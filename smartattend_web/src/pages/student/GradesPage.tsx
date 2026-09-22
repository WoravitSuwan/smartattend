import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { fetchEnrolledCourses } from '@/lib/attendance-data';
import {
  categoryLabels, fetchGradeItems, fetchStudentGrades, gradeColor, gradePoint,
  letterGrade, weightedTotal, type GradeItem,
} from '@/lib/grade-data';
import { motion } from 'framer-motion';
import { BarChart3, GraduationCap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

interface CourseGrade {
  courseId: string;
  code: string;
  name: string;
  semester: string | null;
  items: GradeItem[];
  scores: Record<string, number | null>;
  total: number;
  usedWeight: number;
  grade: string;
}

const GradesPage = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<CourseGrade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const courses = await fetchEnrolledCourses(user.id);
      const out: CourseGrade[] = [];
      for (const c of courses as { id: string; code: string; name: string; semester: string | null }[]) {
        const items = await fetchGradeItems(c.id);
        if (items.length === 0) continue;
        const gs = await fetchStudentGrades(items.map(i => i.id), user.id);
        const scores: Record<string, number | null> = {};
        gs.forEach(g => { scores[g.grade_item_id] = g.score; });
        const { total, usedWeight } = weightedTotal(items, id => scores[id] ?? null);
        out.push({
          courseId: c.id, code: c.code, name: c.name, semester: c.semester,
          items, scores, total, usedWeight, grade: letterGrade(total),
        });
      }
      if (!cancelled) { setRows(out); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const summary = useMemo(() => {
    const bySemester = new Map<string, { points: number; count: number }>();
    let points = 0;
    let count = 0;
    for (const r of rows) {
      if (r.usedWeight <= 0) continue;
      const p = gradePoint(r.grade);
      const sem = r.semester ?? 'อื่นๆ';
      const cur = bySemester.get(sem) ?? { points: 0, count: 0 };
      cur.points += p; cur.count += 1;
      bySemester.set(sem, cur);
      points += p; count += 1;
    }
    const semesters = Array.from(bySemester.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sem, v]) => ({ sem, count: v.count, gpa: v.count > 0 ? v.points / v.count : 0 }));
    return { semesters, gpax: count > 0 ? points / count : 0, courseCount: count };
  }, [rows]);

  return (
    <MobileLayout title="คะแนนเก็บ">
      <div className="px-4 py-4 space-y-3">
        {summary.semesters.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="gradient-hero rounded-2xl p-5 shadow-float text-primary-foreground">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-primary-foreground/20 flex items-center justify-center">
                <GraduationCap className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-primary-foreground/70">สรุปผลการศึกษา (คะแนนที่ประกาศแล้ว)</p>
                <p className="text-2xl font-bold font-display">GPAX {summary.gpax.toFixed(2)}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-[10px] text-primary-foreground/70">รายวิชา</p>
                <p className="text-lg font-bold font-display">{summary.courseCount}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {summary.semesters.map(s => (
                <div key={s.sem} className="bg-primary-foreground/10 rounded-xl p-3">
                  <p className="text-[10px] text-primary-foreground/70">ภาคเรียนที่ {s.sem}</p>
                  <p className="text-xl font-bold font-display">{s.gpa.toFixed(2)}</p>
                  <p className="text-[10px] text-primary-foreground/70">{s.count} วิชา</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {loading && <p className="text-center text-sm text-muted-foreground py-10">กำลังโหลด...</p>}
        {!loading && rows.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">ยังไม่มีข้อมูลคะแนน</div>
        )}

        {rows.map((r, i) => (
          <motion.div key={r.courseId} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }} className="bg-card rounded-2xl p-5 shadow-elevated">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold font-display text-foreground">{r.code}</p>
                  {r.semester && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{r.semester}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{r.name}</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold font-display text-primary">{r.total.toFixed(1)}</p>
                <p className={`text-[10px] font-semibold ${gradeColor(r.grade)}`}>เกรดคาดการณ์ {r.grade}</p>
              </div>
            </div>

            <div className="space-y-2">
              {r.items.map(it => {
                const s = r.scores[it.id];
                const max = Number(it.max_score) || 100;
                return (
                  <div key={it.id} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-28 truncate" title={`${categoryLabels[it.category]} · น้ำหนัก ${it.weight}%`}>
                      {it.name}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <motion.div initial={{ width: 0 }}
                        animate={{ width: `${s == null ? 0 : Math.min(100, (s / max) * 100)}%` }}
                        transition={{ delay: i * 0.06 + 0.25, duration: 0.5 }}
                        className="h-full rounded-full gradient-primary" />
                    </div>
                    <span className="text-xs font-semibold text-foreground w-14 text-right">
                      {s == null ? (it.category === 'final' ? 'รอประกาศ' : 'รอตรวจ') : `${s}/${max}`}
                    </span>
                  </div>
                );
              })}
            </div>

            {r.usedWeight < 100 && (
              <p className="text-[10px] text-muted-foreground text-center mt-3">
                ประกาศคะแนนแล้ว {r.usedWeight}% ของคะแนนรวม — เกรดอาจเปลี่ยนแปลงได้
              </p>
            )}
          </motion.div>
        ))}
      </div>
    </MobileLayout>
  );
};

export default GradesPage;
