-- מגני-גודל ל-submit_signature() — נמצא חסר בסריקת אבטחה 07/09/2026.
-- submit_public_form() קיבלה הגנה כזאת ב-26/08 (DoS: שם/חתימה/תשובות ענקיות
-- דרך RPC ציבורי, anon), אבל submit_signature() (אותה משפחת פונקציות, גם
-- SECURITY DEFINER + anon) נשארה בלי ההגנה המקבילה. הרצה חיה כבר בוצעה
-- דרך .local/run_sql.py; הקובץ הזה הוא לתיעוד/עקביות עם שאר migration_*.sql.

CREATE OR REPLACE FUNCTION public.submit_signature(p_token text, p_name text, p_answers jsonb DEFAULT NULL::jsonb, p_signature text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  if length(coalesce(p_name,'')) < 2 then return false; end if;
  if length(p_name) > 100 then return false; end if;
  if length(coalesce(p_signature, '')) > 300000 then return false; end if;
  if pg_column_size(coalesce(p_answers, '{}'::jsonb)) > 65536 then return false; end if;
  update public.form_responses
     set status='signed', signer_name=p_name, signed_at=current_date,
         answers=coalesce(p_answers, answers), signature=coalesce(p_signature, signature)
   where token = p_token and status <> 'signed';
  get diagnostics n = row_count; return n > 0;
end $function$;
