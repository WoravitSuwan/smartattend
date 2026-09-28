import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import {
  componentScore, courseScore, type GradeComponent, type StructureItem,
} from '@/lib/grade-structure';
import { calcModeLabels } from '@/lib/grade-structure-data';
import { letterGradeFrom, type GradeScaleRow } from '@/lib/grade-data';

interface Student { id: string; name: string; code: string }

interface Props {
  components: GradeComponent[];
  items: StructureItem[];
  students: Student[];
  /** คีย์ `${itemId}:${studentId}` */
  grades: Record<string, number | null>;
  badCells: Record<string, string>;
  scale: GradeScaleRow[];
  /** true = ประกาศผลแล้ว (คะแนนปลายภาคไม่ถูกปิดบังจากอาจารย์อยู่แล้ว แต่ใช้บอกสถานะ) */
  published: boolean;
  readOnly?: boolean;
  onChange: (itemId: string, studentId: string, raw: string) => void;
}

const SUMMARY = '__summary__';

/**
 * ตารางกรอกคะแนนแบบแท็บรายหมวด (สเปกข้อ 4.1)
 *
 * แท็บบนสุดคือหมวดคะแนน มีกี่หมวดก็ขึ้นเท่านั้นแท็บ แท็บสุดท้ายคือสรุปรวมเสมอ
 * แท็บหมวดแสดงทุกช่องย่อยพร้อมคอลัมน์รวมของหมวดท้ายสุด
 * แท็บสรุปแสดงยอดของทุกหมวดกับคะแนนรวม แก้ไม่ได้ กดที่ยอดของหมวดแล้วเด้งไปแท็บนั้น
 *
 * คะแนนคิดด้วย componentScore()/courseScore() ซึ่งเป็นสูตรเดียวกับที่ฐานข้อมูลใช้
 * ไม่ใช่ grade_items.weight แบบเดิม จึงไม่มีทางที่ตัวเลขฝั่งอาจารย์กับฝั่งนักศึกษา
 * จะไม่ตรงกัน
 */
