-- App do garçom: pessoas na mesa e "conta pedida" (o caixa vê no PDV e a mesa fica destacada no mapa).
alter table public.orders
  add column guests int check (guests is null or guests between 1 and 99),
  add column bill_requested_at timestamptz;
-- (uma comanda aberta por mesa já é garantida pelo índice orders_open_table_uk)

-- ================= totem de mesa (tablet na mesa: o cliente pede sozinho) =================
-- Liberado por loja no super admin (store_features 'table_totem'). O aparelho é pareado a UMA mesa e recebe um token
-- que só lê o cardápio e a comanda daquela mesa e envia itens para ela (nunca uma sessão de funcionário).
alter table public.orders drop constraint orders_channel_check;
alter table public.orders add constraint orders_channel_check check (channel in ('loja', 'pdv', 'garcom', 'ifood', 'totem'));

create table public.store_totems (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  table_number int not null check (table_number > 0),
  name text not null default '' check (length(name) <= 60),
  pair_code_hash text,                 -- código de pareamento (uso único, 15 min); some depois de usado
  pair_expires_at timestamptz,
  token_hash text unique,              -- credencial do aparelho (cookie httpOnly)
  created_by uuid, created_at timestamptz not null default now(),
  paired_at timestamptz, last_seen_at timestamptz, revoked_at timestamptz,
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create index store_totems_store_idx on public.store_totems(store_id);
alter table public.store_totems enable row level security;
create policy platform_all on public.store_totems for all to platform_api using (true) with check (true);
grant select, insert, update, delete on public.store_totems to platform_api;
create policy tenant_own on public.store_totems for all to app_api using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant());
grant select, insert, update, delete on public.store_totems to app_api;

-- o totem chega sem sessão de loja: estas funções (security definer) resolvem o aparelho pelo hash, sem expor a tabela
create or replace function app.totem_pair(p_code_hash text, p_token_hash text)
returns table (id uuid, store_id uuid, tenant_id uuid, table_number int) language sql security definer set search_path = public as
$$ update public.store_totems set token_hash = p_token_hash, pair_code_hash = null, pair_expires_at = null, paired_at = now(), last_seen_at = now()
   where pair_code_hash = p_code_hash and pair_expires_at > now() and revoked_at is null
   returning store_totems.id, store_totems.store_id, store_totems.tenant_id, store_totems.table_number $$;
create or replace function app.totem_by_token(p_token_hash text)
returns table (id uuid, store_id uuid, tenant_id uuid, table_number int, name text) language sql security definer set search_path = public as
$$ update public.store_totems set last_seen_at = now() where token_hash = p_token_hash and revoked_at is null
   returning store_totems.id, store_totems.store_id, store_totems.tenant_id, store_totems.table_number, store_totems.name $$;
revoke all on function app.totem_pair(text, text), app.totem_by_token(text) from public;
grant execute on function app.totem_pair(text, text), app.totem_by_token(text) to app_api;
