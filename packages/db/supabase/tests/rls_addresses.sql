-- Isolamento dos endereços salvos do cliente e do e-mail no pedido. Rode num BRANCH/projeto de teste.
begin;
insert into public.tenants (id, name) values ('00000000-0000-0000-0000-0000000000e1', 'Conta E'), ('00000000-0000-0000-0000-0000000000f1', 'Conta F');
insert into public.stores (id, tenant_id, slug, name, status) values
  ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'loja-e', 'Loja E', 'producao'),
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'loja-f', 'Loja F', 'producao');
insert into public.store_customers (id, store_id, tenant_id, email, name) values
  ('50000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'a@e.test', 'Cliente E'),
  ('50000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'a@f.test', 'Cliente F');
insert into public.customer_addresses (store_id, tenant_id, customer_id, street, number, is_default) values
  ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', '50000000-0000-0000-0000-0000000000e1', 'Rua E', '1', true),
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', '50000000-0000-0000-0000-0000000000f1', 'Rua F', '2', true);

create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if; end $$;
grant execute on function pg_temp.expect(boolean, text) to public;

-- ===== app_api: só os endereços da própria conta =====
set local role app_api;
select set_config('app.tenant_id', '00000000-0000-0000-0000-0000000000e1', true);
select pg_temp.expect((select count(*) from public.customer_addresses) = 1, 'conta E vê só o endereço dela');
do $$ begin
  update public.customer_addresses set street = 'invadido' where street = 'Rua F';
  if found then raise exception 'FALHOU: alterou endereço de outra conta'; end if;
  begin insert into public.customer_addresses (store_id, tenant_id, customer_id, street) values ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', '50000000-0000-0000-0000-0000000000f1', 'x');
    raise exception 'FALHOU: criou endereço em outra conta'; exception when insufficient_privilege then null; end;
  -- um cliente só pode ter um endereço padrão
  begin insert into public.customer_addresses (store_id, tenant_id, customer_id, street, is_default) values ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', '50000000-0000-0000-0000-0000000000e1', 'Rua E2', true);
    raise exception 'FALHOU: dois endereços padrão'; exception when unique_violation then null; end;
end $$;
select set_config('app.tenant_id', '', true);
select pg_temp.expect((select count(*) from public.customer_addresses) = 0, 'sem tenant não vê endereços');
reset role;

-- ===== mcp_agent e anon: sem acesso =====
set local role mcp_agent;
do $$ begin begin perform 1 from public.customer_addresses; raise exception 'FALHOU: MCP leu endereços'; exception when insufficient_privilege then null; end; end $$;
reset role;
set local role anon;
do $$ begin begin perform 1 from public.customer_addresses; raise exception 'FALHOU: anon leu endereços'; exception when insufficient_privilege then null; end; end $$;
reset role;

select 'rls_addresses ok' as resultado;
rollback;
