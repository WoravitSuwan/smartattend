import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User as SupabaseAuthUser } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { User, UserRole } from './types';

interface RegisterInput {
  name: string;
  studentId: string;
  email: string;
  password: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (input: RegisterInput) => Promise<{ success: boolean; error?: string; needsEmailConfirm?: boolean }>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  updateUser: (updates: Partial<Pick<User, 'phone' | 'avatarUrl' | 'name' | 'department' | 'faculty' | 'profileCompletedAt' | 'studentId'>>) => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const adminUser: User = {
  id: 'ADMIN1',
  name: 'ผู้ดูแลระบบ',
  email: 'admin@rmutl.ac.th',
  role: 'admin' as UserRole,
  department: 'สำนักวิทยบริการและเทคโนโลยีสารสนเทศ',
};

/** Build the app-level User object from an authenticated backend user. */
async function buildUser(authUser: SupabaseAuthUser): Promise<User> {
  const email = (authUser.email ?? '').toLowerCase();
  if (email === adminUser.email) return adminUser;

  // Real profile + role data is always loaded from the database below.


  // Look up profile + role
  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    supabase
      .from('profiles')
      .select('name, student_code, department, faculty, phone, avatar_url, profile_completed_at')
      .eq('user_id', authUser.id)
      .maybeSingle(),
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', authUser.id),
  ]);

  // A signed-up account always has a profiles row — it's created by the
  // same DB trigger that handles the signup itself. If it's missing while
  // the person still has a (not-yet-expired) session token, the account
  // was deleted out from under them: PostgREST has no way to know that and
  // just returns an empty result instead of an error, so without this
  // check buildUser() would silently fabricate a blank "student" account
  // instead of signaling that the session is no longer valid.
  if (!profile) {
    throw new Error('profile_not_found');
  }

  const meta = (authUser.user_metadata ?? {}) as Record<string, unknown>;
  const baseName = profile?.name ?? (typeof meta.name === 'string' ? meta.name : email);

  // Prefer explicit assigned role; else check pending role_request
  const assignedRole = (roleRows ?? [])[0]?.role as UserRole | undefined;

  let role: UserRole = 'student';
  let department = profile?.department ?? 'วิศวกรรมซอฟต์แวร์';

  if (assignedRole) {
    role = assignedRole;
  } else {
    const { data: req } = await supabase
      .from('role_requests')
      .select('status, department, requested_role')
      .eq('user_id', authUser.id)
      .maybeSingle();
    if (req?.status === 'pending' && req.requested_role === 'instructor') {
      role = 'pending_instructor';
      if (req.department) department = req.department;
    }
  }

  return {
    id: authUser.id,
    name: baseName,
    email,
    role,
    studentId: profile?.student_code ?? (typeof meta.student_id === 'string' ? meta.student_id : undefined),
    department,
    faculty: profile?.faculty ?? undefined,
    phone: profile?.phone ?? undefined,
    avatarUrl: profile?.avatar_url ?? undefined,
    profileCompletedAt: profile?.profile_completed_at ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    // If buildUser ever rejects (deleted account, invalid/revoked session,
    // network error) sign out and clear state instead of leaving `loading`
    // stuck true forever — that stuck state is what renders as a permanent
    // blank screen in App.tsx (`if (loading) return null`).
    const onBuildUserFailed = (err: unknown) => {
      console.warn('buildUser failed — signing out', err);
      if (!active) return;
      setUser(null);
      setLoading(false);
      supabase.auth.signOut().catch(() => {});
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        if (active) { setUser(null); setLoading(false); }
        return;
      }
      // Defer supabase calls out of the auth callback to avoid deadlocks
      setTimeout(() => {
        buildUser(session.user).then(u => {
          if (active) { setUser(u); setLoading(false); }
        }).catch(onBuildUserFailed);
      }, 0);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        if (active) setLoading(false);
        return;
      }
      buildUser(session.user).then(u => {
        if (active) { setUser(u); setLoading(false); }
      }).catch(onBuildUserFailed);
    }).catch(onBuildUserFailed);

    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    const input = email.trim();
    if (!input) {
      return { success: false, error: 'กรุณากรอกอีเมลหรือชื่อผู้ใช้' };
    }

    let resolvedEmail = input.toLowerCase();
    if (!resolvedEmail.includes('@')) {
      // Just the part before "@" — try both institutional domains
      // (rmutl.ac.th / live.rmutl.ac.th) via the DB instead of guessing
      // client-side, since only one of them is actually registered.
      const { data: resolved } = await supabase.rpc('resolve_login_email', { _input: resolvedEmail });
      if (!resolved) {
        return { success: false, error: 'ไม่พบบัญชีนี้ กรุณาตรวจสอบชื่อผู้ใช้ หรือกรอกอีเมลแบบเต็ม' };
      }
      resolvedEmail = String(resolved).toLowerCase();
    }

    const { error } = await supabase.auth.signInWithPassword({ email: resolvedEmail, password });
    if (error) {
      const msg = error.message.toLowerCase().includes('invalid login credentials')
        ? 'อีเมล/รหัสนักศึกษา หรือรหัสผ่านไม่ถูกต้อง'
        : error.message;
      return { success: false, error: msg };
    }
    return { success: true };
  };

  const register = async (input: RegisterInput): Promise<{ success: boolean; error?: string; needsEmailConfirm?: boolean }> => {
    const email = input.email.trim().toLowerCase();

    const { data, error } = await supabase.auth.signUp({
      email,
      password: input.password,
      options: {
        // ค่าเหล่านี้ถูกอ่านโดย trigger handle_new_user ฝั่งฐานข้อมูล
        // เพื่อสร้างโปรไฟล์ให้อัตโนมัติ แม้ผู้ใช้ยังไม่ได้ยืนยันอีเมล
        data: {
          name: input.name.trim(),
          student_id: input.studentId,
          role_intent: 'student',
        },
        // พากลับมาหน้าเข้าสู่ระบบหลังกดยืนยันในอีเมล
        emailRedirectTo: `${window.location.origin}/?verified=1`,
      },
    });

    if (error) {
      const raw = error.message.toLowerCase();
      let msg = error.message;
      if (raw.includes('already registered') || raw.includes('already been registered')) {
        msg = 'อีเมลนี้ถูกใช้งานแล้ว';
      } else if (raw.includes('อนุญาตเฉพาะอีเมล') || raw.includes('check_violation')) {
        msg = 'อนุญาตเฉพาะอีเมลของมหาวิทยาลัย (@rmutl.ac.th หรือ @live.rmutl.ac.th)';
      } else if (raw.includes('rate limit') || raw.includes('too many')) {
        msg = 'ส่งอีเมลยืนยันบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่';
      }
      return { success: false, error: msg };
    }

    // ไม่มี session แปลว่าระบบยืนยันอีเมลเปิดอยู่ ผู้ใช้ต้องกดลิงก์ในอีเมลก่อน
    // โปรไฟล์และบทบาทถูกสร้างโดย trigger ฝั่งฐานข้อมูลแล้ว ไม่ต้อง insert ที่นี่
    return { success: true, needsEmailConfirm: !data.session };
  };

  const requestPasswordReset = async (email: string): Promise<{ success: boolean; error?: string }> => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes('@')) {
      return { success: false, error: 'กรุณากรอกอีเมลให้ถูกต้อง' };
    }
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      const raw = error.message.toLowerCase();
      const msg = raw.includes('rate limit') || raw.includes('too many')
        ? 'ขอลิงก์บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'
        : error.message;
      return { success: false, error: msg };
    }
    return { success: true };
  };

  const updatePassword = async (newPassword: string): Promise<{ success: boolean; error?: string }> => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { success: false, error: error.message };
    return { success: true };
  };

  const updateUser = (updates: Partial<Pick<User, 'phone' | 'avatarUrl' | 'name' | 'department' | 'faculty' | 'profileCompletedAt' | 'studentId'>>) => {
    if (!user) return;
    setUser({ ...user, ...updates });
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      const patch: Record<string, unknown> = {};
      if (updates.phone !== undefined) patch.phone = updates.phone;
      if (updates.avatarUrl !== undefined) patch.avatar_url = updates.avatarUrl;
      if (updates.name !== undefined) patch.name = updates.name;
      if (updates.department !== undefined) patch.department = updates.department;
      if (updates.faculty !== undefined) patch.faculty = updates.faculty;
      if (updates.profileCompletedAt !== undefined) patch.profile_completed_at = updates.profileCompletedAt;
      if (updates.studentId !== undefined) patch.student_code = updates.studentId;
      if (Object.keys(patch).length === 0) return;
      supabase.from('profiles').update(patch as never).eq('user_id', data.user.id).then(() => {});
    });
  };

  const logout = () => {
    supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, requestPasswordReset, updatePassword, logout, updateUser, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
