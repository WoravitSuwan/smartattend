# บันทึกความปลอดภัย

เอกสารนี้บันทึกเรื่องที่ตรวจพบและยังต้องตัดสินใจ **ไม่มีค่าคีย์จริงอยู่ในไฟล์นี้**

อัปเดตล่าสุด 13 ตุลาคม 2569

---

## 1. คีย์ที่พบในประวัติ commit (DEF-008)

### สิ่งที่พบ

| commit | ไฟล์ | สิ่งที่หลุด |
|---|---|---|
| `784eda8` | `smartattend_web/.env` | `VITE_SUPABASE_URL` และ `VITE_SUPABASE_PUBLISHABLE_KEY` |
| `d4509d1` | `smartattend_web/.env` | ค่าเดียวกัน |

**ไม่พบ `service_role` key หรือ `sb_secret_` ในประวัติ** ซึ่งเป็นคีย์ที่หลุดแล้ว
อันตรายจริง ตรวจด้วยการค้นทั้ง 82 commit

### ประเมินความรุนแรง — ต่ำ

publishable key (ขึ้นต้นด้วย `sb_publishable_` เดิมเรียก anon key)
**ออกแบบมาให้เปิดเผยได้** และถูกฝังอยู่ในไฟล์ JavaScript ที่ผู้ใช้ทุกคน
ดาวน์โหลดเมื่อเปิดเว็บอยู่แล้ว การคุ้มครองข้อมูลมาจากนโยบาย RLS ในฐานข้อมูล
ไม่ใช่จากการซ่อนคีย์

URL ของโปรเจกต์ก็เปิดเผยอยู่แล้วเช่นกัน เพราะเบราว์เซอร์ต้องยิงไปที่นั่น

### เรื่องที่ต้องตัดสินใจ

**ข้อ 1 — ต้องหมุนคีย์หรือไม่**

คีย์ที่อยู่ในประวัติเป็นคีย์ชุดเดียวกับที่ใช้งานอยู่ตอนนี้หรือไม่
ผู้ตรวจสอบยืนยันเองไม่ได้ เพราะไม่มีสิทธิ์เข้าถึงค่าที่ตั้งไว้ใน Vercel
และไม่มีไฟล์ `.env` ในสภาพแวดล้อมที่ตรวจ

วิธีตรวจด้วยตนเอง — เทียบ 12 ตัวอักษรแรกของคีย์สองที่นี้ว่าตรงกันหรือไม่

```bash
# ค่าในประวัติ (อ่านอย่างเดียว ไม่เปลี่ยนอะไร)
git show 784eda8 -- smartattend_web/.env | grep PUBLISHABLE | cut -c1-60

# ค่าที่ใช้งานจริง
cd smartattend_web && npx vercel env pull .env.check && \
  grep PUBLISHABLE .env.check | cut -c1-60 && rm .env.check
```

> ⚠️ `vercel env pull` สร้างไฟล์ `.env.check` ขึ้นมาจริง อย่าลืมลบทิ้ง
> ไฟล์ชื่อนี้ถูก `.gitignore` ครอบด้วยกฎ `.env.*` อยู่แล้ว

**ถ้าตรงกัน** แนะนำให้หมุนคีย์ที่ Supabase Dashboard แม้ความเสี่ยงจะต่ำ
เพราะทำได้ง่ายและตัดปัญหาทิ้งไปเลย
ไปที่ Dashboard → Project Settings → API Keys → สร้าง publishable key ใหม่
แล้วอัปเดตค่าใน Vercel (`npx vercel env rm` แล้ว `npx vercel env add`)
และ deploy ใหม่ **ต้องทำก่อนสอบ ไม่ใช่ระหว่างสอบ** เพราะถ้าพลาดเว็บจะล่ม

**ถ้าไม่ตรงกัน** ไม่ต้องทำอะไร บันทึกไว้ว่าตรวจแล้ว

**ข้อ 2 — ล้างประวัติ commit หรือไม่**

ผู้ตรวจสอบ **ไม่ได้แก้ประวัติ และไม่เสนอให้แก้** ตามกฎที่ตั้งไว้
เหตุผลที่ไม่เสนอ

- การเขียนประวัติใหม่ (`git filter-repo`, force push) จะทำให้สำเนาที่คนอื่น
  โคลนไว้ใช้ต่อไม่ได้ และลิงก์ไปยัง commit เดิมที่อาจอ้างในเล่มจะเสีย
