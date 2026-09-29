import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { fetchInstructorCourses } from '@/lib/attendance-data';
import {
  fetchAssignments, fetchAssignmentSubmissions, fmtDateTime, getSubmissionFileUrl,
  waiveLatePenalty, type AssignmentRow, type SubmissionRow,
} from '@/lib/assignment-data';
import { supabase } from '@/integrations/supabase/client';
import { db } from '@/integrations/supabase/untyped';
import { logAudit } from '@/lib/audit-log';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle, ChevronDown, ChevronRight, Clock, Link2, Loader2, Paperclip,
  Save, ShieldCheck, ShieldOff,
} from 'lucide-react';
import { toast } from 'sonner';

interface Course { id: string; code: string; name: string }

type Filter = 'all' | 'pending' | 'done';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'pending', label: 'ยังไม่ตรวจ' },
  { key: 'done', label: 'ตรวจครบแล้ว' },
];

/**
 * หน้าตรวจงาน — รายการงานทั้งหมดเรียงลงมา กดกางเพื่อตรวจในที่เดียว
 *
 * ของเดิมใช้ดรอปดาวน์เลือกงานทีละชิ้น อาจารย์จึงไม่เห็นภาพรวมว่ามีงานกี่ชิ้น
 * ชิ้นไหนตรวจแล้ว ชิ้นไหนยัง ต้องกดเปลี่ยนไปมาเพื่อหาว่าเหลืองานไหนต้องตรวจ
 *
 * ส่วนที่แสดงคะแนนดิบ ที่ถูกหักเพราะส่งช้า และคะแนนสุทธิ ยกมาทั้งก้อนไม่แก้
 */
