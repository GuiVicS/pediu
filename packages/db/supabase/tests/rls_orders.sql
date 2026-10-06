-- Isolamento das tabelas da Fase 1 (pedidos, equipe) e da observabilidade (métricas, logs, alertas). Rode num BRANCH/projeto de teste.
begin;
insert into public.tenants (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Conta A'), ('00000000-0000-0000-0000-0000000000b1', 'Conta B');
insert into public.stores (id, tenant_id, slug, name, status) values
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'loja-a', 'Loja A', 'producao'),
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'loja-b', 'Loja B', 'producao');
insert into public.orders (id, store_id, tenant_id, number, type, subtotal_cents, total_cents) values
  ('30000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 1001, 'retirada', 1000, 1000),
  ('30000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 1001, 'retirada', 2000, 2000);
insert into public.staff_users (tenant_id, store_id, email, name, role) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'a@a.test', 'Admin A', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', 'b@b.test', 'Admin B', 'admin');
insert into public.app_logs (level, service, event, message) values ('info', 'api', 'x', 'm');
insert into public.alerts (rule_key, severity, title, dedupe_key) values ('billing.past_due', 'warn', 't', 'k');

create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if; end $$;
grant execute on function pg_temp.expect(boolean, text) to public;

-- ===== app_api: só a própria conta =====
set local role app_api;
select set_config('app.tenant_id', '00000000-0000-0000-0000-0000000000a1', true);
select pg_temp.expect((select count(*) from public.orders) = 1, 'conta A vê só o pedido dela');
select pg_temp.expect((select count(*) from public.staff_users) = 1, 'conta A vê só a equipe dela');
do $$ begin
  begin update public.orders set status = 'cancelado' where id = '30000000-0000-0000-0000-0000000000b1';
        if found then raise exception 'FALHOU: alterou pedido de outra conta'; end if; end;
  begin insert into public.orders (store_id, tenant_id, number, type, subtotal_cents, total_cents) values ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 9, 'retirada', 1, 1);
        raise exception 'FALHOU: criou pedido em outra conta'; exception when insufficient_privilege then null; end;
  -- itens e eventos são append-only para a API
  begin delete from public.order_items; raise exception 'FALHOU: apagou itens'; exception when insufficient_privilege then null; end;
  begin delete from public.order_events; raise exception 'FALHOU: apagou eventos'; exception when insufficient_privilege then null; end;
  -- observabilidade e plataforma fora do alcance
  begin perform 1 from public.app_logs; raise exception 'FALHOU: API leu logs'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.alerts; raise exception 'FALHOU: API leu alertas'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.metrics_minute; raise exception 'FALHOU: API leu métricas'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.platform_admins; raise exception 'FALHOU: API leu admins'; exception when insufficient_privilege then null; end;
end $$;
-- sem tenant definido, nada aparece
select set_config('app.tenant_id', '', true);
select pg_temp.expect((select count(*) from public.orders) = 0, 'sem tenant não vê pedidos');
reset role;

-- ===== mcp_agent: nada de clientes, pedidos, equipe, logs ou alertas =====
set local role mcp_agent;
do $$ begin
  begin perform 1 from public.orders; raise exception 'FALHOU: MCP leu pedidos'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.order_items; raise exception 'FALHOU: MCP leu itens'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.staff_users; raise exception 'FALHOU: MCP leu equipe'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.staff_sessions; raise exception 'FALHOU: MCP leu sessões'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.app_logs; raise exception 'FALHOU: MCP leu logs'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.alerts; raise exception 'FALHOU: MCP leu alertas'; exception when insufficient_privilege then null; end;
  begin insert into public.orders (store_id, tenant_id, number, type, subtotal_cents, total_cents) values ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 5, 'retirada', 1, 1);
        raise exception 'FALHOU: MCP criou pedido'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ===== anon/authenticated (PostgREST) =====
set local role anon;
do $$ begin
  begin perform 1 from public.orders; raise exception 'FALHOU: anon leu pedidos'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.app_logs; raise exception 'FALHOU: anon leu logs'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform 1 from public.orders; raise exception 'FALHOU: authenticated leu pedidos'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ===== platform_api enxerga tudo =====
set local role platform_api;
select pg_temp.expect((select count(*) from public.orders) = 2, 'plataforma vê todos os pedidos');
select pg_temp.expect((select count(*) from public.alerts) = 1, 'plataforma vê alertas');
reset role;

-- ===== consistência dos pedidos (constraints) =====
do $$ begin
  begin insert into public.orders (store_id, tenant_id, number, type, subtotal_cents, total_cents) values ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 2, 'retirada', 1000, 999);
        raise exception 'FALHOU: aceitou total que não bate'; exception when check_violation then null; end;
  begin insert into public.orders (store_id, tenant_id, number, type, subtotal_cents, total_cents) values ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 3, 'mesa', 100, 100);
        raise exception 'FALHOU: mesa sem número'; exception when check_violation then null; end;
  begin insert into public.orders (store_id, tenant_id, number, type, subtotal_cents, total_cents) values ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 1001, 'retirada', 100, 100);
        raise exception 'FALHOU: número de pedido repetido na loja'; exception when unique_violation then null; end;
  begin insert into public.orders (store_id, tenant_id, number, type, subtotal_cents, total_cents) values ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 4, 'retirada', 100, 100);
        raise exception 'FALHOU: pedido da loja A na conta B'; exception when foreign_key_violation then null; end;
  insert into public.orders (store_id, tenant_id, number, type, table_number, subtotal_cents, total_cents) values ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 10, 'mesa', 5, 100, 100);
  begin insert into public.orders (store_id, tenant_id, number, type, table_number, subtotal_cents, total_cents) values ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 11, 'mesa', 5, 100, 100);
        raise exception 'FALHOU: duas comandas abertas na mesma mesa'; exception when unique_violation then null; end;
end $$;

select 'rls_orders: todos os testes passaram' as resultado;
rollback;
