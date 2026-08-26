-- migration_public_form_link.sql — טופס ציבורי משויך לתלמיד (2026-08-25)
--
-- **הבאג:** הקישור הכללי (`sign.html?g=…`) אחד לכל ההורים, ולכן
-- `submit_public_form` יצרה שורה עם `student_id = null`. התוצאה בפועל בטופס
-- "אישור הורים שנתי": **18 הורים מילאו וחתמו, וכל 37 התלמידים הוצגו כ"ממתין"**.
-- המנהל ראה תמונה הפוכה מהמציאות.
--
-- **הפתרון:** הפונקציה מזהה בעצמה את התלמיד מתוך מה שההורה כבר מילא:
--   1. **טלפון** — כל ערך בתשובות שנראה כמספר טלפון, מול
--      `students.reg` (נייד אב / נייד אם / טלפון בבית). זה הזיהוי החזק.
--   2. **שם משפחה** של החותם מול `students.family` — לאימות ולגיבוי.
-- הצלבה של שניהם גוברת; אחריה טלפון; אחריה שם משפחה. **התאמה מרובה או
-- אפס התאמות → נשמר בלי שיוך**, והמנהל משייך בלחיצה במסך הטפסים. לא מנחשים.
--
-- אם כבר קיימת שורה **ממתינה** לאותו תלמיד באותו טופס — היא זו שמתעדכנת,
-- כדי שלא יופיעו שתי שורות לאותו תלמיד. אם היא **כבר חתומה** (הורה שני
-- שממלא) — נוצרת שורה נוספת משויכת, ולא נדרסת חתימה קיימת.
--
-- אין כאן דליפת מידע: הפונקציה לא מחזירה שום פרט על התלמיד, רק true/false.
-- המזהה נקבע מנתונים שההורה עצמו הזין.
--
-- אידמפוטנטי.

create or replace function public.norm_phone(v text) returns text
  language sql immutable as
$$ select case when length(regexp_replace(coalesce(v,''), '\D', '', 'g')) >= 9
               then right(regexp_replace(v, '\D', '', 'g'), 9) end $$;

create or replace function public.match_student_for_form(p_name text, p_answers jsonb)
  returns bigint
  language plpgsql stable security definer set search_path = public as
$$
declare
  phones text[];
  words  text[];
  ph_ids bigint[];
  fam_ids bigint[];
  hits2   bigint[];
begin
  -- כל ערך בתשובות שנראה כטלפון
  select coalesce(array_agg(distinct public.norm_phone(value)), '{}')
    into phones
    from jsonb_each_text(coalesce(p_answers, '{}'::jsonb))
   where public.norm_phone(value) is not null;

  -- מילות השם של החותם (שם המשפחה ביניהן)
  select coalesce(array_agg(w), '{}') into words
    from unnest(string_to_array(btrim(coalesce(p_name, '')), ' ')) w
   where length(w) > 1;

  select coalesce(array_agg(distinct s.id), '{}') into ph_ids
    from public.students s
   where array_length(phones, 1) is not null
     and (public.norm_phone(s.reg->>'נייד אב')   = any(phones)
       or public.norm_phone(s.reg->>'נייד אם')   = any(phones)
       or public.norm_phone(s.reg->>'טלפון בבית') = any(phones));

  select coalesce(array_agg(distinct s.id), '{}') into fam_ids
    from public.students s
   where array_length(words, 1) is not null
     and btrim(coalesce(s.family, '')) = any(words);

  select coalesce(array_agg(x), '{}') into hits2
    from unnest(ph_ids) x where x = any(fam_ids);

  if array_length(hits2, 1) = 1 then return hits2[1]; end if;
  if array_length(ph_ids, 1) = 1 then return ph_ids[1]; end if;
  if array_length(fam_ids, 1) = 1 then return fam_ids[1]; end if;
  return null;                    -- לא הוכרע — המנהל ישייך ידנית
end $$;

create or replace function public.submit_public_form(g_token text, p_name text, p_answers jsonb, p_signature text)
  returns boolean
  language plpgsql security definer set search_path = public as
$$
declare
  fid bigint;
  sid bigint;
  rid bigint;
begin
  if length(coalesce(p_name, '')) < 2 then return false; end if;
  select f.id into fid from public.forms f
    where f.link_token = g_token and f.is_public and not f.closed
      and (f.open_until is null or f.open_until >= current_date)
    limit 1;
  if fid is null then return false; end if;   -- קוד שגוי / טופס סגור / פג תוקף

  sid := public.match_student_for_form(p_name, p_answers);

  if sid is not null then
    -- שורה ממתינה קיימת לאותו תלמיד — מעדכנים אותה ולא יוצרים כפילות
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
end $$;