- ข้อมูลที่หลุดไม่ใช่ความลับจริงตามที่อธิบายข้างบน
- GitHub ยังเก็บ object เดิมไว้ได้ระยะหนึ่งแม้เขียนประวัติใหม่แล้ว
  จึงไม่ได้ลบได้สะอาดจริงอยู่ดี

เป็นการตัดสินใจของเจ้าของโปรเจกต์

### เรื่องที่ทำให้ข้อนี้เคยร้ายแรงกว่าที่ควร

URL โปรเจกต์ที่เปิดเผยจะมีค่าสำหรับผู้ไม่หวังดีก็ต่อเมื่อมีช่องให้ดึงข้อมูลได้
ซึ่งเคยมีจริงคือ **DEF-001** ที่เปิดให้ผู้ไม่ล็อกอินดึงรายชื่อนักศึกษาทั้งรายวิชาได้
**ข้อนั้นแก้แล้วใน migration `20261013100000`** หลังแก้ คีย์ที่หลุดในประวัติ
จึงไม่ให้สิทธิ์อะไรเกินกว่าที่ผู้ใช้ทั่วไปมีอยู่แล้ว

---

## 2. สถานะไฟล์ `.env`

| รายการ | ผล |
|---|---|
| มีไฟล์ `.env` ถูก track ในรีโปหรือไม่ | **ไม่มี** |
| `.gitignore` ครอบหรือไม่ | ครอบแล้ว ด้วยกฎ `.env` (บรรทัด 10) และ `.env.*` (บรรทัด 11) |
| ไฟล์ที่ track ได้ซึ่งขึ้นต้นด้วย `.env` | `smartattend_web/.env.example` และ `smartattend_pi/.env.example` |
| `.env.example` มีค่าจริงหรือไม่ | ไม่มี ใช้ `<your-project-ref>` และ `<your-publishable-key>` เป็นตัวอย่าง |

กฎ `.env.*` ครอบไฟล์อย่าง `.env.local` และ `.env.production` ด้วย
และมีข้อยกเว้น `!.env.example` ให้ไฟล์ตัวอย่างยัง track ได้

---

## 3. ผลการตรวจฟังก์ชัน SECURITY DEFINER ทั้งหมด

ฟังก์ชัน `SECURITY DEFINER` ทำงานด้วยสิทธิ์ของเจ้าของฟังก์ชัน จึง **ข้าม RLS**
ทุกตัวจึงต้องตรวจสิทธิ์ของผู้เรียกเองภายในฟังก์ชัน
ตรวจทั้งหมด 46 ตัวในสคีมา `public` ผลดังนี้

### ตัวที่เรียกตรงได้ และ PUBLIC (รวมผู้ไม่ล็อกอิน) เรียกได้

| ฟังก์ชัน | ตรวจสิทธิ์ภายใน | ประเมิน |
|---|---|---|
| `get_scan_roster` | **มีแล้ว** | **แก้ไปแล้วใน `20261013100000`** เดิมคือ DEF-001 |
| `grade_item_score_count` | มี | ทดสอบแล้วปฏิเสธผู้ไม่มีสิทธิ์ถูกต้อง |
| `course_grades_locked` | ไม่มี | **เสี่ยงต่ำ** คืนค่า boolean ว่ารายวิชาถูกล็อกหรือไม่ ไม่ใช่ข้อมูลส่วนบุคคล |
| `sync_scheduled_sessions` | ไม่มี | **เสี่ยงต่ำ** เขียนข้อมูลได้ แต่ถูกกั้นด้วยเงื่อนไขเวลาทั้งหมด (`scheduled_start <= now()`) จึงเปลี่ยนสถานะอะไรไม่ได้เกินกว่าที่ระบบจะทำเองอยู่แล้วในอีกไม่กี่วินาที |

### ตัวที่เป็น trigger function

`cleanup_orphan_assignment_items`, `recompute_attendance_block`,
`sync_assignment_grade_item`, `sync_submission_score_to_grade`
— เรียกตรงไม่ได้ในทางปฏิบัติ เพราะต้องมี trigger context ความเสี่ยงต่ำ

### ตัวที่เหลือ 38 ตัว

จำกัดสิทธิ์ด้วย `GRANT` เฉพาะที่จำเป็น และส่วนใหญ่ตรวจสิทธิ์ภายในด้วย
ตัวที่ไม่ตรวจภายในแต่จำกัด `GRANT` ไว้แล้วและมีเหตุผลรองรับ

