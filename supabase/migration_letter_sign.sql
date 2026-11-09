-- מכתב להורים עם שם התלמיד בספח (09/11/2026)
-- דף החתימה (sign.html) מציג טופס-מכתב כמו המכתב המודפס, ובספח "אנו הורי הבחור: ___"
-- כתוב כבר שם התלמיד. השם מגיע לפי הטוקן האישי בלבד (96 ביט אקראי, ר' tok() ב-forms.js),
-- כלומר רק מי שקיבל את הקישור של התלמיד הזה רואה את שמו. לא נוגע ב-get_signing הקיימת.
create or replace function public.get_signing_student(p_token text)
  returns text language sql stable security definer set search_path = public as
$$ select s.name
     from public.form_responses r join public.students s on s.id = r.student_id
    where r.token = p_token and length(coalesce(p_token, '')) >= 16
    limit 1 $$;

revoke all on function public.get_signing_student(text) from public;
grant execute on function public.get_signing_student(text) to anon, authenticated;

-- ── קישור כללי למכתב: ההורה בוחר את הבן (09/11/2026) ─────────────────────
-- רשימת הבנים לבורר — רק לטופס-מכתב פתוח (גוף שמתחיל ב-[מכתב]), ורק לפי קוד הקישור האקראי.
-- הרשימה = התלמידים שיש להם שורה בטופס (אותם תלמידים שבמעקב); אם אין שורות — כל הפעילים.
create or replace function public.get_public_form_students(g_token text)
  returns table(id bigint, name text, cls text, signed boolean)
  language sql stable security definer set search_path = public as
$$ with f as (
     select fo.id from public.forms fo
      where fo.link_token = g_token and fo.is_public and not fo.closed
        and (fo.open_until is null or fo.open_until >= current_date)
        and ltrim(coalesce(fo.body, '')) like '[מכתב]%'
      limit 1),
   pool as (
     select distinct r.student_id as sid from public.form_responses r join f on r.form_id = f.id
      where r.student_id is not null),
   ids as (
     select sid from pool
     union
     select s.id from public.students s
      where s.status = 'פעיל' and exists (select 1 from f) and not exists (select 1 from pool))
   select s.id, s.name, coalesce(c.name, ''),
          exists (select 1 from public.form_responses r join f on r.form_id = f.id
                   where r.student_id = s.id and r.status = 'signed')
     from ids join public.students s on s.id = ids.sid
     left join public.classes c on c.id = s.class_id
    order by c.name nulls last, s.name $$;

revoke all on function public.get_public_form_students(text) from public;
grant execute on function public.get_public_form_students(text) to anon, authenticated;

-- submit_public_form: אם ההורה בחר בן (_student_id) והוא ברשימה של הטופס — החתימה נרשמת אצלו
-- (השורה הממתינה שלו מתעדכנת). אחרת — הזיהוי הקיים לפי טלפון/משפחה. השאר ללא שינוי.
create or replace function public.submit_public_form(g_token text, p_name text, p_answers jsonb, p_signature text)
  returns boolean language plpgsql security definer set search_path = public as
$function$
declare fid bigint; sid bigint; rid bigint;
begin
  if length(coalesce(p_name, '')) < 2 then return false; end if;
  -- מגני גודל נגד הצפה/ניפוח אחסון (DoS): שם/חתימה/תשובות בגבולות סבירים
  if length(p_name) > 100 then return false; end if;
  if length(coalesce(p_signature, '')) > 300000 then return false; end if;
  if pg_column_size(coalesce(p_answers, '{}'::jsonb)) > 65536 then return false; end if;
  select f.id into fid from public.forms f
    where f.link_token = g_token and f.is_public and not f.closed
      and (f.open_until is null or f.open_until >= current_date)
    limit 1;
  if fid is null then return false; end if;
  if coalesce(p_answers->>'_student_id', '') ~ '^[0-9]{1,12}$' then
    select g.id into sid from public.get_public_form_students(g_token) g
     where g.id = (p_answers->>'_student_id')::bigint;
  end if;
  if sid is null then
    sid := public.match_student_for_form(p_name, p_answers);
  end if;
  if sid is not null then
    select r.id into rid from public.form_responses r
      where r.form_id = fid and r.student_id = sid and r.status <> 'signed'
      limit 1;
    if rid is not null then
      update public.form_responses
         set status = 'signed', signer_name = p_name, signed_at = current_date,
             answers = coalesce(p_answers, '{}'::jsonb), signature = p_signature
       where id = rid;
      return true;
    end if;
  end if;
  insert into public.form_responses(form_id, student_id, status, signer_name, signed_at, answers, signature, token)
    values (fid, sid, 'signed', p_name, current_date, coalesce(p_answers, '{}'::jsonb), p_signature,
            'pub-' || md5(random()::text || clock_timestamp()::text));
  return true;
end $function$;
