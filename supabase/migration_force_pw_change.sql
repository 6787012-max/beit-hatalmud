-- migration_force_pw_change.sql — כפיית החלפת סיסמת ברירת מחדל (2026-08-26)
--
-- **הרקע:** סיסמת הכניסה הראשונית של כל איש צוות היא **מספר הטלפון שלו**
-- (`admin.js` יוצר כך). מספרי הטלפון של הצוות ידועים במוסד, ולכן כל עוד
-- מישהו לא החליף — החשבון שלו פתוח בפועל לכל מי שמכיר את המספר. זה מסומן
-- כפרצה פתוחה ב-SECURITY.md מאז 11/08 ולא טופל.
--
-- **המודל:** לא מנסים לנחש מהי הסיסמה (אי אפשר — היא hashed בצד-שרת).
-- במקום זה מתעדים **האם המשתמש החליף אותה בעצמו**:
--   `pw_changed_at`    — מתמלא כשהמשתמש מחליף סיסמה במסך שלו. null = לא החליף.
--   `pw_prompt_since`  — מתי הוצגה לו ההתראה בפעם הראשונה. ממנה נספר השבוע.
-- שבוע הוא **מרגע ההתראה הראשונה** ולא מרגע יצירת המשתמש: כל הצוות קיים
-- כבר חודש, וספירה מהיצירה היתה נועלת את כולם ברגע הפריסה.
--
-- **למה RPC ולא policy:** RLS ב-Postgres חל על שורות ולא על עמודות. מתן
-- update על `profiles` למשתמש היה מאפשר לו גם לשנות `role` ל'מנהל'. שתי
-- הפונקציות כאן נוגעות **אך ורק** בשתי העמודות האלה, ורק בשורה של הקורא.
--
-- אידמפוטנטי.

alter table public.profiles add column if not exists pw_changed_at   timestamptz;
alter table public.profiles add column if not exists pw_prompt_since timestamptz;

comment on column public.profiles.pw_changed_at is
  'מתי המשתמש החליף סיסמה בעצמו. null = עדיין בסיסמת ברירת המחדל (טלפון).';
comment on column public.profiles.pw_prompt_since is
  'מתי הוצגה לו לראשונה ההתראה. הדדליין = +7 ימים.';

-- מסמן שההתראה הוצגה, ומחזיר את מצב המשתמש. הפעם הראשונה קובעת את הדדליין.
create or replace function public.pw_status() returns table(
  needs_change boolean, prompt_since timestamptz, deadline timestamptz, overdue boolean)
  language plpgsql security definer set search_path = public as
$$
declare p record;
begin
  select id, pw_changed_at, pw_prompt_since into p
    from public.profiles where id = auth.uid() and active;
  if p.id is null then
    return query select false, null::timestamptz, null::timestamptz, false;
    return;
  end if;
  if p.pw_changed_at is not null then
    return query select false, p.pw_prompt_since, null::timestamptz, false;
    return;
  end if;
  if p.pw_prompt_since is null then
    update public.profiles set pw_prompt_since = now() where id = p.id
      returning pw_prompt_since into p.pw_prompt_since;
  end if;
  return query select true, p.pw_prompt_since,
                      p.pw_prompt_since + interval '7 days',
                      now() > p.pw_prompt_since + interval '7 days';
end $$;

-- נקרא אחרי שהמשתמש באמת החליף סיסמה ב-Supabase Auth.
create or replace function public.pw_mark_changed() returns boolean
  language plpgsql security definer set search_path = public as
$$
begin
  update public.profiles set pw_changed_at = now() where id = auth.uid() and active;
  return found;
end $$;

revoke all on function public.pw_status()       from public, anon;
revoke all on function public.pw_mark_changed() from public, anon;
grant execute on function public.pw_status()       to authenticated;
grant execute on function public.pw_mark_changed() to authenticated;

-- כשמנהל מאפס סיסמה למישהו, אותו אדם חוזר להיות "לא החליף" ויתבקש שוב.
-- (admin.js קורא לזה אחרי איפוס.)
create or replace function public.pw_reset_flag(p_user uuid) returns boolean
  language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_admin() then return false; end if;
  update public.profiles set pw_changed_at = null, pw_prompt_since = null where id = p_user;
  return found;
end $$;
revoke all on function public.pw_reset_flag(uuid) from public, anon;
grant execute on function public.pw_reset_flag(uuid) to authenticated;
