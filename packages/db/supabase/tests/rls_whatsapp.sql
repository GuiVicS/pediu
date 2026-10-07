-- Isolamento do atendimento por WhatsApp: liberações, pareamento da extensão, respostas rápidas, conversas, rascunhos e disparos.
begin;
insert into public.tenants (id, name) values ('00000000-0000-0000-0000-0000000000e1', 'Conta E'), ('00000000-0000-0000-0000-0000000000f1', 'Conta F');
insert into public.stores (id, tenant_id, slug, name, status) values
  ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'loja-e', 'Loja E', 'producao'),
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'loja-f', 'Loja F', 'producao');
insert into public.staff_users (id, tenant_id, store_id, email, name, role) values
  ('60000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', 'a@e.test', 'Admin E', 'admin'),
  ('60000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'a@f.test', 'Admin F', 'admin');
insert into public.staff_sessions (id, tenant_id, store_id, staff_id, token_hash, expires_at) values
  ('70000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', '60000000-0000-0000-0000-0000000000e1', 'se', now() + interval '1 day'),
  ('70000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', '60000000-0000-0000-0000-0000000000f1', 'sf', now() + interval '1 day');
insert into public.store_features (store_id, tenant_id, feature, enabled) values
  ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'whatsapp_support', true),
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'whatsapp_support', false);
insert into public.extension_pairings (tenant_id, store_id, staff_id, session_id, code_hash, expires_at) values
  ('00000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', '60000000-0000-0000-0000-0000000000e1', '70000000-0000-0000-0000-0000000000e1', 'codigo-e', now() + interval '5 minutes'),
  ('00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', '60000000-0000-0000-0000-0000000000f1', '70000000-0000-0000-0000-0000000000f1', 'codigo-f', now() + interval '5 minutes');
insert into public.quick_replies (store_id, tenant_id, title, body) values
  ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'Horário', 'x'), ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'Horário', 'y');
insert into public.agent_conversations (store_id, tenant_id, chat_id) values
  ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', '5516999990000@c.us'), ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', '5516999990000@c.us');
