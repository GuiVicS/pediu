-- Isolamento dos clientes da loja (conta, códigos de acesso, sessões e vínculo com pedidos). Rode num BRANCH/projeto de teste.
begin;
insert into public.tenants (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Conta C'), ('00000000-0000-0000-0000-0000000000d1', 'Conta D');
insert into public.stores (id, tenant_id, slug, name, status) values
  ('10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'loja-c', 'Loja C', 'producao'),
  ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'loja-d', 'Loja D', 'producao');
insert into public.store_customers (id, store_id, tenant_id, email, name) values
  ('50000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'a@c.test', 'Cliente C'),
  ('50000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'a@d.test', 'Cliente D');
insert into public.customer_login_codes (store_id, tenant_id, email, code_hash, expires_at) values
  ('10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'a@c.test', 'h', now() + interval '10 minutes'),
  ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'a@d.test', 'h', now() + interval '10 minutes');
insert into public.customer_sessions (store_id, tenant_id, customer_id, token_hash, expires_at) values
  ('10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-0000000000c1', 'tc', now() + interval '1 day'),
  ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', '50000000-0000-0000-0000-0000000000d1', 'td', now() + interval '1 day');

create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if; end $$;
grant execute on function pg_temp.expect(boolean, text) to public;

-- ===== app_api: só a própria conta =====
set local role app_api;
select set_config('app.tenant_id', '00000000-0000-0000-0000-0000000000c1', true);
select pg_temp.expect((select count(*) from public.store_customers) = 1, 'conta C vê só o cliente dela');
select pg_temp.expect((select count(*) from public.customer_login_codes) = 1, 'conta C vê só os códigos dela');
select pg_temp.expect((select count(*) from public.customer_sessions) = 1, 'conta C vê só as sessões dela');
do $$ begin
  update public.store_customers set name = 'invadido' where id = '50000000-0000-0000-0000-0000000000d1';
  if found then raise exception 'FALHOU: alterou cliente de outra conta'; end if;
  begin insert into public.store_customers (store_id, tenant_id, email) values ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'x@d.test');
        raise exception 'FALHOU: criou cliente em outra conta'; exception when insufficient_privilege then null; end;
  begin delete from public.store_customers; raise exception 'FALHOU: API apagou clientes'; exception when insufficient_privilege then null; end;
  begin delete from public.customer_sessions; raise exception 'FALHOU: API apagou sessões'; exception when insufficient_privilege then null; end;
  begin update public.platform_public_settings set value = 'https://evil.test'; raise exception 'FALHOU: API alterou config pública'; exception when insufficient_privilege then null; end;
  -- um pedido não pode apontar para o cliente de outra loja (FK composta)
  begin insert into public.orders (store_id, tenant_id, number, type, subtotal_cents, total_cents, customer_id) values ('10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 1, 'retirada', 100, 100, '50000000-0000-0000-0000-0000000000d1');
        raise exception 'FALHOU: pedido ligado a cliente de outra loja'; exception when foreign_key_violation or insufficient_privilege then null; end;
end $$;
select pg_temp.expect((select count(*) from public.platform_public_settings where key = 'landing_url') = 1, 'API lê a configuração pública');
select set_config('app.tenant_id', '', true);
select pg_temp.expect((select count(*) from public.store_customers) = 0, 'sem tenant não vê clientes');
reset role;

-- ===== mcp_agent: sem acesso a clientes =====
set local role mcp_agent;
do $$ begin
  begin perform 1 from public.store_customers; raise exception 'FALHOU: MCP leu clientes'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.customer_login_codes; raise exception 'FALHOU: MCP leu códigos'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.customer_sessions; raise exception 'FALHOU: MCP leu sessões de cliente'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ===== anon/authenticated (PostgREST) =====
set local role anon;
do $$ begin
  begin perform 1 from public.store_customers; raise exception 'FALHOU: anon leu clientes'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.platform_public_settings; raise exception 'FALHOU: anon leu config pública'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ===== platform_api: vê tudo =====
set local role platform_api;
select pg_temp.expect((select count(*) from public.store_customers where tenant_id in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1')) = 2, 'plataforma vê os clientes de todas as contas');
reset role;

select 'rls_customers ok' as resultado;
rollback;
