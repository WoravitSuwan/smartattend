-- 1) Roles infrastructure
create type public.app_role as enum ('admin', 'instructor', 'student');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select, insert on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

create policy "Users can view own roles"
  on public.user_roles for select to authenticated
  using (user_id = auth.uid());

-- Self-service signups may only ever grant themselves the lowest-privilege role
create policy "Users can self-assign student role only"
  on public.user_roles for insert to authenticated
  with check (user_id = auth.uid() and role = 'student');

-- 2) Profiles for registered students
create table public.profiles (
  user_id uuid primary key,
  name text not null,
  email text not null,
  student_code text,
  department text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "Users can insert own profile"
  on public.profiles for insert to authenticated
  with check (user_id = auth.uid());
create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using (user_id = auth.uid());

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at_column();

-- 3) Lock down face_images (biometric data)
alter table public.face_images add column user_id uuid;

drop policy if exists "Public can view face images" on public.face_images;
drop policy if exists "Public can add face images" on public.face_images;
drop policy if exists "Public can update face images" on public.face_images;
drop policy if exists "Public can delete face images" on public.face_images;

revoke all on public.face_images from anon;
revoke all on public.face_images from public;
grant select, insert, delete on public.face_images to authenticated;
grant all on public.face_images to service_role;

create policy "Owners and admins can view face images"
  on public.face_images for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "Students can add own face images"
  on public.face_images for insert to authenticated
  with check (user_id = auth.uid());
create policy "Owners and admins can delete face images"
  on public.face_images for delete to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- 4) Lock down training_runs (admin only)
drop policy if exists "Public can view training runs" on public.training_runs;
drop policy if exists "Public can add training runs" on public.training_runs;
drop policy if exists "Public can update training runs" on public.training_runs;
drop policy if exists "Public can delete training runs" on public.training_runs;

revoke all on public.training_runs from anon;
revoke all on public.training_runs from public;
grant select, insert, update, delete on public.training_runs to authenticated;
grant all on public.training_runs to service_role;

create policy "Admins can manage training runs"
  on public.training_runs for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));