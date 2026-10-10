-- MCP da loja: o lojista gera um token (em Loja › Avançado) para um assistente de IA GERENCIAR PEDIDOS da própria loja.
-- Escopo único por enquanto: 'orders' (listar, ver, mudar status, cancelar, reimprimir). Nada de cardápio, pagamentos ou equipe.
create table public.store_mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  name text not null check (length(name) between 1 and 60),
  token_hash text not null unique,
  scopes text[] not null default array['orders']::text[] check (scopes <@ array['orders']::text[]),
  created_by uuid,
  created_at timestamptz not null default now(),
  last_used_at timestamptz, last_ip inet,
  revoked_at timestamptz, expires_at timestamptz,
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create index store_mcp_tokens_store_idx on public.store_mcp_tokens(store_id, created_at desc);

alter table public.store_mcp_tokens enable row level security;
create policy platform_all on public.store_mcp_tokens for all to platform_api using (true) with check (true);
grant select, insert, update, delete on public.store_mcp_tokens to platform_api;
-- o lojista (app_api) vê, cria e revoga só os tokens da própria conta; o hash nunca é lido pela tela (a API não o devolve)
create policy tenant_own on public.store_mcp_tokens for all to app_api using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant());
grant select, insert, update on public.store_mcp_tokens to app_api;

-- Autenticação: a API ainda não sabe de qual loja é o token, então valida pelo hash numa função que ignora o RLS (e só devolve o necessário).
create or replace function app.store_mcp_authenticate(p_hash text, p_ip text)
returns table (id uuid, store_id uuid, tenant_id uuid, name text, scopes text[]) language sql security definer set search_path = public as
$$ update public.store_mcp_tokens set last_used_at = now(), last_ip = nullif(p_ip, '')::inet
   where token_hash = p_hash and revoked_at is null and (expires_at is null or expires_at > now())
   returning store_mcp_tokens.id, store_mcp_tokens.store_id, store_mcp_tokens.tenant_id, store_mcp_tokens.name, store_mcp_tokens.scopes $$;
revoke all on function app.store_mcp_authenticate(text, text) from public;
grant execute on function app.store_mcp_authenticate(text, text) to app_api;
