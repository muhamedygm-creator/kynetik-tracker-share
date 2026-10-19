-- Amends round 2026-10-12, part 3 (AM-05; Owner's answer: a limited Modeller login). The new role value is
-- added on its own: Postgres can't use a new enum value in the transaction that adds it.
alter type public.app_role add value if not exists 'modeller';
