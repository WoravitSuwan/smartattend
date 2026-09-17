import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
interface ParsedCourse {
  code: string;
  name: string;
  section?: string;
  credits?: string;
  schedule?: string;
  room?: string;
  instructor?: string;
}

export interface StudentCourse {
  id: string;
  code: string;
  name: string;
  section?: string | null;
  credits?: string | null;
  schedule?: string | null;
  room?: string | null;
  instructor?: string | null;
}

/** Upsert parsed courses (dedup by (user_id, code)) into the DB. */
export async function saveParsedCourses(userId: string, courses: ParsedCourse[]) {
  if (!courses.length) return { count: 0 };
  const rows = courses.map(c => ({
    user_id: userId,
    code: c.code,
    name: c.name,
    section: c.section ?? null,
    credits: c.credits ?? null,
    schedule: c.schedule ?? null,
    room: c.room ?? null,
    instructor: c.instructor ?? null,
    source: 'pdf',
  }));
  const { error, data } = await supabase
    .from('student_courses')
    .upsert(rows, { onConflict: 'user_id,code' })
    .select('id');
  if (error) throw error;
  return { count: data?.length ?? rows.length };
}

export async function fetchMyCourses(userId: string): Promise<StudentCourse[]> {
  const { data, error } = await supabase
    .from('student_courses')
    .select('id, code, name, section, credits, schedule, room, instructor')
    .eq('user_id', userId)
    .order('code');
  if (error) throw error;
  return (data ?? []) as StudentCourse[];
}

export async function deleteMyCourse(id: string) {
  const { error } = await supabase.from('student_courses').delete().eq('id', id);
  if (error) throw error;
}

/** React hook: live list of imported courses for the current user. */
export function useMyCourses(userId?: string | null) {
  const [courses, setCourses] = useState<StudentCourse[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) { setCourses([]); return; }
    setLoading(true);
    try {
      const fetched = await fetchMyCourses(userId);
      setCourses(fetched);
    } catch { setCourses([]); }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`student_courses:${userId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'student_courses', filter: `user_id=eq.${userId}` },
        () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, refresh]);

  return { courses, loading, refresh };
}
