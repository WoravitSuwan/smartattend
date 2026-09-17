import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { fetchInstructorCourses } from '@/lib/attendance-data';
import {
  fetchAssignments, fetchAssignmentSubmissions, fmtDateTime, getSubmissionFileUrl,
  type AssignmentRow, type SubmissionRow,
} from '@/lib/assignment-data';
import { supabase } from '@/integrations/supabase/client';
import { logAudit } from '@/lib/audit-log';
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, Clock, Paperclip, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

interface Course { id: string; code: string; name: string }

const InstructorGradingPage = () => {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState('');
  const [subs, setSubs] = useState<SubmissionRow[]>([]);
  const [draft, setDraft] = useState<Record<string, { score: string; feedback: string }>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchInstructorCourses(user.id).then(cs => {
      setCourses(cs as Course[]);
      setSelectedCourse(prev => prev || (cs as Course[])[0]?.id || '');
      if (cs.length === 0) setLoading(false);
    });
  }, [user]);

  useEffect(() => {
    if (!selectedCourse) return;
    fetchAssignments([selectedCourse]).then(as => {
      setAssignments(as);
      setSelectedAssignment(as[0]?.id ?? '');
      if (as.length === 0) { setSubs([]); setLoading(false); }
    });
  }, [selectedCourse]);

  const load = useCallback(async () => {
    if (!selectedAssignment) return;
    setLoading(true);
    const rows = await fetchAssignmentSubmissions(selectedAssignment);
    setSubs(rows);
    setDraft(Object.fromEntries(rows.map(r => [r.id, { score: r.score?.toString() ?? '', feedback: r.feedback ?? '' }])));
    setLoading(false);
  }, [selectedAssignment]);

  useEffect(() => { load(); }, [load]);

  const current = assignments.find(a => a.id === selectedAssignment);

  const save = async (s: SubmissionRow) => {
    if (!user || !current) return;
    const d = draft[s.id];
    const score = Number(d?.score);
    if (!Number.isFinite(score) || score < 0 || score > current.max_score) {
      toast.error(`คะแนนต้องอยู่ระหว่าง 0 - ${current.max_score}`);
      return;
    }
    setSavingId(s.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('assignment_submissions').update({
      score, feedback: d.feedback.trim().slice(0, 1000) || null,
      status: 'graded', graded_by: user.id, graded_at: new Date().toISOString(),
    }).eq('id', s.id);
    setSavingId(null);
    if (error) { console.error(error); toast.error('บันทึกคะแนนไม่สำเร็จ'); return; }
    await logAudit({
      action: 'grade.update', target: 'assignment_submission', targetId: s.id,
      detail: `ให้คะแนนงาน ${current.title} แก่ ${s.studentName ?? ''}`,
      before: { score: s.score }, after: { score },
    }).catch(() => {});
    toast.success('บันทึกคะแนนแล้ว');
    load();
  };

  const openFile = async (path: string) => {
    const url = await getSubmissionFileUrl(path);
    if (url) window.open(url, '_blank'); else toast.error('เปิดไฟล์ไม่สำเร็จ');
  };

  return (
    <MobileLayout title="ตรวจงาน">
      <div className="px-4 py-4 space-y-4">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {courses.map(c => (
            <button key={c.id} onClick={() => setSelectedCourse(c.id)}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                selectedCourse === c.id ? 'gradient-primary text-primary-foreground shadow-elevated' : 'bg-card text-muted-foreground shadow-card'
              }`}>{c.code}</button>
          ))}
        </div>

        {assignments.length > 0 && (
          <select value={selectedAssignment} onChange={e => setSelectedAssignment(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-card shadow-card text-xs text-foreground outline-none">
            {assignments.map(a => <option key={a.id} value={a.id}>{a.title} (เต็ม {a.max_score})</option>)}
          </select>
        )}

        {loading && <p className="text-center text-sm text-muted-foreground py-8">กำลังโหลด...</p>}
        {!loading && assignments.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">ยังไม่มีงานในรายวิชานี้</div>
        )}
        {!loading && assignments.length > 0 && subs.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">ยังไม่มีนักศึกษาส่งงานนี้</div>
        )}

        {subs.map((s, i) => (
          <motion.div key={s.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
            className="bg-card rounded-2xl p-4 shadow-card space-y-2">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{s.studentName}</p>
                <p className="text-[10px] text-muted-foreground">{s.studentCode} · ส่งเมื่อ {fmtDateTime(s.submitted_at)}</p>
              </div>
              <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${
                s.status === 'graded' ? 'bg-primary/15 text-primary' : s.status === 'late' ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'
              }`}>
                {s.status === 'graded' ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                {s.status === 'graded' ? 'ตรวจแล้ว' : s.status === 'late' ? 'ส่งช้า' : 'รอตรวจ'}
              </span>
            </div>

            {s.content && <p className="text-[11px] text-foreground/80">{s.content}</p>}
            {s.file_path && (
              <button onClick={() => openFile(s.file_path!)} className="text-[11px] text-primary font-medium inline-flex items-center gap-1">
                <Paperclip className="w-3 h-3" /> เปิดไฟล์ที่ส่ง
              </button>
            )}

            <div className="flex gap-2">
              <input type="number" min={0} max={current?.max_score ?? 100} value={draft[s.id]?.score ?? ''}
                onChange={e => setDraft(p => ({ ...p, [s.id]: { ...p[s.id], score: e.target.value } }))}
                placeholder={`0-${current?.max_score ?? 100}`}
                className="w-24 px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
              <input value={draft[s.id]?.feedback ?? ''}
                onChange={e => setDraft(p => ({ ...p, [s.id]: { ...p[s.id], feedback: e.target.value } }))}
                placeholder="คอมเมนต์"
                className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
              <button onClick={() => save(s)} disabled={savingId === s.id}
                className="shrink-0 px-3 rounded-xl gradient-primary text-primary-foreground disabled:opacity-50">
                {savingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </MobileLayout>
  );
};

export default InstructorGradingPage;
