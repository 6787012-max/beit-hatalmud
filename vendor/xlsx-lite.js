// xlsx-lite.js — קורא xlsx/csv מינימלי, מקומי לגמרי (2026-08-27).
//
// למה לא SheetJS: הספרייה שוקלת ~900KB, מגיעה מ-CDN שנטפרי חוסם, ואנחנו
// צריכים ממנה בדיוק דבר אחד — לקרוא תאים כטקסט מהגיליון הראשון.
// xlsx הוא ZIP; כרום יודע לפרוס deflate בעצמו (DecompressionStream),
// ו-DOMParser יודע לקרוא את ה-XML. סה"כ ~200 שורות בלי שום תלות.
//
// מגבלות מודעות: קורא רק את הגיליון הראשון, מחזיר טקסט גולמי (תאריך
// מסודרי-אקסל יוצא כמספר), ולא תומך ב-.xls הישן (פורמט בינארי אחר לגמרי).
(function () {
  'use strict';

  // ── ZIP ────────────────────────────────────────────────────────────────
  // סורקים את ה-End Of Central Directory מהסוף (יכול להיות אחריו תגובה),
  // ומשם את טבלת הקבצים. לא מפענחים את כל הארכיון — רק את מה שביקשו.
  function findEOCD(dv) {
    const max = Math.min(dv.byteLength, 66000);
    for (let i = dv.byteLength - 22; i >= dv.byteLength - max; i--) {
      if (i < 0) break;
      if (dv.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  function zipIndex(buf) {
    const dv = new DataView(buf);
    const eocd = findEOCD(dv);
    if (eocd < 0) throw new Error('הקובץ אינו xlsx תקין (לא נמצא ארכיון ZIP)');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder('utf-8');
    const out = {};
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(buf, p + 46, nlen));
      out[name] = { method: method, csize: csize, lho: lho };
      p += 46 + nlen + elen + clen;
    }
    return { dv: dv, buf: buf, files: out };
  }

  async function zipRead(z, name) {
    const e = z.files[name];
    if (!e) return null;
    // כותרת הקובץ המקומית — אורכי השם/התוספת בה עשויים להיות שונים
    // מאלה שבטבלה המרכזית, ולכן קוראים אותם משם ולא משם.
    const dv = z.dv;
    if (dv.getUint32(e.lho, true) !== 0x04034b50) throw new Error('רשומת ZIP פגומה: ' + name);
    const nlen = dv.getUint16(e.lho + 26, true);
    const elen = dv.getUint16(e.lho + 28, true);
    const start = e.lho + 30 + nlen + elen;
    const raw = new Uint8Array(z.buf, start, e.csize);
    if (e.method === 0) return new TextDecoder('utf-8').decode(raw);
    if (e.method !== 8) throw new Error('שיטת דחיסה לא נתמכת בקובץ (' + e.method + ')');
    if (typeof DecompressionStream !== 'function') {
      throw new Error('הדפדפן ישן מדי לקריאת xlsx — שמרו את הקובץ כ-CSV');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([raw]).stream().pipeThrough(ds);
    return await new Response(stream).text();
  }

  // ── XLSX ───────────────────────────────────────────────────────────────
  const colIdx = ref => {                       // "BC12" → 54
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return Math.max(0, n - 1);
  };

  const parseXML = s => {
    const d = new DOMParser().parseFromString(s, 'application/xml');
    if (d.querySelector('parsererror')) throw new Error('XML פגום בתוך הקובץ');
    return d;
  };

  // <si> יכול להכיל כמה <t> (טקסט עשיר) — מחברים את כולם, אחרת שם
  // שנצבע חלקית באקסל יוצא חתוך.
  const siText = si => [].map.call(si.getElementsByTagName('t'), t => t.textContent).join('');

  async function readXlsx(buf) {
    const z = zipIndex(buf);
    // הגיליון הראשון לפי הסדר ב-workbook, ולא "sheet1.xml" — אקסל לא
    // תמיד ממספר את הקבצים לפי הסדר שרואים בלשוניות.
    let path = 'xl/worksheets/sheet1.xml';
    try {
      const wb = parseXML(await zipRead(z, 'xl/workbook.xml'));
      const first = wb.getElementsByTagName('sheet')[0];
      const rid = first && (first.getAttribute('r:id') || first.getAttribute('id'));
      if (rid) {
        const rels = parseXML(await zipRead(z, 'xl/_rels/workbook.xml.rels'));
        const rel = [].filter.call(rels.getElementsByTagName('Relationship'),
          r => r.getAttribute('Id') === rid)[0];
        let t = rel && rel.getAttribute('Target');
        if (t) {
          t = t.replace(/^\/?xl\//, '').replace(/^\.\//, '');
          if (z.files['xl/' + t]) path = 'xl/' + t;
        }
      }
    } catch (_) { /* נופלים חזרה ל-sheet1 */ }

    let shared = [];
    if (z.files['xl/sharedStrings.xml']) {
      const sx = parseXML(await zipRead(z, 'xl/sharedStrings.xml'));
      shared = [].map.call(sx.getElementsByTagName('si'), siText);
    }

    const sh = await zipRead(z, path);
    if (sh == null) throw new Error('לא נמצא גיליון בתוך הקובץ');
    const doc = parseXML(sh);
    const rows = [];
    [].forEach.call(doc.getElementsByTagName('row'), r => {
      const arr = [];
      [].forEach.call(r.getElementsByTagName('c'), c => {
        const ref = c.getAttribute('r') || '';
        const i = ref ? colIdx(ref) : arr.length;
        const t = c.getAttribute('t');
        let v = '';
        if (t === 'inlineStr') {
          const is = c.getElementsByTagName('is')[0];
          v = is ? siText(is) : '';
        } else {
          const ve = c.getElementsByTagName('v')[0];
          v = ve ? ve.textContent : '';
          if (t === 's') v = shared[Number(v)] != null ? shared[Number(v)] : '';
        }
        arr[i] = String(v == null ? '' : v).trim();
      });
      // תאים ריקים באמצע השורה נשארים חורים במערך — ממלאים במחרוזת ריקה
      for (let i = 0; i < arr.length; i++) if (arr[i] == null) arr[i] = '';
      rows.push(arr);
    });
    return rows;
  }

  // ── CSV ────────────────────────────────────────────────────────────────
  function readCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    // מפריד: פסיק, ואם יש יותר נקודות-פסיק בשורה הראשונה — נקודה-פסיק
    // (אקסל בעברית/אירופה שומר CSV עם ';').
    const head = text.split(/\r?\n/)[0] || '';
    const sep = (head.split(';').length > head.split(',').length) ? ';' : ',';
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell.trim()); cell = ''; }
      else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
    return rows;
  }

  /** קורא File → מערך שורות (כל שורה = מערך מחרוזות). */
  async function readFile(file) {
    const nm = String(file.name || '').toLowerCase();
    if (/\.xlsx$/.test(nm)) return await readXlsx(await file.arrayBuffer());
    if (/\.xls$/.test(nm)) throw new Error('פורמט .xls הישן אינו נתמך — שמרו באקסל בתור .xlsx או .csv');
    return readCsv(await file.text());
  }

  window.XlsxLite = { readFile: readFile, readXlsx: readXlsx, readCsv: readCsv };
})();
