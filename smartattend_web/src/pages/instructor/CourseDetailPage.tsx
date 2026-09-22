import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { fetchAssignments, fmtDateTime as fmtAssignDate, type AssignmentRow } from '@/lib/assignment-data';
import { statusClass, statusLabel, fmtDateTime, type AttStatus } from '@/lib/attendance-data';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookOpen, Users, FileText, CalendarClock, CheckCircle, Clock, AlertCircle, HelpCircle, ChevronLeft } from 'lucide-react';

interface CourseInfo {
  id: string;
  code: string;
  name: string;
  section: string | null;
  semester: string | null;
}

interface RosterStudent {
  studentId: string;
  name: string;
  code: string | null;
}

interface SessionRow {
  id: string;
  started_at: string;
  status: string;
}

interface AttendanceByStudent {
  status: AttStatus;
  checkedInAt: string | null;
}

const CourseDetailPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { courseId } = useParams<{ courseId: string }>();

  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [attendance, setAttendance] = useState<Record<string, AttendanceByStudent>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id || !courseId) return;
    (async () => {
      setLoading(true);
      const [{ data: c }, { data: enrolls }, as] = await Promise.all([
        supabase.from('courses').select('id, code, name, section, semester')
          .eq('id', courseId).eq('instructor_id', user.id).maybeSingle(),
        supabase.from('course_enrollments').select('student_id')
          .eq('course_id', courseId).eq('status', 'confirmed'),
        fetchAssignments([courseId]),
      ]);
      setCourse(c ?? null);
      setAssignments(as);

      const ids = (enrolls ?? []).map(e => e.student_id).filter(Boolean) as string[];
      if (ids.length) {
        const { data: profiles } = await supabase.from('profiles')
          .select('user_id, name, student_code').in('user_id', ids);
        const map = new Map((profiles ?? []).map(p => [p.user_id, p]));
        setRoster(ids.map(id => ({
          studentId: id,
          name: map.get(id)?.name ?? 'นักศึกษา',
          code: map.get(id)?.student_code ?? null,
        })).sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '')));
      } else {
        setRoster([]);
      }

      const { data: sess } = await supabase.from('class_sessions')
        .select('id, started_at, status').eq('course_id', courseId)
        .order('started_at', { ascending: false });
      const list = (sess ?? []) as SessionRow[];
      setSessions(list);
      setSessionId(list[0]?.id ?? '');
      setLoading(false);
    })();
  }, [user?.id, courseId]);

  useEffect(() => {
    if (!sessionId) { setAttendance({}); return; }
    (async () => {
      const { data } = await supabase.from('attendance_records')
        .select('student_id, status, checked_in_at').eq('session_id', sessionId);
      const map: Record<string, AttendanceByStudent> = {};
      (data ?? []).forEach(r => { map[r.student_id] = { status: r.status as AttStatus, checkedInAt: r.checked_in_at }; });
      setAttendance(map);
    })();
  }, [sessionId]);

  const selectedSession = useMemo(() => sessions.find(s => s.id === sessionId) ?? null, [sessions, sessionId]);

  const rosterWithStatus = useMemo(() => roster.map(s => {
    const rec = attendance[s.studentId];
    if (rec) return { ...s, status: rec.status as AttStatus | 'pending', checkedInAt: rec.checkedInAt };
    // ไม่มีบันทึกสำหรับคาบนี้: ถ้าคาบยังเปิดอยู่แสดงว่ายังไม่เช็คชื่อ, ถ้าปิดแล้วถือว่าขาดเรียน
    return { ...s, status: (selectedSession?.status === 'open' ? 'pending' : 'absent') as AttStatus | 'pending', checkedInAt: null };
  }), [roster, attendance, selectedSession]);

  if (loading) {
    return (
      <MobileLayout title="รายละเอียดวิชา">
        <p className="text-sm text-muted-foreground text-center py-10">กำลังโหลด...</p>
      </MobileLayout>
    );
  }

  if (!course) {
    return (
      <MobileLayout title="รายละเอียดวิชา">
        <p className="text-sm text-muted-foreground text-center py-10">ไม่พบรายวิชานี้</p>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout title={course.code}>
      <div className="px-4 py-4 space-y-5">
        <button onClick={() => navigate('/instructor/courses')} className="flex items-center gap-1 text-xs text-muted-foreground">
          <ChevronLeft className="w-3.5 h-3.5" /> รายวิชาทั้งหมด
        </button>

        <div className="bg-card rounded-2xl p-5 shadow-elevated">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center shrink-0">
              <BookOpen className="w-6 h-6 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold font-display text-foreground">{course.code} - {course.name}</p>
              <p className="text-xs text-muted-foreground">Section {course.section ?? '-'} · ภาคเรียน {course.semester ?? '-'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3">
            <Users className="w-3.5 h-3.5" /> {roster.length} คนในวิชานี้
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> งานที่มอบหมาย ({assignments.length})
          </h2>
          <div className="space-y-2">
            {assignments.map(a => (
              <div key={a.id} className="bg-card rounded-xl p-3 shadow-card">
                <p className="text-sm font-medium text-foreground truncate">{a.title}</p>
                <p className="text-[11px] text-muted-foreground">กำหนดส่ง {fmtAssignDate(a.due_at)} · เต็ม {a.max_score}</p>
              </div>
            ))}
            {assignments.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">ยังไม่มีงานที่มอบหมายในวิชานี้</p>}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5" /> เลือกวัน-เวลาคาบเรียน
          </h2>
          {sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">ยังไม่เคยเปิดคาบเรียนในวิชานี้</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {sessions.map(s => (
                <button key={s.id} onClick={() => setSessionId(s.id)}
                  className={`whitespace-nowrap px-3 py-2 rounded-xl text-xs font-medium transition-all shrink-0 ${
                    sessionId === s.id ? 'gradient-primary text-primary-foreground shadow-elevated' : 'bg-card text-muted-foreground shadow-card'
                  }`}>
                  {fmtDateTime(s.started_at)} {s.status === 'open' && '· เปิดอยู่'}
                </button>
              ))}
            </div>
          )}
        </div>

        {sessionId && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> รายชื่อนักศึกษาทั้งหมด ({rosterWithStatus.length})
            </h2>
            <div className="space-y-2">
              {rosterWithStatus.map((s, i) => (
                <motion.div key={s.studentId} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }}
                  className="bg-card rounded-xl p-3 flex items-center gap-3 shadow-card">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    s.status === 'pending' ? 'bg-muted text-muted-foreground' : statusClass[s.status as AttStatus]
                  }`}>
                    {s.status === 'on_time' ? <CheckCircle className="w-4 h-4" />
                      : s.status === 'late' ? <Clock className="w-4 h-4" />
                      : s.status === 'pending' ? <HelpCircle className="w-4 h-4" />
                      : <AlertCircle className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                    <p className="text-[11px] text-muted-foreground">{s.code ?? '-'}{s.checkedInAt ? ` · ${fmtDateTime(s.checkedInAt)}` : ''}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                    s.status === 'pending' ? 'bg-muted text-muted-foreground' : statusClass[s.status as AttStatus]
                  }`}>
                    {s.status === 'pending' ? 'ยังไม่เช็คชื่อ' : statusLabel[s.status as AttStatus]}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>
    </MobileLayout>
  );
};

export default CourseDetailPage;
