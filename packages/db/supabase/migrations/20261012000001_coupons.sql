-- Cupons de desconto configuráveis por loja: código digitado no checkout, valor fixo ou porcentagem, limites, validade
-- e cupons exclusivos de clientes escolhidos (aparecem na conta do cliente).
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9_-]{3,20}$'),
  description text not null default '' check (length(description) <= 120),
  kind text not null check (kind in ('percent', 'fixed')),
  percent int check (percent between 1 and 100),
  amount_cents int check (amount_cents > 0),
  max_discount_cents int check (max_discount_cents > 0),         -- teto do desconto (útil em porcentagem)
  min_order_cents int not null default 0 check (min_order_cents >= 0),
  starts_at timestamptz, ends_at timestamptz,
  max_uses int check (max_uses > 0),                              -- total de usos (null = sem limite)
  max_uses_per_customer int check (max_uses_per_customer > 0),
  audience text not null default 'all' check (audience in ('all', 'selected')),
  active boolean not null default true,
  used_count int not null default 0 check (used_count >= 0),
  created_at timestamptz not null default now(),
  unique (store_id, code), unique (id, store_id),
  check ((kind = 'percent' and percent is not null and amount_cents is null) or (kind = 'fixed' and amount_cents is not null and percent is null)),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);

create table public.coupon_customers (
  coupon_id uuid not null, store_id uuid not null, tenant_id uuid not null, customer_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (coupon_id, customer_id),
  foreign key (coupon_id, store_id) references public.coupons(id, store_id) on delete cascade,
  foreign key (customer_id, store_id) references public.store_customers(id, store_id) on delete cascade
);

create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null, store_id uuid not null, tenant_id uuid not null,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  customer_id uuid,
  phone_key text not null default '',          -- últimos 8 dígitos do telefone: o limite por cliente vale também para pedido sem conta
  discount_cents int not null check (discount_cents > 0),
  created_at timestamptz not null default now(),
  released_at timestamptz,                      -- pedido cancelado devolve o uso
  foreign key (coupon_id, store_id) references public.coupons(id, store_id) on delete restrict
);
create index coupon_redemptions_customer_idx on public.coupon_redemptions(coupon_id, customer_id) where released_at is null;
create index coupon_redemptions_phone_idx on public.coupon_redemptions(coupon_id, phone_key) where released_at is null;

alter table public.orders add column coupon_code text;

-- cancelou o pedido: o cupom volta a ficar disponível
create or replace function public.release_coupon_on_cancel() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    with r as (update public.coupon_redemptions set released_at = now() where order_id = new.id and released_at is null returning coupon_id)
    update public.coupons c set used_count = greatest(c.used_count - 1, 0) from r where c.id = r.coupon_id;
  end if;
  return new;
end $$;
create trigger orders_release_coupon after update of status on public.orders for each row execute function public.release_coupon_on_cancel();

do $$ declare t text; begin
  foreach t in array array['coupons', 'coupon_customers', 'coupon_redemptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy platform_all on public.%I for all to platform_api using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to platform_api', t);
    execute format('create policy tenant_own on public.%I for all to app_api using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant())', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
grant select, insert, update, delete on public.coupons to app_api;          -- a API só apaga cupom que nunca foi usado (FK protege o resto)
grant select, insert, delete on public.coupon_customers to app_api;
grant select, insert, update on public.coupon_redemptions to app_api;       -- nunca apaga o histórico de uso