| ฟังก์ชัน | เหตุผล |
|---|---|
| `resolve_login_email` | ให้ `anon` เรียกได้โดยตั้งใจ เพราะใช้ตอนล็อกอินด้วยรหัสนักศึกษา ก่อนที่ผู้ใช้จะมีตัวตน |
| `claim_ai_quota` | เรียกจาก Edge Function ที่ `verify_jwt = true` อยู่แล้ว |
| `check_in_attendance` | ให้ `authenticated` เรียกได้ และตรวจความเป็นเจ้าของผ่าน `auth.uid()` ภายใน |
| `cancel_class_announcement` | ให้ `authenticated` เรียกได้ **ควรตรวจเพิ่มว่ากันรายวิชาที่ไม่ได้สอนหรือยัง** |

### ข้อเสนอที่ยังไม่ได้ทำ (ไม่เร่งด่วน ทำหลังสอบได้)

```sql
-- ปิดช่องให้ PUBLIC เรียกฟังก์ชันที่ไม่ควรเปิด (ความเสี่ยงต่ำ แต่ทำแล้วสะอาดขึ้น)
REVOKE ALL ON FUNCTION public.sync_scheduled_sessions()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.course_grades_locked(uuid)  FROM PUBLIC, anon;
```

สาเหตุร่วมของทั้งหมดคือ PostgreSQL ให้สิทธิ์ `EXECUTE` แก่ `PUBLIC` กับฟังก์ชัน
ใหม่ทุกตัวโดยปริยาย ถ้า migration เขียนแต่ `GRANT` โดยไม่ `REVOKE ... FROM PUBLIC`
สิทธิ์ของ PUBLIC จะยังอยู่ **แนะนำให้ถือเป็นแบบแผนว่า ฟังก์ชัน `SECURITY DEFINER`
ทุกตัวต้องมี `REVOKE ALL ... FROM PUBLIC, anon` กำกับเสมอ**

---

## 4. รายการที่ต้องยืนยันกับฐานข้อมูลจริงก่อนสอบ

ชุดทดสอบอัตโนมัติรันบนฐานข้อมูลที่สร้างจาก migration ชุดเดียวกัน
แต่ไม่ใช่อินสแตนซ์ที่ใช้งานจริง รายการเต็มอยู่ใน
`docs/รายการตรวจสอบด้วยมือ.md` ข้อ M-00 ถึง M-03 ที่สำคัญที่สุดคือ

```sql
-- M-01 ถ้าได้ void แปลว่าปุ่มคำนวณคะแนนการเข้าเรียนบนหน้าจอพัง
SELECT p.proname, pg_get_function_result(p.oid) AS returns
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'recalc_attendance_scores';

-- M-02 ถ้ามีบรรทัดขึ้นต้นด้วย =X/ แปลว่า PUBLIC ยังเรียกได้
SELECT p.proname,
       COALESCE(array_to_string(p.proacl, E'\n'), '(ไม่ได้กำหนด = PUBLIC เรียกได้)') AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'get_scan_roster';

-- ก่อนสั่ง VALIDATE constraint ที่เพิ่มใน 20261013120000 ต้องนับแถวเก่าก่อน
SELECT count(*) FROM public.attendance_records
WHERE edited_at IS NOT NULL AND COALESCE(btrim(edit_reason), '') = '';

SELECT count(*) FROM public.grade_audit_logs
WHERE previous_score IS NOT NULL
  AND previous_score IS DISTINCT FROM new_score
  AND COALESCE(btrim(reason), '') = '';
```

ถ้าสองคำสั่งสุดท้ายได้ `0` จึงสั่ง `VALIDATE` ต่อได้

```sql
ALTER TABLE public.attendance_records VALIDATE CONSTRAINT attendance_edit_needs_reason;
ALTER TABLE public.grade_audit_logs   VALIDATE CONSTRAINT grade_edit_needs_reason;
```

ถ้าได้มากกว่า `0` **อย่าเพิ่งสั่ง VALIDATE** และอย่าลบหรือแก้ข้อมูลเก่า
ให้ตัดสินใจก่อนว่าจะเติมเหตุผลย้อนหลังหรือจะปล่อยแถวเก่าไว้
constraint แบบ `NOT VALID` บังคับกับแถวใหม่และแถวที่ถูกแก้ตั้งแต่นี้ไปอยู่แล้ว
