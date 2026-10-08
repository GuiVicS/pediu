-- Hub de integrações (apps instaláveis por loja) e checkout transparente de cartão (Mercado Pago).

-- ---------- checkout transparente: cada envio de cartão é uma tentativa (chave de idempotência própria) ----------
alter table public.order_payments add column attempts int not null default 0;

-- ---------- apps instalados na loja ----------
-- Mercado Pago e Sicoob: instalados quando as credenciais são salvas. iFood e WhatsApp: instalados no hub (o menu só mostra o que está instalado).
create table public.store_apps (
  store_id uuid not null, tenant_id uuid not null,
  app text not null check (app in ('mercadopago', 'sicoob', 'ifood', 'whatsapp')),
  installed_at timestamptz not null default now(),
  installed_by uuid,
  primary key (store_id, app),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
alter table public.store_apps enable row level security;
create policy platform_all on public.store_apps for all to platform_api using (true) with check (true);
grant select, insert, update, delete on public.store_apps to platform_api;
create policy tenant_own on public.store_apps for all to app_api using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant());
grant select, insert, update, delete on public.store_apps to app_api;
create policy mcp_read on public.store_apps for select to mcp_agent using (true);
grant select on public.store_apps to mcp_agent;

-- quem já usava continua vendo tudo: gateways conectados, iFood vinculado e WhatsApp em uso viram apps instalados
insert into public.store_apps (store_id, tenant_id, app)
  select store_id, tenant_id, provider from public.store_gateways on conflict do nothing;
insert into public.store_apps (store_id, tenant_id, app)
  select store_id, tenant_id, 'ifood' from public.ifood_links on conflict do nothing;
insert into public.store_apps (store_id, tenant_id, app)
  select store_id, tenant_id, 'whatsapp' from public.store_features where feature like 'whatsapp%' and enabled on conflict do nothing;
insert into public.store_apps (store_id, tenant_id, app)
  select distinct store_id, tenant_id, 'whatsapp' from public.extension_devices on conflict do nothing;

-- ---------- login do cliente da loja com e-mail e senha (o código por e-mail continua como "esqueci a senha") ----------
alter table public.store_customers
  add column password_hash text,
  add column failed_attempts int not null default 0,
  add column locked_until timestamptz;
-- como a sessão foi aberta: quem entrou pelo código do e-mail (prova de posse do e-mail) pode definir uma senha nova sem a atual
alter table public.customer_sessions add column via text not null default 'code' check (via in ('code', 'password'));
