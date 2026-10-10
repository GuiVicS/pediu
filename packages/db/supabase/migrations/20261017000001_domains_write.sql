-- Lojista adicionando domínio próprio dava "Erro interno": app_api só tinha SELECT em store_domains,
-- então o INSERT (e depois verificar/remover) falhava com "permission denied".
-- Escrita só em domínios próprios (kind = 'custom') do próprio tenant; o subdomínio padrão continua só da plataforma.
grant insert, update, delete on public.store_domains to app_api;
create policy tenant_custom_ins on public.store_domains for insert to app_api
  with check (tenant_id = app.current_tenant() and kind = 'custom');
create policy tenant_custom_upd on public.store_domains for update to app_api
  using (tenant_id = app.current_tenant() and kind = 'custom') with check (tenant_id = app.current_tenant() and kind = 'custom');
create policy tenant_custom_del on public.store_domains for delete to app_api
  using (tenant_id = app.current_tenant() and kind = 'custom');
