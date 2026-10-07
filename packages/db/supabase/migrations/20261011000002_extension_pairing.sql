-- Pareamento da extensão do WhatsApp com a sessão do lojista.
-- A extensão nunca recebe o cookie da equipe: troca um código de uso único por uma credencial própria,
-- que só vale enquanto a sessão que aprovou o pareamento, o usuário e a liberação da loja continuarem válidos.
create table public.extension_pairings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, store_id uuid not null,
  staff_id uuid not null references public.staff_users(id) on delete cascade,
  session_id uuid not null references public.staff_sessions(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create table public.extension_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, store_id uuid not null,
  staff_id uuid not null references public.staff_users(id) on delete cascade,
  session_id uuid not null references public.staff_sessions(id) on delete cascade,
  token_hash text not null unique,
  name text not null default '' check (length(name) <= 80),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create index extension_devices_store_idx on public.extension_devices(store_id);

do $$ declare t text; begin
  foreach t in array array['extension_pairings', 'extension_devices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy platform_all on public.%I for all to platform_api using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to platform_api', t);
    execute format('create policy tenant_own on public.%I for all to app_api using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant())', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
grant select, insert, update on public.extension_pairings, public.extension_devices to app_api;

-- condição comum: a liberação "whatsapp_support" da loja está ativa
create or replace function app.feature_on(p_store uuid, p_feature text) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.store_features where store_id = p_store and feature = p_feature and enabled) $$;

-- troca o código de uso único por um dispositivo (sem saber o tenant ainda). Devolve nada se o código for inválido, usado, vencido ou a sessão não valer mais.
create or replace function app.extension_pair(p_code_hash text, p_device_hash text, p_name text, p_now timestamptz)
returns table (device_id uuid, store_id uuid, tenant_id uuid, store_name text)
language plpgsql security definer set search_path = public as
$$ declare pr public.extension_pairings; d uuid;
begin
  update public.extension_pairings set used_at = p_now
   where code_hash = p_code_hash and used_at is null and expires_at > p_now returning * into pr;
  if not found then return; end if;
  if not exists (select 1 from public.staff_sessions ss join public.staff_users u on u.id = ss.staff_id
                  where ss.id = pr.session_id and ss.revoked_at is null and ss.expires_at > p_now and u.active)
     or not app.feature_on(pr.store_id, 'whatsapp_support') then return; end if;
  insert into public.extension_devices (tenant_id, store_id, staff_id, session_id, token_hash, name, created_at, last_seen_at)
  values (pr.tenant_id, pr.store_id, pr.staff_id, pr.session_id, p_device_hash, left(coalesce(p_name, ''), 80), p_now, p_now) returning id into d;
  return query select d, pr.store_id, pr.tenant_id, (select s.name from public.stores s where s.id = pr.store_id);
end $$;

-- valida a credencial da extensão a cada uso: dispositivo não revogado, sessão do lojista viva, usuário ativo e recurso ainda liberado
create or replace function app.extension_device(p_hash text, p_now timestamptz)
returns table (device_id uuid, staff_id uuid, tenant_id uuid, store_id uuid, role public.app_role, store_name text)
language sql security definer set search_path = public as
$$ update public.extension_devices d set last_seen_at = p_now
    from public.staff_sessions ss, public.staff_users u, public.stores s
   where d.token_hash = p_hash and d.revoked_at is null
     and ss.id = d.session_id and ss.revoked_at is null and ss.expires_at > p_now
     and u.id = d.staff_id and u.active and s.id = d.store_id
     and app.feature_on(d.store_id, 'whatsapp_support')
  returning d.id, d.staff_id, d.tenant_id, d.store_id, u.role, s.name $$;

revoke all on function app.feature_on(uuid, text), app.extension_pair(text, text, text, timestamptz), app.extension_device(text, timestamptz) from public;
grant execute on function app.feature_on(uuid, text), app.extension_pair(text, text, text, timestamptz), app.extension_device(text, timestamptz) to app_api;
