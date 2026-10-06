-- Núcleo: contas (tenants), lojas, super admin com autenticador, tokens do MCP, auditoria, assinaturas e releases.
-- Acesso SOMENTE pelos roles abaixo (conexão direta/pooler). anon e authenticated do Supabase não enxergam nada.

create schema if not exists app;

-- ---- roles de aplicação (sem senha aqui: defina com ALTER ROLE ... PASSWORD no painel do Supabase) ----
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_api')      then create role app_api      login noinherit nobypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'platform_api') then create role platform_api login noinherit nobypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'mcp_agent')    then create role mcp_agent    login noinherit nobypassrls; end if;
end $$;
-- o Supabase precisa deixar o role de migração assumir esses roles (testes e diagnóstico)
grant app_api, platform_api, mcp_agent to postgres;

grant usage on schema public, app to app_api, platform_api, mcp_agent;

-- ---- helpers ----
create or replace function app.current_tenant() returns uuid language sql stable as
$$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create or replace function app.touch_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at = now(); return new; end $$;

-- ---- tipos ----
create type public.store_status as enum ('desenvolvimento', 'producao', 'suspensa', 'arquivada');
create type public.app_role as enum ('admin', 'gerente', 'suporte', 'balcao', 'garcom', 'entregador');

-- ---- contas e lojas ----
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  document text,                       -- CNPJ/CPF (só dígitos)
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger tenants_touch before update on public.tenants for each row execute function app.touch_updated_at();

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$' and char_length(slug) between 3 and 40),
  name text not null check (char_length(name) between 2 and 80),
  status public.store_status not null default 'desenvolvimento',
  status_reason text,
  created_by text not null default 'superadmin',     -- 'superadmin' | 'mcp:<token_id>'
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stores_tenant_idx on public.stores(tenant_id);
create index stores_status_idx on public.stores(status);
create trigger stores_touch before update on public.stores for each row execute function app.touch_updated_at();

create table public.store_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  hostname text not null unique check (hostname = lower(hostname)),
  kind text not null default 'subdomain' check (kind in ('subdomain', 'custom')),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index store_domains_store_idx on public.store_domains(store_id);

-- ---- equipe da loja (login real entra na Fase 1; a tabela já nasce com RLS) ----
create table public.staff_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  email text not null,
  name text not null,
  role public.app_role not null,
  password_hash text,
  pin_hash text,                       -- PIN só vale em dispositivo pareado
  active boolean not null default true,
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

-- ---- super admin (plataforma) ----
create table public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  name text not null,
  password_hash text not null,
  totp_secret_enc text,                -- cifrado (AES-256-GCM, ver @pediu/shared/secrets)
  totp_enabled boolean not null default false,
  totp_last_step bigint,               -- anti-replay: último passo aceito
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table public.platform_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.platform_admins(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  unique (admin_id, code_hash)
);

create table public.platform_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.platform_admins(id) on delete cascade,
  token_hash text not null unique,
  ip inet,
  user_agent text,
  totp_verified boolean not null default false,   -- sessão só vale depois do 2º fator
  stepup_until timestamptz,                       -- janela curta após reconfirmar o código
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index platform_sessions_admin_idx on public.platform_sessions(admin_id);

-- ---- tokens do MCP (só o hash é guardado) ----
create table public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  hint text not null,
  store_limit uuid[],                  -- null = todas as lojas em desenvolvimento
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  last_ip inet,
  created_by uuid references public.platform_admins(id),
  created_at timestamptz not null default now()
);

