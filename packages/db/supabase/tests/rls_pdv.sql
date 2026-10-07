-- Isolamento do turno de caixa e dos banners da plataforma. Rode num BRANCH/projeto de teste.
begin;
insert into public.tenants (id, name) values ('00000000-0000-0000-0000-0000000000e1', 'Conta E'), ('00000000-0000-0000-0000-0000000000f1', 'Conta F');
insert into public.stores (id, tenant_id, slug, name, status) values
  ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'loja-e', 'Loja E', 'producao'),
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'loja-f', 'Loja F', 'producao');
insert into public.cash_sessions (id, store_id, tenant_id, opening_cents) values
  ('60000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 5000),
  ('60000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 7000);
insert into public.platform_banners (placement, title, image_url) values ('login', 'b', 'https://x.test/b.png');

create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if; end $$;
grant execute on function pg_temp.expect(boolean, text) to public;

-- ===== app_api =====
set local role app_api;
select set_config('app.tenant_id', '00000000-0000-0000-0000-0000000000e1', true);
select pg_temp.expect((select count(*) from public.cash_sessions) = 1, 'conta E vê só o turno dela');
do $$ begin
  update public.cash_sessions set note = 'invadido' where id = '60000000-0000-0000-0000-0000000000f1';
  if found then raise exception 'FALHOU: alterou turno de outra conta'; end if;
  begin insert into public.cash_sessions (store_id, tenant_id, opening_cents) values ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 1);
        raise exception 'FALHOU: abriu caixa em outra conta'; exception when insufficient_privilege then null; end;
  begin delete from public.cash_sessions; raise exception 'FALHOU: API apagou turno'; exception when insufficient_privilege then null; end;
  -- um turno só pode ser fechado com contagem (fechamento sem valor contado viola a regra)
  begin update public.cash_sessions set closed_at = now() where id = '60000000-0000-0000-0000-0000000000e1'; raise exception 'FALHOU: fechou sem contagem'; exception when check_violation then null; end;
  -- um pedido não pode apontar para o turno de outra loja
  begin insert into public.orders (store_id, tenant_id, number, type, subtotal_cents, total_cents, cash_session_id) values ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 1, 'retirada', 100, 100, '60000000-0000-0000-0000-0000000000f1');
        raise exception 'FALHOU: pedido ligado a turno de outra loja'; exception when foreign_key_violation then null; end;
  -- banners: a API só lê
  begin update public.platform_banners set title = 'x'; raise exception 'FALHOU: API alterou banner'; exception when insufficient_privilege then null; end;
  begin insert into public.platform_banners (placement, image_url) values ('login', 'https://x.test'); raise exception 'FALHOU: API criou banner'; exception when insufficient_privilege then null; end;
  begin delete from public.platform_banners; raise exception 'FALHOU: API apagou banner'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.expect((select count(*) from public.platform_banners) = 1, 'API lê os banners');
select set_config('app.tenant_id', '', true);
select pg_temp.expect((select count(*) from public.cash_sessions) = 0, 'sem tenant não vê turnos');
reset role;

-- ===== mcp_agent e anon: nada =====
set local role mcp_agent;
do $$ begin
  begin perform 1 from public.cash_sessions; raise exception 'FALHOU: MCP leu turnos'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.platform_banners; raise exception 'FALHOU: MCP leu banners'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.cash_sessions; raise exception 'FALHOU: anon leu turnos'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.platform_banners; raise exception 'FALHOU: anon leu banners'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ===== platform_api: vê e gerencia =====
set local role platform_api;
select pg_temp.expect((select count(*) from public.cash_sessions where tenant_id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1')) = 2, 'plataforma vê todos os turnos');
select pg_temp.expect((select count(*) from public.platform_banners) = 1, 'plataforma gerencia banners');
reset role;

select 'rls_pdv ok' as resultado;
rollback;
