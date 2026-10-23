-- The person's theme choice, kept on their account so it follows them to every
-- sign-in and device. Null means they never chose; the app then keeps what this
-- device remembers (light by default). profiles already has own-row RLS for
-- select, insert and update, and the events trigger fires on insert only, so a
-- theme change is not logged as activity.

alter table public.profiles
  add column if not exists appearance text
  check (appearance in ('light', 'dark', 'system'));