insert into public.order_drafts (token, store_id, tenant_id, type, lines, expires_at) values
  ('draft-token-e-0123456789', '10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'retirada', '[]', now() + interval '1 day'),
  ('draft-token-vencido-0123', '10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'retirada', '[]', now() - interval '1 minute');
insert into public.broadcast_campaigns (id, store_id, tenant_id, name, body) values
  ('80000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'Promo E', 'oi'),
  ('80000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'Promo F', 'oi');
insert into public.broadcast_recipients (campaign_id, store_id, tenant_id, phone) values
  ('80000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', '5516999990001'),
  ('80000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', '5516999990002');

create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if; end $$;
grant execute on function pg_temp.expect(boolean, text) to public;

-- ===== app_api: só a própria conta =====
set local role app_api;
select set_config('app.tenant_id', '00000000-0000-0000-0000-0000000000e1', true);
select pg_temp.expect((select count(*) from public.store_features) = 1, 'conta E vê só as liberações dela');
select pg_temp.expect((select count(*) from public.extension_pairings) = 1, 'conta E vê só os códigos dela');
select pg_temp.expect((select count(*) from public.quick_replies) = 1, 'conta E vê só as respostas dela');
select pg_temp.expect((select count(*) from public.agent_conversations) = 1, 'conta E vê só as conversas dela');
select pg_temp.expect((select count(*) from public.order_drafts) = 2, 'conta E vê só os rascunhos dela');
select pg_temp.expect((select count(*) from public.broadcast_campaigns) = 1, 'conta E vê só as campanhas dela');
select pg_temp.expect((select count(*) from public.broadcast_recipients) = 1, 'conta E vê só os destinatários dela');
do $$ begin
  -- a loja não se autoliberar: liberações são só da plataforma
  begin insert into public.store_features (store_id, tenant_id, feature, enabled) values ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'ai_agent', true);
        raise exception 'FALHOU: API liberou funcionalidade por conta própria'; exception when insufficient_privilege then null; end;
  begin update public.store_features set enabled = true; raise exception 'FALHOU: API alterou liberações'; exception when insufficient_privilege then null; end;
  -- nada de escrever em outra conta
  begin insert into public.quick_replies (store_id, tenant_id, title, body) values ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'x', 'y');
        raise exception 'FALHOU: criou resposta em outra conta'; exception when insufficient_privilege then null; end;
  update public.agent_conversations set mode = 'off' where store_id = '10000000-0000-0000-0000-0000000000f1';
  if found then raise exception 'FALHOU: alterou conversa de outra conta'; end if;
  update public.broadcast_recipients set status = 'enviada' where store_id = '10000000-0000-0000-0000-0000000000f1';
  if found then raise exception 'FALHOU: alterou destinatário de outra conta'; end if;
  -- dispositivos e pareamentos não são apagados pela API
  begin delete from public.extension_pairings; raise exception 'FALHOU: API apagou pareamentos'; exception when insufficient_privilege then null; end;
  begin delete from public.broadcast_campaigns; raise exception 'FALHOU: API apagou campanhas'; exception when insufficient_privilege then null; end;
end $$;
-- funções sem tenant (a extensão e o cliente ainda não têm sessão de equipe)
select pg_temp.expect(app.feature_on('10000000-0000-0000-0000-0000000000e1', 'whatsapp_support'), 'recurso ligado na loja E');
select pg_temp.expect(not app.feature_on('10000000-0000-0000-0000-0000000000f1', 'whatsapp_support'), 'recurso desligado na loja F');
select pg_temp.expect((select count(*) from app.order_draft('draft-token-e-0123456789', now())) = 1, 'rascunho válido abre por token');
select pg_temp.expect((select count(*) from app.order_draft('draft-token-vencido-0123', now())) = 0, 'rascunho vencido não abre');
select pg_temp.expect((select count(*) from app.order_draft('token-inexistente-000000', now())) = 0, 'token desconhecido não abre');
-- pareamento: uso único e vincula à sessão que aprovou; loja sem o recurso não conecta
select pg_temp.expect((select count(*) from app.extension_pair('codigo-e', 'hash-dispositivo-e', 'Chrome', now())) = 1, 'código válido gera dispositivo');
select pg_temp.expect((select count(*) from app.extension_pair('codigo-e', 'hash-dispositivo-e2', 'Chrome', now())) = 0, 'código só vale uma vez');
select pg_temp.expect((select count(*) from app.extension_pair('codigo-f', 'hash-dispositivo-f', 'Chrome', now())) = 0, 'loja sem o recurso não conecta');
select pg_temp.expect((select count(*) from app.extension_device('hash-dispositivo-e', now())) = 1, 'dispositivo válido autentica');
select pg_temp.expect((select count(*) from app.extension_device('hash-qualquer', now())) = 0, 'credencial desconhecida é recusada');
select set_config('app.tenant_id', '', true);
select pg_temp.expect((select count(*) from public.quick_replies) = 0, 'sem tenant não vê respostas');
reset role;

-- sessão do lojista encerrada derruba o dispositivo
update public.staff_sessions set revoked_at = now() where id = '70000000-0000-0000-0000-0000000000e1';
set local role app_api;
select pg_temp.expect((select count(*) from app.extension_device('hash-dispositivo-e', now())) = 0, 'logout do lojista derruba a extensão');
reset role;

-- ===== mcp_agent: sem acesso =====
set local role mcp_agent;
do $$ begin
  begin perform 1 from public.store_features; raise exception 'FALHOU: MCP leu liberações'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.extension_devices; raise exception 'FALHOU: MCP leu dispositivos'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.agent_conversations; raise exception 'FALHOU: MCP leu conversas'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.broadcast_recipients; raise exception 'FALHOU: MCP leu destinatários'; exception when insufficient_privilege then null; end;
  begin perform 1 from app.extension_device('x', now()); raise exception 'FALHOU: MCP chamou autenticação da extensão'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ===== platform_api: vê e libera =====
set local role platform_api;
select pg_temp.expect((select count(*) from public.store_features where tenant_id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1')) = 2, 'plataforma vê as liberações');
update public.store_features set enabled = true where store_id = '10000000-0000-0000-0000-0000000000f1';
select pg_temp.expect((select enabled from public.store_features where store_id = '10000000-0000-0000-0000-0000000000f1'), 'plataforma libera funcionalidade');
reset role;

select 'rls_whatsapp ok' as resultado;
rollback;
