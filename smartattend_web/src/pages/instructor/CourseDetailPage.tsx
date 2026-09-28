import MobileLayout from '@/components/MobileLayout';
import ScheduleSessionPanel from '@/components/ScheduleSessionPanel';
import AssignmentManagementPage from '@/pages/instructor/AssignmentManagementPage';
import GradeManagementPage from '@/pages/instructor/GradeManagementPage';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { closeClassSession, startClassSession } from '@/lib/class-session';
import { statusClass, statusLabel, fmtDateTime, type AttStatus } from '@/lib/attendance-data';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  BookOpen, Users, CalendarClock, CheckCircle, Clock, AlertCircle, HelpCircle,
  ChevronLeft, PlayCircle, StopCircle, Loader2, FileText, GraduationCap,
} from 'lucide-react';

interface CourseInfo {
  id: string;
  code: string;
  name: string;
  section: string | null;
  semester: string | null;
}

interface RosterStudent { studentId: string; name: string; code: string | null }
interface SessionRow { id: string; started_at: string; status: string; title: string | null }
interface AttendanceByStudent { status: AttStatus; checkedInAt: string | null }

type Tab = 'sessions' | 'assignments' | 'grades';

const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
  { key: 'sessions', label: 'คาบเรียน', icon: CalendarClock },
  { key: 'assignments', label: 'งาน', icon: FileText },
  { key: 'grades', label: 'คะแนน', icon: GraduationCap },
];

/** ศูนย์รวมของรายวิชาเดียว — เปิดคลาส ตั้งเวลาคาบ เช็ครายชื่อ สร้างงาน และให้คะแนน
 *  อยู่ในหน้าเดียวกันทั้งหมด ไม่ต้องสลับไปมาหลายเมนู */
const CourseDetailPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { courseId } = useParams<{ courseId: string }>();

  // แท็บอยู่ใน URL เพื่อให้ลิงก์จากที่อื่นพามาถึงแท็บที่ต้องการได้
  // (เช่นปุ่ม "ไปตั้งโครงสร้างคะแนน" ในฟอร์มสร้างงาน) และรีเฟรชแล้วไม่เด้งกลับ
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [tab, setTabState] = useState<Tab>(
    urlTab === 'assignments' || urlTab === 'grades' ? urlTab : 'sessions');

  const setTab = (t: Tab) => {
    setTabState(t);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (t === 'sessions') next.delete('tab'); else next.set('tab', t);
      return next;
    }, { replace: true });
  };

  // ลิงก์จากหน้าอื่นเปลี่ยน ?tab= ระหว่างที่หน้านี้เปิดอยู่ ต้องตามไปด้วย
  useEffect(() => {
    if (urlTab === 'assignments' || urlTab === 'grades') setTabState(urlTab);
  }, [urlTab]);
  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [attendance, setAttendance] = useState<Record<string, AttendanceByStudent>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lateAfter, setLateAfter] = useState(15);
  const [duration, setDuration] = useState(60);

  const loadCourse = useCallback(async () => {
    if (!user?.id || !courseId) return;
    setLoading(true);
    const [{ data: c }, { data: enrolls }] = await Promise.all([
      supabase.from('courses').select('id, code, name, section, semester')
        .eq('id', courseId).eq('instructor_id', user.id).maybeSingle(),
      supabase.from('course_enrollments').select('student_id')
        .eq('course_id', courseId).eq('status', 'confirmed'),
    ]);
    setCourse(c ?? null);

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
    setLoading(false);
  }, [user?.id, courseId]);

  const loadSessions = useCallback(async () => {
    if (!courseId) return;
    await supabase.rpc('sync_scheduled_sessions');
    const { data } = await supabase.from('class_sessions')
      .select('id, started_at, status, title').eq('course_id', courseId)
      .in('status', ['open', 'closed'])
      .order('started_at', { ascending: false });
    const list = (data ?? []) as SessionRow[];
    setSessions(list);
    setSessionId(prev => (prev && list.some(s => s.id === prev) ? prev : list[0]?.id ?? ''));
  }, [courseId]);

  useEffect(() => { loadCourse(); }, [loadCourse]);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => {
    if (!sessionId) { setAttendance({}); return; }
    (async () => {
      const { data } = await supabase.from('attendance_records')
        .select('student_id, status, checked_in_at').eq('session_id', sessionId);
      const map: Record<string, AttendanceByStudent> = {};
      (data ?? []).forEach(r => {
        map[r.student_id] = { status: r.status as AttStatus, checkedInAt: r.checked_in_at };
      });
      setAttendance(map);
    })();
  }, [sessionId]);

  const openSession = useMemo(() => sessions.find(s => s.status === 'open') ?? null, [sessions]);
  const selectedSession = useMemo(
    () => sessions.find(s => s.id === sessionId) ?? null, [sessions, sessionId]);

  const rosterWithStatus = useMemo(() => roster.map(s => {
    const rec = attendance[s.studentId];
    if (rec) return { ...s, status: rec.status as AttStatus | 'pending', checkedInAt: rec.checkedInAt };
    // ไม่มีบันทึกในคาบนี้: คาบยังเปิด = ยังไม่เช็คชื่อ, คาบปิดแล้ว = ขาดเรียน
    return {
      ...s,
      status: (selectedSession?.status === 'open' ? 'pending' : 'absent') as AttStatus | 'pending',
      checkedInAt: null,
    };
  }), [roster, attendance, selectedSession]);

  const startNow = async () => {
    if (!courseId) return;
    setBusy(true);
    try {
      const res = await startClassSession({
        courseId, lateAfterMinutes: lateAfter, durationMinutes: duration,
      });
      toast.success(`เปิดคลาสแล้ว — แจ้งนักศึกษา ${res.notified_count ?? 0} คน`);
      await loadSessions();
    } catch (e) {
      toast.error((e as { message?: string }).message ?? 'เปิดคลาสไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  const closeNow = async () => {
    if (!openSession || !courseId) return;
    setBusy(true);
    try {
      const n = await closeClassSession(openSession.id, courseId);
      toast.success(n > 0 ? `ปิดคลาสแล้ว — บันทึกขาดเรียน ${n} คน` : 'ปิดคลาสแล้ว');
      await loadSessions();
    } catch (e) {
      toast.error((e as { message?: string }).message ?? 'ปิดคลาสไม่สำเร็จ');
    } finally { setBusy(false); }
  };

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
      <div className="px-4 py-4 space-y-4">
        <button onClick={() => navigate('/instructor/courses')}
          className="flex items-center gap-1 text-xs text-muted-foreground">
          <ChevronLeft className="w-3.5 h-3.5" /> รายวิชาทั้งหมด
        </button>

        <div className="bg-card rounded-2xl p-5 shadow-elevated">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center shrink-0">
              <BookOpen className="w-6 h-6 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold font-display text-foreground">{course.code} - {course.name}</p>
              <p className="text-xs text-muted-foreground">
                Section {course.section ?? '-'} · ภาคเรียน {course.semester ?? '-'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3">
            <Users className="w-3.5 h-3.5" /> {roster.length} คนในวิชานี้
          </div>
        </div>

        <div className="flex gap-2">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                tab === t.key
                  ? 'gradient-primary text-primary-foreground shadow-elevated'
                  : 'bg-card text-muted-foreground shadow-card'
              }`}>
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {tab === 'sessions' && (
          <>
            <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
              {openSession ? (
                <>
                  <div className="flex items-center gap-2 text-xs text-success font-semibold">
                    <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                    กำลังเปิดคลาสอยู่ — เริ่ม {fmtDateTime(openSession.started_at)}
                  </div>
                  <button onClick={closeNow} disabled={busy}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-destructive text-destructive-foreground font-semibold disabled:opacity-50">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <StopCircle className="w-4 h-4" />}
                    ปิดคลาส
                  </button>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs space-y-1">
                      <span className="text-muted-foreground">สายหลังจาก (นาที)</span>
                      <input type="number" min={1} max={120} value={lateAfter}
                        onChange={e => setLateAfter(Math.max(1, Number(e.target.value) || 15))}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
                    </label>
                    <label className="text-xs space-y-1">
                      <span className="text-muted-foreground">ระยะเวลาคาบ (นาที)</span>
                      <input type="number" min={10} max={300} step={10} value={duration}
                        onChange={e => setDuration(Math.max(10, Number(e.target.value) || 60))}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
                    </label>
                  </div>
                  <button onClick={startNow} disabled={busy}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-50">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                    เปิดคลาสตอนนี้
                  </button>
                </>
              )}
            </div>

            <ScheduleSessionPanel courseId={course.id} courseCode={course.code} />

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
                        sessionId === s.id
                          ? 'gradient-primary text-primary-foreground shadow-elevated'
                          : 'bg-card text-muted-foreground shadow-card'
                      }`}>
                      {s.title ? `${s.title} · ` : ''}{fmtDateTime(s.started_at)}
                      {s.status === 'open' && ' · เปิดอยู่'}
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
                    <motion.div key={s.studentId} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i, 12) * 0.02 }}
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
                        <p className="text-[11px] text-muted-foreground">
                          {s.code ?? '-'}{s.checkedInAt ? ` · ${fmtDateTime(s.checkedInAt)}` : ''}
                        </p>
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
          </>
        )}

        {tab === 'assignments' && <AssignmentManagementPage embeddedCourseId={course.id} />}
        {tab === 'grades' && <GradeManagementPage embeddedCourseId={course.id} />}
      </div>
    </MobileLayout>
  );
};

export default CourseDetailPage;
