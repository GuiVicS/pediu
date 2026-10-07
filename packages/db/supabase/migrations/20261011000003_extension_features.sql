-- Atendimento WhatsApp: respostas rápidas, controle por conversa do agente, rascunhos de pedido e disparos.
alter table public.store_customers add column marketing_opt_in boolean not null default false;   -- só quem aceitou entra em disparos

create table public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  title text not null check (length(title) between 1 and 60),
  body text not null check (length(body) between 1 and 1000),
  sort int not null default 0, active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create index quick_replies_store_idx on public.quick_replies(store_id, sort);

-- estado do agente por conversa; chat_id é o id do WhatsApp (pode ser LID, não assumimos telefone)
create table public.agent_conversations (
  store_id uuid not null, tenant_id uuid not null,
  chat_id text not null check (length(chat_id) between 3 and 80),
  mode text not null default 'assisted' check (mode in ('off', 'assisted', 'auto')),
  human_paused boolean not null default false,
  last_message_id text,
  updated_at timestamptz not null default now(),
  primary key (store_id, chat_id),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);

-- rascunho montado pelo agente: o cliente abre o link e finaliza no checkout normal (preço recalculado lá)
create table public.order_drafts (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  store_id uuid not null, tenant_id uuid not null,
  type text not null check (type in ('delivery', 'retirada')),
  zone_id uuid,
  lines jsonb not null,
  chat_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);

create table public.broadcast_campaigns (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  name text not null check (length(name) between 1 and 80),
  body text not null check (length(body) between 1 and 1000),
  status text not null default 'pausada' check (status in ('pausada', 'rodando', 'cancelada', 'concluida')),
  created_by uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, store_id),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create table public.broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null, store_id uuid not null, tenant_id uuid not null,
  customer_id uuid, name text not null default '', phone text not null,
  status text not null default 'pendente' check (status in ('pendente', 'enviando', 'enviada', 'falhou', 'incerta')),
  leased_at timestamptz, finished_at timestamptz, error text,
  unique (campaign_id, phone),
  foreign key (campaign_id, store_id) references public.broadcast_campaigns(id, store_id) on delete cascade
);
create index broadcast_recipients_next_idx on public.broadcast_recipients(campaign_id, status);

do $$ declare t text; begin
  foreach t in array array['quick_replies', 'agent_conversations', 'order_drafts', 'broadcast_campaigns', 'broadcast_recipients'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy platform_all on public.%I for all to platform_api using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to platform_api', t);
    execute format('create policy tenant_own on public.%I for all to app_api using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant())', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
grant select, insert, update, delete on public.quick_replies to app_api;
grant select, insert, update on public.agent_conversations, public.order_drafts, public.broadcast_campaigns, public.broadcast_recipients to app_api;
grant update (marketing_opt_in) on public.store_customers to app_api;

-- o rascunho é aberto pelo cliente sem login: só o necessário, por token
create or replace function app.order_draft(p_token text, p_now timestamptz)
returns table (store_id uuid, type text, zone_id uuid, lines jsonb)
language sql stable security definer set search_path = public as
$$ select d.store_id, d.type, d.zone_id, d.lines from public.order_drafts d
    join public.stores s on s.id = d.store_id where d.token = p_token and d.expires_at > p_now and s.status = 'producao' $$;
revoke all on function app.order_draft(text, timestamptz) from public;
grant execute on function app.order_draft(text, timestamptz) to app_api;
