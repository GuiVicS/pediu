-- Teste de isolamento e da trava do MCP. Rode num BRANCH do Supabase (ou projeto de teste), nunca em produção:
--   psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f packages/db/supabase/tests/rls_lock.sql
-- Tudo roda dentro de uma transação que termina em ROLLBACK, então não deixa dados.
begin;

-- dados de teste (como dono/admin do banco)
insert into public.tenants (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Conta A'), ('00000000-0000-0000-0000-0000000000b1', 'Conta B');
insert into public.stores (id, tenant_id, slug, name, status) values
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'loja-dev-a', 'Loja Dev A', 'desenvolvimento'),
  ('10000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'loja-prod-a', 'Loja Prod A', 'producao'),
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'loja-prod-b', 'Loja Prod B', 'producao');
insert into public.categories (id, store_id, tenant_id, name) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'Cat dev A'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'Cat prod A'),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'Cat prod B');

-- helper: falha o teste se a condição não for verdadeira
create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if; end $$;
grant execute on function pg_temp.expect(boolean, text) to public;

-- ================= app_api: isolamento entre contas =================
set local role app_api;
select set_config('app.tenant_id', '00000000-0000-0000-0000-0000000000a1', true);
select pg_temp.expect((select count(*) from public.categories) = 2, 'conta A deve ver só as 2 categorias dela');
select pg_temp.expect((select count(*) from public.categories where store_id = '10000000-0000-0000-0000-0000000000b1') = 0, 'conta A não pode ver a loja da conta B');
do $$ begin
  begin
    insert into public.categories (store_id, tenant_id, name) values ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'invasão');
    raise exception 'FALHOU: conta A conseguiu inserir na conta B';
  exception when insufficient_privilege then null; -- violação de RLS é esperada
  end;
end $$;
select set_config('app.tenant_id', '', true);
select pg_temp.expect((select count(*) from public.categories) = 0, 'sem tenant definido não pode ver nada');
reset role;

-- ================= mcp_agent: a trava por status =================
set local role mcp_agent;
select pg_temp.expect((select count(*) from public.stores) = 3, 'MCP lista todas as lojas');

-- escreve em desenvolvimento
insert into public.categories (store_id, tenant_id, name) values ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'nova em dev');
update public.categories set name = 'renomeada' where id = '20000000-0000-0000-0000-0000000000a1';

-- NÃO escreve em produção: insert falha, update/delete afetam 0 linhas
do $$ declare n int; begin
  begin
    insert into public.categories (store_id, tenant_id, name) values ('10000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'invasão prod');
    raise exception 'FALHOU: MCP inseriu em loja de produção';
  exception when insufficient_privilege then null;
  end;
  update public.categories set name = 'hack' where id = '20000000-0000-0000-0000-0000000000a2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: MCP alterou categoria de loja em produção'; end if;
  delete from public.categories where id = '20000000-0000-0000-0000-0000000000a2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: MCP apagou categoria de loja em produção'; end if;
end $$;

-- NÃO muda status (nem por coluna, nem criando loja já publicada)
do $$ begin
  begin update public.stores set status = 'producao' where id = '10000000-0000-0000-0000-0000000000a1';
    raise exception 'FALHOU: MCP mudou o status da loja';
  exception when insufficient_privilege then null; end;
  begin insert into public.stores (tenant_id, slug, name, status, created_by) values ('00000000-0000-0000-0000-0000000000a1', 'ja-publicada', 'X', 'producao', 'mcp:t');
    raise exception 'FALHOU: MCP criou loja já em produção';
  exception when insufficient_privilege then null; end;
end $$;

-- NÃO escreve em tabelas de plataforma
do $$ begin
  begin insert into public.mcp_tokens (name, token_hash, hint, expires_at) values ('x', 'x', 'x', now());
    raise exception 'FALHOU: MCP criou token'; exception when insufficient_privilege then null; end;
  begin update public.subscriptions set status = 'active';
    raise exception 'FALHOU: MCP alterou assinatura'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.platform_admins;
    raise exception 'FALHOU: MCP leu admins da plataforma'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ================= anon/authenticated (PostgREST) não veem nada =================
set local role anon;
do $$ begin
  begin perform 1 from public.stores; raise exception 'FALHOU: anon leu stores';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'rls_lock: todos os testes passaram' as resultado;
rollback;
