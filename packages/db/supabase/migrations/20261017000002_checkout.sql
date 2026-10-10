-- Novo checkout: e-mail do pedido (para vincular pedidos feitos antes de existir conta) e endereços salvos do cliente.

-- ---- e-mail informado no pedido (minúsculo). Pedidos antigos ficam sem e-mail e não são vinculados automaticamente ----
alter table public.orders add column customer_email text check (customer_email is null or (customer_email = lower(customer_email) and length(customer_email) between 5 and 160));
create index orders_customer_email_idx on public.orders(store_id, customer_email) where customer_id is null and customer_email is not null;

-- ---- endereços salvos (um cliente tem vários; o checkout reaproveita) ----
create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null, customer_id uuid not null,
  label text not null default '' check (length(label) <= 40),
  cep text not null default '' check (cep ~ '^\d{0,8}$'),
  street text not null check (length(street) between 2 and 120),
  number text not null default '' check (length(number) <= 20),
  complement text not null default '' check (length(complement) <= 80),
  district text not null default '' check (length(district) <= 80),
  city text not null default '' check (length(city) <= 80),
  uf text not null default '' check (length(uf) <= 2),
  zone_id uuid,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (customer_id, store_id) references public.store_customers(id, store_id) on delete cascade,
  foreign key (zone_id, store_id) references public.delivery_zones(id, store_id) on delete set null (zone_id),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create index customer_addresses_customer_idx on public.customer_addresses(customer_id, created_at);
create unique index customer_addresses_default_idx on public.customer_addresses(customer_id) where is_default;

alter table public.customer_addresses enable row level security;
create policy platform_all on public.customer_addresses for all to platform_api using (true) with check (true);
grant select, insert, update, delete on public.customer_addresses to platform_api;
create policy tenant_own on public.customer_addresses for all to app_api using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant());
grant select, insert, update, delete on public.customer_addresses to app_api;
