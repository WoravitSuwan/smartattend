// Parse a class-schedule image into structured courses via Google Gemini vision.
//
// ฟังก์ชันนี้ใช้ GEMINI_API_KEY ของโปรเจกต์ ซึ่งมีค่าใช้จ่ายต่อการเรียก
// ของเดิมตั้ง verify_jwt = false จึงเปิดให้ใครก็ยิงได้ไม่จำกัด ตอนนี้
//   1. config.toml ตั้ง verify_jwt = true (กันคนที่ไม่ได้ล็อกอิน)
//   2. ตรวจ role ในฟังก์ชันอีกชั้น — verify_jwt บอกแค่ว่า "ล็อกอินอยู่"
//      ไม่ได้บอกว่าเป็นใคร นักศึกษาทุกคนก็มี JWT ที่ใช้ได้
//   3. จำกัดขนาดภาพ และจำกัดจำนวนครั้งต่อผู้ใช้ต่อชั่วโมงผ่าน RPC
//      claim_ai_quota() ที่นับในฐานข้อมูล (ดู migration 20260927120000)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

// ของเดิม import corsHeaders จาก 'npm:@supabase/supabase-js@2/cors' ซึ่งไม่มี
// export นั้นอยู่จริง — ประกาศเองให้ตรงกับฟังก์ชันอื่นในโปรเจกต์
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

