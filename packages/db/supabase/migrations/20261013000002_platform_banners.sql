-- Banners da plataforma: o super admin cadastra; aparecem na tela de login do lojista (lado a lado com o formulário)
-- e numa faixa fina acima do dashboard do painel. Cada banner pode levar a um link.

create table public.platform_banners (
  id uuid primary key default gen_random_uuid(),
  placement text not null check (placement in ('login', 'dashboard')),
  title text not null default '' check (length(title) <= 120),
  image_url text not null check (length(image_url) between 1 and 2048),
  link_url text not null default '' check (length(link_url) <= 2048),
  active boolean not null default true,
  sort int not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references public.platform_admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index platform_banners_placement_idx on public.platform_banners(placement, active, sort);
create trigger platform_banners_touch before update on public.platform_banners for each row execute function app.touch_updated_at();

alter table public.platform_banners enable row level security;
create policy platform_all on public.platform_banners for all to platform_api using (true) with check (true);
grant select, insert, update, delete on public.platform_banners to platform_api;
-- a API das lojas só lê (tela de login e painel); escrever é exclusivo do super admin
create policy read_all on public.platform_banners for select to app_api using (true);
grant select on public.platform_banners to app_api;
revoke all on public.platform_banners from anon, authenticated;
