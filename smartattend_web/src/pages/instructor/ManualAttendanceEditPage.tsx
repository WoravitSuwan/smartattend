import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { logAudit } from '@/lib/audit-log';
import { AttendanceRow, AttStatus, fetchInstructorCourses, fetchSessionAttendance, statusLabel, fmtDateTime } from '@/lib/attendance-data';

interface SessionRow { id: string; started_at: string; course_id: string }

const OPTIONS: AttStatus[] = ['on_time', 'late', 'absent'];

const ManualAttendanceEditPage = () => {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [courses, setCourses] = useState<{ id: string; code: string; name: string }[]>([]);
  const [courseId, setCourseId] = useState('');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionId, setSessionId] = useState(params.get('session') ?? '');
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [names, setNames] = useState<Record<string, { name: string; code: string | null }>>({});
  const [edits, setEdits] = useState<Record<string, AttStatus>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    fetchInstructorCourses(user.id).then(cs => {
      setCourses(cs);
      if (!params.get('session')) setCourseId(p => p || cs[0]?.id || '');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const s = params.get('session');
    if (!s) return;
    supabase.from('class_sessions').select('course_id').eq('id', s).maybeSingle()
      .then(({ data }) => { if (data?.course_id) setCourseId(data.course_id); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!courseId) return;
    supabase.from('class_sessions').select('id, started_at, course_id').eq('course_id', courseId)
      .order('started_at', { ascending: false })
      .then(({ data }) => {
        const list = (data ?? []) as SessionRow[];
        setSessions(list);
        setSessionId(prev => (prev && list.some(s => s.id === prev) ? prev : list[0]?.id ?? ''));
      });
  }, [courseId]);

  const reload = async (sid: string) => {
    const r = await fetchSessionAttendance(sid);
    setRows(r);
    setEdits({});
    const ids = r.map(x => x.studentId);
    if (ids.length) {
      const { data } = await supabase.from('profiles').select('user_id, name, student_code').in('user_id', ids);
      const map: Record<string, { name: string; code: string | null }> = {};
      (data ?? []).forEach(p => { map[p.user_id] = { name: p.name, code: p.student_code }; });
      setNames(map);
    }
  };

  useEffect(() => { if (sessionId) reload(sessionId); }, [sessionId]);

  const handleSave = async () => {
    const changed = rows.filter(r => edits[r.id] && edits[r.id] !== r.status);
    if (!changed.length) { toast.error('ยังไม่มีการเปลี่ยนแปลง'); return; }
    if (!reason.trim()) { toast.error('กรุณากรอกเหตุผลในการแก้ไข'); return; }
    setSaving(true);
    const now = new Date().toISOString();
    for (const r of changed) {
      const next = edits[r.id];
      const { error } = await (supabase as never as typeof supabase)
        .from('attendance_records')
        .update({ status: next, edited_by: user?.id, edited_at: now, edit_reason: reason.trim() })
        .eq('id', r.id);
      if (error) { toast.error(`บันทึกไม่สำเร็จ: ${error.message}`); setSaving(false); return; }
      await logAudit({
        action: 'edit_attendance',
        target: 'attendance_records',
        targetId: r.id,
        detail: `${names[r.studentId]?.name ?? r.studentId} : ${statusLabel[r.status]} → ${statusLabel[next]}`,
        before: { status: r.status },
        after: { status: next },
        reason: reason.trim(),
      });
    }
    toast.success(`บันทึกการแก้ไข ${changed.length} รายการแล้ว`);
    setReason('');
    setSaving(false);
    reload(sessionId);
  };

  return (
    <MobileLayout title="แก้ไขการเข้าเรียน">
      <div className="px-4 py-4 space-y-4">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {courses.map(c => (
            <button key={c.id} onClick={() => setCourseId(c.id)}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-medium ${courseId === c.id ? 'gradient-primary text-primary-foreground shadow-elevated' : 'bg-card text-muted-foreground shadow-card'}`}>
              {c.code}
            </button>
          ))}
        </div>

        <select value={sessionId} onChange={e => setSessionId(e.target.value)}
          className="w-full bg-card rounded-xl px-3 py-2 text-xs shadow-card border border-border text-foreground">
          {sessions.map(s => <option key={s.id} value={s.id}>{fmtDateTime(s.started_at)}</option>)}
        </select>

        <div className="space-y-2">
          {rows.map(r => {
            const current = edits[r.id] ?? r.status;
            return (
              <div key={r.id} className="bg-card rounded-xl p-3 shadow-card">
                <div className="flex items-center justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{names[r.studentId]?.name ?? 'นักศึกษา'}</p>
                    <p className="text-[11px] text-muted-foreground">{names[r.studentId]?.code ?? '-'} · {fmtDateTime(r.checkedInAt)}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {OPTIONS.map(opt => (
                    <button key={opt} onClick={() => setEdits(p => ({ ...p, [r.id]: opt }))}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                        current === opt ? 'gradient-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                      {statusLabel[opt]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">ไม่มีข้อมูลในคาบนี้</p>}
        </div>

        {rows.length > 0 && (
          <div className="bg-card rounded-xl p-3 shadow-card space-y-2">
            <label className="text-xs font-semibold text-foreground">เหตุผลในการแก้ไข (จำเป็น)</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
              placeholder="เช่น ระบบสแกนไม่ทำงาน นักศึกษามาเรียนจริง"
              className="w-full bg-background rounded-lg px-3 py-2 text-xs border border-border text-foreground" />
            <button onClick={handleSave} disabled={saving}
              className="w-full gradient-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
              <Save className="w-4 h-4" /> {saving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
            </button>
          </div>
        )}
      </div>
    </MobileLayout>
  );
};

export default ManualAttendanceEditPage;
