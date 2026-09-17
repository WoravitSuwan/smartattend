import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { motion } from 'framer-motion';
import { CheckCircle, Clock, AlertCircle, Pencil, Users } from 'lucide-react';
import { AttendanceRow, fetchInstructorCourses, fetchSessionAttendance, statusClass, statusLabel, fmtDateTime } from '@/lib/attendance-data';

interface SessionRow { id: string; started_at: string; status: string; closed_at: string | null; course_id: string }

const InstructorAttendancePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [courses, setCourses] = useState<{ id: string; code: string; name: string }[]>([]);
  const [courseId, setCourseId] = useState('');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionId, setSessionId] = useState(params.get('session') ?? '');
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    fetchInstructorCourses(user.id).then(cs => {
      setCourses(cs);
      if (!params.get('session')) setCourseId(prev => prev || cs[0]?.id || '');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // resolve course from deep-linked session
  useEffect(() => {
    const s = params.get('session');
    if (!s) return;
    (async () => {
      const { data } = await supabase.from('class_sessions').select('course_id').eq('id', s).maybeSingle();
      if (data?.course_id) setCourseId(data.course_id);
      setSessionId(s);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!courseId) { setSessions([]); return; }
    (async () => {
      const { data } = await supabase
        .from('class_sessions')
        .select('id, started_at, status, closed_at, course_id')
        .eq('course_id', courseId)
        .order('started_at', { ascending: false });
      const list = (data ?? []) as SessionRow[];
      setSessions(list);
      setSessionId(prev => (prev && list.some(s => s.id === prev) ? prev : list[0]?.id ?? ''));
    })();
  }, [courseId]);

  useEffect(() => {
    if (!sessionId) { setRows([]); return; }
    let cancelled = false;
    setLoading(true);
    fetchSessionAttendance(sessionId).then(r => { if (!cancelled) { setRows(r); setLoading(false); } });

    const channel = supabase
      .channel(`att-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records', filter: `session_id=eq.${sessionId}` },
        () => { fetchSessionAttendance(sessionId).then(r => setRows(r)); })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [sessionId]);

  const summary = useMemo(() => ({
    onTime: rows.filter(r => r.status === 'on_time').length,
    late: rows.filter(r => r.status === 'late').length,
    absent: rows.filter(r => r.status === 'absent').length,
  }), [rows]);

  const [names, setNames] = useState<Record<string, { name: string; code: string | null }>>({});
  useEffect(() => {
    const ids = rows.map(r => r.studentId);
    if (!ids.length) return;
    (async () => {
      const { data } = await supabase.from('profiles').select('user_id, name, student_code').in('user_id', ids);
      const map: Record<string, { name: string; code: string | null }> = {};
      (data ?? []).forEach(p => { map[p.user_id] = { name: p.name, code: p.student_code }; });
      setNames(map);
    })();
  }, [rows]);

  return (
    <MobileLayout title="การเข้าเรียน">
      <div className="px-4 py-4 space-y-4">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {courses.map(c => (
            <button key={c.id} onClick={() => { setCourseId(c.id); setParams({}); }}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-medium transition-all ${courseId === c.id ? 'gradient-primary text-primary-foreground shadow-elevated' : 'bg-card text-muted-foreground shadow-card'}`}>
              {c.code}
            </button>
          ))}
        </div>
        {courses.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">ยังไม่มีรายวิชา</p>}

        {sessions.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">คาบเรียน</p>
            <div className="space-y-2">
              {sessions.map(s => (
                <button key={s.id} onClick={() => setSessionId(s.id)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-all ${sessionId === s.id ? 'bg-primary/10 border border-primary text-foreground' : 'bg-card shadow-card text-muted-foreground'}`}>
                  <span>{fmtDateTime(s.started_at)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.status === 'open' ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'}`}>
                    {s.status === 'open' ? 'เปิดอยู่' : 'ปิดแล้ว'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {courseId && sessions.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">ยังไม่เคยเปิดคาบเรียนในวิชานี้</p>}

        {sessionId && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'ตรงเวลา', value: summary.onTime, color: 'text-success' },
                { label: 'มาสาย', value: summary.late, color: 'text-warning' },
                { label: 'ขาดเรียน', value: summary.absent, color: 'text-destructive' },
              ].map(s => (
                <div key={s.label} className="bg-card rounded-xl p-3 text-center shadow-card">
                  <p className={`text-xl font-bold font-display ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Users className="w-3 h-3" /> ผู้เข้าเรียน ({rows.length})
              </p>
              <button onClick={() => navigate(`/instructor/attendance/edit?session=${sessionId}`)} className="text-xs text-primary font-medium">
                แก้ไขสถานะ
              </button>
            </div>

            {loading && <p className="text-xs text-muted-foreground text-center py-4">กำลังโหลด...</p>}
            <div className="space-y-2">
              {rows.map((r, i) => (
                <motion.div key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }}
                  className="bg-card rounded-xl p-3 flex items-center gap-3 shadow-card">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${statusClass[r.status]}`}>
                    {r.status === 'on_time' ? <CheckCircle className="w-4 h-4" /> : r.status === 'late' ? <Clock className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{names[r.studentId]?.name ?? 'นักศึกษา'}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {names[r.studentId]?.code ?? '-'} · {fmtDateTime(r.checkedInAt)}
                      {r.confidence != null ? ` · ${Math.round(Number(r.confidence) * 100)}%` : ''}
                    </p>
                    {r.editedAt && (
                      <p className="text-[10px] text-warning flex items-center gap-1" title={`แก้ไขโดยอาจารย์: ${r.editReason ?? '-'}`}>
                        <Pencil className="w-3 h-3" /> ถูกแก้ไข
                      </p>
                    )}
                  </div>
                  {r.photo && (
                    <button onClick={() => setZoom(r.photo)} className="w-9 h-9 rounded-lg overflow-hidden border border-border shrink-0">
                      <img src={r.photo} alt="ภาพหลักฐาน" className="w-full h-full object-cover" />
                    </button>
                  )}
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${statusClass[r.status]}`}>{statusLabel[r.status]}</span>
                </motion.div>
              ))}
            </div>
            {!loading && rows.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">ยังไม่มีผู้เช็คชื่อในคาบนี้</p>}
          </>
        )}
      </div>

      {zoom && (
        <div className="fixed inset-0 z-50 bg-foreground/70 flex items-center justify-center p-6" onClick={() => setZoom(null)}>
          <img src={zoom} alt="ภาพหลักฐานขยาย" className="max-w-full max-h-full rounded-2xl" />
        </div>
      )}
    </MobileLayout>
  );
};

export default InstructorAttendancePage;