-- ---- pedido de publicação feito pelo MCP (um humano aprova no super admin) ----
create table public.publication_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  requested_by text not null,          -- 'mcp:<token_id>'
  note text,
  checklist jsonb,
  status text not null default 'pendente' check (status in ('pendente', 'aprovada', 'recusada')),
  decided_by uuid references public.platform_admins(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index publication_requests_one_pending on public.publication_requests(store_id) where status = 'pendente';

-- ---- revisões de configuração (permitem desfazer qualquer alteração do MCP) ----
create table public.store_config_revisions (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  actor text not null,
  entity text not null,                -- 'theme' | 'settings' | 'category' | 'product' | ...
  entity_id text,
  op text not null check (op in ('create', 'update', 'delete')),
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index store_config_revisions_store_idx on public.store_config_revisions(store_id, id desc);

-- ---- auditoria (append-only) ----
create table public.audit_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_kind text not null check (actor_kind in ('superadmin', 'mcp', 'staff', 'billing', 'system')),
  actor_id text,
  tenant_id uuid,
  store_id uuid,
  action text not null,
  ip inet,
  before jsonb,
  after jsonb,
  meta jsonb
);
create index audit_logs_at_idx on public.audit_logs(at desc);
create index audit_logs_store_idx on public.audit_logs(store_id, at desc);

-- ---- planos e assinaturas (Stripe) ----
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  modules text[] not null default '{}',                 -- feature flags liberadas pelo plano
  stripe_product_id text,
  stripe_price_monthly text,
  stripe_price_yearly text,
  stripe_price_setup text,                              -- taxa de implantação (única)
  trial_days int not null default 0 check (trial_days between 0 and 90),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger plans_touch before update on public.plans for each row execute function app.touch_updated_at();

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid references public.plans(id),
  stripe_subscription_id text unique,
  status text not null default 'incomplete' check (status in ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  interval text check (interval in ('month', 'year')),
  amount_cents int check (amount_cents >= 0),          -- valor por período (para MRR; anual é dividido por 12 na consulta)
  currency text not null default 'brl',
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean not null default false,
  past_due_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_tenant_idx on public.subscriptions(tenant_id);
create trigger subscriptions_touch before update on public.subscriptions for each row execute function app.touch_updated_at();

-- configuração da plataforma (chaves do Stripe etc.), sempre cifrada
create table public.platform_settings (
  key text primary key,
  value_enc text not null,
  updated_by uuid references public.platform_admins(id),
  updated_at timestamptz not null default now()
);

-- idempotência de webhooks (Stripe, Mercado Pago, iFood...)
create table public.webhook_inbox (
  id bigint generated always as identity primary key,
  provider text not null,
  event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, event_id)
);

-- ---- releases e versão fixada por loja ----
create table public.releases (
  id uuid primary key default gen_random_uuid(),
  app text not null check (app in ('web', 'print-agent')),          -- 'web' = loja + painel + PDV/garçom/entregador (uma só build)
  version text not null check (version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$'),
  channel text not null default 'beta' check (channel in ('beta', 'estavel')),
  changelog text not null default '',
  min_api text,
  support_ends_at timestamptz,
  created_at timestamptz not null default now(),
  unique (app, version)
);

create table public.store_release_pins (
  store_id uuid not null references public.stores(id) on delete cascade,
  app text not null check (app in ('web')),
  version text,                        -- versão fixa; null = segue o canal
  channel text not null default 'estavel' check (channel in ('beta', 'estavel')),
  updated_at timestamptz not null default now(),
  primary key (store_id, app)
);

-- ================= RLS =================
alter table public.tenants                 enable row level security;
alter table public.stores                  enable row level security;
alter table public.store_domains           enable row level security;
alter table public.staff_users             enable row level security;
alter table public.platform_admins         enable row level security;
alter table public.platform_recovery_codes enable row level security;
alter table public.platform_sessions       enable row level security;
alter table public.mcp_tokens              enable row level security;
alter table public.publication_requests    enable row level security;
alter table public.store_config_revisions  enable row level security;
alter table public.audit_logs              enable row level security;
alter table public.plans                   enable row level security;
alter table public.subscriptions           enable row level security;
alter table public.platform_settings       enable row level security;
alter table public.webhook_inbox           enable row level security;
alter table public.releases                enable row level security;
alter table public.store_release_pins      enable row level security;

-- platform_api: vê e altera tudo da plataforma (as rotas dele exigem super admin + autenticador)
do $$ declare t text; begin
  foreach t in array array['tenants','stores','store_domains','staff_users','platform_admins','platform_recovery_codes','platform_sessions','mcp_tokens',
    'publication_requests','store_config_revisions','audit_logs','plans','subscriptions','platform_settings','webhook_inbox','releases','store_release_pins'] loop
    execute format('create policy platform_all on public.%I for all to platform_api using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to platform_api', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to platform_api, mcp_agent, app_api;

-- app_api (API das lojas): só enxerga a própria conta, definida por SET LOCAL app.tenant_id em cada transação
create policy tenant_own on public.tenants        for select to app_api using (id = app.current_tenant());
create policy tenant_own on public.stores         for select to app_api using (tenant_id = app.current_tenant());
create policy tenant_own on public.store_domains  for select to app_api using (tenant_id = app.current_tenant());
create policy tenant_own on public.staff_users    for all    to app_api using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant());
create policy tenant_own on public.subscriptions  for select to app_api using (tenant_id = app.current_tenant());
grant select on public.tenants, public.stores, public.store_domains, public.subscriptions to app_api;
grant select, insert, update, delete on public.staff_users to app_api;
grant select on public.plans, public.releases, public.store_release_pins to app_api;
create policy read_all on public.plans              for select to app_api using (true);
create policy read_all on public.releases           for select to app_api using (true);
create policy pin_own  on public.store_release_pins for select to app_api
  using (exists (select 1 from public.stores s where s.id = store_id and s.tenant_id = app.current_tenant()));
grant insert on public.audit_logs to app_api, mcp_agent;
create policy append_only_app on public.audit_logs for insert to app_api with check (true);
create policy append_only_mcp on public.audit_logs for insert to mcp_agent with check (actor_kind = 'mcp');

-- mcp_agent: lê lojas e assinaturas; cria lojas SEMPRE em desenvolvimento; nunca muda status
grant select on public.tenants, public.stores, public.subscriptions, public.plans to mcp_agent;
create policy mcp_read on public.tenants       for select to mcp_agent using (true);
create policy mcp_read on public.stores        for select to mcp_agent using (status <> 'arquivada');
create policy mcp_read on public.subscriptions for select to mcp_agent using (true);
create policy mcp_read on public.plans         for select to mcp_agent using (true);

grant insert on public.tenants to mcp_agent;
create policy mcp_new_tenant on public.tenants for insert to mcp_agent with check (true);

-- Camada 3 da trava: este helper é a fonte da verdade usada pelas políticas de escrita do catálogo.
create or replace function app.store_in_dev(p_store uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.stores s where s.id = p_store and s.status = 'desenvolvimento') $$;
revoke all on function app.store_in_dev(uuid) from public;
grant execute on function app.store_in_dev(uuid) to app_api, platform_api, mcp_agent;

grant insert on public.stores to mcp_agent;
create policy mcp_new_store on public.stores for insert to mcp_agent
  with check (status = 'desenvolvimento' and created_by like 'mcp:%');
-- só nome e slug (a coluna status NÃO está na lista), e só enquanto a loja está em desenvolvimento
grant update (name, slug) on public.stores to mcp_agent;
create policy mcp_edit_store on public.stores for update to mcp_agent
  using (status = 'desenvolvimento') with check (status = 'desenvolvimento');

grant select, insert on public.publication_requests to mcp_agent;
create policy mcp_request on public.publication_requests for insert to mcp_agent
  with check (status = 'pendente' and app.store_in_dev(store_id));
create policy mcp_request_read on public.publication_requests for select to mcp_agent using (true);

grant select, insert on public.store_config_revisions to mcp_agent;
create policy mcp_rev_insert on public.store_config_revisions for insert to mcp_agent with check (app.store_in_dev(store_id));
create policy mcp_rev_read   on public.store_config_revisions for select to mcp_agent using (true);

grant select, insert on public.store_domains to mcp_agent;
create policy mcp_read_domain on public.store_domains for select to mcp_agent using (true);
create policy mcp_new_domain  on public.store_domains for insert to mcp_agent
  with check (kind = 'subdomain' and app.store_in_dev(store_id));

-- Autenticação do MCP: o role mcp_agent NÃO lê mcp_tokens; só chama esta função, que valida o hash e registra o uso.
create or replace function app.mcp_authenticate(p_hash text, p_ip text)
returns table (id uuid, store_limit uuid[]) language sql security definer set search_path = public as
$$ update public.mcp_tokens set last_used_at = now(), last_ip = nullif(p_ip, '')::inet
   where token_hash = p_hash and revoked_at is null and expires_at > now()
   returning mcp_tokens.id, mcp_tokens.store_limit $$;
revoke all on function app.mcp_authenticate(text, text) from public;
grant execute on function app.mcp_authenticate(text, text) to mcp_agent;

-- ---- anon/authenticated do Supabase não acessam nada (PostgREST fica sem tabelas) ----
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
