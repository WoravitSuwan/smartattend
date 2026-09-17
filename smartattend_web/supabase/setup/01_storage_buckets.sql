-- ═══════════════════════════════════════════════════════════════
--  สร้าง Storage bucket ที่ระบบต้องใช้
--  รันไฟล์นี้ใน Supabase Dashboard > SQL Editor หลังทำ db push แล้ว
--
--  หมายเหตุ: นโยบายความปลอดภัย (RLS) ของ bucket เหล่านี้
--  อยู่ในไฟล์ migration แล้ว ไม่ต้องสร้างซ้ำ
-- ═══════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values
  ('face-models',       'face-models',       false),   -- โมเดลจดจำใบหน้าที่เทรนแล้ว
  ('assignment-files',  'assignment-files',  false),   -- ไฟล์งานที่นักศึกษาส่ง
  ('leave-attachments', 'leave-attachments', false)    -- เอกสารแนบใบลา
on conflict (id) do nothing;

-- ตรวจผล
select id, name, public, created_at from storage.buckets order by id;
