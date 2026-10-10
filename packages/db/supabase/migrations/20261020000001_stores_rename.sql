-- Lojista salvando "Loja e entrega" dava "Erro interno": app_api só tinha SELECT em stores,
-- então o UPDATE do nome falhava com "permission denied" e derrubava o salvamento inteiro (horários, telefone etc.).
-- Libera alterar apenas a coluna name, e apenas das lojas do próprio tenant; status, slug e o resto continuam só da plataforma.
grant update (name) on public.stores to app_api;
create policy tenant_rename on public.stores for update to app_api
  using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant());
