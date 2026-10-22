-- Balança v2.5 | Aplique em projeto Supabase reservado/aprovado para a equipe.
-- Nunca coloque a service_role ou senhas SQL no aplicativo.
-- Dados, incluindo fotos, permanecem privados aos integrantes autenticados de cada equipe.

create table if not exists public.balanca_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.balanca_team_members (
  team_id uuid not null references public.balanca_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id,user_id)
);
create index if not exists balanca_team_members_user_idx on public.balanca_team_members(user_id);
create table if not exists public.balanca_team_invites (
  team_id uuid primary key references public.balanca_teams(id) on delete cascade,
  code uuid not null unique default gen_random_uuid()
);
create table if not exists public.balanca_team_data (
  team_id uuid primary key references public.balanca_teams(id) on delete cascade,
  payload jsonb not null,
  version bigint not null default 1 check(version>0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.balanca_teams enable row level security;
alter table public.balanca_team_members enable row level security;
alter table public.balanca_team_invites enable row level security;
alter table public.balanca_team_data enable row level security;
revoke all on public.balanca_teams, public.balanca_team_members, public.balanca_team_invites, public.balanca_team_data from anon;
grant select,insert on public.balanca_teams to authenticated;
grant select,insert on public.balanca_team_members to authenticated;
grant select,insert on public.balanca_team_invites to authenticated;
grant select,insert on public.balanca_team_data to authenticated;
-- UPDATE direto bloqueado: todas alterações passam por RPC com versão esperada.
revoke update on public.balanca_team_data from authenticated;

-- É possível listar apenas os espaços a que a pessoa pertence; cada membro lê sua própria inscrição.
create policy "balanca_teams_read" on public.balanca_teams
for select to authenticated using (
 owner_id=(select auth.uid()) or id in
 (select team_id from public.balanca_team_members where user_id=(select auth.uid()))
);
create policy "balanca_teams_create" on public.balanca_teams
for insert to authenticated with check(owner_id=(select auth.uid()));
create policy "balanca_member_read_own" on public.balanca_team_members
for select to authenticated using(user_id=(select auth.uid()));
create policy "balanca_owner_member_create" on public.balanca_team_members
for insert to authenticated with check(
 user_id=(select auth.uid()) and exists(
   select 1 from public.balanca_teams t where t.id=team_id and t.owner_id=(select auth.uid())
 )
);
create policy "balanca_owner_invite_read" on public.balanca_team_invites
for select to authenticated using(exists(
 select 1 from public.balanca_teams t where t.id=team_id and t.owner_id=(select auth.uid())
));
create policy "balanca_owner_invite_create" on public.balanca_team_invites
for insert to authenticated with check(exists(
 select 1 from public.balanca_teams t where t.id=team_id and t.owner_id=(select auth.uid())
));
create policy "balanca_team_data_read" on public.balanca_team_data
for select to authenticated using(team_id in (
 select m.team_id from public.balanca_team_members m where m.user_id=(select auth.uid())
));
create policy "balanca_team_data_create" on public.balanca_team_data
for insert to authenticated with check(team_id in (
 select t.id from public.balanca_teams t where t.owner_id=(select auth.uid())
));
create policy "balanca_team_data_update" on public.balanca_team_data
for update to authenticated using(team_id in (
 select m.team_id from public.balanca_team_members m where m.user_id=(select auth.uid())
)) with check(team_id in (
 select m.team_id from public.balanca_team_members m where m.user_id=(select auth.uid())
));

-- A função interna tem uma única finalidade: aceitar um convite UUID de alta entropia.
-- Não está no schema exposto pela API. A função pública é apenas um wrapper autenticado.
create schema if not exists balanca_private;
revoke all on schema balanca_private from public, anon;
grant usage on schema balanca_private to authenticated;
create or replace function balanca_private.join_team(p_team uuid, p_code uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
 v_user := auth.uid();
 if v_user is null or (select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) then
  raise exception 'Entre com uma conta para participar da equipe';
 end if;
 if not exists(select 1 from public.balanca_team_invites where team_id=p_team and code=p_code) then
  return false;
 end if;
 insert into public.balanca_team_members(team_id,user_id) values(p_team,v_user)
 on conflict(team_id,user_id) do nothing;
 return true;
end $$;
revoke all on function balanca_private.join_team(uuid,uuid) from public, anon;
grant execute on function balanca_private.join_team(uuid,uuid) to authenticated;
create or replace function public.balanca_join_team(p_team uuid,p_code uuid)
returns boolean language sql security invoker set search_path = '' as $$
 select balanca_private.join_team(p_team,p_code);
$$;
revoke all on function public.balanca_join_team(uuid,uuid) from public, anon;
grant execute on function public.balanca_join_team(uuid,uuid) to authenticated;

-- Atualização atômica: somente integrantes, com revisão obrigatória, sem UPDATE direto.
create or replace function balanca_private.save_team(p_team uuid,p_payload jsonb,p_expected bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_version bigint;
begin
 v_user := auth.uid();
 if v_user is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
  raise exception 'Autenticação obrigatória';
 end if;
 if not exists(select 1 from public.balanca_team_members where team_id=p_team and user_id=v_user) then
  raise exception 'Sem permissão para esta equipe';
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Dados inválidos'; end if;
 if octet_length(p_payload::text)>25000000 then raise exception 'Backup da equipe excedeu 25 MB'; end if;
 update public.balanca_team_data
    set payload=p_payload,version=version+1,updated_at=now(),updated_by=v_user
  where team_id=p_team and version=p_expected
  returning version into v_version;
 if v_version is null then raise exception 'SYNC_CONFLICT: dados atualizados em outro aparelho'; end if;
 return v_version;
end $$;
revoke all on function balanca_private.save_team(uuid,jsonb,bigint) from public,anon;
grant execute on function balanca_private.save_team(uuid,jsonb,bigint) to authenticated;
create or replace function public.balanca_team_save(p_team uuid,p_payload jsonb,p_expected bigint)
returns bigint language sql security invoker set search_path = '' as $$
 select balanca_private.save_team(p_team,p_payload,p_expected);
$$;
revoke all on function public.balanca_team_save(uuid,jsonb,bigint) from public,anon;
grant execute on function public.balanca_team_save(uuid,jsonb,bigint) to authenticated;

-- Segurança: nenhuma tabela tem políticas TO anon; não reutilizar projeto financeiro/cripto.
-- Recomendado: restringir cadastro aos e-mails da equipe e habilitar confirmação de e-mail.
