// Parse a class-schedule image into structured courses via Google Gemini vision.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

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
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
    const { imageDataUrl } = await req.json();
    if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
      return new Response(JSON.stringify({ error: 'imageDataUrl (data:image/...;base64,...) required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const mime = extractMime(imageDataUrl);
    if (!mime || !SUPPORTED_MIME.includes(mime)) {
      return new Response(JSON.stringify({ error: `unsupported_image_type: ${mime ?? 'unknown'}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
      return new Response(JSON.stringify({ error: 'ai_gateway_failed', status: resp.status, detail: t.slice(0, 500) }), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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

    return new Response(JSON.stringify({ courses, count: courses.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
