-- Amends AM-14 (Owner, 2026-10-13): a "Floor Station" login for the shared workshop iPad. The role value is
-- added on its own: Postgres can't use a new enum value in the transaction that adds it.
alter type public.app_role add value if not exists 'floor_station';
