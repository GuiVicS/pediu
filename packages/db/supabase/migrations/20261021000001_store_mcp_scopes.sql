-- MCP da loja: escopos opcionais além do básico 'orders', marcados pelo lojista ao gerar o token:
--   'customers' (listar, criar, editar e excluir contatos de clientes) e 'payments' (gerar Pix e link de pagamento do pedido).
-- Tokens que já existem continuam só com 'orders'.
alter table public.store_mcp_tokens drop constraint store_mcp_tokens_scopes_check;
alter table public.store_mcp_tokens add constraint store_mcp_tokens_scopes_check
  check (scopes <@ array['orders', 'customers', 'payments']::text[] and 'orders' = any(scopes));

-- Excluir contato de cliente: app_api continua SEM delete em store_customers (ninguém apaga clientes em massa pela API).
-- A exclusão é de um cliente por vez, pelo id, só da própria conta, por esta função.
create or replace function app.store_mcp_delete_customer(p_store uuid, p_customer uuid)
returns table (name text) language sql security definer set search_path = public as
$$ delete from public.store_customers c where c.id = p_customer and c.store_id = p_store and c.tenant_id = app.current_tenant() returning c.name $$;
revoke all on function app.store_mcp_delete_customer(uuid, uuid) from public;
grant execute on function app.store_mcp_delete_customer(uuid, uuid) to app_api;
