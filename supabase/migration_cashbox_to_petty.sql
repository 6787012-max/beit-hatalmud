-- migration_cashbox_to_petty.sql — "קופה כללית" מתמזגת לקופה הקטנה (2026-08-25)
--
-- יוסף: אין צורך בשתי קופות במערכת — מה שהיה ב"קופה כללית" שייך לקופה הקטנה
-- של בית התלמוד, והמסך הישן יורד.
--
-- הטבלאות `income` ו-`expenses` **נשארות במסד ואינן נמחקות**. מסך אפשר
-- להחזיר בשתי שורות קוד; שורות שנמחקו לא חוזרות. הן פשוט כבר לא מוצגות
-- בשום מקום. אם בעוד חודש ברור שהמיזוג תקין — אפשר להפיל אותן בנפרד.
--
-- מיפוי:
--   income.source → party      · expenses.name    → party
--   income.method → method     · expenses.kind    → category ('כללית'/'עובד')
--                              · expenses.payslip → note (רק "עם תלוש", שזה מידע)
--                              · expenses.tz      → note
--   הכל נכנס לקופה **בית התלמוד**, בסטטוס "שולם" (הכסף כבר יצא בפועל).
--
-- **אידמפוטנטיות ללא סימון בהערה.** הגרסה הראשונה שתלה תג `[קופה כללית #id]`
-- בתחילת ה-note, וזה הופיע למשתמש בעמודת ההערה בכל שורה שהועברה — רעש שאין
-- לו שום ערך עבורו. במקום זה מזהים שורה שכבר הועברה לפי המפתח הטבעי שלה
-- (קופה + סוג + תאריך + סכום + ספק), וההערה נשארת נקייה.

do $$
declare
  fund bigint;
begin
  select id into fund from public.petty_funds where name = 'בית התלמוד';
  if fund is null then
    raise exception 'הקופה "בית התלמוד" לא קיימת — הרץ קודם migration_petty_cash.sql';
  end if;

  -- ── הכנסות ──
  insert into public.petty_entries (fund_id, kind, date, amount, party, method, status, note, created_by)
  select fund, 'income', i.date, i.amount, coalesce(nullif(i.source, ''), 'ללא מקור'),
         nullif(i.method, ''), 'שולם', nullif(i.note, ''), i.created_by
  from public.income i
  where not exists (
    select 1 from public.petty_entries p
    where p.fund_id = fund and p.kind = 'income'
      and p.date = i.date and p.amount = i.amount
      and p.party = coalesce(nullif(i.source, ''), 'ללא מקור')
  );

  -- ── הוצאות ──
  insert into public.petty_entries (fund_id, kind, date, amount, party, category, method, status, note, created_by)
  select fund, 'expense', e.date, e.amount, coalesce(nullif(e.name, ''), 'ללא ספק'),
         nullif(e.kind, ''), nullif(e.method, ''), 'שולם',
         nullif(concat_ws(' · ',
           nullif(e.note, ''),
           case when e.payslip = 'עם תלוש' then 'עם תלוש' end,
           case when nullif(e.tz, '') is not null then 'ת"ז ' || e.tz end
         ), ''),
         e.created_by
  from public.expenses e
  where not exists (
    select 1 from public.petty_entries p
    where p.fund_id = fund and p.kind = 'expense'
      and p.date = e.date and p.amount = e.amount
      and p.party = coalesce(nullif(e.name, ''), 'ללא ספק')
  );
end $$;

-- ניקוי התג מהריצה הראשונה (אם הורצה הגרסה הקודמת של הקובץ הזה)
update public.petty_entries
   set note = nullif(btrim(regexp_replace(note, '^\[קופה כללית #\d+\]\s*', '')), '')
 where note like '[קופה כללית #%';
