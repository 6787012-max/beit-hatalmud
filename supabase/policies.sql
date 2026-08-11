-- cheder-v3 · RLS — שומר האבטחה. הרץ אחרי schema.sql.
-- עיקרון: deny-by-default. מנהל רואה הכל; מורה רק את הכיתות שהוקצו לו; רפואי מוגבל.

-- ===== פונקציות עזר (SECURITY DEFINER — עוקפות RLS כדי למנוע רקורסיה) =====
create or replace function public.my_role() returns text
  language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() and active $$;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce(public.my_role() = 'מנהל', false) $$;

create or replace function public.has_class_access(cid bigint) returns boolean
  language sql stable security definer set search_path = public as
$$ select public.is_admin()
     or exists (select 1 from public.user_class_access u where u.user_id = auth.uid() and u.class_id = cid)
     or exists (select 1 from public.classes c where c.id = cid and c.melamed = auth.uid()) $$;

create or replace function public.can_see_student(sid bigint) returns boolean
  language sql stable security definer set search_path = public as
$$ select public.is_admin()
     or exists (select 1 from public.students s where s.id = sid and public.has_class_access(s.class_id)) $$;

-- ===== הפעלת RLS על כל הטבלאות =====
alter table public.profiles          enable row level security;
alter table public.classes           enable row level security;
alter table public.user_class_access enable row level security;
alter table public.students          enable row level security;
alter table public.categories        enable row level security;
alter table public.behavior_events   enable row level security;
alter table public.attendance        enable row level security;
alter table public.tests             enable row level security;
alter table public.functioning       enable row level security;
alter table public.medications       enable row level security;
alter table public.conversations     enable row level security;
alter table public.meetings          enable row level security;
alter table public.reading           enable row level security;
alter table public.writing           enable row level security;
alter table public.tuition           enable row level security;
alter table public.feedback          enable row level security;
alter table public.audit_log         enable row level security;

-- ===== profiles =====
drop policy if exists prof_self_read on public.profiles;
create policy prof_self_read  on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists prof_admin_all on public.profiles;
create policy prof_admin_all  on public.profiles for all    using (public.is_admin()) with check (public.is_admin());

-- ===== classes / access =====
drop policy if exists cls_read on public.classes;
create policy cls_read  on public.classes for select using (public.has_class_access(id));
drop policy if exists cls_admin on public.classes;
create policy cls_admin on public.classes for all    using (public.is_admin()) with check (public.is_admin());
drop policy if exists uca_admin on public.user_class_access;
create policy uca_admin on public.user_class_access for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists uca_self on public.user_class_access;
create policy uca_self  on public.user_class_access for select using (user_id = auth.uid() or public.is_admin());

-- ===== categories (משותף לכולם לקריאה; שינוי למנהל) =====
drop policy if exists cat_read on public.categories;
create policy cat_read  on public.categories for select using (auth.uid() is not null);
drop policy if exists cat_admin on public.categories;
create policy cat_admin on public.categories for all    using (public.is_admin()) with check (public.is_admin());

-- ===== students =====
drop policy if exists stu_read on public.students;
create policy stu_read on public.students for select using (public.has_class_access(class_id));
drop policy if exists stu_ins on public.students;
create policy stu_ins  on public.students for insert with check (public.has_class_access(class_id));
drop policy if exists stu_upd on public.students;
create policy stu_upd  on public.students for update using (public.has_class_access(class_id)) with check (public.has_class_access(class_id));
drop policy if exists stu_del on public.students;
create policy stu_del  on public.students for delete using (public.is_admin());

-- ===== מקרו לוגי לטבלאות תלויות-תלמיד (מיושם פרטנית לכל טבלה) =====
-- behavior_events
drop policy if exists beh_read on public.behavior_events;
create policy beh_read on public.behavior_events for select using (public.can_see_student(student_id));
drop policy if exists beh_ins on public.behavior_events;
create policy beh_ins  on public.behavior_events for insert with check (public.can_see_student(student_id));
drop policy if exists beh_upd on public.behavior_events;
create policy beh_upd  on public.behavior_events for update using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));
drop policy if exists beh_del on public.behavior_events;
create policy beh_del  on public.behavior_events for delete using (public.can_see_student(student_id));
-- attendance
drop policy if exists att_read on public.attendance;
create policy att_read on public.attendance for select using (public.can_see_student(student_id));
drop policy if exists att_ins on public.attendance;
create policy att_ins  on public.attendance for insert with check (public.can_see_student(student_id));
drop policy if exists att_upd on public.attendance;
create policy att_upd  on public.attendance for update using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));
drop policy if exists att_del on public.attendance;
create policy att_del  on public.attendance for delete using (public.can_see_student(student_id));
-- tests
drop policy if exists tst_read on public.tests;
create policy tst_read on public.tests for select using (public.can_see_student(student_id));
drop policy if exists tst_ins on public.tests;
create policy tst_ins  on public.tests for insert with check (public.can_see_student(student_id));
drop policy if exists tst_upd on public.tests;
create policy tst_upd  on public.tests for update using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));
drop policy if exists tst_del on public.tests;
create policy tst_del  on public.tests for delete using (public.can_see_student(student_id));
-- functioning
drop policy if exists fnc_read on public.functioning;
create policy fnc_read on public.functioning for select using (public.can_see_student(student_id));
drop policy if exists fnc_all on public.functioning;
create policy fnc_all  on public.functioning for all using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));
-- conversations
drop policy if exists cnv_all on public.conversations;
create policy cnv_all  on public.conversations for all using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));
-- meetings
drop policy if exists mtg_all on public.meetings;
create policy mtg_all  on public.meetings for all using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));
-- reading
drop policy if exists rdg_all on public.reading;
create policy rdg_all  on public.reading for all using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));
-- writing
drop policy if exists wrt_all on public.writing;
create policy wrt_all  on public.writing for all using (public.can_see_student(student_id)) with check (public.can_see_student(student_id));

