-- Fase 1: pedidos reais e login da equipe das lojas.
-- Dados de clientes (nome, telefone, endereço) ficam FORA do alcance do MCP: só app_api (por conta) e platform_api.

-- ---- equipe: bloqueio por tentativas e sessões ----
alter table public.staff_users
  add column failed_attempts int not null default 0,
  add column locked_until timestamptz,
  add column last_login_at timestamptz,
  add constraint staff_email_lower check (email = lower(email));

create table public.staff_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  staff_id uuid not null references public.staff_users(id) on delete cascade,
  token_hash text not null unique,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index staff_sessions_staff_idx on public.staff_sessions(staff_id);

-- ---- pedidos ----
alter table public.delivery_zones add constraint delivery_zones_id_store_uk unique (id, store_id);   -- permite FK composta (zona só da própria loja)

create table public.order_counters (
  store_id uuid primary key references public.stores(id) on delete cascade,
  tenant_id uuid not null,
  last int not null default 1000
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  number int not null,
  channel text not null default 'loja' check (channel in ('loja', 'pdv', 'garcom', 'ifood')),
  type text not null check (type in ('delivery', 'retirada', 'mesa')),
  status text not null default 'novo' check (status in ('novo', 'preparo', 'pronto', 'saiu', 'entregue', 'cancelado')),
  customer_name text not null default '', customer_phone text not null default '',
  address text not null default '',
  zone_id uuid,
  table_number int check (table_number is null or table_number > 0),
  note text not null default '',
  subtotal_cents int not null check (subtotal_cents >= 0),
  fee_cents int not null default 0 check (fee_cents >= 0),
  discount_cents int not null default 0 check (discount_cents >= 0),
  total_cents int not null check (total_cents >= 0),
  payment_method text not null default '',
  change_for_cents int check (change_for_cents is null or change_for_cents >= 0),
  paid boolean not null default false,
  paid_at timestamptz, paid_method text,
  courier_id uuid references public.staff_users(id) on delete set null,
  created_by uuid references public.staff_users(id) on delete set null,
  tracking_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  accepted_at timestamptz, ready_at timestamptz, dispatched_at timestamptz, delivered_at timestamptz,
  cancelled_at timestamptz, cancel_reason text,
  unique (id, store_id),
  unique (store_id, number),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade,
  foreign key (zone_id, store_id) references public.delivery_zones(id, store_id) on delete set null (zone_id),
  check (total_cents = subtotal_cents + fee_cents - discount_cents),
  check (type <> 'mesa' or table_number is not null),
  check (type <> 'delivery' or address <> '')
);
create index orders_store_created_idx on public.orders(store_id, created_at desc);
create index orders_store_status_idx on public.orders(store_id, status);
create index orders_tenant_idx on public.orders(tenant_id);
-- no máximo uma comanda aberta por mesa
create unique index orders_open_table_uk on public.orders(store_id, table_number) where type = 'mesa' and status not in ('entregue', 'cancelado');

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null, store_id uuid not null, tenant_id uuid not null,
  product_id uuid,
  name text not null,
  qty int not null check (qty between 1 and 99),
  unit_cents int not null check (unit_cents >= 0),
  total_cents int not null check (total_cents = unit_cents * qty),
  note text not null default '',
  addons jsonb not null default '[]'::jsonb,           -- [{group, name, priceCents}] (cópia do momento da compra)
  print_zone_id uuid,
  created_at timestamptz not null default now(),
  foreign key (order_id, store_id) references public.orders(id, store_id) on delete cascade,
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create index order_items_order_idx on public.order_items(order_id);
create index order_items_product_idx on public.order_items(store_id, product_id);

-- histórico (append-only): base dos tempos de preparo/entrega e da linha do tempo de cada pedido
create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null, store_id uuid not null, tenant_id uuid not null,
  at timestamptz not null default now(),
  actor_kind text not null check (actor_kind in ('customer', 'staff', 'system')),
  actor_id text,
  event text not null,
  data jsonb,
  foreign key (order_id, store_id) references public.orders(id, store_id) on delete cascade
);
create index order_events_order_idx on public.order_events(order_id, id);
create index order_events_store_idx on public.order_events(store_id, at desc);

-- ================= RLS =================
do $$ declare t text; begin
  foreach t in array array['staff_sessions', 'order_counters', 'orders', 'order_items', 'order_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy platform_all on public.%I for all to platform_api using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to platform_api', t);
    execute format('create policy tenant_own on public.%I for all to app_api using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant())', t);
  end loop;
end $$;
grant select, insert, update on public.staff_sessions, public.order_counters, public.orders to app_api;
grant select, insert on public.order_items, public.order_events to app_api;       -- itens e eventos não são editáveis depois de gravados
grant usage, select on all sequences in schema public to app_api;

-- ---- funções públicas, mínimas (security definer): resolver loja, sessão da equipe e acompanhamento por token ----
create or replace function app.resolve_store(p_slug text)
returns table (store_id uuid, tenant_id uuid, name text, status public.store_status)
language sql stable security definer set search_path = public as
$$ select s.id, s.tenant_id, s.name, s.status from public.stores s where s.slug = lower(p_slug) and s.status <> 'arquivada' $$;

create or replace function app.resolve_store_by_host(p_host text)
returns table (store_id uuid, tenant_id uuid, name text, status public.store_status)
language sql stable security definer set search_path = public as
$$ select s.id, s.tenant_id, s.name, s.status from public.stores s join public.store_domains d on d.store_id = s.id
   where d.hostname = lower(p_host) and d.verified_at is not null and s.status <> 'arquivada' $$;

-- valida o token da sessão da equipe, renova o último uso e devolve quem é (antes de saber o tenant)
create or replace function app.staff_session(p_hash text, p_now timestamptz, p_idle_seconds int)
returns table (session_id uuid, staff_id uuid, tenant_id uuid, store_id uuid, role public.app_role, name text)
language sql security definer set search_path = public as
$$ update public.staff_sessions ss set last_seen_at = p_now
   from public.staff_users u
   where ss.token_hash = p_hash and ss.revoked_at is null and ss.expires_at > p_now
     and ss.last_seen_at > p_now - make_interval(secs => p_idle_seconds)
     and u.id = ss.staff_id and u.active
   returning ss.id, ss.staff_id, ss.tenant_id, ss.store_id, u.role, u.name $$;

-- acompanhamento público: só o necessário (sem telefone nem endereço)
create or replace function app.order_by_token(p_token text)
returns table (number int, status text, type text, total_cents int, created_at timestamptz, accepted_at timestamptz, ready_at timestamptz,
               dispatched_at timestamptz, delivered_at timestamptz, cancelled_at timestamptz, store_name text, items jsonb)
language sql stable security definer set search_path = public as
$$ select o.number, o.status, o.type, o.total_cents, o.created_at, o.accepted_at, o.ready_at, o.dispatched_at, o.delivered_at, o.cancelled_at, s.name,
          coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty) order by i.created_at) from public.order_items i where i.order_id = o.id), '[]')
   from public.orders o join public.stores s on s.id = o.store_id where o.tracking_token = p_token $$;

revoke all on function app.resolve_store(text), app.resolve_store_by_host(text), app.staff_session(text, timestamptz, int), app.order_by_token(text) from public;
grant execute on function app.resolve_store(text), app.resolve_store_by_host(text), app.staff_session(text, timestamptz, int), app.order_by_token(text) to app_api;
grant execute on function app.resolve_store(text), app.order_by_token(text) to platform_api;

revoke all on all tables in schema public from anon, authenticated;
