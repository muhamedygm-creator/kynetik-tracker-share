-- v2: task durations in hours and minutes (docs/ux/DECISIONS.md 2026-10-07). Two decimals of an hour
-- could not hold a minute exactly (1 min = 0.0167 h); four decimals round-trip every whole minute.
alter table public.queue_tasks alter column dur_value type numeric(10,4);
