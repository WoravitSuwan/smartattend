import { useEffect, useState, useCallback } from 'react';
import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { motion } from 'framer-motion';
import { BookOpen, User, Calendar, Check, X, Loader2, Inbox } from 'lucide-react';
import { toast } from 'sonner';

interface EnrollmentRow {
  id: string;
  status: string;
  course: {
    id: string;
    code: string;
    name: string;
    section: string | null;
    semester: string | null;
    instructor_id: string;
  };
  instructor_name?: string | null;
}

const StudentCoursesPage = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<EnrollmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('course_enrollments')
        .select('id, status, course:courses(id, code, name, section, semester, instructor_id)')
        .eq('student_id', user.id)
        .in('status', ['confirmed', 'pending']);
      if (error) throw error;
      const list = (data ?? []) as unknown as EnrollmentRow[];

      const instructorIds = Array.from(new Set(list.map(r => r.course?.instructor_id).filter(Boolean)));
      if (instructorIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, name')
          .in('user_id', instructorIds);
        const map = new Map((profs ?? []).map(p => [p.user_id, p.name]));
        list.forEach(r => { r.instructor_name = map.get(r.course.instructor_id) ?? null; });
      }
      setRows(list);
    } catch (e) {
      console.error(e);
      toast.error('โหลดรายวิชาไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!user?.id) return;
    const ch = supabase
      .channel(`enroll:${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'course_enrollments', filter: `student_id=eq.${user.id}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, load]);

  const respond = async (row: EnrollmentRow, accept: boolean) => {
    setBusyId(row.id);
    try {
      const { error } = await supabase
        .from('course_enrollments')
        .update(accept
          ? { status: 'confirmed', confirmed_at: new Date().toISOString() }
          : { status: 'declined' })
        .eq('id', row.id);
      if (error) throw error;
      toast.success(accept ? 'ยืนยันเข้าร่วมวิชาแล้ว' : 'ปฏิเสธคำเชิญแล้ว');
      await load();
    } catch (e) {
      console.error(e);
      toast.error('บันทึกไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  };

  const confirmed = rows.filter(r => r.status === 'confirmed');
  const pending = rows.filter(r => r.status === 'pending');

  return (
    <MobileLayout title="วิชาเรียนของฉัน">
      <div className="px-4 py-4 space-y-5">
        {loading && (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        )}

        {!loading && rows.length === 0 && (
          <div className="bg-card rounded-2xl border border-border p-8 text-center">
            <Inbox className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium text-foreground">ยังไม่มีวิชาเรียน</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              อาจารย์จะเพิ่มคุณเข้าวิชาผ่านระบบนำเข้ารายชื่อ
            </p>
          </div>
        )}

        {pending.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              รอการยืนยัน ({pending.length})
            </h2>
            <div className="space-y-2">
              {pending.map((r, i) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  className="bg-card rounded-2xl p-4 border border-accent/40 shadow-card"
                >
                  <CourseHeader row={r} />
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <button
                      onClick={() => respond(r, true)}
                      disabled={busyId === r.id}
                      className="h-9 rounded-lg bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" /> ยืนยัน
                    </button>
                    <button
                      onClick={() => respond(r, false)}
                      disabled={busyId === r.id}
                      className="h-9 rounded-lg bg-muted text-foreground text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" /> ปฏิเสธ
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </section>
        )}

        {confirmed.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              วิชาที่ยืนยันแล้ว ({confirmed.length})
            </h2>
            <div className="space-y-2">
              {confirmed.map((r, i) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  className="bg-card rounded-2xl p-4 border border-border shadow-card"
                >
                  <CourseHeader row={r} />
                </motion.div>
              ))}
            </div>
          </section>
        )}
      </div>
    </MobileLayout>
  );
};

function CourseHeader({ row }: { row: EnrollmentRow }) {
  const c = row.course;
  return (
    <div className="flex items-start gap-3">
      <div className="w-11 h-11 rounded-xl gradient-primary flex items-center justify-center shrink-0">
        <BookOpen className="w-5 h-5 text-primary-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold font-display text-foreground">
          {c.code}{c.section ? ` · ตอน ${c.section}` : ''}
        </p>
        <p className="text-xs text-foreground truncate">{c.name}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-muted-foreground">
          {row.instructor_name && (
            <span className="flex items-center gap-1"><User className="w-3 h-3" />{row.instructor_name}</span>
          )}
          {c.semester && (
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />ภาคเรียน {c.semester}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default StudentCoursesPage;
