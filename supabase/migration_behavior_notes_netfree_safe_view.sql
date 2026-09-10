-- migration_behavior_notes_netfree_safe_view.sql (2026-09-10)
--
-- Problem: some legitimate Hebrew behavior_events/behavior_comments note text
-- gets misclassified as inappropriate by a network content filter on the
-- viewer's own network, which inspects the plaintext HTTP response body and
-- replaces/blocks the flagged run of text -- turning real disciplinary notes
-- into "xxxxx" in the UI. Not an app bug, not corrupted data: verified by
-- fetching the exact same rows from a network with no such filter, where the
-- text reads completely normally.
--
-- Fix: read-only views that return the note field base64-encoded instead of
-- plaintext, so no scannable Hebrew substring appears in the response body.
-- The app's read path decodes note_b64 -> note client-side before rendering
-- (see js/store.js). The write path is untouched -- inserts/updates still go
-- straight to the real table with plaintext note, since outgoing POST bodies
-- were never observed being blocked, only fetched/response content.
--
-- security_invoker = true makes each view evaluate RLS as the querying role,
-- not the view owner -- required so per-student RLS (can_see_student) still
-- applies exactly as on the base table. Idempotent (create or replace).

create or replace view public.behavior_events_enc
with (security_invoker = true) as
select
  id, student_id, category_id, severity, event_date, event_time,
  case when note is null then null
       else encode(convert_to(note, 'UTF8'), 'base64') end as note_b64,
  created_by, created_at, followup, due_date
from public.behavior_events;

create or replace view public.behavior_comments_enc
with (security_invoker = true) as
select
  id, event_id, comment_date,
  case when note is null then null
       else encode(convert_to(note, 'UTF8'), 'base64') end as note_b64,
  created_by, created_at
from public.behavior_comments;

grant select on public.behavior_events_enc to authenticated;
grant select on public.behavior_comments_enc to authenticated;
