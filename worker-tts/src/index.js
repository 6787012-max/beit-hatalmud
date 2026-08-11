// cheder-tts — Cloudflare Worker: טקסט עברי → אודיו (Gemini TTS) עבור פאנל ימות.
// המפתח GEMINI_KEY נשמר כ-secret ב-Worker (לא בדפדפן, לא בקוד). מחזיר WAV.
// CORS פתוח כדי שהפאנל (GitHub Pages) יוכל לקרוא.
const MODEL = 'gemini-2.5-flash-preview-tts';

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extra,
  };
}

// PCM16 → WAV
function pcmToWav(pcm, rate) {
  const dataLen = pcm.byteLength;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); wr(8, 'WAVE');
  wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true); dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  wr(36, 'data'); dv.setUint32(40, dataLen, true);
  new Uint8Array(buf, 44).set(new Uint8Array(pcm));
  return buf;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    let body = {};
    if (request.method === 'POST') {
      try { body = await request.json(); } catch (_) { return new Response('bad json', { status: 400, headers: cors() }); }
    } else if (request.method === 'GET') {
      const u = new URL(request.url);
      body = { text: u.searchParams.get('text') || '', voice: u.searchParams.get('voice') || '' };
    } else {
      return new Response('POST or GET', { status: 405, headers: cors() });
    }
    const text = (body.text || '').trim();
    const voice = body.voice || 'Charon';
    if (!text) return new Response('missing text', { status: 400, headers: cors() });
    if (text.length > 2000) return new Response('text too long', { status: 400, headers: cors() });

    const prompt = 'קרא בקול רגוע, ברור ומקצועי המתאים להודעה טלפונית: ' + text;
    const gReq = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    };
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gReq) }
    );
    if (!r.ok) return new Response('tts failed: ' + (await r.text()).slice(0, 200), { status: 502, headers: cors() });
    const data = await r.json();
    const part = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!part?.data) return new Response('no audio', { status: 502, headers: cors() });

    const bin = atob(part.data);
    const pcm = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i);
    let rate = 24000;
    const mt = part.mimeType || '';
    const m = mt.match(/rate=(\d+)/);
    if (m) rate = parseInt(m[1]);
    const wav = pcmToWav(pcm.buffer, rate);
    return new Response(wav, { headers: cors({ 'Content-Type': 'audio/wav' }) });
  },
};
