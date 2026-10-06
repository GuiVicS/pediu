-- Observabilidade do super admin: métricas por minuto, logs operacionais, regras e alertas.
-- A escrita de métricas e logs passa por funções security definer (nenhum role de aplicação ganha acesso às tabelas).

create table public.metrics_minute (
  bucket timestamptz not null,                                     -- início do minuto
  scope text not null check (scope in ('platform', 'store', 'mcp', 'webhook')),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000000',
  store_id uuid not null default '00000000-0000-0000-0000-000000000000',   -- sentinela = sem loja
  route text not null check (char_length(route) <= 120),
  method text not null default '',
  status_class text not null,                                      -- '2xx' | '4xx' | '5xx' | 'ok' | 'error'
  count int not null default 0,
  errors int not null default 0,
  sum_ms bigint not null default 0,
  max_ms int not null default 0,
  b0 int not null default 0, b1 int not null default 0, b2 int not null default 0, b3 int not null default 0,
  b4 int not null default 0, b5 int not null default 0, b6 int not null default 0,   -- histograma: ≤50 ≤100 ≤250 ≤500 ≤1000 ≤2500 >2500 ms
  primary key (bucket, scope, store_id, route, method, status_class)
);
create index metrics_scope_bucket_idx on public.metrics_minute(scope, bucket desc);
create index metrics_store_bucket_idx on public.metrics_minute(store_id, bucket desc) where store_id <> '00000000-0000-0000-0000-000000000000';

create table public.app_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  service text not null check (service in ('api', 'mcp', 'worker', 'print', 'payments')),
  tenant_id uuid, store_id uuid,
  request_id text,
  event text not null check (char_length(event) <= 80),
  message text not null check (char_length(message) <= 1000),
  status int, duration_ms int,
  data jsonb
);
create index app_logs_store_at_idx on public.app_logs(store_id, at desc) where store_id is not null;
create index app_logs_level_at_idx on public.app_logs(level, at desc);
create index app_logs_at_idx on public.app_logs(at desc);

create table public.alert_rules (
  key text primary key,
  scope text not null check (scope in ('store', 'platform', 'billing', 'security')),
  severity text not null check (severity in ('info', 'warn', 'critical')),
  title text not null,
  description text not null default '',
  enabled boolean not null default true,
  params jsonb not null default '{}'::jsonb,
  cooldown_min int not null default 60 check (cooldown_min >= 1),
  updated_at timestamptz not null default now()
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null references public.alert_rules(key) on delete cascade,
  severity text not null check (severity in ('info', 'warn', 'critical')),
  tenant_id uuid, store_id uuid,
  title text not null,
  detail jsonb,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  dedupe_key text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  occurrences int not null default 1,
  last_notified_at timestamptz,
  ack_by uuid references public.platform_admins(id), ack_at timestamptz,
  resolved_at timestamptz, resolved_by text
);
-- uma única ocorrência aberta (ou reconhecida) por condição
create unique index alerts_open_dedupe_uk on public.alerts(dedupe_key) where status <> 'resolved';
create index alerts_status_idx on public.alerts(status, last_seen desc);
create index alerts_store_idx on public.alerts(store_id, last_seen desc);

insert into public.alert_rules (key, scope, severity, title, description, params, cooldown_min) values
  ('store.no_orders',       'store',    'warn',     'Loja sem pedidos',                 'Loja no ar que vendia e não recebeu pedidos na janela.',                 '{"hours":24,"min_prev_orders":5,"prev_days":7}', 360),
  ('store.cancel_rate',     'store',    'warn',     'Taxa de cancelamento alta',        'Cancelamentos acima do limite na janela.',                                '{"window_hours":24,"min_orders":10,"max_rate":0.2}', 360),
  ('store.slow_prep',       'store',    'warn',     'Preparo lento',                    'Tempo médio entre aceitar e ficar pronto acima do limite.',               '{"window_hours":24,"min_orders":5,"max_avg_minutes":45}', 360),
  ('store.order_stuck',     'store',    'critical', 'Pedido parado sem aceite',         'Pedido novo esperando aceite há mais tempo que o limite.',                '{"max_minutes":10}', 30),
  ('platform.api_errors',   'platform', 'critical', 'Erros 5xx na API',                 'Taxa de erros 5xx acima do limite.',                                      '{"window_min":5,"min_requests":50,"max_rate":0.02}', 30),
  ('platform.api_latency',  'platform', 'warn',     'API lenta',                        'Latência p95 acima do limite.',                                           '{"window_min":5,"min_requests":50,"max_p95_ms":1500}', 60),
  ('platform.webhook_stuck','platform', 'warn',     'Webhook sem processar',            'Eventos recebidos que não foram processados.',                            '{"stuck_min":10}', 60),
  ('security.auth_failures','security', 'critical', 'Falhas de login em excesso',       'Muitas falhas de autenticação do super admin em pouco tempo.',            '{"window_min":10,"max":10}', 30),
  ('billing.past_due',      'billing',  'warn',     'Assinatura em atraso',             'Conta com pagamento em atraso (a loja é suspensa após a carência).',      '{}', 720),
  ('mcp.token_expiring',    'platform', 'info',     'Token do MCP perto de vencer',     'Token do MCP expira em breve.',                                           '{"days":7}', 1440);