/** ขนาดภาพสูงสุดที่รับ (นับจาก base64 payload) */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
/** จำนวนครั้งที่ผู้ใช้หนึ่งคนเรียกได้ต่อชั่วโมง */
const RATE_LIMIT_PER_HOUR = 20;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/** ขนาดจริงของ base64 (ไม่รวมส่วนหัว data:...;base64,) */
function base64Bytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',');
  if (i < 0) return 0;
  const b64 = dataUrl.slice(i + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

interface ParsedCourse {
  code: string;
  name: string;
  section?: string;
  credits?: string;
  schedule?: string;
  room?: string;
  instructor?: string;
  raw?: string;
}

const SUPPORTED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

function extractMime(dataUrl: string): string | null {
  const m = dataUrl.match(/^data:([^;,]+)[;,]/);
  return m ? m[1].toLowerCase() : null;
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function tryParseCourses(content: string): ParsedCourse[] {
  const s = stripFences(content);
  // Try direct
  try {
    const p = JSON.parse(s);
    if (Array.isArray(p?.courses)) return p.courses;
    if (Array.isArray(p)) return p;
  } catch { /* fallthrough */ }
  // Try to extract first {...} block
  const objM = s.match(/\{[\s\S]*\}/);
  if (objM) {
    try {
      const p = JSON.parse(objM[0]);
      if (Array.isArray(p?.courses)) return p.courses;
    } catch { /* ignore */ }
  }
  // Try to extract first [...] array
  const arrM = s.match(/\[[\s\S]*\]/);
  if (arrM) {
    try {
      const p = JSON.parse(arrM[0]);
      if (Array.isArray(p)) return p;
    } catch { /* ignore */ }
  }
  return [];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (!GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not configured' }, 500);

    // ── ตรวจตัวตนและสิทธิ์ ────────────────────────────────────────────────
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'unauthorized' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401);

    const { data: roles } = await admin
      .from('user_roles').select('role').eq('user_id', userData.user.id);
    const allowed = (roles ?? []).some((r: { role: string }) =>
      r.role === 'instructor' || r.role === 'admin');
    if (!allowed) return json({ error: 'forbidden' }, 403);

    // ── ตรวจข้อมูลที่ส่งมา ────────────────────────────────────────────────
    const { imageDataUrl } = await req.json().catch(() => ({ imageDataUrl: null }));
    if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
      return json({ error: 'imageDataUrl (data:image/...;base64,...) required' }, 400);
    }
    const mime = extractMime(imageDataUrl);
    if (!mime || !SUPPORTED_MIME.includes(mime)) {
      return json({ error: `unsupported_image_type: ${mime ?? 'unknown'}` }, 400);
    }
    const bytes = base64Bytes(imageDataUrl);
    if (bytes > MAX_IMAGE_BYTES) {
      return json({
        error: 'image_too_large',
        detail: `ภาพใหญ่เกินไป (${Math.round(bytes / 1024 / 1024)} MB) จำกัดไม่เกิน ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
      }, 413);
    }

    // ── จำกัดจำนวนครั้งต่อชั่วโมง (นับในฐานข้อมูล ไม่ใช่ในหน่วยความจำ) ──
    // เรียกด้วย JWT ของผู้ใช้ เพื่อให้ auth.uid() ใน RPC เป็นคนที่เรียกจริง
    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: quotaOk, error: quotaErr } = await asUser.rpc('claim_ai_quota', {
      _feature: 'parse-schedule-image',
      _limit_per_hour: RATE_LIMIT_PER_HOUR,
      _bytes_in: bytes,
    });
    if (quotaErr) {
      console.error('claim_ai_quota failed', quotaErr.message);
      return json({ error: 'quota_check_failed' }, 500);
    }
    if (quotaOk === false) {
      return json({
        error: 'rate_limited',
        detail: `ใช้เกินโควตาแล้ว (${RATE_LIMIT_PER_HOUR} ครั้งต่อชั่วโมง) กรุณารอแล้วลองใหม่`,
      }, 429);
    }

    const prompt = `คุณกำลังดูรูปภาพตารางเรียน/ตารางสอน/ใบลงทะเบียนของมหาวิทยาลัยไทย (อาจเป็นภาพถ่ายจากมือถือ สแกน หรือสกรีนช็อต)
กรุณาอ่านทุกช่อง/ทุกแถวอย่างละเอียด รวมถึงข้อความในตาราง กราฟิก และหมายเหตุด้านล่าง แล้วดึงข้อมูลรายวิชาทั้งหมดที่ปรากฏ

ตอบเป็น JSON เท่านั้น (ห้ามมีข้อความอื่น ห้ามใส่ markdown fence) ในรูปแบบ:
{"courses":[{"code":"...","name":"...","section":"...","credits":"...","schedule":"...","room":"...","instructor":"..."}]}

กติกา:
- code: รหัสวิชา เช่น ENGSE207, 13-011-101, BSCCS101 (จำเป็นต้องมี)
- name: ชื่อวิชาภาษาไทยหรืออังกฤษ
- section: กลุ่ม/ตอนเรียน เช่น "1", "SE-1"
- credits: หน่วยกิต เช่น "3(3-0-6)" หรือ "3"
- schedule: วันและเวลา เช่น "จ. 08:00-11:00" หรือ "จ./พ. 09:00-10:30"
- room: ห้องเรียน เช่น "S1-201"
- instructor: ชื่ออาจารย์ผู้สอน
- ถ้าฟิลด์ไหนไม่เห็น ให้ละไว้ (อย่าเดา)
- ตอบเป็น JSON ล้วน ไม่มีคำอธิบาย ไม่มี \`\`\``;

    // เรียก Google Gemini โดยตรง ไม่ผ่านตัวกลางของผู้ให้บริการรายใด
    const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GEMINI_API_KEY}` },
      body: JSON.stringify({
        model: 'gemini-2.0-flash',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        }],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      const status = resp.status === 429 ? 429 : resp.status === 402 ? 402 : 502;
      return json({ error: 'ai_gateway_failed', status: resp.status, detail: t.slice(0, 500) }, status);
    }
    const data = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content ?? '';
    let courses = tryParseCourses(content);
    // Clean / normalize
    courses = courses
      .filter((c) => c && typeof c.code === 'string' && c.code.trim())
      .map((c) => ({
        code: String(c.code).replace(/\s+/g, '').trim(),
        name: (c.name ?? '').toString().trim() || '(ไม่ระบุชื่อวิชา)',
        section: c.section?.toString().trim() || undefined,
        credits: c.credits?.toString().trim() || undefined,
        schedule: c.schedule?.toString().trim() || undefined,
        room: c.room?.toString().trim() || undefined,
        instructor: c.instructor?.toString().trim() || undefined,
        raw: `${c.code} ${c.name ?? ''}`.trim(),
      }));

    return json({ courses, count: courses.length }, 200);
  } catch (e) {
    console.error('parse-schedule-image error:', e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
