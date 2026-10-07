-- Clientes da loja: conta por loja (login por código enviado ao e-mail), sessões, vínculo com os pedidos
-- e configurações públicas da plataforma (ex.: link da landing page no rodapé das lojas).

-- ---- clientes (um cadastro por loja: o mesmo e-mail em duas lojas são duas contas independentes) ----
create table public.store_customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  email text not null check (email = lower(email) and length(email) between 5 and 160),
  name text not null default '' check (length(name) <= 80),
  phone text not null default '' check (length(phone) <= 20),   -- telefone de contato (login por telefone fica para depois)
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (id, store_id),
  unique (store_id, email),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create index store_customers_store_created_idx on public.store_customers(store_id, created_at desc);
create index store_customers_tenant_idx on public.store_customers(tenant_id);

-- ---- códigos de acesso de uso único (só o hash é guardado) ----
create table public.customer_login_codes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  email text not null,
  name text not null default '', phone text not null default '',   -- dados informados ao pedir o código; viram o cadastro na confirmação
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create index customer_login_codes_lookup_idx on public.customer_login_codes(store_id, email, created_at desc);

-- ---- sessões do cliente (cookie guarda só o token; aqui fica o hash) ----
create table public.customer_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  customer_id uuid not null,
  token_hash text not null unique,
  ip text, user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (customer_id, store_id) references public.store_customers(id, store_id) on delete cascade,
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create index customer_sessions_customer_idx on public.customer_sessions(customer_id);

-- ---- pedidos ligados ao cliente (opcional: pedido sem login continua funcionando) ----
alter table public.orders add column customer_id uuid;
alter table public.orders add foreign key (customer_id, store_id) references public.store_customers(id, store_id) on delete set null (customer_id);
create index orders_customer_idx on public.orders(store_id, customer_id, created_at desc) where customer_id is not null;

-- ---- configurações públicas da plataforma (não são segredos; platform_settings é cifrada) ----
create table public.platform_public_settings (
  key text primary key,
  value text not null default '' check (length(value) <= 500),
  updated_by uuid references public.platform_admins(id),
  updated_at timestamptz not null default now()
);
insert into public.platform_public_settings (key, value) values ('landing_url', 'https://pediulanchou.com.br');

-- ================= RLS =================
do $$ declare t text; begin
  foreach t in array array['store_customers', 'customer_login_codes', 'customer_sessions', 'platform_public_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy platform_all on public.%I for all to platform_api using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to platform_api', t);
  end loop;
  foreach t in array array['store_customers', 'customer_login_codes', 'customer_sessions'] loop
    execute format('create policy tenant_own on public.%I for all to app_api using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant())', t);
  end loop;
end $$;
-- a API da loja cria e altera clientes, códigos e sessões da própria conta; nunca apaga
grant select, insert, update on public.store_customers, public.customer_login_codes, public.customer_sessions to app_api;
-- configurações públicas: leitura para a API das lojas (o rodapé usa), escrita só pela plataforma
create policy read_all on public.platform_public_settings for select to app_api using (true);
grant select on public.platform_public_settings to app_api;

revoke all on public.store_customers, public.customer_login_codes, public.customer_sessions, public.platform_public_settings from anon, authenticated;
