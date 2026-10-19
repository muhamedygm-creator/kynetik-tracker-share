-- Theme switch (Joey, 2026-10-17; docs/amends/THEME_SWITCH_PROMPT.md): each person's Light / Dark / System choice,
-- kept on their profile so it follows them across devices (the browser keeps a copy so pages open in the right
-- theme without a flash). Dark, the Kynetik look, is the default.
--   · Only the person themself changes it, through set_theme (profiles are otherwise Owner-only to update).
--   · A theme change is a display preference, not tracker data: it is left out of the audit log.

alter table public.profiles
  add column theme text not null default 'dark' check (theme in ('light', 'dark', 'system'));

create or replace function public.set_theme(p_theme text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_theme is null or p_theme not in ('light', 'dark', 'system') then
    raise exception 'Choose Light, Dark or System.';
  end if;
  perform set_config('app.skip_audit', 'on', true);
  update public.profiles set theme = p_theme where user_id = auth.uid();
  perform set_config('app.skip_audit', 'off', true);
end $$;

revoke all on function public.set_theme(text) from public;
grant execute on function public.set_theme(text) to authenticated;
