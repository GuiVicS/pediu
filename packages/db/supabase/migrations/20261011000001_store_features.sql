-- Funcionalidades liberadas por loja (checklist do super admin). Linha ausente = desativada.
create table public.store_features (
  store_id uuid not null, tenant_id uuid not null,
  feature text not null check (feature ~ '^[a-z_]{2,40}$'),
  enabled boolean not null default false,
  updated_by uuid references public.platform_admins(id),
  updated_at timestamptz not null default now(),
  primary key (store_id, feature),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create index store_features_tenant_idx on public.store_features(tenant_id);

alter table public.store_features enable row level security;
create policy platform_all on public.store_features for all to platform_api using (true) with check (true);
grant select, insert, update, delete on public.store_features to platform_api;
-- a loja só lê as próprias liberações; quem libera é a plataforma
create policy tenant_read on public.store_features for select to app_api using (tenant_id = app.current_tenant());
grant select on public.store_features to app_api;
revoke all on public.store_features from anon, authenticated;
