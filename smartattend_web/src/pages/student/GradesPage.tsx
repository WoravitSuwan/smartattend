import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { fetchEnrolledCourses } from '@/lib/attendance-data';
import { fetchGradeScale, gradeColor, gradePointFrom } from '@/lib/grade-data';
import { fetchScoreSummary, type ScoreSummary } from '@/lib/score-summary-data';
import { fetchStructureItems } from '@/lib/grade-structure-data';
import type { StructureItem } from '@/lib/grade-structure';
import { fetchStudentGrades } from '@/lib/grade-data';
import { motion } from 'framer-motion';
import { BarChart3, ChevronDown, ChevronRight, GraduationCap, Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

interface CourseGrade {
  courseId: string;
  code: string;
  name: string;
  semester: string | null;
  /** สรุปคะแนนที่ฐานข้อมูลคำนวณให้ — แหล่งความจริงเดียว */
  summary: ScoreSummary;
  /** รายการคะแนนที่นักศึกษามีสิทธิ์เห็น (รายการที่ถูกปิดบังจะไม่อยู่ในนี้) */
  items: StructureItem[];
  /** คีย์ = grade_item_id */
  scores: Record<string, number | null>;
  /** แต้มของเกรดที่ได้ ใช้คิด GPA — 0 เมื่อยังไม่มีเกรด */
  gradePoint: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * หน้าคะแนนของนักศึกษา
 *
 * คะแนนทุกตัวมาจาก get_student_score_summary() ไม่ได้คำนวณในเบราว์เซอร์
 *   1. สูตรคิดคะแนนอยู่ในฐานข้อมูล (component_score) ถ้าหน้าจอคิดเองจะมีสูตร
 *      สองชุดที่ต้องคอยให้ตรงกัน และเคยไม่ตรงกันมาแล้ว
 *   2. น้ำหนักอยู่ที่หมวด (grade_components.weight_percent) ไม่ใช่ที่
 *      grade_items.weight ซึ่งเลิกใช้แล้ว หน้านี้จึงไม่อ่านคอลัมน์นั้นอีก
 *   3. RPC เป็น SECURITY INVOKER จึงเห็นข้อมูลเท่าที่ RLS อนุญาต หมวดที่ถูก
 *      ปิดบังจะบอกมาเป็น masked = true แยกจาก "ยังไม่ตรวจ" ได้ชัดเจน
 */
const GradesPage = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<CourseGrade[]>([]);
  const [loading, setLoading] = useState(true);
  /** หมวดที่กางรายการย่อยอยู่ */
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const courses = await fetchEnrolledCourses(user.id);
      const out: CourseGrade[] = [];
      for (const c of courses as {
        id: string; code: string; name: string; semester: string | null;
      }[]) {
        const summary = await fetchScoreSummary(c.id);
        if (!summary || summary.components.length === 0) continue;

        const items = await fetchStructureItems(c.id);
        const gs = await fetchStudentGrades(items.map(i => i.id), user.id);
        const scores: Record<string, number | null> = {};
        gs.forEach(g => { scores[g.grade_item_id] = g.score; });

        // แต้ม GPA มาจากเกณฑ์ตัดเกรดของรายวิชานั้น ไม่ฮาร์ดโค้ด
        let gradePoint = 0;
        if (summary.grade != null) {
          const { scale } = await fetchGradeScale(c.id);
          gradePoint = gradePointFrom(scale, summary.grade);
        }

        out.push({
          courseId: c.id, code: c.code, name: c.name, semester: c.semester,
          summary, items, scores, gradePoint,
        });
      }
      if (!cancelled) { setRows(out); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const gpa = useMemo(() => {
    const bySemester = new Map<string, { points: number; count: number }>();
    let points = 0;
    let count = 0;
    for (const r of rows) {
      // นับเฉพาะวิชาที่มีเกรดจริงแล้ว (ตรวจครบ + ประกาศผล) วิชาที่ยังตรวจไม่ครบ
      // ถ้านับด้วย GPAX จะเป็นตัวเลขที่เปลี่ยนไปมาทุกครั้งที่อาจารย์กรอกคะแนน
      if (!r.summary.grade_is_final || r.summary.grade == null) continue;
      const sem = r.semester ?? 'อื่นๆ';
      const cur = bySemester.get(sem) ?? { points: 0, count: 0 };
      cur.points += r.gradePoint; cur.count += 1;
      bySemester.set(sem, cur);
      points += r.gradePoint; count += 1;
    }
    const semesters = Array.from(bySemester.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sem, v]) => ({ sem, count: v.count, gpa: v.count > 0 ? v.points / v.count : 0 }));
    return { semesters, gpax: count > 0 ? points / count : 0, courseCount: count };
  }, [rows]);

  return (
    <MobileLayout title="คะแนนเก็บ">
      <div className="px-4 py-4 space-y-3">
        {gpa.semesters.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="gradient-hero rounded-2xl p-5 shadow-float text-primary-foreground">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-primary-foreground/20 flex items-center justify-center">
                <GraduationCap className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-primary-foreground/70">สรุปผลการศึกษา (เฉพาะวิชาที่ประกาศผลแล้ว)</p>
                <p className="text-2xl font-bold font-display">GPAX {gpa.gpax.toFixed(2)}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-[10px] text-primary-foreground/70">รายวิชา</p>
                <p className="text-lg font-bold font-display">{gpa.courseCount}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {gpa.semesters.map(s => (
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

        {rows.map((r, i) => {
          const sm = r.summary;
          const remaining = round1(Math.max(0, sm.declared_weight - sm.used_weight));
          return (
            <motion.div key={r.courseId} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }} className="bg-card rounded-2xl p-5 shadow-elevated">
              <div className="flex items-center gap-3 mb-3">
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
                {sm.grade != null && (
                  <p className={`text-sm font-bold shrink-0 ${gradeColor(sm.grade)}`}>เกรด {sm.grade}</p>
                )}
              </div>

              {/* ── คะแนนรวมของวิชา ──
                  ตัวหารคือคะแนนเต็มของรายวิชา (100) ไม่ใช่น้ำหนักที่ตรวจแล้ว
                  ของเดิมหาร 20 แล้วได้ 20.0/20 ซึ่งอ่านว่า "เต็มแล้ว" ทั้งที่
                  ตรวจไปแค่ 20% ของวิชา และอาจารย์ยังโพสต์งานเพิ่มได้อีก */}
              {sm.used_weight > 0 ? (
                <div className="mb-3">
                  <p className="text-2xl font-bold font-display text-primary leading-tight">
                    {sm.earned.toFixed(1)}
                    <span className="text-sm font-medium text-muted-foreground"> / 100</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    ตรวจแล้ว {round1(sm.used_weight)}% ของคะแนนทั้งหมด
                    <br />
                    {/* 100.0% ซ้ำกับคะแนนเต็มของวิชาจนสับสน จึงบอกเป็นคำแทนตัวเลข
                        กรณีที่ยังไม่เต็มยังบอกเป็นเปอร์เซ็นต์อยู่ เพราะเป็นข้อมูลที่
                        นักศึกษาใช้ประเมินตัวเองได้ และไม่ชนกับเลข 100 */}
                    {sm.normalized == null
                      ? '—'
                      : sm.normalized >= 99.95
                        ? 'ได้เต็มจากงานที่ตรวจแล้ว'
                        : `ได้ ${sm.normalized.toFixed(1)}% ของงานที่ตรวจแล้ว`}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mb-3">ยังไม่มีคะแนน</p>
              )}

              {/* ── รายหมวด กางดูรายการย่อยได้ ── */}
              <div className="space-y-2">
                {sm.components.map(c => {
                  const key = `${r.courseId}:${c.component_id}`;
                  const its = r.items
                    .filter(it => it.component_id === c.component_id)
                    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
                  // ── ความยาวแถบเทียบกับคะแนนเต็มของรายวิชา (100) ──
                  // ของเดิมหารด้วยน้ำหนักหมวดเอง ทำให้หมวด LAB น้ำหนัก 20 ที่ได้เต็ม
                  // แสดงแถบเต็มหลอด ซึ่งอ่านว่า "ได้คะแนนครบวิชาแล้ว"
                  // เนื่องจากคะแนนเต็มของวิชาคือ 100 ค่า c.earned จึงเป็นเปอร์เซ็นต์
                  // ของวิชาอยู่แล้ว ใช้ตรง ๆ ได้ — หมวด 20 ได้เต็มจะยาว 20% ของหลอด
                  // หมวดที่ยังไม่ตรวจและหมวดที่ถูกปิดบังให้แถบว่าง (ปิดบังจะวาดลายทางแทน)
                  const pct = c.masked || !c.has_any_score
                    ? 0
                    : Math.min(100, Math.max(0, c.earned));
                  // ความยาวของลายทางสำหรับหมวดที่ถูกปิดบัง บอกเฉพาะ "พื้นที่ที่จองไว้"
                  // ตามน้ำหนักหมวด เพราะคะแนนจริงยังไม่มีสิทธิ์เห็น
                  const maskedPct = c.masked ? Math.min(100, Math.max(0, c.weight)) : 0;
                  // ตรวจครบทุกงานที่คาดไว้แล้วหรือยัง — ถ้ายัง คะแนนยังเปลี่ยนได้
                  const done = c.graded_items >= c.counts_toward;
                  return (
                    <div key={c.component_id}>
                      <button
                        onClick={() => setOpen(o => ({ ...o, [key]: !o[key] }))}
                        disabled={its.length === 0}
                        className="w-full flex items-start gap-2 text-left">
                        {its.length > 0
                          ? (open[key] ? <ChevronDown className="w-3 h-3 mt-1 text-muted-foreground shrink-0" />
                                       : <ChevronRight className="w-3 h-3 mt-1 text-muted-foreground shrink-0" />)
                          : <span className="w-3 shrink-0" />}
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate"
                              title={`น้ำหนัก ${c.weight}%`}>
                              {c.name}
                            </span>
                            <span className="text-xs font-semibold text-foreground text-right shrink-0">
                              {c.masked ? (
                                <span className="inline-flex items-center gap-1 text-muted-foreground font-normal">
                                  <Lock className="w-3 h-3" /> {c.weight}%
                                </span>
                              ) : c.has_any_score
                                ? `${c.earned.toFixed(1)}/${round1(c.max_points)}`
                                : '—'}
                            </span>
                          </span>
                          <span className="block h-1.5 mt-1 rounded-full bg-muted overflow-hidden">
                            {c.masked ? (
                              // ลายทางสื่อว่า "มีคะแนนอยู่ตรงนี้แต่ยังดูไม่ได้"
                              // ต่างจากแถบว่างที่สื่อว่า "ยังไม่มีคะแนน"
                              <motion.span initial={{ width: 0 }}
                                animate={{ width: `${maskedPct}%` }}
                                transition={{ delay: i * 0.06 + 0.25, duration: 0.5 }}
                                className="block h-full rounded-full"
                                style={{
                                  backgroundImage:
                                    'repeating-linear-gradient(45deg,'
                                    + ' hsl(var(--muted-foreground) / 0.45) 0 2px,'
                                    + ' transparent 2px 5px)',
                                }} />
                            ) : (
                              <motion.span initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ delay: i * 0.06 + 0.25, duration: 0.5 }}
                                className="block h-full rounded-full gradient-primary" />
                            )}
                          </span>
                          {/* ── บอกให้ชัดว่าตัวเลขข้างบนคิดจากอะไร ──
                              ปัญหาเดิม: หมวด LAB 20% มีงาน 2 ชิ้น ได้เต็มทั้งคู่
                              แสดง 20.0/20 ทำให้เข้าใจว่าได้ LAB เต็มทั้งเทอมแล้ว
                              พออาจารย์โพสต์งานเพิ่ม ตัวเลขลดลงเอง เข้าใจว่าคะแนนหาย */}
                          {!c.masked && c.has_any_score && (
                            <span className="block text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                              {c.planned_item_count != null
                                ? `ตรวจแล้ว ${c.graded_items} จาก ${c.planned_item_count} ชิ้นที่วางแผนไว้`
                                : `คิดจากงานที่ตรวจแล้ว ${c.graded_items} ชิ้น`}
                              {' · '}เต็มหมวดนี้ {c.weight} คะแนน
                              {!done && (
                                <span className="block text-warning">
                                  คะแนนอาจเปลี่ยนเมื่ออาจารย์เพิ่มงานหรือตรวจงานเพิ่ม
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </button>

                      {open[key] && its.length > 0 && (
                        <div className="pl-5 pt-1 space-y-0.5">
                          {its.map(it => {
                            const s = r.scores[it.id];
                            return (
                              <div key={it.id} className="flex items-center gap-2 text-[10px]">
                                <span className="flex-1 min-w-0 truncate text-muted-foreground">{it.name}</span>
                                <span className="text-foreground font-medium shrink-0">
                                  {s == null ? 'รอตรวจ' : `${s}/${it.max_score}`}
                                </span>
                              </div>
                            );
                          })}
                          {c.dropped > 0 && (
                            <p className="text-[10px] text-muted-foreground">
                              หมวดนี้ตัดคะแนนต่ำสุดออก {c.dropped} รายการ
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="text-[10px] text-muted-foreground text-center mt-3 leading-relaxed">
                {sm.grade != null && sm.grade_is_final
                  ? `ประกาศผลแล้ว · ได้ ${sm.earned.toFixed(1)} จาก ${round1(sm.used_weight)} คะแนน`
                  : sm.fully_graded
                    ? 'ตรวจคะแนนครบแล้ว รอประกาศผล — ยังไม่แสดงเกรดจนกว่าอาจารย์จะประกาศ'
                    : `ยังประเมินไม่ครบ · ตรวจแล้ว ${round1(sm.used_weight)}% จากน้ำหนักทั้งหมด `
                      + `${round1(sm.declared_weight)}% (เหลืออีก ${remaining}%) — `
                      + 'ยังไม่แสดงตัวอักษรเกรดเพราะคิดจากคะแนนแค่บางส่วน'}
                {sm.masked_weight > 0 && (
                  <>
                    <br />
                    คะแนนที่ถูกปิดบังอยู่ {round1(sm.masked_weight)}% (คะแนนปลายภาค)
                    จะเห็นเมื่ออาจารย์ประกาศผล
                  </>
                )}
              </p>
            </motion.div>
          );
        })}
      </div>
    </MobileLayout>
  );
};

export default GradesPage;