const InstructorGradingPage = () => {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  /** ผลการส่งของทุกงานในรายวิชา คีย์คือ assignment_id */
  const [subsByAssignment, setSubsByAssignment] = useState<Record<string, SubmissionRow[]>>({});
  /** จำนวนนักศึกษาที่ยืนยันเข้าร่วมรายวิชา — ตัวหารของ "ส่งแล้ว x จาก y" */
  const [studentCount, setStudentCount] = useState(0);
  const [draft, setDraft] = useState<Record<string, { score: string; feedback: string }>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [waivingId, setWaivingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (!user) return;
    fetchInstructorCourses(user.id).then(cs => {
      setCourses(cs as Course[]);
      setSelectedCourse(prev => prev || (cs as Course[])[0]?.id || '');
      if (cs.length === 0) setLoading(false);
    });
  }, [user]);

  const load = useCallback(async () => {
    if (!selectedCourse) return;
    setLoading(true);

    const [as, { count }] = await Promise.all([
      fetchAssignments([selectedCourse]),
      db.from('course_enrollments')
        .select('student_id', { count: 'exact', head: true })
        .eq('course_id', selectedCourse)
        .eq('status', 'confirmed')
        .not('student_id', 'is', null),
    ]);
    setAssignments(as);
    setStudentCount(Number(count ?? 0));

    // โหลดผลการส่งของทุกงานทีเดียว เพื่อให้เห็นภาพรวมได้โดยไม่ต้องกดทีละชิ้น
    const entries = await Promise.all(
      as.map(async a => [a.id, await fetchAssignmentSubmissions(a.id)] as const));
    const map = Object.fromEntries(entries);
    setSubsByAssignment(map);
    setDraft(Object.fromEntries(
      entries.flatMap(([, rows]) => rows.map(r =>
        [r.id, { score: r.score?.toString() ?? '', feedback: r.feedback ?? '' }] as const))));
    setLoading(false);
  }, [selectedCourse]);

  useEffect(() => { load(); }, [load]);

  /** สรุปของงานแต่ละชิ้น — ส่งแล้วกี่คน ตรวจแล้วกี่คน ตรวจครบหรือยัง */
  const summaries = useMemo(() => assignments.map(a => {
    const rows = subsByAssignment[a.id] ?? [];
    const submitted = rows.length;
    const graded = rows.filter(r => r.score != null).length;
    return {
      assignment: a,
      rows,
      submitted,
      graded,
      // ตรวจครบ = ตรวจทุกคนที่ส่งมาแล้ว และต้องมีคนส่งอย่างน้อยหนึ่งคน
      complete: submitted > 0 && graded === submitted,
      progress: submitted > 0 ? (graded / submitted) * 100 : 0,
    };
  }), [assignments, subsByAssignment]);

  /** งานที่ยังตรวจไม่ครบอยู่บนสุด ในกลุ่มเดียวกันเรียงตามกำหนดส่ง */
  const visible = useMemo(() => {
    const filtered = summaries.filter(s =>
      filter === 'all' ? true : filter === 'pending' ? !s.complete : s.complete);
    return [...filtered].sort((x, y) => {
      if (x.complete !== y.complete) return x.complete ? 1 : -1;
      const dx = x.assignment.due_at ? Date.parse(x.assignment.due_at) : Number.MAX_SAFE_INTEGER;
      const dy = y.assignment.due_at ? Date.parse(y.assignment.due_at) : Number.MAX_SAFE_INTEGER;
      return dx - dy;
    });
  }, [summaries, filter]);

  const pendingCount = summaries.filter(s => !s.complete).length;

  const save = async (s: SubmissionRow, a: AssignmentRow) => {
    if (!user) return;
    const d = draft[s.id];
    const score = Number(d?.score);
    if (!Number.isFinite(score) || score < 0 || score > a.max_score) {
      toast.error(`คะแนนต้องอยู่ระหว่าง 0 - ${a.max_score}`);
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
      detail: `ให้คะแนนงาน ${a.title} แก่ ${s.studentName ?? ''}`,
      before: { score: s.score }, after: { score },
    }).catch(() => {});
    toast.success('บันทึกคะแนนแล้ว');
    load();
  };

  /** ยกเว้น/ยกเลิกยกเว้นการหักคะแนนส่งช้าเป็นรายคน ต้องระบุเหตุผลเมื่อยกเว้น */
  const toggleWaiver = async (s: SubmissionRow) => {
    if (!s.late_penalty_waived) {
      const reason = window.prompt(
        `ยกเว้นการหักคะแนนส่งช้าของ ${s.studentName ?? 'นักศึกษา'} (ส่งช้า ${s.late_days ?? 0} วัน)\n\nระบุเหตุผล (บันทึกลงประวัติ):`);
      if (reason == null) return;
      if (!reason.trim()) { toast.error('ต้องระบุเหตุผลในการยกเว้น'); return; }
      setWaivingId(s.id);
      const { error } = await waiveLatePenalty(s.id, true, reason.trim());
      setWaivingId(null);
      if (error) { toast.error(error.message || 'ยกเว้นไม่สำเร็จ'); return; }
      toast.success('ยกเว้นการหักคะแนนแล้ว คะแนนในตารางคะแนนถูกปรับตามทันที');
    } else {
      setWaivingId(s.id);
      const { error } = await waiveLatePenalty(s.id, false);
      setWaivingId(null);
      if (error) { toast.error(error.message || 'ยกเลิกไม่สำเร็จ'); return; }
      toast.success('ยกเลิกการยกเว้นแล้ว การหักคะแนนกลับมาตามกฎ');
    }
    load();
  };

  const openFile = async (path: string) => {
    const url = await getSubmissionFileUrl(path);
    if (url) window.open(url, '_blank'); else toast.error('เปิดไฟล์ไม่สำเร็จ');
  };

  return (
    <MobileLayout title="ตรวจงาน">
      <div className="px-4 py-4 space-y-3">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {courses.map(c => (
            <button key={c.id} onClick={() => { setSelectedCourse(c.id); setOpenId(null); }}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                selectedCourse === c.id ? 'gradient-primary text-primary-foreground shadow-elevated' : 'bg-card text-muted-foreground shadow-card'
              }`}>{c.code}</button>
          ))}
        </div>

        {/* ── ตัวกรอง พร้อมบอกว่าเหลืองานที่ต้องตรวจกี่ชิ้น ── */}
        {assignments.length > 0 && (
          <div className="flex items-center gap-1.5">
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`flex-1 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${
                  filter === f.key ? 'gradient-primary text-primary-foreground' : 'bg-card text-muted-foreground shadow-card'
                }`}>
                {f.label}
                {f.key === 'pending' && pendingCount > 0 && ` (${pendingCount})`}
              </button>
            ))}
          </div>
        )}

        {loading && <p className="text-center text-sm text-muted-foreground py-8">กำลังโหลด...</p>}
        {!loading && assignments.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">ยังไม่มีงานในรายวิชานี้</div>
        )}
        {!loading && assignments.length > 0 && visible.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {filter === 'pending' ? 'ตรวจงานครบทุกชิ้นแล้ว' : 'ยังไม่มีงานที่ตรวจครบ'}
          </div>
        )}

        {visible.map(({ assignment: a, rows, submitted, graded, complete, progress }, i) => (
          <motion.div key={a.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.04, 0.3) }}
            className="bg-card rounded-2xl shadow-card overflow-hidden">

            {/* ── แถวสรุปของงานหนึ่งชิ้น ── */}
            <button onClick={() => setOpenId(p => (p === a.id ? null : a.id))}
              className="w-full text-left p-3.5 space-y-2">
              <div className="flex items-start gap-2">
                {openId === a.id
                  ? <ChevronDown className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                  : <ChevronRight className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{a.title}</p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    เต็ม {a.max_score} คะแนน
                    {' · '}
                    {a.componentName
                      ? <span className="inline-flex items-center gap-0.5">
                          <Link2 className="w-2.5 h-2.5" />เข้าหมวด {a.componentName}
                        </span>
                      : <span className="text-warning">ไม่ได้ผูกหมวดคะแนน</span>}
                    <br />
                    กำหนดส่ง {a.due_at ? fmtDateTime(a.due_at) : 'ไม่กำหนด'}
                  </p>
                </div>
                <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${
                  complete ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                }`}>
                  {complete ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  {complete ? 'ตรวจครบ' : 'ยังไม่ครบ'}
                </span>
              </div>

              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-muted-foreground">
                  ส่งแล้ว <span className="font-semibold text-foreground">{submitted}</span> จาก {studentCount}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  ตรวจแล้ว <span className="font-semibold text-foreground">{graded}</span> จาก {submitted}
                </span>
              </div>

              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full transition-all ${complete ? 'bg-success' : 'gradient-primary'}`}
                  style={{ width: `${progress}%` }} />
              </div>
            </button>

            {/* ── กางออกเพื่อตรวจ ไม่ต้องเปลี่ยนหน้า ── */}
            {openId === a.id && (
              <div className="px-3.5 pb-3.5 space-y-2.5 border-t border-border pt-2.5">
                {rows.length === 0 && (
                  <p className="text-[11px] text-muted-foreground py-2">ยังไม่มีนักศึกษาส่งงานนี้</p>
                )}

                {rows.map(s => (
                  <div key={s.id} className="rounded-xl bg-muted/30 p-2.5 space-y-2">
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

                    {/* สามค่าที่ต้องเห็นเสมอ: คะแนนดิบ · ที่ถูกหัก · คะแนนสุทธิ */}
                    {s.score != null && (
                      <div className="rounded-xl bg-card px-2.5 py-2 space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">คะแนนดิบที่ตรวจให้</span>
                          <span className="font-semibold text-foreground">{s.score}/{a.max_score}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">
                            หักส่งช้า
                            {(s.late_days ?? 0) > 0 && ` (${s.late_days} วัน)`}
                            {s.late_penalty_waived && ' — ยกเว้นแล้ว'}
                          </span>
                          <span className={`font-semibold ${
                            (s.penalty_points ?? 0) > 0 ? 'text-destructive' : 'text-muted-foreground'
                          }`}>
                            {(s.penalty_points ?? 0) > 0 ? `-${s.penalty_points}` : '0'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border">
                          <span className="font-medium text-foreground">คะแนนสุทธิ (เข้าตารางคะแนน)</span>
                          <span className="font-bold text-primary">{s.net_score ?? s.score}</span>
                        </div>
                        {s.late_waiver_reason && (
                          <p className="text-[10px] text-muted-foreground">
                            เหตุผลการยกเว้น: {s.late_waiver_reason}
                          </p>
                        )}
                        {(s.late_days ?? 0) > 0 && (
                          <button onClick={() => toggleWaiver(s)} disabled={waivingId === s.id}
                            className={`w-full mt-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-semibold disabled:opacity-50 ${
                              s.late_penalty_waived ? 'bg-muted text-foreground' : 'bg-warning/15 text-warning'
                            }`}>
                            {waivingId === s.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : s.late_penalty_waived ? <ShieldOff className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                            {s.late_penalty_waived ? 'ยกเลิกการยกเว้น (หักคะแนนตามกฎ)' : 'ยกเว้นการหักคะแนนให้คนนี้'}
                          </button>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <input type="number" min={0} max={a.max_score} value={draft[s.id]?.score ?? ''}
                        onChange={e => setDraft(p => ({ ...p, [s.id]: { ...p[s.id], score: e.target.value } }))}
                        placeholder={`0-${a.max_score}`}
                        className="w-20 shrink-0 px-2.5 py-2 rounded-xl bg-card text-xs text-foreground outline-none" />
                      <input value={draft[s.id]?.feedback ?? ''}
                        onChange={e => setDraft(p => ({ ...p, [s.id]: { ...p[s.id], feedback: e.target.value } }))}
                        placeholder="คอมเมนต์"
                        className="flex-1 min-w-0 px-2.5 py-2 rounded-xl bg-card text-xs text-foreground outline-none" />
                      <button onClick={() => save(s, a)} disabled={savingId === s.id}
                        className="shrink-0 px-3 rounded-xl gradient-primary text-primary-foreground disabled:opacity-50">
                        {savingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </MobileLayout>
  );
};

export default InstructorGradingPage;
