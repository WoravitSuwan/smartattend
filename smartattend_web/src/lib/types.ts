export type UserRole = 'student' | 'instructor' | 'admin' | 'pending_instructor';

/** App-level user, built from the authenticated backend user + profile row. */
export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  studentId?: string;
  department: string;
  faculty?: string;
  avatarUrl?: string;
  phone?: string;
  profileCompletedAt?: string | null;
}
