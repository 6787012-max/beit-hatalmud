-- ═══════════════════════════════════════════════════════════════
-- migration_public_forms.sql — טופס ציבורי מאובטח ("גוגל פורמס") + נעילת חדר הטפסים.
-- קישור כללי עם קוד אקראי בלתי-נחיש, תאריך-סיום/סגירה, וללא מספור/זיוף.
-- בטוח להרצה חוזרת. הרץ ב-SQL Editor אחרי setup_all + migration_fixes.
-- ═══════════════════════════════════════════════════════════════

-- 1) עמודות לקישור הכללי המאובטח
alter table public.forms add column if not exists link_token text unique;      -- קוד הקישור האקראי (?g=...)
alter table public.forms add column if not exists is_public  boolean not null default false;  -- הקישור הכללי פעיל?
alter table public.forms add column if not exists open_until date;             -- תאריך-סיום (null = ללא)
alter table public.forms add column if not exists closed     boolean not null default false;   -- נסגר ידנית

-- 2) הסרת ה-RPC הישנים והפגיעים (לפי מספר טופס — ניתן לנחש/לזייף)
drop function if exists public.get_form(bigint);
drop function if exists public.submit_general(bigint, text, jsonb, text);
drop function if exists public.submit_general(bigint, text);

-- 3) קריאת טופס ציבורי — לפי הקוד האקראי בלבד, ורק אם פתוח (לא נסגר, לא פג תוקף).
--    אין גישה לפי מספר → אי אפשר לנחש/לספור טפסים אחרים.
create or replace function public.get_public_form(g_token text)
  returns table(title text, body text, fields jsonb)
  language sql stable security definer set search_path = public as
$$ select f.title, f.body, f.fields
     from public.forms f
    where f.link_token = g_token
      and f.is_public and not f.closed
      and (f.open_until is null or f.open_until >= current_date) $$;

-- 4) שליחת מילוי ציבורי — לפי הקוד בלבד; בדיקת פתיחה/דדליין בצד-שרת; יוצר שורה חדשה בלבד.
--    לא קורא/משנה תשובות של אחרים, לא נוגע בטבלה ישירות.
create or replace function public.submit_public_form(g_token text, p_name text, p_answers jsonb, p_signature text)
  returns boolean language plpgsql security definer set search_path = public as
$$
declare fid bigint;
begin
  if length(coalesce(p_name,'')) < 2 then return false; end if;
  select f.id into fid from public.forms f
    where f.link_token = g_token and f.is_public and not f.closed
      and (f.open_until is null or f.open_until >= current_date)
    limit 1;
  if fid is null then return false; end if;   -- קוד שגוי / טופס סגור / פג תוקף
  insert into public.form_responses(form_id, student_id, status, signer_name, signed_at, answers, signature, token)
    values (fid, null, 'signed', p_name, current_date, coalesce(p_answers, '{}'::jsonb), p_signature,
            'pub-' || md5(random()::text || clock_timestamp()::text));
  return true;
end $$;

revoke all on function public.get_public_form(text), public.submit_public_form(text, text, jsonb, text) from public;
grant execute on function public.get_public_form(text)                       to anon, authenticated;
grant execute on function public.submit_public_form(text, text, jsonb, text) to anon, authenticated;

-- 5) נעילת חדר הטפסים — רק צוות אמיתי ניגש ישירות (לא מי שנרשם לבד וקיבל 'צוות').
--    הורים/ציבור עוברים אך ורק דרך ה-RPC למעלה, אז זה לא פוגע בהם.
drop policy if exists forms_staff on public.forms;
drop policy if exists forms_read  on public.forms;
drop policy if exists forms_write on public.forms;
create policy forms_read  on public.forms for select
  using (public.is_admin() or public.my_role() in ('מזכירה','מפקח','מורה'));
create policy forms_write on public.forms for all
  using (public.is_admin() or public.my_role() = 'מזכירה')
  with check (public.is_admin() or public.my_role() = 'מזכירה');

-- form_responses: מנהל/מזכירה/מפקח + המורה של התלמיד. תשובות כלליות (student_id null) — מנהל/מזכירה/מפקח בלבד.
drop policy if exists fr_staff on public.form_responses;
create policy fr_staff on public.form_responses for all
  using      (public.is_admin() or public.my_role() in ('מזכירה','מפקח') or public.can_see_student(student_id))
  with check (public.is_admin() or public.my_role() in ('מזכירה','מפקח') or public.can_see_student(student_id));