-- ---- escrita por funções (security definer) ----
create or replace function app.record_metrics(p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare r jsonb; z constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 500 then raise exception 'metrics: lote inválido'; end if;
  for r in select * from jsonb_array_elements(p) loop
    insert into public.metrics_minute (bucket, scope, tenant_id, store_id, route, method, status_class, count, errors, sum_ms, max_ms, b0, b1, b2, b3, b4, b5, b6)
    values (date_trunc('minute', (r->>'bucket')::timestamptz), r->>'scope', coalesce((r->>'tenant_id')::uuid, z), coalesce((r->>'store_id')::uuid, z),
            left(r->>'route', 120), coalesce(r->>'method', ''), r->>'status_class',
            (r->>'count')::int, coalesce((r->>'errors')::int, 0), (r->>'sum_ms')::bigint, (r->>'max_ms')::int,
            coalesce((r->>'b0')::int, 0), coalesce((r->>'b1')::int, 0), coalesce((r->>'b2')::int, 0), coalesce((r->>'b3')::int, 0),
            coalesce((r->>'b4')::int, 0), coalesce((r->>'b5')::int, 0), coalesce((r->>'b6')::int, 0))
    on conflict (bucket, scope, store_id, route, method, status_class) do update set
      count = metrics_minute.count + excluded.count, errors = metrics_minute.errors + excluded.errors,
      sum_ms = metrics_minute.sum_ms + excluded.sum_ms, max_ms = greatest(metrics_minute.max_ms, excluded.max_ms),
      b0 = metrics_minute.b0 + excluded.b0, b1 = metrics_minute.b1 + excluded.b1, b2 = metrics_minute.b2 + excluded.b2, b3 = metrics_minute.b3 + excluded.b3,
      b4 = metrics_minute.b4 + excluded.b4, b5 = metrics_minute.b5 + excluded.b5, b6 = metrics_minute.b6 + excluded.b6;
  end loop;
end $$;

create or replace function app.write_logs(p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 500 then raise exception 'logs: lote inválido'; end if;
  for r in select * from jsonb_array_elements(p) loop
    insert into public.app_logs (at, level, service, tenant_id, store_id, request_id, event, message, status, duration_ms, data)
    values (coalesce((r->>'at')::timestamptz, now()), r->>'level', r->>'service', (r->>'tenant_id')::uuid, (r->>'store_id')::uuid, r->>'request_id',
            left(r->>'event', 80), left(r->>'message', 1000), (r->>'status')::int, (r->>'duration_ms')::int, r->'data');
  end loop;
end $$;

revoke all on function app.record_metrics(jsonb), app.write_logs(jsonb) from public;
grant execute on function app.record_metrics(jsonb), app.write_logs(jsonb) to app_api, platform_api, mcp_agent;

-- ---- leitura e gestão: só a plataforma ----
alter table public.metrics_minute enable row level security;
alter table public.app_logs enable row level security;
alter table public.alert_rules enable row level security;
alter table public.alerts enable row level security;
create policy platform_all on public.metrics_minute for all to platform_api using (true) with check (true);
create policy platform_all on public.app_logs       for all to platform_api using (true) with check (true);
create policy platform_all on public.alert_rules    for all to platform_api using (true) with check (true);
create policy platform_all on public.alerts         for all to platform_api using (true) with check (true);
grant select, insert, update, delete on public.metrics_minute, public.app_logs, public.alert_rules, public.alerts to platform_api;

revoke all on all tables in schema public from anon, authenticated;
