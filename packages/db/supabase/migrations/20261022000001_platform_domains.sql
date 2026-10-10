-- Endereços da plataforma editáveis no super admin (antes só por variável de ambiente e arquivo do proxy):
--   'admin'  = endereço do super admin;          'api' = endereço da API (avisos de pagamento, iFood);
--   'mcp'    = endereço do MCP da plataforma;     'stores' = domínio-base das lojas (cada loja abre em slug.dominio).
-- Um papel pode ter vários endereços (o antigo continua valendo como apelido). Só vale depois de verificado (DNS apontando para o servidor).
create table public.platform_domains (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('admin', 'api', 'mcp', 'stores')),
  hostname text not null unique check (hostname = lower(hostname)),
  verified_at timestamptz,
  verify_error text,
  verified_checked_at timestamptz,
  created_by uuid references public.platform_admins(id),
  created_at timestamptz not null default now()
);
alter table public.platform_domains enable row level security;
create policy platform_all on public.platform_domains for all to platform_api using (true) with check (true);
grant select, insert, update, delete on public.platform_domains to platform_api;
