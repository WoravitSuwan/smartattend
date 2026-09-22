import { motion } from 'framer-motion';
import { BookOpen, Clock, CheckCircle, AlertCircle, ClipboardList, BarChart3, GraduationCap, ScanFace, Camera } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import MobileLayout from '@/components/MobileLayout';
import RegistrationStatusCard from '@/components/RegistrationStatusCard';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  AttendanceRow, SummaryRow, fetchMyAttendance, fetchSummary, fetchEnrolledCourses,
  statusClass, statusLabel, fmtDateTime,
} from '@/lib/attendance-data';

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.35 } }),
};

interface CourseItem { id: string; code: string; name: string; section?: string | null }

const StudentDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [recent, setRecent] = useState<AttendanceRow[]>([]);
  const [openSession, setOpenSession] = useState<{ id: string; code: string } | null>(null);

  const loadAttendance = useCallback(async () => {
    if (!user?.id) return;
    const [s, r] = await Promise.all([fetchSummary({ studentId: user.id }), fetchMyAttendance(user.id)]);
    setSummary(s);
    setRecent(r.slice(0, 5));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const cs = await fetchEnrolledCourses(user.id);
      setCourses(cs);
      const ids = cs.map((c: CourseItem) => c.id);
      if (ids.length) {
        const { data } = await supabase
          .from('class_sessions')
          .select('id, course_id, started_at')
          .in('course_id', ids)
          .eq('status', 'open')
          .order('started_at', { ascending: false })
          .limit(1);
        const s = data?.[0];
        if (s) setOpenSession({ id: s.id, code: cs.find((c: CourseItem) => c.id === s.course_id)?.code ?? '' });
        else setOpenSession(null);
      }
    })();
    loadAttendance();

    const channel = supabase
      .channel(`student-att-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records', filter: `student_id=eq.${user.id}` },
        () => loadAttendance())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, loadAttendance]);

  const onTime = summary.reduce((a, b) => a + Number(b.on_time_count), 0);
  const late = summary.reduce((a, b) => a + Number(b.late_count), 0);
  const absent = summary.reduce((a, b) => a + Number(b.absent_count), 0);

  return (
    <MobileLayout>
      <div className="px-4 py-4 space-y-5">
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="gradient-hero rounded-2xl p-5 shadow-float">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm text-primary-foreground/70">สถานะวันนี้</p>
              <p className="text-xl font-bold text-primary-foreground font-display mt-1">
                {openSession ? `มีคาบเรียนเปิดอยู่ ${openSession.code}` : 'ไม่มีคาบเรียน'}
              </p>
              {openSession && (
                <p className="mt-3 px-4 py-2 rounded-xl bg-primary-foreground/20 text-primary-foreground text-xs font-semibold w-fit">
                  ไปสแกนใบหน้าที่กล้องหน้าห้องเรียนได้เลย
                </p>
              )}
            </div>
            <div className="w-14 h-14 rounded-full bg-primary-foreground/20 flex items-center justify-center shrink-0">
              <Camera className="w-7 h-7 text-primary-foreground" />
            </div>
          </div>
        </motion.div>

        <RegistrationStatusCard />

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'ตรงเวลา', value: onTime, icon: CheckCircle, color: 'text-success' },
            { label: 'มาสาย', value: late, icon: Clock, color: 'text-warning' },
            { label: 'ขาดเรียน', value: absent, icon: AlertCircle, color: 'text-destructive' },
          ].map((stat, i) => (
            <motion.div key={stat.label} custom={i} variants={fadeUp} initial="hidden" animate="show"
              className="bg-card rounded-xl p-3 text-center shadow-card">
              <stat.icon className={`w-5 h-5 mx-auto ${stat.color} mb-1`} />
              <p className="text-lg font-bold font-display text-foreground">{stat.value}</p>
              <p className="text-[10px] text-muted-foreground">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">ทางลัด</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'ลงทะเบียนใบหน้า', icon: ScanFace, path: '/student/face-register', color: 'text-accent bg-accent/10' },
              { label: 'ประวัติเข้าเรียน', icon: ClipboardList, path: '/student/history', color: 'text-primary bg-primary-light' },
              { label: 'คะแนนเก็บ', icon: GraduationCap, path: '/student/grades', color: 'text-success bg-success/10' },
              { label: 'สถิติ', icon: BarChart3, path: '/student/analytics', color: 'text-secondary bg-secondary/10' },
            ].map((action, i) => (
              <motion.button key={action.label} custom={i} variants={fadeUp} initial="hidden" animate="show"
                onClick={() => navigate(action.path)}
                className="bg-card rounded-xl p-4 flex items-center gap-3 shadow-card hover:shadow-elevated transition-shadow text-left">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${action.color}`}>
                  <action.icon className="w-5 h-5" />
                </div>
                <span className="text-xs font-medium text-foreground">{action.label}</span>
              </motion.button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">รายวิชาของฉัน</h2>
            <button onClick={() => navigate('/student/courses')} className="text-xs text-primary font-medium">ดูทั้งหมด</button>
          </div>
          <div className="space-y-2">
            {courses.map((course, i) => (
              <motion.div key={course.id} custom={i} variants={fadeUp} initial="hidden" animate="show"
                className="bg-card rounded-xl p-4 flex items-center gap-3 shadow-card">
                <div className="w-10 h-10 rounded-lg gradient-primary flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-primary-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{course.code} - {course.name}</p>
                  {course.section && <p className="text-xs text-muted-foreground">ตอน {course.section}</p>}
                </div>
              </motion.div>
            ))}
            {courses.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">ยังไม่มีรายวิชาที่ลงทะเบียน</p>}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">การเช็คชื่อล่าสุด</h2>
            <button onClick={() => navigate('/student/history')} className="text-xs text-primary font-medium">ดูทั้งหมด</button>
          </div>
          <div className="space-y-2">
            {recent.map((r, i) => (
              <motion.div key={r.id} custom={i} variants={fadeUp} initial="hidden" animate="show"
                className="bg-card rounded-xl p-3 flex items-center gap-3 shadow-card">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${statusClass[r.status]}`}>
                  {r.status === 'on_time' ? <CheckCircle className="w-4 h-4" /> : r.status === 'late' ? <Clock className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{r.courseCode} - {r.courseName}</p>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(r.checkedInAt)}</p>
                </div>
                {r.photo && <img src={r.photo} alt="ภาพหลักฐาน" className="w-8 h-8 rounded-lg object-cover border border-border" />}
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${statusClass[r.status]}`}>{statusLabel[r.status]}</span>
              </motion.div>
            ))}
            {recent.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">ยังไม่มีการเช็คชื่อ</p>}
          </div>
        </div>
      </div>
    </MobileLayout>
  );
};

export default StudentDashboard;
