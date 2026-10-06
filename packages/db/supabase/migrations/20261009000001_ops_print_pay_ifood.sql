-- Fase operação: impressão por zonas, gateways de pagamento, iFood, destaques e domínios próprios.

-- ---------- destaques do cardápio ----------
create table public.featured_products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  product_id uuid not null,
  sort int not null default 0, active boolean not null default true,
  unique (product_id),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade,
  foreign key (product_id, store_id) references public.products(id, store_id) on delete cascade
);

-- ---------- impressão ----------
alter table public.print_zones
  add column is_default boolean not null default false,                       -- recebe os itens de categorias sem zona
  add column events text[] not null default array['novo', 'items_added', 'cancelado'];   -- quando imprime: novo | preparo | items_added | pronto | cancelado
create unique index print_zones_one_default on public.print_zones(store_id) where is_default;

create table public.print_agents (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  name text not null,
  token_hash text not null unique,
  platform text, version text,
  last_seen_at timestamptz,
  discovered jsonb not null default '[]'::jsonb,        -- impressoras que o agente enxerga (informadas no "hello")
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, store_id),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);

create table public.print_pairing_codes (
  code_hash text primary key,
  store_id uuid not null, tenant_id uuid not null,
  expires_at timestamptz not null, used_at timestamptz,
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);

create table public.printers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  agent_id uuid,
  name text not null,
  connection text not null check (connection in ('rede', 'windows', 'cups')),
  address text not null,                                -- rede: ip:porta | windows: nome do compartilhamento | cups: nome da fila
  paper text not null default '80mm' check (paper in ('58mm', '80mm')),
  columns int not null default 48 check (columns between 20 and 80),
  codepage text not null default 'cp860' check (codepage in ('cp860', 'cp850', 'cp437')),
  cut boolean not null default true, drawer boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, store_id),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade,
  foreign key (agent_id, store_id) references public.print_agents(id, store_id) on delete set null (agent_id)
);

create table public.zone_printers (
  store_id uuid not null, tenant_id uuid not null,
  zone_id uuid not null, printer_id uuid not null,
  priority int not null default 0,                      -- 0 = principal; 1, 2… = reserva (failover)
  copies int not null default 1 check (copies between 1 and 5),
  primary key (zone_id, printer_id),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade,
  foreign key (zone_id, store_id) references public.print_zones(id, store_id) on delete cascade,
  foreign key (printer_id, store_id) references public.printers(id, store_id) on delete cascade
);

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  order_id uuid, zone_id uuid, printer_id uuid,
  kind text not null,                                   -- novo | preparo | items_added | pronto | cancelado | reimpressao | teste | conta
  dedupe_key text not null,                             -- impede imprimir duas vezes o mesmo evento
  data_b64 text not null,                               -- bytes ESC/POS em base64
  preview text not null default '',                     -- mesmo cupom em texto (para a tela)
  status text not null default 'pendente' check (status in ('pendente', 'enviado', 'impresso', 'falhou')),
  attempts int not null default 0,
  tried_printers uuid[] not null default '{}',
  last_error text,
  created_at timestamptz not null default now(), sent_at timestamptz, printed_at timestamptz,
  unique (store_id, dedupe_key),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create index print_jobs_store_status_idx on public.print_jobs(store_id, status, created_at desc);
create index print_jobs_pending_idx on public.print_jobs(status) where status in ('pendente', 'enviado');
create index print_jobs_order_idx on public.print_jobs(order_id);

-- ---------- gateways de pagamento (credenciais sempre cifradas) ----------
create table public.store_gateways (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  provider text not null check (provider in ('mercadopago', 'sicoob')),
  credentials_enc text not null,
  status text not null default 'ativo' check (status in ('ativo', 'inativo')),
  meta jsonb not null default '{}'::jsonb,              -- dados não sensíveis (ex.: apelido da conta)
  updated_at timestamptz not null default now(),
  unique (store_id, provider),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);

create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null, store_id uuid not null, tenant_id uuid not null,
  provider text not null check (provider in ('mercadopago', 'sicoob')),
  method text not null check (method in ('pix', 'card')),
  external_id text,                                     -- id do pagamento no provedor
  txid text,
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado', 'cancelado', 'expirado', 'estornado')),
  amount_cents int not null check (amount_cents > 0),
  qr_code text,                                         -- copia-e-cola do Pix
  checkout_url text,
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, external_id),
  foreign key (order_id, store_id) references public.orders(id, store_id) on delete cascade
);
create index order_payments_order_idx on public.order_payments(order_id);
create index order_payments_pending_idx on public.order_payments(status) where status = 'pendente';

-- pedido que só vale depois de pago (Pix/cartão online): fica 'aguardando' até o webhook confirmar
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('aguardando', 'novo', 'preparo', 'pronto', 'saiu', 'entregue', 'cancelado'));
alter table public.orders add column external_provider text, add column external_ref text, add column external_data jsonb;
create unique index orders_external_uk on public.orders(store_id, external_provider, external_ref) where external_ref is not null;

