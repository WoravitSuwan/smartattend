import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { logAudit } from '@/lib/audit-log';
import { fetchInstructorCourses, fetchSummary, type SummaryRow } from '@/lib/attendance-data';
import {
  attendanceScore, categoryLabels, fetchGradeItems, fetchStudentGrades, gradeColor,
  letterGrade, upsertGrade, weightedTotal, type GradeCategory, type GradeItem, type StudentGrade,
} from '@/lib/grade-data';
import { supabase } from '@/integrations/supabase/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Plus, Trash2, Sparkles, Loader2, Save } from 'lucide-react';

interface Course { id: string; code: string; name: string }
interface Student { id: string; name: string; code: string }

const CATEGORIES = Object.keys(categoryLabels) as GradeCategory[];

const GradeManagementPage = () => {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState('');
  const [items, setItems] = useState<GradeItem[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [grades, setGrades] = useState<Record<string, number | null>>({}); // `${itemId}:${studentId}`
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCat, setNewCat] = useState<GradeCategory>('assignment');
  const [newMax, setNewMax] = useState('100');
  const [newWeight, setNewWeight] = useState('10');

  useEffect(() => {
    if (!user) return;
    fetchInstructorCourses(user.id).then(cs => {
      setCourses(cs as Course[]);
      if (cs.length > 0) setCourseId(cs[0].id);
      else setLoading(false);
    });
  }, [user]);

  const load = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    const its = await fetchGradeItems(courseId);
    setItems(its);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: enr } = await (supabase as any)
      .from('course_enrollments')
      .select('student_id, student_code_raw, student_name_raw')
      .eq('course_id', courseId)
      .not('student_id', 'is', null);
    const list: Student[] = (enr ?? []).map((e: { student_id: string; student_code_raw: string; student_name_raw: string }) => ({
      id: e.student_id, code: e.student_code_raw, name: e.student_name_raw,
    })).sort((a: Student, b: Student) => a.code.localeCompare(b.code));
    setStudents(list);

    const rows = await fetchStudentGrades(its.map(i => i.id));
    const map: Record<string, number | null> = {};
    rows.forEach((r: StudentGrade) => { map[`${r.grade_item_id}:${r.student_id}`] = r.score; });
    setGrades(map);

    setSummary(await fetchSummary({ courseId }));
    setLoading(false);
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  const addItem = async () => {
    if (!newName.trim()) { toast.error('กรุณาระบุชื่อหัวข้อคะแนน'); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('grade_items').insert({
      course_id: courseId, name: newName.trim(), category: newCat,
      max_score: Number(newMax) || 100, weight: Number(newWeight) || 0,
    });
    if (error) { console.error(error); toast.error('สร้างหัวข้อคะแนนไม่สำเร็จ'); return; }
    toast.success('เพิ่มหัวข้อคะแนนแล้ว');
    setNewName(''); setShowNew(false);
    load();
  };

  const removeItem = async (id: string) => {
    if (!window.confirm('ลบหัวข้อคะแนนนี้และคะแนนทั้งหมดในหัวข้อ?')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('grade_items').delete().eq('id', id);
    if (error) { toast.error('ลบไม่สำเร็จ'); return; }
    toast.success('ลบแล้ว');
    load();
  };

  const setScore = (itemId: string, studentId: string, raw: string) => {
    const v = raw === '' ? null : Number(raw);
    setGrades(prev => ({ ...prev, [`${itemId}:${studentId}`]: Number.isNaN(v as number) ? null : v }));
  };

  const saveAll = async () => {
    setSaving(true);
    const ops: Promise<unknown>[] = [];
    for (const it of items) {
      for (const s of students) {
        const v = grades[`${it.id}:${s.id}`];
        if (v === undefined) continue;
        ops.push(upsertGrade(it.id, s.id, v));
      }
    }
    await Promise.all(ops);
    setSaving(false);
    await logAudit({
      action: 'grade.update', target: 'course', targetId: courseId,
      detail: `บันทึกคะแนน ${items.length} หัวข้อ × ${students.length} คน`,
    });
    toast.success('บันทึกคะแนนเรียบร้อย นักศึกษาจะได้รับการแจ้งเตือน');
    load();
  };

  const autoAttendance = async () => {
    const attItems = items.filter(i => i.category === 'attendance');
    if (attItems.length === 0) { toast.error('ยังไม่มีหัวข้อคะแนนประเภท "เข้าเรียน"'); return; }
    const next = { ...grades };
    let n = 0;
    for (const it of attItems) {
      for (const s of students) {
        const row = summary.find(r => r.student_id === s.id && r.course_id === courseId);
        if (!row) continue;
        next[`${it.id}:${s.id}`] = attendanceScore(row.attendance_rate, Number(it.max_score) || 100);
        n++;
      }
    }
    setGrades(next);
    toast.success(`คำนวณคะแนนเข้าเรียนอัตโนมัติ ${n} รายการ — กด "บันทึกคะแนน" เพื่อยืนยัน`);
  };

  const totalWeight = useMemo(() => items.reduce((a, i) => a + (Number(i.weight) || 0), 0), [items]);

  return (
    <MobileLayout title="จัดการคะแนน">
      <div className="px-4 py-4 space-y-4">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {courses.map(c => (
            <button key={c.id} onClick={() => setCourseId(c.id)}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                courseId === c.id ? 'gradient-primary text-primary-foreground shadow-elevated' : 'bg-card text-muted-foreground shadow-card'
              }`}>{c.code}</button>
          ))}
        </div>

        {courses.length === 0 && !loading && (
          <div className="text-center py-12 text-muted-foreground text-sm">ยังไม่มีรายวิชา</div>
        )}

        {courseId && (
          <>
            {/* Grade items */}
            <div className="bg-card rounded-2xl p-4 shadow-card space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground">หัวข้อคะแนน · น้ำหนักรวม {totalWeight}%</p>
                <button onClick={() => setShowNew(v => !v)} className="inline-flex items-center gap-1 text-[11px] text-primary font-medium">
                  <Plus className="w-3.5 h-3.5" /> เพิ่ม
                </button>
              </div>
              {totalWeight !== 100 && items.length > 0 && (
                <p className="text-[10px] text-warning">น้ำหนักรวมยังไม่เท่ากับ 100%</p>
              )}

              {items.map(it => (
                <div key={it.id} className="flex items-center gap-2 py-1.5 border-t border-border first:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{it.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {categoryLabels[it.category]} · เต็ม {it.max_score} · น้ำหนัก {it.weight}%
                    </p>
                  </div>
                  <button onClick={() => removeItem(it.id)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></button>
                </div>
              ))}
              {items.length === 0 && <p className="text-[11px] text-muted-foreground">ยังไม่มีหัวข้อคะแนน</p>}

              {showNew && (
                <div className="pt-2 space-y-2 border-t border-border">
                  <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="ชื่อหัวข้อ เช่น สอบกลางภาค"
                    className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
                  <div className="grid grid-cols-3 gap-2">
                    <select value={newCat} onChange={e => setNewCat(e.target.value as GradeCategory)}
                      className="px-2 py-2 rounded-xl bg-muted text-xs text-foreground outline-none">
                      {CATEGORIES.map(c => <option key={c} value={c}>{categoryLabels[c]}</option>)}
                    </select>
                    <input value={newMax} onChange={e => setNewMax(e.target.value)} type="number" placeholder="เต็ม"
                      className="px-2 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
                    <input value={newWeight} onChange={e => setNewWeight(e.target.value)} type="number" placeholder="น้ำหนัก %"
                      className="px-2 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
                  </div>
                  <button onClick={addItem} className="w-full py-2 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold">
                    สร้างหัวข้อคะแนน
                  </button>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button onClick={autoAttendance}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-card shadow-card text-xs font-semibold text-foreground">
                <Sparkles className="w-3.5 h-3.5 text-primary" /> คำนวณคะแนนเข้าเรียน
              </button>
              <button onClick={saveAll} disabled={saving || items.length === 0}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold shadow-elevated disabled:opacity-50">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} บันทึกคะแนน
              </button>
            </div>

            {loading && <p className="text-center text-sm text-muted-foreground py-8">กำลังโหลด...</p>}
            {!loading && students.length === 0 && (
              <div className="text-center py-10 text-muted-foreground text-sm">ยังไม่มีนักศึกษาที่จับคู่บัญชีในรายวิชานี้</div>
            )}

            {/* Score grid */}
            {students.length > 0 && items.length > 0 && (
              <div className="bg-card rounded-2xl shadow-card overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left p-2.5 font-medium text-muted-foreground sticky left-0 bg-card">นักศึกษา</th>
                      {items.map(it => (
                        <th key={it.id} className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                          {it.name}<br /><span className="text-[9px] font-normal">/{it.max_score}</span>
                        </th>
                      ))}
                      <th className="p-2.5 font-medium text-muted-foreground">รวม</th>
                      <th className="p-2.5 font-medium text-muted-foreground">เกรด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s, i) => {
                      const { total } = weightedTotal(items, id => grades[`${id}:${s.id}`] ?? null);
                      const g = letterGrade(total);
                      return (
                        <motion.tr key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                          className="border-b border-border last:border-0">
                          <td className="p-2.5 sticky left-0 bg-card">
                            <p className="font-medium text-foreground whitespace-nowrap">{s.name}</p>
                            <p className="text-[10px] text-muted-foreground">{s.code}</p>
                          </td>
                          {items.map(it => (
                            <td key={it.id} className="p-1.5 text-center">
                              <input
                                type="number" min={0} max={Number(it.max_score)}
                                value={grades[`${it.id}:${s.id}`] ?? ''}
                                onChange={e => setScore(it.id, s.id, e.target.value)}
                                className="w-14 px-1.5 py-1 rounded-lg bg-muted text-center text-foreground outline-none"
                              />
                            </td>
                          ))}
                          <td className="p-2.5 text-center font-semibold text-foreground">{total.toFixed(1)}</td>
                          <td className={`p-2.5 text-center font-bold ${gradeColor(g)}`}>{g}</td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </MobileLayout>
  );
};

export default GradeManagementPage;