const GradeSheet = ({
  components, items, students, grades, badCells, scale, published, readOnly, onChange,
}: Props) => {
  const [tab, setTab] = useState<string>(components[0]?.id ?? SUMMARY);

  const itemsOf = useMemo(() => {
    const m = new Map<string, StructureItem[]>();
    for (const c of components) {
      m.set(c.id, items.filter(i => i.component_id === c.id)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)));
    }
    return m;
  }, [components, items]);

  const scoreOf = (itemId: string, studentId: string) => grades[`${itemId}:${studentId}`] ?? null;

  const active = components.find(c => c.id === tab) ?? null;
  const activeItems = active ? (itemsOf.get(active.id) ?? []) : [];

  /** รายการที่ไม่ได้อยู่ในหมวดใดเลย — ไม่ถูกนับในคะแนน ต้องบอกอาจารย์ */
  const orphanItems = useMemo(
    () => items.filter(i => !i.component_id), [items]);

  if (components.length === 0) {
    return (
      <div className="bg-card rounded-2xl p-4 shadow-card">
        <p className="text-[11px] text-muted-foreground">
          ยังไม่มีหมวดคะแนน — ตั้งหมวดด้านบนก่อน แล้วรายการคะแนนจะเข้ามาอยู่ในแท็บของหมวดนั้น
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl shadow-card overflow-hidden">
      {/* ── แท็บ ── */}
      <div className="flex gap-1.5 overflow-x-auto p-2.5 border-b border-border scrollbar-hide">
        {components.map(c => {
          const n = (itemsOf.get(c.id) ?? []).length;
          return (
            <button key={c.id} onClick={() => setTab(c.id)}
              className={`whitespace-nowrap px-3 py-1.5 rounded-xl text-[11px] font-medium transition-all ${
                tab === c.id ? 'gradient-primary text-primary-foreground shadow-elevated'
                             : 'bg-muted text-muted-foreground'
              }`}>
              {c.name} {c.weight_percent}%
              {c.is_final_exam && !published && <Lock className="w-2.5 h-2.5 inline ml-1" />}
              <span className="opacity-70"> ({n})</span>
            </button>
          );
        })}
        <button onClick={() => setTab(SUMMARY)}
          className={`whitespace-nowrap px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${
            tab === SUMMARY ? 'gradient-primary text-primary-foreground shadow-elevated'
                            : 'bg-muted text-muted-foreground'
          }`}>
          สรุปรวม
        </button>
      </div>

      {/* ── แท็บหมวด ── */}
      {active && (
        <>
          <div className="px-3 py-2 text-[10px] text-muted-foreground leading-relaxed border-b border-border">
            วิธีคิด: {calcModeLabels[active.calc_mode]}
            {active.drop_lowest > 0 && ` · ตัดคะแนนต่ำสุดออก ${active.drop_lowest} รายการ`}
            {active.score_mode === 'auto_attendance' && ' · คะแนนมาจากการเข้าเรียน กรอกมือไม่ได้'}
            {active.is_final_exam && !published && ' · นักศึกษายังไม่เห็นคะแนนหมวดนี้จนกว่าจะประกาศผล'}
          </div>

          {activeItems.length === 0 ? (
            <p className="p-4 text-[11px] text-muted-foreground">
              หมวดนี้ยังไม่มีรายการคะแนน — กดจำนวนรายการในกล่อง "โครงสร้างคะแนน" ด้านบน
              เพื่อกางรายการของหมวดนี้แล้วเพิ่ม หรือโพสต์งานที่ผูกกับหมวดนี้
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-2.5 font-medium text-muted-foreground sticky left-0 bg-card">
                      นักศึกษา
                    </th>
                    {activeItems.map(it => (
                      <th key={it.id} className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                        {it.name}
                        <br />
                        <span className="text-[9px] font-normal">
                          /{it.max_score}
                          {active.calc_mode === 'weighted_items' && ` · ${it.weight_in_component}%`}
                        </span>
                      </th>
                    ))}
                    <th className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                      รวมหมวด<br /><span className="text-[9px] font-normal">/{active.weight_percent}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s, i) => {
                    const cs = componentScore(active, activeItems, id => scoreOf(id, s.id));
                    return (
                      <motion.tr key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        transition={{ delay: Math.min(i * 0.015, 0.4) }}
                        className="border-b border-border last:border-0">
                        <td className="p-2.5 sticky left-0 bg-card">
                          <p className="font-medium text-foreground whitespace-nowrap">{s.name}</p>
                          <p className="text-[10px] text-muted-foreground">{s.code}</p>
                        </td>
                        {activeItems.map(it => {
                          const key = `${it.id}:${s.id}`;
                          const err = badCells[key];
                          const auto = active.score_mode === 'auto_attendance'
                            || it.source !== 'manual';
                          return (
                            <td key={it.id} className="p-1.5 text-center">
                              <input
                                type="number" min={0} max={it.max_score} step="any"
                                value={grades[key] ?? ''}
                                disabled={readOnly || auto}
                                onChange={e => onChange(it.id, s.id, e.target.value)}
                                title={err ?? (auto ? 'คะแนนนี้คำนวณอัตโนมัติ แก้ที่ต้นทาง' : undefined)}
                                aria-invalid={!!err}
                                className={`w-14 px-1.5 py-1 rounded-lg text-center outline-none disabled:opacity-60 ${
                                  err ? 'bg-destructive/15 text-destructive ring-1 ring-destructive'
                                      : 'bg-muted text-foreground'
                                }`}
                              />
                            </td>
                          );
                        })}
                        <td className="p-2.5 text-center font-semibold text-foreground whitespace-nowrap">
                          {cs.hasAnyScore
                            ? `${cs.earned.toFixed(2)} / ${cs.maxPoints.toFixed(2)}`
                            : '—'}
                          {cs.dropped > 0 && (
                            <span className="block text-[9px] font-normal text-muted-foreground">
                              ตัด {cs.droppedNames.join(', ')}
                            </span>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── แท็บสรุป ── */}
      {tab === SUMMARY && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left p-2.5 font-medium text-muted-foreground sticky left-0 bg-card">
                  นักศึกษา
                </th>
                {components.map(c => (
                  <th key={c.id} className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                    <button onClick={() => setTab(c.id)} className="hover:text-primary">
                      {c.name}<br /><span className="text-[9px] font-normal">/{c.weight_percent}</span>
                    </button>
                  </th>
                ))}
                <th className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                  ได้<br /><span className="text-[9px] font-normal">/ ที่ตรวจแล้ว</span>
                </th>
                <th className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                  ร้อยละ<br /><span className="text-[9px] font-normal">ของที่ตรวจ</span>
                </th>
                <th className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                  เกรด<br /><span className="text-[9px] font-normal">คาดการณ์</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {students.map((s, i) => {
                const total = courseScore(components, cid => itemsOf.get(cid) ?? [],
                  id => scoreOf(id, s.id));
                const g = total.normalized == null ? null : letterGradeFrom(scale, total.normalized);
                const done = total.usedWeight >= 99.99;
                return (
                  <motion.tr key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.015, 0.4) }}
                    className="border-b border-border last:border-0">
                    <td className="p-2.5 sticky left-0 bg-card">
                      <p className="font-medium text-foreground whitespace-nowrap">{s.name}</p>
                      <p className="text-[10px] text-muted-foreground">{s.code}</p>
                    </td>
                    {total.perComponent.map(pc => (
                      <td key={pc.component.id} className="p-2.5 text-center">
                        <button onClick={() => setTab(pc.component.id)}
                          className="text-foreground hover:text-primary">
                          {pc.score.hasAnyScore ? pc.score.earned.toFixed(2) : '—'}
                        </button>
                      </td>
                    ))}
                    <td className="p-2.5 text-center font-semibold text-foreground whitespace-nowrap">
                      {total.usedWeight > 0
                        ? `${total.earned.toFixed(2)} / ${total.usedWeight.toFixed(0)}`
                        : '—'}
                    </td>
                    <td className="p-2.5 text-center font-semibold text-foreground">
                      {total.normalized == null ? '—' : `${total.normalized.toFixed(1)}%`}
                    </td>
                    <td className="p-2.5 text-center font-bold whitespace-nowrap">
                      {g == null ? '—' : (done ? g : `${g}*`)}
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── ท้ายตาราง ── */}
      <div className="px-3 py-2.5 border-t border-border space-y-1">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          ช่องที่ยังไม่ตรวจแสดงเป็นขีด ไม่ใช่ศูนย์ และไม่ถูกนับในตัวหาร ·
          เครื่องหมาย * = ยังตรวจไม่ครบ 100% เกรดยังเปลี่ยนได้ ·
          นักศึกษาจะไม่เห็นตัวอักษรเกรดจนกว่าจะตรวจครบและประกาศผล
        </p>
        {orphanItems.length > 0 && (
          <p className="text-[10px] text-warning leading-relaxed">
            มีรายการคะแนน {orphanItems.length} รายการที่ยังไม่อยู่ในหมวดใด
            ({orphanItems.map(i => i.name).join(', ')}) — รายการเหล่านี้ยังไม่ถูกนับในคะแนนรวม
            ให้แก้รายการนั้นแล้วเลือกหมวด
          </p>
        )}
      </div>
    </div>
  );
};

export default GradeSheet;
