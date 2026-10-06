-- Catálogo e configuração da loja: tudo que o MCP personaliza enquanto a loja está em desenvolvimento.
-- Toda linha carrega tenant_id e store_id; chaves compostas impedem referências entre lojas/contas diferentes.

alter table public.stores add constraint stores_id_tenant_uk unique (id, tenant_id);

-- aparência (tema completo, validado por ThemeInput em @pediu/shared) e dados da loja (horários, pedido mínimo, etc.)
create table public.store_themes (
  store_id uuid primary key,
  tenant_id uuid not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create table public.store_settings (
  store_id uuid primary key,
  tenant_id uuid not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);

create table public.print_zones (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  name text not null, description text not null default '',
  paper text not null default '80mm' check (paper in ('58mm', '80mm')),
  copies int not null default 1 check (copies between 1 and 5),
  auto_print boolean not null default true, show_prices boolean not null default false, active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, store_id),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  name text not null, image_url text not null default '',
  image_fit text not null default 'cover' check (image_fit in ('cover', 'contain')),
  sort int not null default 0, active boolean not null default true,
  print_zone_id uuid,
  created_at timestamptz not null default now(),
  unique (id, store_id),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade,
  foreign key (print_zone_id, store_id) references public.print_zones(id, store_id) on delete set null (print_zone_id)
);
create index categories_store_idx on public.categories(store_id, sort);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  category_id uuid not null,
  name text not null, description text not null default '', notes text not null default '',
  price numeric(10,2) not null check (price >= 0),
  image_url text not null default '', image_fit text not null default 'cover' check (image_fit in ('cover', 'contain')),
  prep_time int not null default 0, active boolean not null default true, available boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, store_id),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade,
  foreign key (category_id, store_id) references public.categories(id, store_id) on delete cascade
);
create index products_store_idx on public.products(store_id, category_id, sort);

create table public.addon_groups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  name text not null, description text not null default '',
  min int not null default 0, max int not null default 1 check (max >= 1), required boolean not null default false,
  pricing text not null default 'sum' check (pricing in ('sum', 'highest', 'lowest', 'average')),
  sort int not null default 0, active boolean not null default true,
  unique (id, store_id),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create table public.addons (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  group_id uuid not null,
  name text not null, price numeric(10,2) not null default 0 check (price >= 0),
  sort int not null default 0, active boolean not null default true,
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade,
  foreign key (group_id, store_id) references public.addon_groups(id, store_id) on delete cascade
);
create table public.product_addon_groups (
  store_id uuid not null, tenant_id uuid not null,
  product_id uuid not null, group_id uuid not null,
  primary key (product_id, group_id),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade,
  foreign key (product_id, store_id) references public.products(id, store_id) on delete cascade,
  foreign key (group_id, store_id) references public.addon_groups(id, store_id) on delete cascade
);

create table public.banners (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  title text not null default '', description text not null default '', image_url text not null,
  sort int not null default 0, active boolean not null default true,
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  name text not null, fee numeric(10,2) not null check (fee >= 0), eta int not null default 0, active boolean not null default true,
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
-- formas de pagamento oferecidas (liga/desliga e textos). Credenciais dos gateways ficam em outra tabela, fora do alcance do MCP.
create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  name text not null, type text not null check (type in ('pix', 'cash', 'credit', 'debit', 'voucher')),
  note text not null default '', sort int not null default 0, active boolean not null default true,
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);

-- ================= RLS do catálogo =================
do $$ declare t text; begin
  foreach t in array array['store_themes','store_settings','print_zones','categories','products','addon_groups','addons','product_addon_groups','banners','delivery_zones','payment_methods'] loop
    execute format('alter table public.%I enable row level security', t);

    -- plataforma: tudo
    execute format('create policy platform_all on public.%I for all to platform_api using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to platform_api', t);

    -- API das lojas: só a própria conta
    execute format('create policy tenant_own on public.%I for all to app_api using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant())', t);
    execute format('grant select, insert, update, delete on public.%I to app_api', t);

    -- MCP: lê tudo; escreve SOMENTE se a loja está em desenvolvimento (camada 3 da trava)
    execute format('create policy mcp_read on public.%I for select to mcp_agent using (true)', t);
    execute format('create policy mcp_ins  on public.%I for insert to mcp_agent with check (app.store_in_dev(store_id))', t);
    execute format('create policy mcp_upd  on public.%I for update to mcp_agent using (app.store_in_dev(store_id)) with check (app.store_in_dev(store_id))', t);
    execute format('create policy mcp_del  on public.%I for delete to mcp_agent using (app.store_in_dev(store_id))', t);
    execute format('grant select, insert, update, delete on public.%I to mcp_agent', t);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
