import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Plus, Pencil, Trash2, Users, X, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import BulkImportStudentsModal, { type ParsedRow } from '@/components/BulkImportStudentsModal';

interface Instructor {
  id: string;
  name: string;
}

interface CourseRow {
  id: string;
  code: string;
  name: string;
  section: string;
  semester: string | null;
  instructorId: string;
  instructor: string;
  enrolledCount: number;
}

interface Editable {
  id: string;
  code: string;
  name: string;
  section: string;
  semester: string;
  instructorId: string;
}

const empty = (defaultInstructorId: string): Editable => ({
  id: '',
  code: '',
  name: '',
  section: '001',
  semester: '',
  instructorId: defaultInstructorId,
});

export default function AdminCoursesPage() {
  const [list, setList] = useState<CourseRow[]>([]);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [enrolledStudents, setEnrolledStudents] = useState<Record<string, { studentId: string; name: string; code: string }[]>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Editable | null>(null);
  const [viewing, setViewing] = useState<CourseRow | null>(null);
  const [importing, setImporting] = useState<{ courseId?: string } | null>(null);
  const [importedByCourse, setImportedByCourse] = useState<Record<string, number>>({});

  const load = async () => {
    setLoading(true);
    try {
      const { data: courses, error: cErr } = await supabase
        .from('courses')
        .select('id, code, name, section, semester, instructor_id, created_at')
        .order('created_at', { ascending: false });
      if (cErr) throw cErr;

      const instructorIds = Array.from(new Set((courses ?? []).map(c => c.instructor_id).filter(Boolean)));
      let profilesMap = new Map<string, string>();
      if (instructorIds.length > 0) {
        const { data: profiles, error: pErr } = await supabase
          .from('profiles')
          .select('user_id, name')
          .in('user_id', instructorIds);
        if (pErr) throw pErr;
        profilesMap = new Map((profiles ?? []).map(p => [p.user_id, p.name]));
      }
      setInstructors(Array.from(profilesMap, ([id, name]) => ({ id, name })));

      const { data: enrollments, error: eErr } = await supabase
        .from('course_enrollments')
        .select('course_id, student_id, student_name_raw, student_code_raw');
      if (eErr) throw eErr;

      const countByCourse = new Map<string, number>();
      const studentsByCourse: Record<string, { studentId: string; name: string; code: string }[]> = {};
      for (const e of enrollments ?? []) {
        countByCourse.set(e.course_id, (countByCourse.get(e.course_id) ?? 0) + 1);
        (studentsByCourse[e.course_id] ??= []).push({
          studentId: e.student_id ?? e.student_code_raw,
          name: e.student_name_raw,
          code: e.student_code_raw,
        });
      }
      setEnrolledStudents(studentsByCourse);

      setList((courses ?? []).map(c => ({
        id: c.id,
        code: c.code,
        name: c.name,
        section: c.section,
        semester: c.semester,
        instructorId: c.instructor_id,
        instructor: profilesMap.get(c.instructor_id) ?? '—',
        enrolledCount: countByCourse.get(c.id) ?? 0,
      })));
    } catch (e) {
      console.error(e);
      toast.error('โหลดข้อมูลรายวิชาไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!q) return list;
    const s = q.toLowerCase();
    return list.filter(c => `${c.code} ${c.name} ${c.instructor}`.toLowerCase().includes(s));
  }, [list, q]);

  const save = async () => {
    if (!editing) return;
    if (!editing.code.trim() || !editing.name.trim()) {
      toast.error('กรอกรหัสและชื่อรายวิชา');
      return;
    }
    if (!editing.instructorId) {
      toast.error('เลือกอาจารย์ผู้สอน');
      return;
    }
    try {
      if (editing.id) {
        const { error } = await supabase.from('courses').update({
          code: editing.code,
          name: editing.name,
          section: editing.section,
          semester: editing.semester || null,
          instructor_id: editing.instructorId,
        }).eq('id', editing.id);
        if (error) throw error;
        toast.success('แก้ไขรายวิชาเรียบร้อย');
      } else {
        const { error } = await supabase.from('courses').insert({
          code: editing.code,
          name: editing.name,
          section: editing.section,
          semester: editing.semester || null,
          instructor_id: editing.instructorId,
        });
        if (error) throw error;
        toast.success('เพิ่มรายวิชาเรียบร้อย');
      }
      setEditing(null);
      load();
    } catch (e) {
      console.error(e);
      toast.error('บันทึกรายวิชาไม่สำเร็จ');
    }
  };

  const del = async (c: CourseRow) => {
    if (!confirm(`ลบรายวิชา ${c.code}?`)) return;
    try {
      const { error } = await supabase.from('courses').delete().eq('id', c.id);
      if (error) throw error;
      toast.success('ลบรายวิชาแล้ว');
      load();
    } catch (e) {
      console.error(e);
      toast.error('ลบรายวิชาไม่สำเร็จ');
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold font-display text-foreground flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-primary" /> จัดการรายวิชา
          </h1>
          <p className="text-sm text-muted-foreground">เพิ่ม / แก้ไข / ลบ รายวิชา · กำหนดอาจารย์และภาคเรียน</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setImporting({})}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted">
            <Upload className="w-4 h-4" /> นำเข้ารายชื่อ (CSV/Excel)
          </button>
          <button onClick={() => setEditing(empty(instructors[0]?.id ?? ''))}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
            <Plus className="w-4 h-4" /> เพิ่มรายวิชา
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="bg-card rounded-2xl p-3 shadow-card border border-border">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหารหัสวิชา / ชื่อ / อาจารย์..."
            className="w-full h-10 rounded-lg bg-background border border-border pl-9 pr-3 text-sm" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-2xl shadow-card border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">รหัสวิชา</th>
                <th className="px-4 py-3 font-medium">ชื่อวิชา</th>
                <th className="px-4 py-3 font-medium">อาจารย์</th>
                <th className="px-4 py-3 font-medium">ภาคเรียน</th>
                <th className="px-4 py-3 font-medium">ตอน</th>
                <th className="px-4 py-3 font-medium text-center">นักศึกษา</th>
                <th className="px-4 py-3 font-medium text-right">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูล...</td></tr>
              )}
              {!loading && filtered.map((c, i) => (
                <motion.tr key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                  className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs text-primary">{c.code}</td>
                  <td className="px-4 py-3 text-foreground whitespace-pre-line">{c.name}</td>
                  <td className="px-4 py-3 text-foreground">{c.instructor}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{c.semester ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.section}</td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => setViewing(c)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20">
                      <Users className="w-3 h-3" /> {c.enrolledCount + (importedByCourse[c.id] ?? 0)}
                    </button>
                    {importedByCourse[c.id] ? (
                      <div className="text-[10px] text-success mt-1">+{importedByCourse[c.id]} นำเข้า</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setImporting({ courseId: c.id })}
                        title="นำเข้ารายชื่อ"
                        className="w-8 h-8 rounded-lg bg-muted hover:bg-primary/10 hover:text-primary flex items-center justify-center text-muted-foreground">
                        <Upload className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditing({ id: c.id, code: c.code, name: c.name, section: c.section, semester: c.semester ?? '', instructorId: c.instructorId })}
                        className="w-8 h-8 rounded-lg bg-muted hover:bg-primary/10 hover:text-primary flex items-center justify-center text-muted-foreground">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => del(c)}
                        className="w-8 h-8 rounded-lg bg-muted hover:bg-destructive/10 hover:text-destructive flex items-center justify-center text-muted-foreground">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">ไม่พบรายวิชา</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            onClick={e => e.stopPropagation()}
            className="bg-card rounded-2xl shadow-elevated border border-border w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold font-display text-foreground">
                {editing.id ? 'แก้ไขรายวิชา' : 'เพิ่มรายวิชา'}
              </h2>
              <button onClick={() => setEditing(null)} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">รหัสวิชา</label>
                  <input value={editing.code} onChange={e => setEditing({ ...editing, code: e.target.value })}
                    className="mt-1 w-full h-10 rounded-lg bg-background border border-border px-3 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">ตอน</label>
                  <input value={editing.section} onChange={e => setEditing({ ...editing, section: e.target.value })}
                    className="mt-1 w-full h-10 rounded-lg bg-background border border-border px-3 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">ชื่อวิชา</label>
                <textarea value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} rows={2}
                  className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">อาจารย์ผู้สอน</label>
                <select value={editing.instructorId}
                  onChange={e => setEditing({ ...editing, instructorId: e.target.value })}
                  className="mt-1 w-full h-10 rounded-lg bg-background border border-border px-2 text-sm">
                  {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">ภาคเรียน</label>
                <input value={editing.semester} onChange={e => setEditing({ ...editing, semester: e.target.value })}
                  placeholder="เช่น 1/2567"
                  className="mt-1 w-full h-10 rounded-lg bg-background border border-border px-3 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl border border-border text-sm hover:bg-muted">ยกเลิก</button>
              <button onClick={save} className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">บันทึก</button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Enrollments modal */}
      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setViewing(null)}>
          <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            onClick={e => e.stopPropagation()}
            className="bg-card rounded-2xl shadow-elevated border border-border w-full max-w-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <h2 className="text-lg font-bold font-display text-foreground">นักศึกษาที่ลงทะเบียน</h2>
                <p className="text-xs text-muted-foreground">{viewing.code} · {viewing.name.split('\n')[0]}</p>
              </div>
              <button onClick={() => setViewing(null)} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              {(enrolledStudents[viewing.id] ?? []).map((s, idx) => (
                <div key={s.studentId + idx} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">{idx + 1}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{s.code}</p>
                  </div>
                </div>
              ))}
              {(enrolledStudents[viewing.id] ?? []).length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">ยังไม่มีนักศึกษาลงทะเบียน</p>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {importing && (
        <BulkImportStudentsModal
          courseId={importing.courseId}
          onClose={() => setImporting(null)}
          onImported={(cid, rows: ParsedRow[]) => {
            setImportedByCourse(prev => ({ ...prev, [cid]: (prev[cid] ?? 0) + rows.length }));
            load();
          }}
        />
      )}
    </div>
  );
}
