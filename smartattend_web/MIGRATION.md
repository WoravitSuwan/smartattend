# การย้ายออกจาก Lovable

เอกสารนี้อธิบายสิ่งที่ต้องทำเพื่อให้โปรเจกต์เป็นอิสระจาก Lovable โดยสมบูรณ์

## สิ่งที่จัดการให้แล้วในโค้ด

| รายการ | เดิม | ปัจจุบัน |
|---|---|---|
| ปลั๊กอิน build | `lovable-tagger` | ถอดออกแล้ว |
| ชื่อโปรเจกต์ | `vite_react_shadcn_ts` | `smartattend` |
| meta tag ในหน้าเว็บ | รูปตัวอย่างและบัญชีของ Lovable | ลบออกแล้ว |
| ไฟล์ตั้งค่าเฉพาะ | `.lovable/`, `playwright.config.ts` | ลบออกแล้ว |
| README | เนื้อหาโฆษณา Lovable | เขียนใหม่ทั้งหมด |
| บริการ AI อ่านตารางเรียน | `ai.gateway.lovable.dev` | เรียก Google Gemini โดยตรง |

## สิ่งที่ต้องทำเอง (สำคัญ)

### 1. ย้ายฐานข้อมูลไปยัง Supabase ของตัวเอง

ปัจจุบันฐานข้อมูลโฮสต์อยู่บน Lovable Cloud (โดเมน `*.lovable.cloud`)
ซึ่งยังผูกกับบัญชี Lovable อยู่ แม้โค้ดจะเป็นอิสระแล้วก็ตาม

#### เตรียมตัว

1. สมัคร Supabase ที่ https://supabase.com (ฟรี) แล้วสร้างโปรเจกต์ใหม่
   - ตั้งรหัสผ่านฐานข้อมูล **จดเก็บไว้ให้ดี** จะใช้ตอนเชื่อมต่อ
   - เลือก Region เป็น **Southeast Asia (Singapore)** เพื่อให้เร็วที่สุดจากไทย

2. ติดตั้ง Supabase CLI บนเครื่อง

   ```bash
   brew install supabase/tap/supabase
   supabase login
   ```

#### รันสคริปต์อัตโนมัติ

หา `project-ref` จาก URL ของ dashboard:
`https://supabase.com/dashboard/project/`**`xxxxxxxxxxxx`**

```bash
./migrate-to-supabase.sh xxxxxxxxxxxx
```

สคริปต์จะทำให้ 3 อย่าง: เชื่อมต่อโปรเจกต์ รัน migration ทั้ง 34 ไฟล์
และอัปโหลด edge functions ทั้ง 8 ตัว

#### ทำต่อเองอีก 3 ขั้น

**ก) สร้าง Storage bucket**

Dashboard → SQL Editor → วางเนื้อหาไฟล์ `supabase/setup/01_storage_buckets.sql` → Run

**ข) แก้ไฟล์ `.env`**

ค่าทั้งหมดอยู่ที่ Project Settings → API

```
VITE_SUPABASE_URL="https://xxxxxxxxxxxx.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="eyJ..."     # anon public key
VITE_SUPABASE_PROJECT_ID="xxxxxxxxxxxx"
```

**ค) ตั้งผู้ดูแลระบบคนแรก**

ฐานข้อมูลใหม่ยังไม่มีผู้ใช้เลย ต้องสมัครผ่านหน้าเว็บก่อน (จะได้บทบาทนักศึกษา)
แล้วรัน `supabase/setup/02_create_admin.sql` ใน SQL Editor เพื่อยกระดับเป็นแอดมิน

> ต้องทำผ่าน SQL เพราะระบบออกแบบมาไม่ให้ผู้ใช้ตั้งสิทธิ์ตัวเองเป็นแอดมินได้
> ซึ่งเป็นมาตรการความปลอดภัยที่ถูกต้องแล้ว

#### ตั้งค่า secret ของ edge function

ฟีเจอร์อ่านตารางเรียนจากรูปภาพต้องใช้คีย์ Google Gemini

```bash
supabase secrets set GEMINI_API_KEY=<คีย์จาก aistudio.google.com>
```

หากไม่ใช้ฟีเจอร์นี้ ข้ามได้ ส่วนอื่นทำงานปกติ

### 2. ย้ายข้อมูลเดิม (ถ้าต้องการเก็บไว้)

ข้อมูลผู้ใช้ ภาพใบหน้า และประวัติการเข้าเรียนจะไม่ถูกย้ายตามอัตโนมัติ

หากยังเข้าถึง Lovable Cloud ได้ ให้ export ข้อมูลออกมาก่อน
(Dashboard > Database > Backups หรือใช้ `pg_dump` กับ connection string)
แล้วนำเข้าโปรเจกต์ใหม่ด้วย `psql`

> ถ้าเป็นข้อมูลทดสอบทั้งหมด อาจเริ่มใหม่จะง่ายกว่า และเป็นโอกาสดี
> ที่จะให้นักศึกษาหลายคนลงทะเบียนใบหน้าใหม่เพื่อให้โมเดลแม่นยำขึ้น

### 3. ขอคีย์ Google Gemini

ฟีเจอร์อ่านตารางเรียนจากรูปภาพต้องใช้คีย์ของ Google
ขอได้ฟรีที่ https://aistudio.google.com/apikey

หากไม่ใช้ฟีเจอร์นี้ สามารถข้ามได้ ส่วนอื่นของระบบทำงานได้ตามปกติ

## ตรวจสอบว่าเป็นอิสระแล้ว

```bash
grep -ri "lovable" . --exclude-dir=node_modules --exclude=package-lock.json
```

ถ้าไม่มีผลลัพธ์ แสดงว่าโค้ดไม่อ้างอิงถึง Lovable แล้ว

> `package-lock.json` อาจยังมีร่องรอยของแพ็กเกจเดิมอยู่
> ให้ลบไฟล์นี้แล้วรัน `npm install` ใหม่เพื่อสร้างใหม่ทั้งหมด