-- ===== רפואי — מוגבל: קריאה לפי כיתה, שינוי למנהל בלבד =====
drop policy if exists med_read on public.medications;
create policy med_read on public.medications for select using (public.can_see_student(student_id));
drop policy if exists med_write on public.medications;
create policy med_write on public.medications for all using (public.is_admin()) with check (public.is_admin());

-- ===== כספים — מנהל + מזכירה (מזכירה = כספים בלבד); מפקח קורא =====
alter table public.tuition   enable row level security;
alter table public.income    enable row level security;
alter table public.expenses  enable row level security;
alter table public.subjects  enable row level security;
drop policy if exists tui_money on public.tuition;
create policy tui_money on public.tuition for all
  using (public.is_admin() or public.my_role() in ('מזכירה','מפקח'))
  with check (public.is_admin() or public.my_role() = 'מזכירה');
drop policy if exists inc_money on public.income;
create policy inc_money on public.income for all
  using (public.is_admin() or public.my_role() in ('מזכירה','מפקח'))
  with check (public.is_admin() or public.my_role() = 'מזכירה');
drop policy if exists exp_money on public.expenses;
create policy exp_money on public.expenses for all
  using (public.is_admin() or public.my_role() in ('מזכירה','מפקח'))
  with check (public.is_admin() or public.my_role() = 'מזכירה');
drop policy if exists subj_read on public.subjects;
create policy subj_read on public.subjects for select using (auth.uid() is not null);
drop policy if exists subj_admin on public.subjects;
create policy subj_admin on public.subjects for all using (public.is_admin()) with check (public.is_admin());

-- ===== feedback =====
drop policy if exists fb_ins on public.feedback;
create policy fb_ins  on public.feedback for insert with check (auth.uid() is not null);
drop policy if exists fb_read on public.feedback;
create policy fb_read on public.feedback for select using (public.is_admin() or user_id = auth.uid());

-- ===== audit_log — קריאה למנהל; כתיבה לכל מאומת (רישום פעולות) =====
drop policy if exists aud_read on public.audit_log;
create policy aud_read on public.audit_log for select using (public.is_admin());
drop policy if exists aud_ins on public.audit_log;
create policy aud_ins  on public.audit_log for insert with check (auth.uid() is not null);

-- ===== טפסים וחתימות הורים =====
alter table public.forms          enable row level security;
alter table public.form_responses enable row level security;

-- צוות מאומת מנהל את הטפסים (מוסדיים). הורים אינם ניגשים ישירות — רק דרך פונקציות RPC למטה.
drop policy if exists forms_staff on public.forms;
create policy forms_staff on public.forms for all using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists fr_staff on public.form_responses;
create policy fr_staff on public.form_responses for all
  using (public.is_admin() or student_id is null or public.can_see_student(student_id))
  with check (public.is_admin() or student_id is null or public.can_see_student(student_id));

-- חתימת הורה ללא התחברות: גישה מוגבלת לפונקציות SECURITY DEFINER לפי טוקן/מזהה בלבד.
-- ההורה לא יכול למנות/לקרוא טפסים אחרים — רק את הטופס שהקישור שלו בידיו.
create or replace function public.get_signing(p_token text)
  returns table(form_id bigint, title text, body text, status text, signer_name text, signed_at date)
  language sql stable security definer set search_path = public as
$$ select f.id, f.title, f.body, r.status, r.signer_name, r.signed_at
     from public.form_responses r join public.forms f on f.id = r.form_id
    where r.token = p_token $$;

create or replace function public.get_form(p_form_id bigint)
  returns table(form_id bigint, title text, body text)
  language sql stable security definer set search_path = public as
$$ select id, title, body from public.forms where id = p_form_id $$;

create or replace function public.submit_signature(p_token text, p_name text)
  returns boolean language plpgsql security definer set search_path = public as
$$ declare n int;
begin
  if length(coalesce(p_name,'')) < 2 then return false; end if;
  update public.form_responses set status='signed', signer_name=p_name, signed_at=current_date
    where token = p_token and status <> 'signed';
  get diagnostics n = row_count; return n > 0;
end $$;

create or replace function public.submit_general(p_form_id bigint, p_name text)
  returns boolean language plpgsql security definer set search_path = public as
$$ begin
  if length(coalesce(p_name,'')) < 2 then return false; end if;
  if not exists (select 1 from public.forms where id = p_form_id) then return false; end if;
  insert into public.form_responses(form_id, status, signer_name, signed_at, token)
    values (p_form_id, 'signed', p_name, current_date, 'web-'||md5(random()::text||clock_timestamp()::text));
  return true;
end $$;

revoke all on function public.get_signing(text), public.get_form(bigint),
  public.submit_signature(text, text), public.submit_general(bigint, text) from public;
grant execute on function public.get_signing(text)              to anon, authenticated;
grant execute on function public.get_form(bigint)               to anon, authenticated;
grant execute on function public.submit_signature(text, text)   to anon, authenticated;
grant execute on function public.submit_general(bigint, text)   to anon, authenticated;
