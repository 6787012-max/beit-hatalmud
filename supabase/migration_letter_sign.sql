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
