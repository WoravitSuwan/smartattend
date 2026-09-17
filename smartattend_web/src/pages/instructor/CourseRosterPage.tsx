import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Users, Upload, CheckCircle2, Clock, AlertCircle, XCircle, CalendarDays, Trash2, Link2, Pencil, X, Search, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import MobileLayout from '@/components/MobileLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';

interface Course {
  id: string;
  code: string;
  name: string;
  section: string | null;
  semester: string | null;
}
interface Enrollment {
  id: string;
  course_id: string;
  student_id: string | null;
  student_code_raw: string;
  student_name_raw: string;
  status: 'pending' | 'confirmed' | 'declined' | 'unmatched';
  confirmed_at: string | null;
}
interface ProfileHit { user_id: string; name: string | null; email: string | null; student_code: string | null; }

const statusStyle: Record<Enrollment['status'], { label: string; cls: string; icon: any }> = {
  confirmed: { label: 'ยืนยันแล้ว', cls: 'bg-success/15 text-success border-success/30', icon: CheckCircle2 },
  pending: { label: 'รอยืนยัน', cls: 'bg-warning/15 text-warning border-warning/30', icon: Clock },
  unmatched: { label: 'ไม่พบในระบบ', cls: 'bg-destructive/15 text-destructive border-destructive/30', icon: AlertCircle },
  declined: { label: 'ปฏิเสธ', cls: 'bg-muted text-muted-foreground border-border', icon: XCircle },
};

