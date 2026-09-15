-- migration_ads_templates.sql — תבניות מותאמות-אישית לעורך המודעות (2026-09-15, בקשת יוסף)
--
-- התבניות הקבועות (בלאנק/הודעה/לוח שיעורים/תעודה/ריבוע-וואטסאפ) חיות בקובץ
-- סטטי data/ads-templates.json בריפו — GitHub Pages אין לו שרת, אז אי אפשר
-- לכתוב לשם מהדפדפן. תבנית שהצוות שומר מתוך העורך עצמו ("שמירה כתבנית…")
-- נכתבת לכאן במקום. loadTemplates() ב-js/ads-editor.js מציג את שתי הרשימות
-- מאוחדות: הקבועות קודם, אחריהן "התבניות שלנו".
--
-- הרשאות: כל איש צוות רשאי לקרוא/לשמור/לערוך/למחוק — זו ספריית עיצוב
-- משותפת, לא נתון רגיש כמו תלמיד/רפואי.
--
-- 15/09/2026 (המשך אותו יום): נוסף update — יוסף ביקש גם "לערוך את הקיים
-- כולל העיצוב", לא רק ליצור חדש. "עדכון תבנית" ב-UI טוען קנבס+elements
-- חדשים לאותה שורה (PATCH לפי id), לא יוצר שורה נוספת.
--
-- אידמפוטנטי.

create table if not exists public.ads_custom_templates (
  id         bigserial primary key,
  name       text not null,
  canvas     jsonb not null,
  elements   jsonb not null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.ads_custom_templates enable row level security;

drop policy if exists ads_tpl_read on public.ads_custom_templates;
create policy ads_tpl_read on public.ads_custom_templates for select using (public.is_staff());
drop policy if exists ads_tpl_write on public.ads_custom_templates;
create policy ads_tpl_write on public.ads_custom_templates for insert with check (public.is_staff());
drop policy if exists ads_tpl_delete on public.ads_custom_templates;
create policy ads_tpl_delete on public.ads_custom_templates for delete using (public.is_staff());
drop policy if exists ads_tpl_update on public.ads_custom_templates;
create policy ads_tpl_update on public.ads_custom_templates for update using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.ads_custom_templates to authenticated;
grant usage, select on sequence public.ads_custom_templates_id_seq to authenticated;
