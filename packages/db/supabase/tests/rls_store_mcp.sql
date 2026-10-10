-- Isolamento dos tokens do MCP da loja. Rode num BRANCH/projeto de teste.
begin;
insert into public.tenants (id, name) values ('00000000-0000-0000-0000-0000000000a9', 'Conta M1'), ('00000000-0000-0000-0000-0000000000b9', 'Conta M2');
insert into public.stores (id, tenant_id, slug, name, status) values
  ('10000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a9', 'loja-m1', 'Loja M1', 'producao'),
  ('10000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000b9', 'loja-m2', 'Loja M2', 'producao');
insert into public.store_customers (id, store_id, tenant_id, email, name) values ('a0000000-0000-0000-0000-0000000000b9', '10000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000b9', 'alheio@m2.test', 'Cliente Alheio');
insert into public.store_mcp_tokens (id, store_id, tenant_id, name, token_hash) values
  ('90000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a9', 'Token 1', 'hash-m1'),
  ('90000000-0000-0000-0000-0000000000b9', '10000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000b9', 'Token 2', 'hash-m2');

create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if; end $$;
grant execute on function pg_temp.expect(boolean, text) to public;

-- ===== app_api: só os tokens da própria conta =====
set local role app_api;
select set_config('app.tenant_id', '00000000-0000-0000-0000-0000000000a9', true);
select pg_temp.expect((select count(*) from public.store_mcp_tokens) = 1, 'conta M1 vê só o token dela');
do $$ begin
  update public.store_mcp_tokens set revoked_at = now() where id = '90000000-0000-0000-0000-0000000000b9';
  if found then raise exception 'FALHOU: revogou token de outra conta'; end if;
  begin insert into public.store_mcp_tokens (store_id, tenant_id, name, token_hash) values ('10000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000b9', 'x', 'h-x');
    raise exception 'FALHOU: criou token em outra conta'; exception when insufficient_privilege then null; end;
  begin delete from public.store_mcp_tokens where id = '90000000-0000-0000-0000-0000000000a9';
    raise exception 'FALHOU: lojista conseguiu apagar o token (só revoga)'; exception when insufficient_privilege then null; end;
  begin insert into public.store_mcp_tokens (store_id, tenant_id, name, token_hash, scopes) values ('10000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a9', 'y', 'h-y', array['orders', 'cardapio']);
    raise exception 'FALHOU: aceitou escopo desconhecido'; exception when check_violation then null; end;
  begin insert into public.store_mcp_tokens (store_id, tenant_id, name, token_hash, scopes) values ('10000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a9', 'z', 'h-z', array['payments']);
    raise exception 'FALHOU: aceitou token sem o escopo básico orders'; exception when check_violation then null; end;
  insert into public.store_mcp_tokens (store_id, tenant_id, name, token_hash, scopes) values ('10000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a9', 'w', 'h-w', array['orders', 'customers', 'payments']);
end $$;
-- excluir cliente pelo MCP: um por vez, só da própria conta (app_api segue sem delete na tabela)
insert into public.store_customers (id, store_id, tenant_id, email, name) values ('a0000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a9', 'meu@m1.test', 'Meu Cliente');
select pg_temp.expect((select count(*) from app.store_mcp_delete_customer('10000000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-0000000000b9')) = 0, 'não exclui cliente de outra conta');
select pg_temp.expect((select count(*) from app.store_mcp_delete_customer('10000000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-0000000000a9')) = 0, 'não exclui informando a loja errada');
select pg_temp.expect((select name from app.store_mcp_delete_customer('10000000-0000-0000-0000-0000000000a9', 'a0000000-0000-0000-0000-0000000000a9')) = 'Meu Cliente', 'exclui o cliente da própria conta');
do $$ begin
  begin delete from public.store_customers; raise exception 'FALHOU: API apagou clientes direto na tabela'; exception when insufficient_privilege then null; end;
end $$;
-- a autenticação (função) acha o token pelo hash e registra o uso; token revogado não autentica
select pg_temp.expect((select count(*) from app.store_mcp_authenticate('hash-m1', '203.0.113.9')) = 1, 'autentica pelo hash');
select pg_temp.expect((select last_used_at is not null and last_ip = '203.0.113.9'::inet from public.store_mcp_tokens where id = '90000000-0000-0000-0000-0000000000a9'), 'registra o último uso');
select pg_temp.expect((select count(*) from app.store_mcp_authenticate('hash-inexistente', '')) = 0, 'hash inexistente não autentica');
update public.store_mcp_tokens set revoked_at = now() where id = '90000000-0000-0000-0000-0000000000a9';
select pg_temp.expect((select count(*) from app.store_mcp_authenticate('hash-m1', '')) = 0, 'token revogado não autentica');
select set_config('app.tenant_id', '', true);
select pg_temp.expect((select count(*) from public.store_mcp_tokens) = 0, 'sem tenant não vê tokens');
reset role;

-- ===== mcp_agent (MCP da plataforma) e anon: sem acesso =====
set local role mcp_agent;
do $$ begin begin perform 1 from public.store_mcp_tokens; raise exception 'FALHOU: MCP da plataforma leu tokens da loja'; exception when insufficient_privilege then null; end; end $$;
reset role;
set local role anon;
do $$ begin begin perform 1 from public.store_mcp_tokens; raise exception 'FALHOU: anon leu tokens'; exception when insufficient_privilege then null; end; end $$;
reset role;

select 'rls_store_mcp ok' as resultado;
rollback;
