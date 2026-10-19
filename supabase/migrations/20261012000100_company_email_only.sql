-- Company addresses only (Owner, 2026-10-12, docs/ux/DECISIONS.md): access is limited to
-- @kynetikkoncepts.com emails. Enforced here so no path around the app (Microsoft, email link,
-- a stray auth user, an old profile) gets in:
--   · an invitation for any other address is refused;
--   · a new auth user with any other address gets no profile;
--   · an existing profile with any other address has no role, so RLS shows it nothing.
-- Rows are kept, not deleted, so history and the audit log stay intact.

create or replace function private.company_email(e text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(lower(split_part(trim(e), '@', 2)) = 'kynetikkoncepts.com', false)
$$;
grant execute on function private.company_email(text) to authenticated;

create or replace function private.current_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.user_id = auth.uid() and p.active and private.company_email(p.email)
$$;

-- Runs before apply_invitation (triggers fire in name order).
create or replace function private.check_invitation_email() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not private.company_email(new.email) then
    raise exception 'Only @kynetikkoncepts.com addresses can be invited.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger a_check_invitation_email before insert or update of email on public.invitations
  for each row execute function private.check_invitation_email();

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv public.invitations;
begin
  if not private.company_email(new.email) then return new; end if;
  select * into inv from public.invitations where lower(email) = lower(new.email);
  if found then
    insert into public.profiles (user_id, email, name, role)
    values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)), inv.role)
    on conflict (user_id) do nothing;
    update public.invitations set accepted_at = coalesce(accepted_at, now()) where id = inv.id;
  end if;
  return new;
end $$;

-- The Owner who keeps the app running must be one who can still sign in.
create or replace function private.guard_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where role = 'owner' and active and private.company_email(email)) then
    raise exception 'There must always be at least one active Owner.' using errcode = 'P0001';
  end if;
  return null;
end $$;
