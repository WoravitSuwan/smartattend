-- ═══════════════════════════════════════════════════════════════════
--  ยืนยันตัวตนผู้สมัคร: จำกัดโดเมนอีเมล + สร้างโปรไฟล์อัตโนมัติ
--
--  แก้ปัญหา 2 อย่าง
--    1. ใครก็สมัครได้ด้วยอีเมลอะไรก็ได้ แม้แต่อีเมลนอกมหาวิทยาลัย
--       -> บังคับโดเมนที่ระดับฐานข้อมูล ข้ามผ่านไม่ได้แม้เรียก API ตรง
--    2. เมื่อเปิดระบบยืนยันอีเมล ผู้สมัครจะยังไม่มี session ตอนสมัคร
--       ทำให้โค้ดฝั่งหน้าเว็บสร้างโปรไฟล์ไม่ได้
--       -> ย้ายมาสร้างด้วย trigger ฝั่งฐานข้อมูลแทน
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) รายชื่อโดเมนที่อนุญาต ─────────────────────────────────────
-- แยกเป็นตารางเพื่อให้แอดมินเพิ่ม/ลบได้ภายหลังโดยไม่ต้องแก้โค้ด
create table if not exists public.allowed_email_domains (
  domain      text primary key,
  note        text,
  created_at  timestamptz not null default now()
);

insert into public.allowed_email_domains (domain, note) values
  ('rmutl.ac.th',      'อีเมลบุคลากรของมหาวิทยาลัย'),
  ('live.rmutl.ac.th', 'อีเมลนักศึกษาของมหาวิทยาลัย')
on conflict (domain) do nothing;

alter table public.allowed_email_domains enable row level security;

drop policy if exists "Anyone can read allowed domains" on public.allowed_email_domains;
create policy "Anyone can read allowed domains"
  on public.allowed_email_domains
  for select to authenticated, anon
  using (true);

drop policy if exists "Admins manage allowed domains" on public.allowed_email_domains;
create policy "Admins manage allowed domains"
  on public.allowed_email_domains
  for all to authenticated
  using (internal.has_role(auth.uid(), 'admin'::public.app_role))
  with check (internal.has_role(auth.uid(), 'admin'::public.app_role));

grant select on public.allowed_email_domains to anon, authenticated;
grant all    on public.allowed_email_domains to service_role;


-- ── 2) บังคับโดเมนตอนสมัคร ──────────────────────────────────────
create or replace function public.enforce_email_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain text;
begin
  v_domain := lower(split_part(new.email, '@', 2));

  if not exists (select 1 from public.allowed_email_domains where domain = v_domain) then
    raise exception
      'อนุญาตเฉพาะอีเมลของมหาวิทยาลัยเท่านั้น (@rmutl.ac.th หรือ @live.rmutl.ac.th)'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_enforce_email_domain on auth.users;
create trigger trg_enforce_email_domain
  before insert on auth.users
  for each row execute function public.enforce_email_domain();


-- ── 3) สร้างโปรไฟล์และกำหนดบทบาทอัตโนมัติ ─────────────────────────
-- จำเป็นเมื่อเปิดระบบยืนยันอีเมล เพราะตอนสมัครจะยังไม่มี session
-- ทำให้โค้ดฝั่งหน้าเว็บ insert ตาราง profiles ไม่ได้ (ติด RLS)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent text := coalesce(new.raw_user_meta_data->>'role_intent', 'student');
begin
  insert into public.profiles (user_id, name, email, student_code, department)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)),
    new.email,
    nullif(trim(new.raw_user_meta_data->>'student_id'), ''),
    nullif(trim(new.raw_user_meta_data->>'department'), '')
  )
  on conflict (user_id) do nothing;

  -- นักศึกษาได้บทบาททันที ส่วนอาจารย์ต้องผ่านการอนุมัติจากแอดมินก่อน
  if v_intent = 'student' then
    insert into public.user_roles (user_id, role)
    values (new.id, 'student'::public.app_role)
    on conflict (user_id, role) do nothing;
  end if;

  return new;
end $$;

drop trigger if exists trg_handle_new_user on auth.users;
create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── 4) ปิดช่องโหว่: ห้ามผู้ใช้ตั้งบทบาทตัวเองอีกต่อไป ──────────────
-- เดิมเปิดให้ self-assign บทบาท student ได้ เพื่อให้หน้าเว็บสมัครทำงาน
-- ตอนนี้ trigger ทำหน้าที่นั้นแทนแล้ว จึงปิดสิทธิ์นี้เพื่อความปลอดภัย
drop policy if exists "Users can self-assign student role only" on public.user_roles;
revoke insert on public.user_roles from authenticated;
