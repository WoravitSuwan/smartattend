-- ═══════════════════════════════════════════════════════════════
--  ตั้งผู้ดูแลระบบคนแรก
--
--  ขั้นตอน:
--    1. สมัครบัญชีผ่านหน้าเว็บตามปกติก่อน (จะได้บทบาทนักศึกษา)
--    2. แก้อีเมลด้านล่างให้ตรงกับบัญชีที่เพิ่งสมัคร
--    3. รันไฟล์นี้ใน SQL Editor
--
--  ต้องทำผ่าน SQL เพราะระบบป้องกันไม่ให้ผู้ใช้ตั้งสิทธิ์ตัวเองเป็นแอดมิน
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  v_email text := 'เปลี่ยนเป็นอีเมลของคุณ@live.rmutl.ac.th';  -- ← แก้ตรงนี้
  v_uid   uuid;
begin
  select id into v_uid from auth.users where email = v_email;

  if v_uid is null then
    raise exception 'ไม่พบผู้ใช้อีเมล % — กรุณาสมัครผ่านหน้าเว็บก่อน', v_email;
  end if;

  -- ลบบทบาทเดิม (เช่น student) แล้วตั้งเป็น admin
  delete from public.user_roles where user_id = v_uid;
  insert into public.user_roles (user_id, role) values (v_uid, 'admin');

  raise notice 'ตั้ง % เป็นผู้ดูแลระบบเรียบร้อย', v_email;
end $$;

-- ตรวจผล
select p.email, r.role
from public.profiles p
join public.user_roles r on r.user_id = p.user_id
order by r.role;
