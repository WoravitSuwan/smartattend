import { useEffect, useState, useCallback, useMemo } from 'react';
import MobileLayout from '@/components/MobileLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { Loader2, PlayCircle, StopCircle, Users, Clock, AlarmClock } from 'lucide-react';
import { toast } from 'sonner';

interface Course { id: string; code: string; name: string; section: string | null; }
interface Session {
  id: string; course_id: string; status: string;
  started_at: string; closed_at: string | null;
  late_after_minutes: number; planned_end_time: string | null;
}
interface Record {
  id: string;
  session_id: string;
  student_id: string;
  photo_data_url: string | null;
  confidence: number | null;
  checked_in_at: string | null;
  status: 'on_time' | 'late' | 'absent';
  student_name?: string | null;
  student_code?: string | null;
}

const DURATION_OPTIONS = [50, 60, 90, 120, 180];

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function formatCountdown(ms: number): string {
  const abs = Math.abs(ms);
  const totalSec = Math.floor(abs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h} ชม. ${m} นาที`;
  if (m > 0) return `${m} นาที ${s.toString().padStart(2, '0')} วิ`;
  return `${s} วิ`;
}

export default function StartClassTestPage() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(false);
  const [lateAfter, setLateAfter] = useState<number>(15);
  const [durationMin, setDurationMin] = useState<number>(60);
  const now = useNow(1000);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from('courses')
        .select('id, code, name, section')
        .eq('instructor_id', user.id)
        .order('code');
      setCourses(data ?? []);
      if (data?.[0]) setSelectedCourse(data[0].id);

      const { data: open } = await supabase
        .from('class_sessions')
        .select('*')
        .eq('instructor_id', user.id)
        .eq('status', 'open')
        .order('started_at', { ascending: false })
        .limit(1);
      if (open?.[0]) setActiveSession(open[0] as Session);
    })();
  }, [user?.id]);

  const loadRecords = useCallback(async (sessionId: string) => {
    const { data } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('session_id', sessionId)
      .order('checked_in_at', { ascending: true });
    const rows = (data ?? []) as Record[];
    if (rows.length) {
      const ids = Array.from(new Set(rows.map(r => r.student_id)));
      const { data: profs } = await supabase.from('profiles').select('user_id, name, student_code').in('user_id', ids);
      const map = new Map((profs ?? []).map(p => [p.user_id, p]));
      rows.forEach(r => {
        const p = map.get(r.student_id);
        r.student_name = p?.name ?? null;
        r.student_code = p?.student_code ?? null;
      });
    }
    setRecords(rows);
  }, []);

  useEffect(() => {
    if (!activeSession) { setRecords([]); return; }
    loadRecords(activeSession.id);
    const ch = supabase
      .channel(`att-${activeSession.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance_records', filter: `session_id=eq.${activeSession.id}` },
        () => loadRecords(activeSession.id),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeSession, loadRecords]);

  const startClass = async () => {
    if (!user?.id || !selectedCourse) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('start-class-session', {
        body: {
          course_id: selectedCourse,
          late_after_minutes: lateAfter,
          duration_minutes: durationMin,
        },
      });
      if (error) throw error;
      if (!data?.session) throw new Error(data?.error ?? 'ไม่สามารถเริ่มคลาสได้');
      setActiveSession(data.session as Session);
      const course = courses.find(c => c.id === selectedCourse);
      toast.success(`เริ่มคลาส ${course?.code ?? ''} แล้ว — แจ้งนักศึกษา ${data.notified_count ?? 0} คน`);
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? 'ไม่สามารถเริ่มคลาสได้');
    } finally { setLoading(false); }
  };

  const closeClass = async () => {
    if (!activeSession) return;
    setLoading(true);
    try {
      // 1. Confirmed students of this course
      const { data: enrolled } = await supabase
        .from('course_enrollments')
        .select('student_id')
        .eq('course_id', activeSession.course_id)
        .eq('status', 'confirmed')
        .not('student_id', 'is', null);

      // 2. Who already has a record for this session
      const { data: existing } = await supabase
        .from('attendance_records')
        .select('student_id')
        .eq('session_id', activeSession.id);

      const present = new Set((existing ?? []).map(r => r.student_id));
      const absentRows = (enrolled ?? [])
        .map(e => e.student_id as string)
        .filter(id => id && !present.has(id))
        .map(id => ({
          session_id: activeSession.id,
          student_id: id,
          status: 'absent',
          checked_in_at: null,
          photo_data_url: null,
          confidence: 0,
        }));

      let absentCount = 0;
      if (absentRows.length > 0) {
        const { error: absErr } = await supabase.from('attendance_records').insert(absentRows);
        if (absErr) throw absErr;
        absentCount = absentRows.length;
      }

      const { error: upErr } = await supabase
        .from('class_sessions')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('id', activeSession.id);
      if (upErr) throw upErr;

      setActiveSession(null);
      setRecords([]);
      toast.success(
        absentCount > 0
          ? `ปิดคลาสแล้ว — บันทึกขาดเรียน ${absentCount} คน`
          : 'ปิดคลาสแล้ว — ไม่มีนักศึกษาขาดเรียน',
      );
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? 'ปิดคลาสไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const activeCourse = courses.find(c => c.id === activeSession?.course_id);
  const startedAtDate = activeSession ? new Date(activeSession.started_at) : null;
  const lateThreshold = useMemo(() => {
    if (!startedAtDate || !activeSession) return null;
    return new Date(startedAtDate.getTime() + activeSession.late_after_minutes * 60_000);
  }, [startedAtDate, activeSession]);
  const plannedEnd = activeSession?.planned_end_time ? new Date(activeSession.planned_end_time) : null;
  const remainingMs = plannedEnd ? plannedEnd.getTime() - now.getTime() : 0;
  const overtime = plannedEnd ? now.getTime() > plannedEnd.getTime() : false;

  return (
    <MobileLayout title="เช็คชื่อเข้าเรียน">
      <div className="p-4 space-y-4">
        <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground">เริ่มคาบเรียน</h2>
            <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {now.toLocaleTimeString('th-TH')}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            เปิดคาบเรียนแล้วให้นักศึกษาไปสแกนใบหน้าที่กล้อง Raspberry Pi หน้าห้องเรียนเท่านั้น
          </p>
          <select
            value={selectedCourse}
            onChange={(e) => setSelectedCourse(e.target.value)}
            disabled={!!activeSession || loading}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          >
            {courses.length === 0 && <option value="">— ไม่มีวิชาที่คุณสอน —</option>}
            {courses.map(c => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}{c.section ? ` (ตอน ${c.section})` : ''}
              </option>
            ))}
          </select>

          {!activeSession && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">สายหลังจาก (นาที)</span>
                <input
                  type="number" min={1} max={120} value={lateAfter}
                  onChange={(e) => setLateAfter(Math.max(1, Number(e.target.value) || 15))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">ระยะเวลาคาบ</span>
                <select
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                >
                  {DURATION_OPTIONS.map(m => (
                    <option key={m} value={m}>{m} นาที</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {!activeSession ? (
            <button
              onClick={startClass}
              disabled={loading || !selectedCourse}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
              เริ่มคลาส
            </button>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">เริ่มเมื่อ</span>
                  <span className="font-medium">{startedAtDate?.toLocaleTimeString('th-TH')}</span>
                </div>
                {lateThreshold && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">เกิน {activeSession.late_after_minutes} นาที = สาย</span>
                    <span className="font-medium">{lateThreshold.toLocaleTimeString('th-TH')}</span>
                  </div>
                )}
                {plannedEnd && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">เลิกคาบ</span>
                    <span className="font-medium">{plannedEnd.toLocaleTimeString('th-TH')}</span>
                  </div>
                )}
                {plannedEnd && (
                  overtime ? (
                    <div className="flex items-center gap-2 mt-1 px-2 py-1.5 rounded-md bg-destructive/15 text-destructive font-semibold">
                      <AlarmClock className="w-3.5 h-3.5" />
                      หมดเวลาคาบแล้ว — กรุณากดปิดคลาส (เกิน {formatCountdown(-remainingMs)})
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-1 px-2 py-1.5 rounded-md bg-primary/10 text-primary font-semibold">
                      <Clock className="w-3.5 h-3.5" />
                      เหลืออีก {formatCountdown(remainingMs)}
                    </div>
                  )
                )}
              </div>
              <button
                onClick={closeClass}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-destructive text-destructive-foreground font-semibold disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <StopCircle className="w-4 h-4" />}
                ปิดคลาส
              </button>
            </>
          )}
        </div>

        {activeSession && (
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-foreground">
                คลาสสด — {activeCourse?.code} ({records.length} คน)
              </h3>
            </div>
            {records.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">
                ยังไม่มีนักศึกษาเช็คชื่อ...
              </p>
            ) : (
              <div className="space-y-2">
                {records.map(r => {
                  const badge = r.status === 'absent'
                    ? { label: 'ขาดเรียน', cls: 'bg-destructive/15 text-destructive' }
                    : r.status === 'late'
                      ? { label: 'มาสาย', cls: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400' }
                      : { label: 'ตรงเวลา', cls: 'bg-green-500/15 text-green-700 dark:text-green-400' };
                  return (
                    <div key={r.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
                      {r.photo_data_url ? (
                        <img src={r.photo_data_url} alt="face" className="w-12 h-12 rounded-lg object-cover" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                          ไม่มีรูป
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {r.student_name ?? r.student_id}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {r.student_code ?? ''}
                          {r.checked_in_at ? ` • ${new Date(r.checked_in_at).toLocaleTimeString('th-TH')}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge.cls}`}>
                          {badge.label}
                        </span>
                        {r.confidence != null && r.status !== 'absent' && (
                          <div className="text-xs font-semibold text-primary">
                            {(Number(r.confidence) * 100).toFixed(1)}%
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </MobileLayout>
  );
}
