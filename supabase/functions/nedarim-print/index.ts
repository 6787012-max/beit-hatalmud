// nedarim-print — קולט Webhook של נדרים פלוס (מוסד המכינה 7009572) והופך תשלום
// בקטגוריה "הדפסות" לטעינה ביתרת ההדפסות של איש הצוות (18/10/2026).
//
// נדרים שולחים POST application/json **פעם אחת בלבד** על כל עסקה מוצלחת, ולכן:
//   • גם פניה חשודה לא נזרקת — היא נשמרת כ"ממתין לשיוך" ולא נטענת (print_nedarim_ingest).
//   • השמירה ב-print_nedarim_payments ייחודית לפי TransactionId — שליחה כפולה לא תטען פעמיים.
// אבטחה: כתובת IP של נדרים (18.196.146.117 / 18.194.219.73, הרשומה הראשונה ב-x-forwarded-for)
// מתקבלת בלי סוד. כל מקור אחר — 403, אלא אם צירף ?s= (סוד מ-print_nedarim, לבדיקות בלבד),
// ואז התשלום נשמר כ"ממתין לשיוך" ולא נטען.
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
  const ips = (req.headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim())
    .concat([req.headers.get('cf-connecting-ip') || '', req.headers.get('x-real-ip') || '']).filter(Boolean);
  // רק הכתובת הראשונה ב-x-forwarded-for היא השולח האמיתי (נבדק 18/10: כותרת מזויפת
  // מהלקוח נדרסת ע"י הפרוקסי של Supabase). שאר הרשומות הן כתובות ביניים.
  const trusted = NEDARIM_IPS.includes(ips[0] || '');
  // הכניסה: מכתובת IP של נדרים — בלי סוד (כך הכתובת שמוזנת בנדרים אינה סוד);
  // מכל מקום אחר — רק עם ?s= הנכון (לבדיקות), ואז התשלום נשמר כ"ממתין" ולא נטען.
  const log = (tx: unknown, result: string) =>
    sb.from('print_nedarim_log').insert({ trusted, ip: ips[0] || null, tx: tx == null ? null : String(tx), result });
  if (!trusted) {
    const secret = new URL(req.url).searchParams.get('s') || '';
    const { data: cfg } = await sb.from('print_nedarim').select('secret').eq('id', 1).maybeSingle();
    if (!cfg || !secret || secret !== cfg.secret) { await log(null, 'נחסם (403)'); return json({ ok: false, error: 'forbidden' }, 403); }
  }

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
    await log(body.TransactionId, 'שגיאה: ' + error.message);
    return json({ ok: false, error: error.message }, 500);
  }
  await log(body.TransactionId, String(data));
  return json({ ok: true, result: data, trusted });
});
