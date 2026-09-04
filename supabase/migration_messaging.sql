-- migration_messaging.sql — פאנל שליחת מיילים והודעות קוליות להורים (2026-09-04)
-- מיועד לתוספת 1: מזכירה/מנהל שולחים דיוור להורים דרך מייל, צינתוק, או שילוב.
-- הרץ ב-Supabase SQL Editor אחרי schema.sql + policies.sql. בטוח להרצה חוזרת.

-- ===== תבניות הודעה מוכנות מראש =====
-- category: general / meeting / event / holiday / vacation / emergency / thanks
-- placeholders בגוף: {{student_name}} {{class_name}} {{parent_name}} — יומרו בשליחה
create table if not exists public.message_templates (
  id           bigint generated always as identity primary key,
  name         text not null,                      -- שם התבנית כפי שיראה במסך
  category     text not null default 'general',    -- לסיווג/פילטר
  subject      text,                               -- נושא המייל (אם כולל מייל)
  html_body    text,                               -- גוף HTML למייל
  voice_text   text,                               -- טקסט להקראה (TTS) בהודעה קולית
  is_active    boolean not null default true,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_msg_tpl_active on public.message_templates(is_active);

alter table public.message_templates enable row level security;

-- קריאה: כל משתמש מחובר (התבניות עצמן אינן רגישות). כתיבה: מנהל/מזכירה בלבד.
drop policy if exists mtpl_read on public.message_templates;
create policy mtpl_read on public.message_templates for select
  using (auth.uid() is not null);

drop policy if exists mtpl_write on public.message_templates;
create policy mtpl_write on public.message_templates for all
  using (public.is_admin() or public.my_role() in ('מזכירה'))
  with check (public.is_admin() or public.my_role() in ('מזכירה'));

-- ===== יומן שליחות =====
-- כל דיוור שנשלח נרשם כאן, גם אם נכשל בחלקו.
-- channel: mail / voice / mail+voice / mail+tzintuk_free
-- audience_kind: all / class / custom_ids
create table if not exists public.message_log (
  id                bigint generated always as identity primary key,
  sender_id         uuid references public.profiles(id) on delete set null,
  template_id       bigint references public.message_templates(id) on delete set null,
  channel           text not null,                 -- mail / voice / mail+voice / mail+tzintuk_free
  subject           text,
  audience_kind     text not null,                 -- all / class / custom
  audience_class_id bigint references public.classes(id) on delete set null,
  audience_count    integer not null default 0,    -- כמה נמענים נכללו
  mail_sent         integer not null default 0,    -- כמה מיילים נשלחו בפועל
  mail_failed       integer not null default 0,
  voice_ext         text,                          -- שלוחת קו שקובץ השמע הועלה אליה
  voice_tzintuk     text,                          -- pending / sent / free_only / none
  audio_path        text,                          -- ivr2:/.../000.wav שנוצר
  notes             text,                          -- הודעות שגיאה / מטא
  sent_at           timestamptz not null default now()
);

create index if not exists idx_msg_log_sent_at on public.message_log(sent_at desc);
create index if not exists idx_msg_log_sender on public.message_log(sender_id);

alter table public.message_log enable row level security;

-- מנהל/מזכירה בלבד — הרשומות מכילות רשימות נמענים ולכן רגישות.
drop policy if exists mlog_read on public.message_log;
create policy mlog_read on public.message_log for select
  using (public.is_admin() or public.my_role() in ('מזכירה'));

drop policy if exists mlog_write on public.message_log;
create policy mlog_write on public.message_log for all
  using (public.is_admin() or public.my_role() in ('מזכירה'))
  with check (public.is_admin() or public.my_role() in ('מזכירה'));

-- ===== זרעים — 6 תבניות בסיסיות =====
-- אם אין כלום — נזרע. אם כבר יש (הרצה חוזרת) — לא לגעת.
insert into public.message_templates (name, category, subject, html_body, voice_text)
select v.name, v.category, v.subject, v.html_body, v.voice_text
from (values
  (
    'זימון לאסיפת הורים',
    'meeting',
    'זימון לאסיפת הורים — {{student_name}}',
    '<p>שלום להורי {{student_name}},</p><p>אנו שמחים להזמין אתכם לאסיפת הורים שתתקיים ביום ___ בשעה ___ בכיתה {{class_name}}.</p><p>נשמח לראותכם.</p><p>בברכה,<br>הנהלת המכינה</p>',
    'שלום להורי התלמיד. אנו שמחים להזמין אתכם לאסיפת הורים שתתקיים ביום המצוין. נודה על אישור הגעה.'
  ),
  (
    'דיווח על אירוע כללי',
    'event',
    'עדכון חשוב — מכינה בית התלמוד',
    '<p>הורים יקרים,</p><p>ברצוננו לעדכנכם שהיום התקיים במכינה ___.</p><p>לפרטים נוספים ניתן לפנות למזכירות.</p><p>בברכה,<br>הנהלת המכינה</p>',
    'הורים יקרים, ברצוננו לעדכן אתכם על אירוע חשוב שהתקיים היום במכינה. לפרטים נוספים אנא צרו קשר עם המזכירות.'
  ),
  (
    'ברכה לחג',
    'holiday',
    'ברכת חג שמח — מכינת בית התלמוד',
    '<p>הורים ותלמידים יקרים,</p><p>הנהלת וצוות מכינת בית התלמוד מברכים אתכם בברכת חג שמח.</p><p>שיהיה חג כשר ושמח לכל בית ישראל.</p><p>בברכה,<br>הנהלת המכינה</p>',
    'הורים ותלמידים יקרים. הנהלת וצוות מכינת בית התלמוד מברכים אתכם בברכת חג שמח וכשר. שנזכה כולנו לגאולה שלמה במהרה.'
  ),
  (
    'הודעה על חופש/יציאה מוקדמת',
    'vacation',
    'הודעת חופש — מכינה בית התלמוד',
    '<p>הורים יקרים,</p><p>אנו מודיעים כי ביום ___ לא יתקיימו לימודים / הלימודים יסתיימו בשעה ___.</p><p>הלימודים יחזרו כסדרם ביום ___.</p><p>בברכה,<br>הנהלת המכינה</p>',
    'הורים יקרים. אנו מודיעים כי ביום המצוין לא יתקיימו לימודים כרגיל. אנא היערכו בהתאם.'
  ),
  (
    'דיווח דחוף להורים',
    'emergency',
    'הודעה דחופה — מכינה בית התלמוד',
    '<p>הורים יקרים,</p><p>הודעה דחופה: ___</p><p>אנא צרו קשר עם המזכירות בהקדם: <a href="tel:0556742853">0556742853</a>.</p><p>בברכה,<br>הנהלת המכינה</p>',
    'הורים יקרים. זו הודעה דחופה מהנהלת המכינה. אנא צרו קשר עם המזכירות בהקדם האפשרי.'
  ),
  (
    'תודה על שיתוף הפעולה',
    'thanks',
    'תודה — מכינה בית התלמוד',
    '<p>הורים יקרים,</p><p>ברצוננו להודות לכם על שיתוף הפעולה המופלא לאורך התקופה האחרונה.</p><p>בזכות ההשקעה המשותפת אנו רואים ברכה בעמלנו.</p><p>בברכה,<br>הנהלת המכינה</p>',
    'הורים יקרים. ברצוננו להודות לכם על שיתוף הפעולה המופלא. בזכות ההשקעה המשותפת אנו רואים ברכה בעמלנו.'
  ),
  (
    'הודעה על מבחן / בוחן',
    'event',
    'הודעה על בוחן — {{student_name}}',
    '<p>שלום להורי {{student_name}},</p><p>ביום ___ יתקיים בוחן בכיתה {{class_name}} בנושא ___.</p><p>אנא סייעו בהכנה בבית.</p><p>בברכה,<br>הצוות</p>',
    'שלום להורי התלמיד. אנו מודיעים על בוחן שיתקיים בקרוב. אנא סייעו לתלמיד להתכונן.'
  ),
  (
    'תזכורת לתשלום',
    'general',
    'תזכורת — מכינה בית התלמוד',
    '<p>הורים יקרים,</p><p>ברצוננו להזכיר כי טרם הוסדר תשלום ___ עבור התלמיד.</p><p>נודה על הסדרתו בהקדם.</p><p>לבירורים: <a href="tel:0556742853">0556742853</a>.</p><p>בברכה,<br>המזכירות</p>',
    'הורים יקרים. תזכורת מהמזכירות שטרם הוסדר תשלום. אנא צרו קשר להסדרתו.'
  )
) as v(name, category, subject, html_body, voice_text)
where not exists (select 1 from public.message_templates limit 1);
