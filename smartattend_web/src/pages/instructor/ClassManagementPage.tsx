import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { fetchInstructorCourses } from '@/lib/attendance-data';
import { useState, useEffect, useCallback } from 'react';
import { Play, Square, XCircle, Clock, Users, CheckCircle, Settings, Timer, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

type ClassStatus = 'not_started' | 'active' | 'ended';

interface CourseItem {
  id: string;
  code: string;
  name: string;
  section: string | null;
  studentCount: number;
}

interface ClassSession {
  id: string;
  courseId: string;
  status: ClassStatus;
  startedAt?: Date;
  elapsed?: number;
  lateAfterMinutes: number;
}

const statusConfig: Record<ClassStatus, { labelTh: string; color: string; bg: string; icon: typeof Clock }> = {
  not_started: { labelTh: 'ยังไม่เริ่ม', color: 'text-muted-foreground', bg: 'bg-muted', icon: Clock },
  active: { labelTh: 'กำลังเรียน', color: 'text-success', bg: 'bg-success/10', icon: Play },
  ended: { labelTh: 'สิ้นสุดแล้ว', color: 'text-primary', bg: 'bg-primary-light', icon: CheckCircle },
};

const DEFAULT_LATE = 10;
const DEFAULT_DURATION = 60;

const ClassManagementPage = () => {
  const { user } = useAuth();
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<Record<string, ClassSession>>({});
  const [checkedCounts, setCheckedCounts] = useState<Record<string, number>>({});

  const [pendingLate, setPendingLate] = useState<Record<string, number>>({});

  const [settingsCourse, setSettingsCourse] = useState<string | null>(null);
  const [tempLate, setTempLate] = useState(DEFAULT_LATE);
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const cs = await fetchInstructorCourses(user.id);
    let studentCounts = new Map<string, number>();
    if (cs.length) {
      const { data: enrolls } = await supabase
        .from('course_enrollments')
        .select('course_id')
        .in('course_id', cs.map(c => c.id));
      (enrolls ?? []).forEach(e => studentCounts.set(e.course_id, (studentCounts.get(e.course_id) ?? 0) + 1));
    }
    const courseItems: CourseItem[] = cs.map(c => ({
      id: c.id, code: c.code, name: c.name, section: c.section, studentCount: studentCounts.get(c.id) ?? 0,
    }));
    setCourses(courseItems);

    if (courseItems.length) {
      const { data: openSessions } = await supabase
        .from('class_sessions')
        .select('id, course_id, status, started_at, late_after_minutes')
        .in('course_id', courseItems.map(c => c.id))
        .eq('status', 'open');

      const sMap: Record<string, ClassSession> = {};
      (openSessions ?? []).forEach(s => {
        sMap[s.course_id] = {
          id: s.id,
          courseId: s.course_id,
          status: 'active',
          startedAt: new Date(s.started_at),
          lateAfterMinutes: s.late_after_minutes,
        };
      });
      setSessions(sMap);

      const counts: Record<string, number> = {};
      for (const s of openSessions ?? []) {
        const { count } = await supabase
          .from('attendance_records')
          .select('id', { count: 'exact', head: true })
          .eq('session_id', s.id)
          .in('status', ['on_time', 'late', 'excused']);
        counts[s.course_id] = count ?? 0;
      }
      setCheckedCounts(counts);
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  // Timer for active classes
  useEffect(() => {
    const interval = setInterval(() => {
      setSessions(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(id => {
          if (next[id].status === 'active' && next[id].startedAt) {
            next[id] = { ...next[id], elapsed: Math.floor((Date.now() - next[id].startedAt!.getTime()) / 1000) };
          }
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const openSettings = (courseId: string) => {
    const existing = sessions[courseId];
    setTempLate(existing?.lateAfterMinutes ?? pendingLate[courseId] ?? DEFAULT_LATE);
    setSettingsCourse(courseId);
  };

  const saveGracePeriod = async () => {
    if (!settingsCourse) return;
    if (tempLate < 1) {
      toast.error('เวลาต้องมากกว่า 0 นาที');
      return;
    }
    const existing = sessions[settingsCourse];
    setSavingSettings(true);
    try {
      if (existing && existing.status === 'active') {
        const { error } = await supabase
          .from('class_sessions')
          .update({ late_after_minutes: tempLate })
          .eq('id', existing.id);
        if (error) throw error;
        setSessions(prev => ({ ...prev, [settingsCourse]: { ...prev[settingsCourse], lateAfterMinutes: tempLate } }));
      } else {
        setPendingLate(prev => ({ ...prev, [settingsCourse]: tempLate }));
      }
      toast.success('บันทึกช่วงผ่อนผันเรียบร้อย');
      setSettingsCourse(null);
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? 'บันทึกไม่สำเร็จ');
    } finally {
      setSavingSettings(false);
    }
  };

  const startClass = useCallback(async (courseId: string) => {
    try {
      const lateAfter = pendingLate[courseId] ?? DEFAULT_LATE;
      const { data, error } = await supabase.functions.invoke('start-class-session', {
        body: { course_id: courseId, late_after_minutes: lateAfter, duration_minutes: DEFAULT_DURATION },
      });
      if (error) throw error;
      if (!data?.session) throw new Error(data?.error ?? 'ไม่สามารถเริ่มคลาสได้');
      setSessions(prev => ({
        ...prev,
        [courseId]: {
          id: data.session.id,
          courseId,
          status: 'active',
          startedAt: new Date(data.session.started_at),
          elapsed: 0,
          lateAfterMinutes: data.session.late_after_minutes,
        },
      }));
      setCheckedCounts(prev => ({ ...prev, [courseId]: 0 }));
      toast.success('เริ่มคลาสเรียบร้อย — ระบบเช็คชื่อเปิดแล้ว');
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? 'เริ่มคลาสไม่สำเร็จ');
    }
  }, [pendingLate]);

  const endClass = useCallback(async (courseId: string) => {
    const session = sessions[courseId];
    if (!session) return;
    try {
      const { error } = await supabase
        .from('class_sessions')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('id', session.id);
      if (error) throw error;
      setSessions(prev => ({ ...prev, [courseId]: { ...prev[courseId], status: 'ended' } }));
      toast.success('ปิดคลาสเรียบร้อย — ระบบเช็คชื่อปิดแล้ว');
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? 'ปิดคลาสไม่สำเร็จ');
    }
  }, [sessions]);

  const cancelClass = useCallback((courseId: string) => {
    setSessions(prev => {
      const next = { ...prev };
      delete next[courseId];
      return next;
    });
    toast('ยกเลิกคลาสแล้ว', { icon: '⚠️' });
  }, []);

  const resetClass = useCallback((courseId: string) => {
    setSessions(prev => {
      const next = { ...prev };
      delete next[courseId];
      return next;
    });
  }, []);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <MobileLayout title="Class Management">
      <div className="px-4 py-4 space-y-4">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Active summary */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Active', count: Object.values(sessions).filter(s => s.status === 'active').length, color: 'text-success' },
                { label: 'Ended', count: Object.values(sessions).filter(s => s.status === 'ended').length, color: 'text-primary' },
                { label: 'Not Started', count: courses.length - Object.keys(sessions).length, color: 'text-muted-foreground' },
              ].map(s => (
                <div key={s.label} className="bg-card rounded-xl p-3 text-center shadow-card">
                  <p className={`text-xl font-bold font-display ${s.color}`}>{s.count}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>

            {courses.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-10">ยังไม่มีรายวิชา</p>
            )}

            {/* Course Cards */}
            <div className="space-y-3">
              {courses.map((course, i) => {
                const session = sessions[course.id];
                const status: ClassStatus = session?.status ?? 'not_started';
                const config = statusConfig[status];
                const Icon = config.icon;
                const studentCount = course.studentCount;
                const checkedCount = checkedCounts[course.id] ?? 0;
                const lateAfter = session?.lateAfterMinutes ?? pendingLate[course.id] ?? DEFAULT_LATE;

                return (
                  <motion.div key={course.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                    className="bg-card rounded-xl shadow-card overflow-hidden"
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-sm font-bold text-foreground">{course.code}</p>
                          <p className="text-xs text-muted-foreground">{course.name}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Section {course.section ?? '-'}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => openSettings(course.id)}
                            className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center hover:bg-primary-light transition-colors"
                            title="ตั้งค่าช่วงผ่อนผัน"
                          >
                            <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                          <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold ${config.bg} ${config.color}`}>
                            <Icon className="w-3 h-3" />
                            {config.labelTh}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 mb-3 text-[10px] text-muted-foreground">
                        <Timer className="w-3 h-3" />
                        <span>ช่วงผ่อนผัน: สาย ≤ {lateAfter} นาที</span>
                      </div>

                      <AnimatePresence>
                        {status === 'active' && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                            className="mb-3"
                          >
                            <div className="bg-success/5 border border-success/20 rounded-xl p-3 text-center">
                              <p className="text-[10px] text-success font-medium mb-1">Class Duration</p>
                              <p className="text-2xl font-bold font-display text-success tracking-wider">
                                {formatTime(session?.elapsed || 0)}
                              </p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {status === 'active' && (
                        <div className="flex gap-2 mb-3">
                          <div className="flex-1 bg-muted rounded-lg p-2 text-center">
                            <p className="text-sm font-bold text-success">{checkedCount}</p>
                            <p className="text-[9px] text-muted-foreground">Checked-in</p>
                          </div>
                          <div className="flex-1 bg-muted rounded-lg p-2 text-center">
                            <p className="text-sm font-bold text-destructive">{Math.max(studentCount - checkedCount, 0)}</p>
                            <p className="text-[9px] text-muted-foreground">Remaining</p>
                          </div>
                          <div className="flex-1 bg-muted rounded-lg p-2 text-center">
                            <p className="text-sm font-bold text-foreground">{studentCount}</p>
                            <p className="text-[9px] text-muted-foreground">Total</p>
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2">
                        {status === 'not_started' && (
                          <>
                            <button onClick={() => startClass(course.id)}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold shadow-elevated"
                            >
                              <Play className="w-4 h-4" /> Start Class
                            </button>
                            <button onClick={() => cancelClass(course.id)}
                              className="flex items-center justify-center gap-1 px-4 py-2.5 rounded-xl bg-destructive/10 text-destructive text-xs font-semibold"
                            >
                              <XCircle className="w-4 h-4" /> Cancel
                            </button>
                          </>
                        )}
                        {status === 'active' && (
                          <button onClick={() => endClass(course.id)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold shadow-elevated"
                          >
                            <Square className="w-4 h-4" /> End Class
                          </button>
                        )}
                        {status === 'ended' && (
                          <button onClick={() => resetClass(course.id)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-muted text-muted-foreground text-xs font-semibold"
                          >
                            <Clock className="w-4 h-4" /> Reset
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Grace Period Settings Modal */}
      <AnimatePresence>
        {settingsCourse && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-foreground/40 backdrop-blur-sm z-50 flex items-end justify-center"
            onClick={() => setSettingsCourse(null)}
          >
            <motion.div
              initial={{ y: 300 }} animate={{ y: 0 }} exit={{ y: 300 }}
              transition={{ type: 'spring', damping: 25 }}
              className="w-full max-w-lg bg-card rounded-t-2xl p-6 space-y-5"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-2">
                <Timer className="w-5 h-5 text-primary" />
                <h3 className="text-base font-bold font-display text-foreground">ตั้งค่าช่วงผ่อนผัน (Grace Period)</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                {courses.find(c => c.id === settingsCourse)?.code} — {courses.find(c => c.id === settingsCourse)?.name}
              </p>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1.5">
                    เวลาเริ่มนับ "สาย" (นาที หลังเริ่มเรียน)
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={30}
                      value={tempLate}
                      onChange={e => setTempLate(Number(e.target.value))}
                      className="flex-1 accent-warning"
                    />
                    <span className="text-sm font-bold text-warning w-12 text-right">{tempLate} นาที</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">เช็คชื่อหลังจากนี้จะถูกบันทึกเป็น "สาย"</p>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={saveGracePeriod}
                  disabled={savingSettings}
                  className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shadow-elevated disabled:opacity-50"
                >
                  {savingSettings ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button
                  onClick={() => setSettingsCourse(null)}
                  className="px-6 py-3 rounded-xl bg-muted text-muted-foreground text-sm font-semibold"
                >
                  ยกเลิก
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </MobileLayout>
  );
};

export default ClassManagementPage;