export default function CourseRosterPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { courseId: forcedCourseId } = useParams<{ courseId?: string }>();
  const isAdminView = !!forcedCourseId;

  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedSemester, setSelectedSemester] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);

  const [matchOpen, setMatchOpen] = useState<Enrollment | null>(null);
  const [editOpen, setEditOpen] = useState<Course | null>(null);

  const selectedCourse = courses.find(c => c.id === selectedId) ?? null;

  const loadCourses = async () => {
    let data: Course[] | null = null;
    if (isAdminView) {
      const res = await (supabase as any).from('courses').select('id, code, name, section, semester').eq('id', forcedCourseId);
      data = res.data as Course[] | null;
    } else if (user?.id) {
      const res = await (supabase as any).from('courses').select('id, code, name, section, semester').eq('instructor_id', user.id).order('created_at', { ascending: false });
      data = res.data as Course[] | null;
    }
    if (data) {
      setCourses(data);
      if (data.length > 0 && !selectedId) {
        setSelectedSemester(data[0].semester ?? 'ไม่ระบุ');
        setSelectedId(data[0].id);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    let alive = true;
    (async () => { if (alive) await loadCourses(); })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, forcedCourseId, isAdminView]);

  const semesters = useMemo(() => {
    const s = new Set<string>();
    courses.forEach(c => s.add(c.semester ?? 'ไม่ระบุ'));
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [courses]);

  const coursesInSemester = useMemo(
    () => courses.filter(c => (c.semester ?? 'ไม่ระบุ') === selectedSemester),
    [courses, selectedSemester],
  );

  useEffect(() => {
    if (coursesInSemester.length === 0) { setSelectedId(''); return; }
    if (!coursesInSemester.some(c => c.id === selectedId)) {
      setSelectedId(coursesInSemester[0].id);
    }
  }, [coursesInSemester, selectedId]);

  useEffect(() => {
    if (!selectedId) { setRows([]); return; }
    let alive = true;
    const load = async () => {
      const { data } = await (supabase as any)
        .from('course_enrollments')
        .select('id, course_id, student_id, student_code_raw, student_name_raw, status, confirmed_at')
        .eq('course_id', selectedId)
        .order('student_code_raw', { ascending: true });
      if (alive && data) setRows(data as Enrollment[]);
    };
    load();
    const channel = supabase
      .channel(`enrollments-${selectedId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'course_enrollments', filter: `course_id=eq.${selectedId}` },
        () => { load(); },
      )
      .subscribe();
    return () => { alive = false; supabase.removeChannel(channel); };
  }, [selectedId]);

  const counts = {
    total: rows.length,
    confirmed: rows.filter(r => r.status === 'confirmed').length,
    pending: rows.filter(r => r.status === 'pending').length,
    unmatched: rows.filter(r => r.status === 'unmatched').length,
  };

  const deleteRow = async (r: Enrollment) => {
    if (!confirm(`ลบ ${r.student_code_raw} ${r.student_name_raw} ออกจากวิชานี้?`)) return;
    const { error } = await (supabase as any).from('course_enrollments').delete().eq('id', r.id);
    if (error) toast.error(error.message); else toast.success('ลบแล้ว');
  };

  const deleteCourse = async () => {
    if (!selectedCourse) return;
    if (!confirm(`ลบวิชา ${selectedCourse.code} ${selectedCourse.name} ทั้งวิชา?\nรายชื่อนักศึกษาทั้งหมดในวิชานี้จะถูกลบตามไปด้วย การกระทำนี้ย้อนกลับไม่ได้`)) return;
    // Explicitly delete enrollments first in case FK is not cascading
    await (supabase as any).from('course_enrollments').delete().eq('course_id', selectedCourse.id);
    const { error } = await (supabase as any).from('courses').delete().eq('id', selectedCourse.id);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบวิชาแล้ว');
    setCourses(cs => cs.filter(c => c.id !== selectedCourse.id));
    setSelectedId('');
  };

  return (
    <MobileLayout title="รายชื่อนักศึกษา">
      <div className="px-4 py-4 space-y-4 max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => navigate(isAdminView ? '/admin/course-overview' : '/instructor')}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-3 h-3" /> กลับ
          </button>
          {!isAdminView && (
            <button onClick={() => navigate('/instructor/import-roster')}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:opacity-90">
              <Upload className="w-3 h-3" /> Import ไฟล์ใหม่
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-center text-xs text-muted-foreground py-10">กำลังโหลด...</p>
        ) : courses.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center bg-card">
            <Users className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-foreground font-medium">ยังไม่มีวิชา</p>
            {!isAdminView && (
              <>
                <p className="text-xs text-muted-foreground mt-1">Import ไฟล์รายชื่อเพื่อสร้างวิชาแรกของคุณ</p>
                <button onClick={() => navigate('/instructor/import-roster')}
                  className="mt-4 inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium">
                  <Upload className="w-4 h-4" /> Import รายชื่อ
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {!isAdminView && semesters.length > 0 && (
              <div>
                <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" /> เลือกภาคเรียน
                </label>
                <div className="mt-1 flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {semesters.map(s => {
                    const active = s === selectedSemester;
                    return (
                      <button key={s} onClick={() => setSelectedSemester(s)}
                        className={`shrink-0 h-9 px-3 rounded-lg border text-xs font-medium transition-colors ${
                          active ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-foreground border-border hover:bg-muted/50'
                        }`}>{s}</button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label className="text-[11px] text-muted-foreground">เลือกวิชา</label>
              <select value={selectedId} onChange={e => setSelectedId(e.target.value)} disabled={isAdminView}
                className="mt-1 w-full h-10 rounded-lg bg-card border border-border px-3 text-sm text-foreground disabled:opacity-70">
                {(isAdminView ? courses : coursesInSemester).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}{c.section ? ` · ${c.section}` : ''}{c.semester ? ` · ${c.semester}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <Stat label="ทั้งหมด" value={counts.total} tone="muted" />
              <Stat label="ยืนยันแล้ว" value={counts.confirmed} tone="success" />
              <Stat label="รอยืนยัน" value={counts.pending} tone="warning" />
              <Stat label="ไม่พบ" value={counts.unmatched} tone="destructive" />
            </div>

            <div className="rounded-xl border border-border overflow-hidden bg-card">
              {selectedCourse && !isAdminView && (
                <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-muted/30">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {selectedCourse.code} · {selectedCourse.name}
                  </p>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => setEditOpen(selectedCourse)}
                      className="inline-flex items-center gap-1 h-8 px-2 rounded-lg border border-border text-[11px] text-foreground hover:bg-muted">
                      <Pencil className="w-3 h-3" /> แก้ไขวิชา
                    </button>
                    <button onClick={deleteCourse}
                      className="inline-flex items-center gap-1 h-8 px-2 rounded-lg border border-destructive/40 text-[11px] text-destructive hover:bg-destructive/10">
                      <Trash2 className="w-3 h-3" /> ลบวิชา
                    </button>
                  </div>
                </div>
              )}
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium w-10">#</th>
                      <th className="px-3 py-2 font-medium">รหัสนักศึกษา</th>
                      <th className="px-3 py-2 font-medium">ชื่อ</th>
                      <th className="px-3 py-2 font-medium">สถานะ</th>
                      {!isAdminView && <th className="px-3 py-2 font-medium text-right">จัดการ</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">ยังไม่มีนักศึกษาในวิชานี้</td></tr>
                    ) : rows.map((r, i) => {
                      const s = statusStyle[r.status];
                      const Icon = s.icon;
                      return (
                        <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-t border-border/60">
                          <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                          <td className="px-3 py-2 font-mono text-foreground">{r.student_code_raw}</td>
                          <td className="px-3 py-2 text-foreground">{r.student_name_raw}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${s.cls}`}>
                              <Icon className="w-3 h-3" /> {s.label}
                            </span>
                          </td>
                          {!isAdminView && (
                            <td className="px-3 py-2">
                              <div className="flex justify-end gap-1">
                                {r.status === 'unmatched' && (
                                  <button onClick={() => setMatchOpen(r)}
                                    className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-border text-[11px] text-foreground hover:bg-muted">
                                    <Link2 className="w-3 h-3" /> จับคู่
                                  </button>
                                )}
                                <button onClick={() => deleteRow(r)}
                                  className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-destructive/40 text-[11px] text-destructive hover:bg-destructive/10">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                          )}
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {matchOpen && (
        <ManualMatchDialog enrollment={matchOpen} onClose={() => setMatchOpen(null)} />
      )}
      {editOpen && (
        <EditCourseDialog course={editOpen} onClose={() => setEditOpen(null)}
          onSaved={updated => {
            setCourses(cs => cs.map(c => c.id === updated.id ? updated : c));
            setEditOpen(null);
          }} />
      )}
    </MobileLayout>
  );
}

function ManualMatchDialog({ enrollment, onClose }: { enrollment: Enrollment; onClose: () => void }) {
  const [q, setQ] = useState(enrollment.student_code_raw.replace(/\D/g, ''));
  const [results, setResults] = useState<ProfileHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  const search = async () => {
    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; results: ProfileHit[]; error?: string }>('manual-match-enrollment', {
        body: { action: 'search', q },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? 'search_failed');
      setResults(data.results);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ค้นหาไม่สำเร็จ');
    } finally { setSearching(false); }
  };

  useEffect(() => { search(); /* eslint-disable-next-line */ }, []);

  const pick = async (p: ProfileHit) => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string }>('manual-match-enrollment', {
        body: { action: 'match', enrollmentId: enrollment.id, studentId: p.user_id },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? 'match_failed');
      toast.success('จับคู่และส่งคำเชิญให้นักศึกษาแล้ว');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'จับคู่ไม่สำเร็จ');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">จับคู่นักศึกษาด้วยตนเอง</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="text-[11px] text-muted-foreground">
          รายการเดิม: <span className="font-mono text-foreground">{enrollment.student_code_raw}</span> · {enrollment.student_name_raw}
        </div>
        <div className="flex gap-2">
          <input value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search(); }}
            placeholder="ค้นหาด้วยรหัสนักศึกษาหรือชื่อ"
            className="flex-1 h-10 rounded-lg bg-background border border-border px-3 text-sm text-foreground" />
          <button onClick={search} disabled={searching}
            className="inline-flex items-center gap-1 h-10 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50">
            {searching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} ค้นหา
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
          {results.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-6">
              {searching ? 'กำลังค้นหา...' : 'ไม่พบผลลัพธ์'}
            </p>
          ) : results.map(p => (
            <button key={p.user_id} onClick={() => pick(p)} disabled={saving}
              className="w-full text-left px-3 py-2 hover:bg-muted/50 disabled:opacity-50">
              <p className="text-sm text-foreground">{p.name || '(ไม่มีชื่อ)'}</p>
              <p className="text-[11px] text-muted-foreground font-mono">{p.student_code ?? '—'} · {p.email ?? ''}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EditCourseDialog({ course, onClose, onSaved }: { course: Course; onClose: () => void; onSaved: (c: Course) => void }) {
  const [code, setCode] = useState(course.code);
  const [name, setName] = useState(course.name);
  const [section, setSection] = useState(course.section ?? '');
  const [semester, setSemester] = useState(course.semester ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!code.trim() || !name.trim()) { toast.error('กรุณากรอกรหัสและชื่อวิชา'); return; }
    setSaving(true);
    try {
      const { data, error } = await (supabase as any).from('courses')
        .update({ code: code.trim(), name: name.trim(), section: section.trim(), semester: semester.trim() || null })
        .eq('id', course.id).select('id, code, name, section, semester').single();
      if (error) throw new Error(error.message);
      toast.success('บันทึกแล้ว');
      onSaved(data as Course);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">แก้ไขวิชา</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <Field label="รหัสวิชา *" value={code} onChange={setCode} />
        <Field label="ชื่อวิชา *" value={name} onChange={setName} />
        <Field label="Section" value={section} onChange={setSection} />
        <Field label="ภาคเรียน" value={semester} onChange={setSemester} />
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-border text-sm text-foreground hover:bg-muted">ยกเลิก</button>
          <button onClick={save} disabled={saving}
            className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} บันทึก
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)}
        className="mt-1 w-full h-10 rounded-lg bg-background border border-border px-3 text-sm text-foreground" />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'muted' | 'success' | 'warning' | 'destructive' }) {
  const toneMap = {
    muted: 'bg-muted/40 border-border text-foreground',
    success: 'bg-success/10 border-success/30 text-success',
    warning: 'bg-warning/10 border-warning/30 text-warning',
    destructive: 'bg-destructive/10 border-destructive/30 text-destructive',
  };
  return (
    <div className={`rounded-xl border p-3 text-center ${toneMap[tone]}`}>
      <p className="text-[10px] opacity-80">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
