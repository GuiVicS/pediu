-- Isolamento dos cupons (cupons, clientes escolhidos, usos) e devolução do uso quando o pedido é cancelado.
begin;
insert into public.tenants (id, name) values ('00000000-0000-0000-0000-0000000000a7', 'Conta G'), ('00000000-0000-0000-0000-0000000000b7', 'Conta H');
insert into public.stores (id, tenant_id, slug, name, status) values
  ('10000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a7', 'loja-g', 'Loja G', 'producao'),
  ('10000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000b7', 'loja-h', 'Loja H', 'producao');
insert into public.store_customers (id, store_id, tenant_id, email) values
  ('50000000-0000-0000-0000-0000000000a7', '10000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a7', 'a@g.test'),
  ('50000000-0000-0000-0000-0000000000b7', '10000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000b7', 'a@h.test');
insert into public.coupons (id, store_id, tenant_id, code, kind, percent, amount_cents, audience, used_count) values
  ('90000000-0000-0000-0000-0000000000a7', '10000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a7', 'CUPOMG', 'percent', 10, null, 'selected', 1),
  ('90000000-0000-0000-0000-0000000000b7', '10000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000b7', 'CUPOMH', 'fixed', null, 500, 'all', 0);
insert into public.coupon_customers (coupon_id, store_id, tenant_id, customer_id) values
  ('90000000-0000-0000-0000-0000000000a7', '10000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a7', '50000000-0000-0000-0000-0000000000a7');
insert into public.orders (id, store_id, tenant_id, number, type, subtotal_cents, total_cents, discount_cents) values
  ('a0000000-0000-0000-0000-0000000000a7', '10000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a7', 1001, 'retirada', 1000, 900, 100);
insert into public.coupon_redemptions (coupon_id, store_id, tenant_id, order_id, discount_cents) values
  ('90000000-0000-0000-0000-0000000000a7', '10000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a7', 'a0000000-0000-0000-0000-0000000000a7', 100);

create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if; end $$;
grant execute on function pg_temp.expect(boolean, text) to public;

-- ===== app_api: só a própria conta =====
set local role app_api;
select set_config('app.tenant_id', '00000000-0000-0000-0000-0000000000a7', true);
select pg_temp.expect((select count(*) from public.coupons) = 1, 'conta G vê só os cupons dela');
select pg_temp.expect((select count(*) from public.coupon_customers) = 1, 'conta G vê só os clientes escolhidos dela');
select pg_temp.expect((select count(*) from public.coupon_redemptions) = 1, 'conta G vê só os usos dela');
do $$ begin
  update public.coupons set active = false where code = 'CUPOMH';
  if found then raise exception 'FALHOU: alterou cupom de outra conta'; end if;
  begin insert into public.coupons (store_id, tenant_id, code, kind, percent) values ('10000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000b7', 'INVASOR', 'percent', 10);
        raise exception 'FALHOU: criou cupom em outra conta'; exception when insufficient_privilege then null; end;
  begin delete from public.coupon_redemptions; raise exception 'FALHOU: API apagou histórico de uso'; exception when insufficient_privilege then null; end;
  -- cupom com uso não pode ser apagado (o histórico protege)
  begin delete from public.coupons where code = 'CUPOMG'; raise exception 'FALHOU: apagou cupom com histórico'; exception when foreign_key_violation then null; end;
  -- um cliente de outra loja não entra na lista do cupom
  begin insert into public.coupon_customers (coupon_id, store_id, tenant_id, customer_id) values ('90000000-0000-0000-0000-0000000000a7', '10000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a7', '50000000-0000-0000-0000-0000000000b7');
        raise exception 'FALHOU: cliente de outra loja no cupom'; exception when foreign_key_violation then null; end;
end $$;
-- cancelar o pedido devolve o uso do cupom (gatilho)
update public.orders set status = 'cancelado' where id = 'a0000000-0000-0000-0000-0000000000a7';
select pg_temp.expect((select used_count from public.coupons where code = 'CUPOMG') = 0, 'cancelamento devolve o uso');
select pg_temp.expect((select released_at is not null from public.coupon_redemptions limit 1), 'uso marcado como devolvido');
select set_config('app.tenant_id', '', true);
select pg_temp.expect((select count(*) from public.coupons) = 0, 'sem tenant não vê cupons');
reset role;

-- ===== mcp_agent: sem acesso =====
set local role mcp_agent;
do $$ begin
  begin perform 1 from public.coupons; raise exception 'FALHOU: MCP leu cupons'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.coupon_redemptions; raise exception 'FALHOU: MCP leu usos'; exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'rls_coupons ok' as resultado;
rollback;
