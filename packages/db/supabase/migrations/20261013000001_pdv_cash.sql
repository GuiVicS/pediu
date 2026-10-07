-- PDV: como cada pedido foi pago (na tela ou externamente) e turno de caixa (abertura, conferência e fechamento).

-- ---- turno de caixa: um por operador e loja enquanto estiver aberto ----
create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  opened_by uuid references public.staff_users(id) on delete set null,
  opened_by_name text not null default '',
  opened_at timestamptz not null default now(),
  opening_cents int not null check (opening_cents >= 0),
  opening_breakdown jsonb not null default '{}'::jsonb,   -- quantas cédulas/moedas de cada valor ({"100": 1, "0.5": 2})
  closed_by uuid references public.staff_users(id) on delete set null,
  closed_at timestamptz,
  counted_cents int check (counted_cents is null or counted_cents >= 0),
  expected_cents int,
  difference_cents int,
  note text not null default '' check (length(note) <= 300),
  summary jsonb,                                           -- resumo do turno congelado no fechamento
  unique (id, store_id),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade,
  check ((closed_at is null) = (counted_cents is null))
);
create unique index cash_sessions_one_open_uk on public.cash_sessions(store_id, opened_by) where closed_at is null;
create index cash_sessions_store_idx on public.cash_sessions(store_id, opened_at desc);

-- ---- pedido: forma e modo do pagamento ----
alter table public.orders
  add column paid_type text check (paid_type is null or paid_type in ('pix', 'cash', 'credit', 'debit', 'voucher')),
  add column payment_mode text check (payment_mode is null or payment_mode in ('tela', 'externo')),   -- tela = QR/online no sistema; externo = maquininha, dinheiro e afins, só registrado
  add column cash_received_cents int check (cash_received_cents is null or cash_received_cents >= 0),
  add column change_cents int check (change_cents is null or change_cents >= 0),
  add column payment_ref text check (payment_ref is null or length(payment_ref) <= 40),               -- autorização/NSU da maquininha
  add column paid_by uuid references public.staff_users(id) on delete set null,
  add column cash_session_id uuid;
alter table public.orders add foreign key (cash_session_id, store_id) references public.cash_sessions(id, store_id) on delete set null (cash_session_id);
create index orders_cash_session_idx on public.orders(store_id, cash_session_id) where cash_session_id is not null;

-- pedidos já pagos antes desta migration: o tipo sai do cadastro da forma de pagamento (pelo nome)
update public.orders o set paid_type = pm.type, payment_mode = case when o.paid_method in ('Pix online', 'Cartão online') then 'tela' else 'externo' end
  from public.payment_methods pm where o.paid and o.paid_type is null and pm.store_id = o.store_id and pm.name = o.paid_method;
update public.orders set paid_type = 'pix', payment_mode = 'tela' where paid and paid_type is null and paid_method = 'Pix online';
update public.orders set paid_type = 'credit', payment_mode = 'tela' where paid and paid_type is null and paid_method = 'Cartão online';

-- ================= RLS =================
alter table public.cash_sessions enable row level security;
create policy platform_all on public.cash_sessions for all to platform_api using (true) with check (true);
grant select, insert, update, delete on public.cash_sessions to platform_api;
create policy tenant_own on public.cash_sessions for all to app_api using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant());
grant select, insert, update on public.cash_sessions to app_api;     -- o turno nunca é apagado pela API: fica o histórico
revoke all on public.cash_sessions from anon, authenticated;
