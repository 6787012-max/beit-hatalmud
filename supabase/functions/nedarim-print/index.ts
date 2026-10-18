// nedarim-print — קולט Webhook של נדרים פלוס (מוסד המכינה 7009572) והופך תשלום
// בקטגוריה "הדפסות" לטעינה ביתרת ההדפסות של איש הצוות (18/10/2026).
//
// נדרים שולחים POST application/json **פעם אחת בלבד** על כל עסקה מוצלחת, ולכן:
//   • גם פניה חשודה לא נזרקת — היא נשמרת כ"ממתין לשיוך" ולא נטענת (print_nedarim_ingest).
//   • השמירה ב-print_nedarim_payments ייחודית לפי TransactionId — שליחה כפולה לא תטען פעמיים.
// אבטחה: (1) סוד בכתובת (?s=, מטבלת print_nedarim) — בלעדיו 403; (2) כתובת IP של נדרים
// (18.196.146.117 / 18.194.219.73) — בלעדיה התשלום נשמר אבל לא נטען אוטומטית.
// verify_jwt=false — נדרים לא שולחים JWT.
import { createClient } from 'npm:@supabase/supabase-js@2';

const NEDARIM_IPS = ['18.196.146.117', '18.194.219.73'];
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true, service: 'nedarim-print' });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const secret = new URL(req.url).searchParams.get('s') || '';
  const { data: cfg } = await sb.from('print_nedarim').select('secret').eq('id', 1).maybeSingle();
  if (!cfg || !secret || secret !== cfg.secret) return json({ ok: false, error: 'forbidden' }, 403);

  const ips = (req.headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim())
    .concat([req.headers.get('cf-connecting-ip') || '', req.headers.get('x-real-ip') || '']).filter(Boolean);
  // רק הכתובת הראשונה ב-x-forwarded-for היא השולח האמיתי (נבדק 18/10: כותרת מזויפת
  // מהלקוח נדרסת ע"י הפרוקסי של Supabase). שאר הרשומות הן כתובות ביניים.
  const trusted = NEDARIM_IPS.includes(ips[0] || '');

  let body: Record<string, unknown> = {};
  const raw = await req.text();
  try { body = JSON.parse(raw); } catch {
    // ליתר ביטחון: אם יגיע כטופס (key=value&...)
    body = Object.fromEntries(new URLSearchParams(raw));
  }
  // נשמר בתוך raw — כך אפשר לראות בדיעבד מאיזו כתובת הגיע תשלום שלא נטען אוטומטית.
  body._source_ip = ips.join(',');
  const { data, error } = await sb.rpc('print_nedarim_ingest', { p: body, p_trusted: trusted });
  if (error) {
    console.error('ingest failed', error.message);
    return json({ ok: false, error: error.message }, 500);
  }
  return json({ ok: true, result: data, trusted });
});