-- forma de pagamento "online": cobra pelo gateway (Pix/cartão) em vez de receber na entrega
alter table public.payment_methods
  add column online boolean not null default false,
  add column gateway text check (gateway in ('mercadopago', 'sicoob')),
  add constraint payment_online_needs_gateway check (not online or gateway is not null);

-- consulta pública do pagamento pendente de um pedido (pelo token de acompanhamento): só o necessário para mostrar o QR/checkout
create or replace function app.payment_by_token(p_token text)
returns table (status text, method text, qr_code text, checkout_url text, expires_at timestamptz, amount_cents int, order_status text)
language sql stable security definer set search_path = public as
$$ select p.status, p.method, p.qr_code, p.checkout_url, p.expires_at, p.amount_cents, o.status
   from public.orders o join public.order_payments p on p.order_id = o.id where o.tracking_token = p_token order by p.created_at desc limit 1 $$;
revoke all on function app.payment_by_token(text) from public;
grant execute on function app.payment_by_token(text) to app_api;

-- ---------- iFood ----------
create table public.ifood_links (
  store_id uuid primary key, tenant_id uuid not null,
  merchant_id text not null unique,
  active boolean not null default true,
  last_event_at timestamptz, last_error text,
  created_at timestamptz not null default now(),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create table public.ifood_item_map (
  store_id uuid not null, tenant_id uuid not null,
  external_code text not null,
  product_id uuid not null,
  primary key (store_id, external_code),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade,
  foreign key (product_id, store_id) references public.products(id, store_id) on delete cascade
);
create table public.ifood_events (
  event_id text primary key,
  merchant_id text, order_ref text, code text,
  received_at timestamptz not null default now(), processed_at timestamptz, error text
);

-- ---------- domínios próprios ----------
alter table public.store_domains add column verify_token text, add column verify_error text, add column verified_checked_at timestamptz;

-- ================= RLS =================
do $$ declare t text; begin
  foreach t in array array['featured_products', 'print_agents', 'print_pairing_codes', 'printers', 'zone_printers', 'print_jobs', 'store_gateways', 'order_payments', 'ifood_links', 'ifood_item_map'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy platform_all on public.%I for all to platform_api using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to platform_api', t);
    execute format('create policy tenant_own on public.%I for all to app_api using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant())', t);
    execute format('grant select, insert, update, delete on public.%I to app_api', t);
  end loop;
end $$;
alter table public.ifood_events enable row level security;
create policy platform_all on public.ifood_events for all to platform_api using (true) with check (true);
grant select, insert, update, delete on public.ifood_events to platform_api;
grant update on public.orders to platform_api;

-- as credenciais cifradas dos gateways não são lidas pelo role da API de loja depois de gravadas: só o painel mostra "configurado"
revoke select on public.store_gateways from app_api;
grant select (id, store_id, tenant_id, provider, status, meta, updated_at) on public.store_gateways to app_api;
grant insert, update, delete on public.store_gateways to app_api;

-- ---------- autenticação do Print Agent (antes de saber a conta) ----------
create or replace function app.agent_auth(p_hash text)
returns table (agent_id uuid, store_id uuid, tenant_id uuid)
language sql security definer set search_path = public as
$$ update public.print_agents set last_seen_at = now() where token_hash = p_hash and revoked_at is null returning id, store_id, tenant_id $$;

create or replace function app.agent_pair(p_code_hash text, p_token_hash text, p_name text, p_platform text, p_version text)
returns table (agent_id uuid, store_id uuid, tenant_id uuid)
language plpgsql security definer set search_path = public as $$
declare c record; a uuid;
begin
  update public.print_pairing_codes set used_at = now() where code_hash = p_code_hash and used_at is null and expires_at > now() returning * into c;
  if c.code_hash is null then return; end if;
  insert into public.print_agents (store_id, tenant_id, name, token_hash, platform, version, last_seen_at)
  values (c.store_id, c.tenant_id, left(p_name, 60), p_token_hash, p_platform, p_version, now()) returning id into a;
  return query select a, c.store_id, c.tenant_id;
end $$;

revoke all on function app.agent_auth(text), app.agent_pair(text, text, text, text, text) from public;
grant execute on function app.agent_auth(text), app.agent_pair(text, text, text, text, text) to app_api, platform_api;

-- ---------- resolução da loja pelo domínio (serve o web-edge e a loja) ----------
create or replace function app.resolve_host(p_host text)
returns table (store_id uuid, slug text, status public.store_status)
language sql stable security definer set search_path = public as
$$ select s.id, s.slug, s.status from public.stores s join public.store_domains d on d.store_id = s.id
   where d.hostname = lower(p_host) and d.verified_at is not null and s.status <> 'arquivada' $$;
revoke all on function app.resolve_host(text) from public;
grant execute on function app.resolve_host(text) to app_api, platform_api;

revoke all on all tables in schema public from anon, authenticated;
