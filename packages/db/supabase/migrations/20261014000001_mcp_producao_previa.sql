-- MCP em produção (permissão por token) e link secreto de prévia para lojas em desenvolvimento.

-- ================= MCP: alterar lojas em produção =================
-- Desligado por padrão: só tokens marcados pelo super admin alteram lojas no ar. O MCP continua sem mudar status.
alter table public.mcp_tokens add column allow_production boolean not null default false;

-- a autenticação passa a devolver a permissão do token
drop function app.mcp_authenticate(text, text);
create function app.mcp_authenticate(p_hash text, p_ip text)
returns table (id uuid, store_limit uuid[], allow_production boolean) language sql security definer set search_path = public as
$$ update public.mcp_tokens set last_used_at = now(), last_ip = nullif(p_ip, '')::inet
   where token_hash = p_hash and revoked_at is null and expires_at > now()
   returning mcp_tokens.id, mcp_tokens.store_limit, mcp_tokens.allow_production $$;
revoke all on function app.mcp_authenticate(text, text) from public;
grant execute on function app.mcp_authenticate(text, text) to mcp_agent;

-- Loja em desenvolvimento: sempre. Em produção: só na transação em que o serviço do MCP ligou "pediu.mcp_producao"
-- (ele só liga para token com allow_production). Suspensa e arquivada: nunca.
create or replace function app.mcp_store_writable(p_store uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.stores s where s.id = p_store and (s.status = 'desenvolvimento'
     or (s.status = 'producao' and coalesce(current_setting('pediu.mcp_producao', true), '') = 'on'))) $$;
revoke all on function app.mcp_store_writable(uuid) from public;
grant execute on function app.mcp_store_writable(uuid) to mcp_agent;

do $$ declare t text; begin
  foreach t in array array['store_themes','store_settings','print_zones','categories','products','addon_groups','addons','product_addon_groups','banners','delivery_zones','payment_methods'] loop
    execute format('drop policy mcp_ins on public.%I', t);
    execute format('drop policy mcp_upd on public.%I', t);
    execute format('drop policy mcp_del on public.%I', t);
    execute format('create policy mcp_ins on public.%I for insert to mcp_agent with check (app.mcp_store_writable(store_id))', t);
    execute format('create policy mcp_upd on public.%I for update to mcp_agent using (app.mcp_store_writable(store_id)) with check (app.mcp_store_writable(store_id))', t);
    execute format('create policy mcp_del on public.%I for delete to mcp_agent using (app.mcp_store_writable(store_id))', t);
  end loop;
end $$;

-- histórico (desfazer) também em produção; a trava da linha da loja (FOR UPDATE) segue a mesma regra
drop policy mcp_rev_insert on public.store_config_revisions;
create policy mcp_rev_insert on public.store_config_revisions for insert to mcp_agent with check (app.mcp_store_writable(store_id));
drop policy mcp_edit_store on public.stores;
create policy mcp_edit_store on public.stores for update to mcp_agent
  using (app.mcp_store_writable(id)) with check (app.mcp_store_writable(id));
-- publicação e criação de subdomínio continuam só em desenvolvimento (políticas originais, com app.store_in_dev)

-- ================= prévia de loja em desenvolvimento =================
-- Código secreto do link de prévia. Quem tem o link vê a vitrine; pedidos continuam bloqueados até publicar.
alter table public.stores add column preview_token text unique;
grant update (preview_token) on public.stores to mcp_agent;

-- a API das lojas não lê a coluna: só pergunta se o código vale para a loja
create or replace function app.store_preview_ok(p_store uuid, p_token text) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(length(p_token) >= 32, false) and exists (select 1 from public.stores s
     where s.id = p_store and s.status = 'desenvolvimento' and s.preview_token = p_token) $$;
revoke all on function app.store_preview_ok(uuid, text) from public;
grant execute on function app.store_preview_ok(uuid, text) to app_api;

-- ================= administrador obrigatório na criação da loja (também pelo MCP) =================
-- O MCP só INSERE o primeiro administrador de loja em desenvolvimento; não lê, não altera e não apaga usuários.
grant insert (tenant_id, store_id, email, name, role, password_hash, active) on public.staff_users to mcp_agent;
create policy mcp_first_admin on public.staff_users for insert to mcp_agent
  with check (role = 'admin' and store_id is not null and app.store_in_dev(store_id));
