// xlsx-write-lite.js — כותב xlsx מינימלי, מקומי לגמרי (09/09/2026).
//
// אותה סיבה כמו xlsx-lite.js (הקורא): לא SheetJS (~900KB, CDN שנטפרי חוסם).
// xlsx הוא ZIP + XML; כרום יודע לדחוס deflate-raw בעצמו (CompressionStream),
// אז בונים ZIP תקין + OOXML מינימלי (גיליון אחד, בלי עיצוב) ביד.
//
// שימוש: await window.XlsxWriteLite.build(header, rows, numericCols) → Blob
//   header: מערך כותרות (שורה 1). rows: מערך של מערכים (ערכי התאים).
//   numericCols: Set/מערך של אינדקסים (0-based) שצריך לשמור כמספר ולא כטקסט
//   (בלי זה הכל טקסט — גם "16" יישאר "16" ולא 16, כלומר גם בלי numericCols
//   התוצאה תקינה, רק שעמודות כמו "יתרה" ייפתחו כטקסט מיושר לימין באקסל).
(function () {
  'use strict';

  // ── CRC32 (טבלה סטנדרטית) — ZIP דורש checksum תקין לכל קובץ בארכיון ──
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  async function deflateRaw(bytes) {
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // בונה ארכיון ZIP תקין (local headers + central directory + EOCD) מרשימת
  // קבצים. לא תומך בתיקיות/הערות/multi-disk — מינימום שצריך ל-xlsx תקין.
  async function buildZip(files) {
    const enc = new TextEncoder();
    const localParts = [], centralParts = [];
    let offset = 0;
    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const compressed = await deflateRaw(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0, true);
      lh.setUint16(8, 8, true);          // method = deflate
      lh.setUint16(10, 0, true);
      lh.setUint16(12, 0, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, compressed.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameBytes.length, true);
      lh.setUint16(28, 0, true);
      localParts.push(new Uint8Array(lh.buffer), nameBytes, compressed);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0, true);
      ch.setUint16(10, 8, true);
      ch.setUint16(12, 0, true);
      ch.setUint16(14, 0, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, compressed.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, nameBytes.length, true);
      ch.setUint16(30, 0, true);
      ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true);
      ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true);
      ch.setUint32(42, offset, true);
      centralParts.push(new Uint8Array(ch.buffer), nameBytes);

      offset += lh.byteLength + nameBytes.length + compressed.length;
    }
    const centralStart = offset;
    const centralSize = centralParts.reduce((a, p) => a + p.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, centralStart, true);
    eocd.setUint16(20, 0, true);
    return new Blob([...localParts, ...centralParts, new Uint8Array(eocd.buffer)],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // אות/אותיות עמודה מ-index (0-based): 0→A, 25→Z, 26→AA...
  function colLetter(i) {
    let s = '';
    i += 1;
    while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  const xmlEsc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // תווי בקרה לא-חוקיים ב-XML (מלבד \t\n\r) — נדיר, אבל שדה "הערות" חופשי-קלט עלול להכיל
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  function cellXml(ref, val, isNumeric) {
    if (val == null || val === '') return '<c r="' + ref + '"/>';
    if (isNumeric && typeof val === 'number' && isFinite(val)) {
      return '<c r="' + ref + '"><v>' + val + '</v></c>';
    }
    if (isNumeric) {
      const n = Number(val);
      if (isFinite(n) && String(val).trim() !== '') return '<c r="' + ref + '"><v>' + n + '</v></c>';
    }
    return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(val) + '</t></is></c>';
  }

  /**
   * header: string[]. rows: any[][]. numericCols: iterable of 0-based column indexes to store as numbers.
   * מחזיר Blob (application/...spreadsheetml.sheet) — מוכן ל-a.href=URL.createObjectURL(blob).
   */
  async function build(header, rows, numericCols) {
    const numSet = new Set(numericCols || []);
    const enc = new TextEncoder();
    const allRows = [header].concat(rows);
    let sheetRows = '';
    allRows.forEach((r, ri) => {
      const rn = ri + 1;
      let cells = '';
      r.forEach((v, ci) => { cells += cellXml(colLetter(ci) + rn, v, numSet.has(ci)); });
      sheetRows += '<row r="' + rn + '">' + cells + '</row>';
    });
    const lastCol = colLetter(Math.max(0, header.length - 1));

    const contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>';
    const rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';
    const workbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const workbookRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>';
    const sheet =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:' + lastCol + allRows.length + '"/>' +
      '<sheetData>' + sheetRows + '</sheetData></worksheet>';

    const files = [
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
      { name: '_rels/.rels', data: enc.encode(rootRels) },
      { name: 'xl/workbook.xml', data: enc.encode(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(workbookRels) },
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet) },
    ];
    return buildZip(files);
  }

  window.XlsxWriteLite = { build: build };
})();
