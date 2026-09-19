import { motion } from 'framer-motion';
import { BookOpen, Users, TrendingUp, AlertTriangle, ClipboardList, GraduationCap, FileText, PlusCircle, CalendarOff, ScanFace, Radio, PlayCircle, Upload, Download } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import MobileLayout from '@/components/MobileLayout';
import { useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SummaryRow, fetchInstructorCourses, fetchSummary, fmtDateTime } from '@/lib/attendance-data';

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.35 } }),
};

interface CourseItem { id: string; code: string; name: string }
interface OpenSession { id: string; courseCode: string; startedAt: string; checked: number; total: number }
interface AtRisk { studentId: string; name: string; code: string | null; courseCode: string; rate: number }

const InstructorDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [totalStudents, setTotalStudents] = useState(0);
  const [openSessions, setOpenSessions] = useState<OpenSession[]>([]);
  const [courseRates, setCourseRates] = useState<{ code: string; rate: number }[]>([]);
  const [atRisk, setAtRisk] = useState<AtRisk[]>([]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const cs = await fetchInstructorCourses(user.id);
    setCourses(cs);
    const ids = cs.map(c => c.id);
    if (!ids.length) return;

    const { data: enrolls } = await supabase
      .from('course_enrollments')
      .select('course_id, student_id')
      .in('course_id', ids)
      .eq('status', 'confirmed');
    setTotalStudents((enrolls ?? []).length);

    const { data: sessions } = await supabase
      .from('class_sessions')
      .select('id, course_id, started_at')
      .in('course_id', ids)
      .eq('status', 'open')
      .order('started_at', { ascending: false });

    const open: OpenSession[] = [];
    for (const s of sessions ?? []) {
      const { count } = await supabase.from('attendance_records')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', s.id).neq('status', 'absent');
      open.push({
        id: s.id,
        courseCode: cs.find(c => c.id === s.course_id)?.code ?? '',
        startedAt: s.started_at,
        checked: count ?? 0,
        total: (enrolls ?? []).filter(e => e.course_id === s.course_id).length,
      });
    }
    setOpenSessions(open);

    const summaries: SummaryRow[] = [];
    for (const id of ids) summaries.push(...await fetchSummary({ courseId: id }));

    const byCourse = new Map<string, { sum: number; n: number }>();
    summaries.forEach(s => {
      const agg = byCourse.get(s.course_code) ?? { sum: 0, n: 0 };
      agg.sum += Number(s.attendance_rate ?? 0); agg.n += 1;
      byCourse.set(s.course_code, agg);
    });
    setCourseRates(Array.from(byCourse, ([code, a]) => ({ code, rate: Math.round(a.sum / a.n) })));

    const risky = summaries.filter(s => Number(s.attendance_rate ?? 100) < 80);
    if (risky.length) {
      const { data: profs } = await supabase.from('profiles').select('user_id, name, student_code')
        .in('user_id', risky.map(r => r.student_id));
      const map = new Map((profs ?? []).map(p => [p.user_id, p]));
      setAtRisk(risky.map(r => ({
        studentId: r.student_id,
        name: map.get(r.student_id)?.name ?? 'นักศึกษา',
        code: map.get(r.student_id)?.student_code ?? null,
        courseCode: r.course_code,
        rate: Number(r.attendance_rate ?? 0),
      })).sort((a, b) => a.rate - b.rate));
    } else setAtRisk([]);
  }, [user?.id]);

  useEffect(() => {
    load();
    if (!user?.id) return;
    const channel = supabase
      .channel(`instructor-att-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, load]);

  return (
    <MobileLayout>
      <div className="px-4 py-4 space-y-5">
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'นักศึกษาทั้งหมด', value: totalStudents, icon: Users, color: 'text-primary' },
            { label: 'รายวิชาที่สอน', value: courses.length, icon: BookOpen, color: 'text-secondary' },
          ].map((stat, i) => (
            <motion.div key={stat.label} custom={i} variants={fadeUp} initial="hidden" animate="show" className="bg-card rounded-xl p-4 shadow-card">
              <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
              <p className="text-2xl font-bold font-display text-foreground">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        {openSessions.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1">
              <Radio className="w-3 h-3 text-success" /> คาบเรียนที่เปิดอยู่
            </h2>
            <div className="space-y-2">
              {openSessions.map(s => (
                <button key={s.id} onClick={() => navigate(`/instructor/attendance?session=${s.id}`)}
                  className="w-full bg-card rounded-xl p-3 flex items-center justify-between shadow-card text-left">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{s.courseCode}</p>
                    <p className="text-[11px] text-muted-foreground">เริ่ม {fmtDateTime(s.startedAt)}</p>
                  </div>
                  <span className="text-xs font-bold text-primary">{s.checked}/{s.total} เช็คชื่อแล้ว</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {courseRates.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> อัตราการเข้าเรียนเฉลี่ย
            </h2>
            <div className="space-y-2">
              {courseRates.map(c => (
                <div key={c.code} className="bg-card rounded-xl p-3 flex items-center justify-between shadow-card">
                  <p className="text-sm font-medium text-foreground">{c.code}</p>
                  <p className="text-sm font-bold text-primary">{c.rate}%</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-warning" /> นักศึกษากลุ่มเสี่ยง (ต่ำกว่า 80%)
          </h2>
          <div className="space-y-2">
            {atRisk.map(s => (
              <div key={`${s.studentId}-${s.courseCode}`} className="bg-card rounded-xl p-3 flex items-center gap-3 shadow-card">
                <div className="w-8 h-8 rounded-full bg-warning/20 flex items-center justify-center text-[10px] font-bold text-warning">
                  {s.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">{s.code ?? '-'} · {s.courseCode}</p>
                </div>
                <span className="text-xs font-bold text-destructive">{s.rate}%</span>
              </div>
            ))}
            {atRisk.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">ไม่มีนักศึกษากลุ่มเสี่ยง</p>}
          </div>
        </div>

        {[
          {
            group: 'การเรียนการสอน',
            items: [
              { label: 'เปิดคลาส', icon: PlayCircle, path: '/instructor/class-test' },
              { label: 'เช็คชื่อ', icon: ClipboardList, path: '/instructor/attendance' },
              { label: 'รายชื่อในวิชา', icon: Users, path: '/instructor/roster' },
              { label: 'Import รายชื่อ', icon: Upload, path: '/instructor/import-roster' },
            ],
          },
          {
            group: 'งานและคะแนน',
            items: [
              { label: 'สร้างงาน', icon: PlusCircle, path: '/instructor/assignments' },
              { label: 'เกรด', icon: GraduationCap, path: '/instructor/grades' },
              { label: 'Export คะแนน', icon: Download, path: '/instructor/export' },
            ],
          },
          {
            group: 'อื่น ๆ',
            items: [
              { label: 'รายงาน', icon: FileText, path: '/instructor/reports' },
              { label: 'ใบลา', icon: CalendarOff, path: '/instructor/leaves' },
              { label: 'สถานะใบหน้า', icon: ScanFace, path: '/instructor/face-status' },
            ],
          },
        ].map((section) => (
          <div key={section.group}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{section.group}</h2>
            <div className="grid grid-cols-2 gap-3">
              {section.items.map((a, i) => (
                <motion.button key={a.label} custom={i} variants={fadeUp} initial="hidden" animate="show"
                  onClick={() => navigate(a.path)}
                  className="bg-card rounded-xl p-4 flex items-center gap-3 shadow-card text-left">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <a.icon className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-medium text-foreground">{a.label}</span>
                </motion.button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </MobileLayout>
  );
};

export default InstructorDashboard;
