import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Lock, PencilLine } from 'lucide-react';
import {
  componentScore, courseScore, type GradeComponent, type StructureItem,
} from '@/lib/grade-structure';
import { calcModeLabels } from '@/lib/grade-structure-data';
import { isFullyGraded, letterGradeFrom, type GradeScaleRow } from '@/lib/grade-data';

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
  /**
   * id ของรายการคะแนนที่มีการส่งงานอยู่จริงอย่างน้อยหนึ่งชิ้น
   *
   * ใช้เตือนอาจารย์ว่าถ้าตรวจงานที่ส่งภายหลัง trigger trg_sync_submission_score
   * จะเขียนทับคะแนนที่กรอกเองทิ้ง กรณีสอบกระดาษที่ไม่มีใครส่งงานเลยจะไม่อยู่ใน
   * ชุดนี้ จึงไม่ต้องเตือนให้รำคาญ
   */
  itemsWithSubmissions?: Set<string>;
  onChange: (itemId: string, studentId: string, raw: string) => void;
}

const SUMMARY = '__summary__';

/**
 * ช่องกรอกคะแนนช่องนี้พิมพ์ได้หรือไม่ — กฎเดียวที่ใช้ทั้งตาราง
 *
 * แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพื่อให้ทดสอบกฎได้ตรง ๆ โดยไม่ต้อง render ตาราง
 * ทั้งใบ กฎนี้เคยผิดมาแล้วตรงที่เหมาว่า source ไม่ใช่ manual คือแก้ไม่ได้ทั้งหมด
 * ซึ่งกินงานจาก assignment เข้าไปด้วย ทำให้อาจารย์ที่สอบแบบกระดาษกรอกคะแนนไม่ได้
 *
 * ลำดับความสำคัญ
 *   1. ประกาศผลแล้ว  ล็อกเสมอ สวิตช์แก้ด้วยมือก็ปลดไม่ได้
 *   2. คะแนนเข้าเรียน ล็อกไว้ก่อน ปลดได้ด้วยสวิตช์ระดับคอลัมน์
 *   3. ที่เหลือ       พิมพ์ได้ รวมถึงงานที่มาจาก assignment
 */
export function isCellLocked(args: {
  readOnly?: boolean;
  itemSource: StructureItem['source'];
  componentScoreMode?: string;
  manualOverride?: boolean;
}): boolean {
  if (args.readOnly) return true;
  const fromAttendance = args.componentScoreMode === 'auto_attendance'
    || args.itemSource === 'attendance';
  return fromAttendance && !args.manualOverride;
}

/** ปัดสองตำแหน่งตอนแสดงผลเท่านั้น ไม่ปัดระหว่างคำนวณ และไม่โชว์ .00 ที่ไม่จำเป็น */
const round2 = (n: number) => String(Math.round(n * 100) / 100);

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
  components, items, students, grades, badCells, scale, published, readOnly,
  itemsWithSubmissions, onChange,
}: Props) => {
  const [tab, setTab] = useState<string>(components[0]?.id ?? SUMMARY);

  /**
   * คอลัมน์คะแนนเข้าเรียนที่อาจารย์เปิดให้แก้ด้วยมือ (คีย์ = id ของรายการ)
   *
   * ไม่เก็บลงฐานข้อมูลโดยตั้งใจ เป็นสวิตช์ชั่วคราวของหน้าจอเท่านั้น
   * เหตุที่ต้องมีสวิตช์กั้นแทนการปลดล็อกทิ้ง เพราะคะแนนเข้าเรียนคำนวณจากข้อมูล
   * การสแกนจริง ถ้าพิมพ์ทับโดยไม่ตั้งใจ ตัวเลขจะไม่ตรงกับหลักฐานในระบบ
   * และอธิบายที่มาของคะแนนไม่ได้เมื่อมีการโต้แย้ง
   */
  const [manualOverride, setManualOverride] = useState<Record<string, boolean>>({});

  /** ช่องที่ถูกพิมพ์ทับด้วยมือในรอบนี้ ใช้ทำเครื่องหมายให้ต่างจากค่าที่ระบบคำนวณ */
  const [handEdited, setHandEdited] = useState<Record<string, boolean>>({});

  /** เตือนเรื่องการส่งงานครั้งเดียวต่อหนึ่งรายการ ไม่ใช่ทุกครั้งที่พิมพ์ */
  const warned = useRef<Set<string>>(new Set());

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
  /** คอลัมน์ของหมวดนี้ยังถูกปิดบังจากนักศึกษาอยู่ (ปลายภาคและยังไม่ประกาศผล) */
  const lockedColumn = !!active?.is_final_exam && !published;

  /**
   * รายการนี้เป็นคะแนนที่ระบบคำนวณจากการเข้าเรียนหรือไม่
   *
   * เดิมโค้ดถือว่า "source ไม่ใช่ manual" คือแก้ไม่ได้ทั้งหมด ซึ่งเหมารวมงานที่
   * มาจาก assignment เข้าไปด้วย อาจารย์ที่สอบแบบกระดาษจึงกรอกคะแนนไม่ได้เลย
   * ทั้งที่ฐานข้อมูลอนุญาตให้เขียนได้ (ไม่มี constraint หรือ trigger ใดห้ามไว้)
   * ตัวล็อกที่ควรมีจริง ๆ มีแค่คะแนนเข้าเรียนเท่านั้น
   */
  const isAttendanceItem = (it: StructureItem) =>
    active?.score_mode === 'auto_attendance' || it.source === 'attendance';

  /** ช่องของรายการนี้พิมพ์ไม่ได้หรือไม่ — ใช้กฎเดียวกับที่เทสต์ครอบไว้ */
  const isItemLocked = (it: StructureItem) => isCellLocked({
    readOnly,
    itemSource: it.source,
    componentScoreMode: active?.score_mode,
    manualOverride: manualOverride[it.id],
  });

  const toggleManual = (itemId: string) => {
    setManualOverride(prev => {
      const next = !prev[itemId];
      if (next) {
        toast.warning('เปิดให้แก้คะแนนเข้าเรียนด้วยมือแล้ว', {
          description: 'คะแนนนี้คำนวณจากการสแกนจริง ถ้าพิมพ์ทับจะไม่ตรงกับหลักฐานในระบบ',
        });
      }
      return { ...prev, [itemId]: next };
    });
  };

  /**
   * ดักการพิมพ์เพื่อเตือนและทำเครื่องหมาย ก่อนส่งต่อให้ผู้เรียกตามเดิม
   * ไม่แตะค่าที่ส่งออกไป จึงไม่กระทบเส้นทางบันทึกคะแนนที่มีอยู่
   */
  const handleChange = (it: StructureItem, studentId: string, raw: string) => {
    if (itemsWithSubmissions?.has(it.id) && !warned.current.has(it.id)) {
      warned.current.add(it.id);
      toast.warning(`"${it.name}" มีการส่งงานอยู่`, {
        description: 'ถ้าตรวจงานที่ส่งภายหลัง คะแนนที่กรอกเองจะถูกเขียนทับ',
      });
    }
    if (isAttendanceItem(it)) {
      setHandEdited(prev => ({ ...prev, [`${it.id}:${studentId}`]: true }));
    }
    onChange(it.id, studentId, raw);
  };

  /** น้ำหนักรวมที่อาจารย์ตั้งไว้ทุกหมวด — ตัวหารของ "ตรวจไปแล้วกี่เปอร์เซ็นต์" */
  const declaredWeight = useMemo(
    () => Math.round(components.reduce((a, c) => a + (Number(c.weight_percent) || 0), 0) * 100) / 100,
    [components]);

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
            {active.score_mode === 'auto_attendance'
              && ' · คะแนนมาจากการเข้าเรียน ถ้าต้องแก้เป็นรายคน กดปุ่ม "แก้ด้วยมือ" ที่หัวคอลัมน์'}
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
                        {/* คอลัมน์ของหมวดปลายภาคที่ยังไม่ประกาศผล ติดแม่กุญแจไว้ให้เห็น
                            ว่านักศึกษายังไม่เห็นคะแนนช่องนี้ */}
                        {lockedColumn && (
                          <Lock className="w-2.5 h-2.5 inline mr-1 text-warning"
                            aria-label="นักศึกษายังไม่เห็นคะแนนคอลัมน์นี้" />
                        )}
                        {it.name}
                        <br />
                        <span className="text-[9px] font-normal">
                          /{it.max_score}
                          {active.calc_mode === 'weighted_items' && ` · ${it.weight_in_component}%`}
                          {lockedColumn && ' · ล็อก'}
                        </span>
                        {/* สวิตช์ปลดล็อกเฉพาะคอลัมน์คะแนนเข้าเรียน
                            ไม่ขึ้นตอนประกาศผลแล้ว เพราะตอนนั้นล็อกทุกช่องอยู่ดี
                            การโชว์สวิตช์ที่กดแล้วไม่เกิดอะไรทำให้เข้าใจผิด */}
                        {isAttendanceItem(it) && !readOnly && (
                          <button type="button" onClick={() => toggleManual(it.id)}
                            aria-pressed={!!manualOverride[it.id]}
                            className={`mt-1 mx-auto flex items-center gap-1 px-1.5 py-0.5 rounded-md
                              text-[9px] font-medium transition-colors ${
                              manualOverride[it.id]
                                ? 'bg-warning/20 text-warning'
                                : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}>
                            {manualOverride[it.id]
                              ? <PencilLine className="w-2.5 h-2.5" />
                              : <Lock className="w-2.5 h-2.5" />}
                            แก้ด้วยมือ
                          </button>
                        )}
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
                          const locked = isItemLocked(it);
                          const edited = !!handEdited[key];
                          return (
                            <td key={it.id} className="p-1.5 text-center">
                              <input
                                type="number" min={0} max={it.max_score} step="any"
                                value={grades[key] ?? ''}
                                // ช่องว่าง = ยังไม่ตรวจ ไม่ใช่ศูนย์ แสดงขีดไว้ให้อ่านออก
                                placeholder="—"
                                disabled={locked}
                                onChange={e => handleChange(it, s.id, e.target.value)}
                                title={err ?? (
                                  readOnly ? 'ประกาศผลแล้ว แก้คะแนนไม่ได้'
                                  : locked ? 'คะแนนจากการเข้าเรียน กดปุ่ม "แก้ด้วยมือ" ที่หัวคอลัมน์ก่อนจึงจะพิมพ์ได้'
                                  : edited ? 'ค่านี้ถูกพิมพ์ทับด้วยมือ ไม่ใช่ค่าที่ระบบคำนวณ'
                                  : undefined)}
                                aria-invalid={!!err}
                                className={`w-14 px-1.5 py-1 rounded-lg text-center outline-none disabled:opacity-60 ${
                                  err ? 'bg-destructive/15 text-destructive ring-1 ring-destructive'
                                  // ช่องที่พิมพ์ทับด้วยมือต้องดูต่างจากค่าที่ระบบคำนวณ
                                  // ใช้ทั้งสีและขอบ ไม่พึ่งสีอย่างเดียว เผื่อคนตาบอดสี
                                  : edited ? 'bg-warning/15 text-foreground ring-1 ring-warning'
                                      : 'bg-muted text-foreground'
                                }`}
                              />
                              {edited && (
                                <span className="block text-[8px] text-warning leading-none mt-0.5">
                                  แก้มือ
                                </span>
                              )}
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
                {components.map(c => {
                  const locked = c.is_final_exam && !published;
                  return (
                    <th key={c.id} className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                      <button onClick={() => setTab(c.id)} className="hover:text-primary">
                        {locked && (
                          <Lock className="w-2.5 h-2.5 inline mr-1 text-warning"
                            aria-label="นักศึกษายังไม่เห็นคะแนนหมวดนี้" />
                        )}
                        {c.name}<br />
                        <span className="text-[9px] font-normal">
                          /{c.weight_percent}{locked && ' · ล็อก'}
                        </span>
                      </button>
                    </th>
                  );
                })}
                <th className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                  ได้<br /><span className="text-[9px] font-normal">/ น้ำหนักที่ตรวจแล้ว</span>
                </th>
                <th className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                  ตรวจแล้ว<br /><span className="text-[9px] font-normal">ของ {declaredWeight}%</span>
                </th>
                <th className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                  ร้อยละ<br /><span className="text-[9px] font-normal">ของที่ตรวจ</span>
                </th>
                <th className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                  เกรด<br /><span className="text-[9px] font-normal">ตรวจครบแล้วเท่านั้น</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {students.map((s, i) => {
                const total = courseScore(components, cid => itemsOf.get(cid) ?? [],
                  id => scoreOf(id, s.id));
                // ตัวอักษรเกรดแสดงได้ต่อเมื่อ "ตรวจครบน้ำหนัก 100" เท่านั้น
                // ระหว่างเทอมที่ยังตรวจไม่ครบ ตัวเลขที่คิดได้มาจากคะแนนแค่บางส่วน
                // เอาไปตัดเกรดไม่ได้ และเคยทำให้ทั้งตารางขึ้น F ตอนยังไม่กรอกอะไรเลย
                const done = isFullyGraded(total);
                const g = done && total.normalized != null
                  ? letterGradeFrom(scale, total.normalized)
                  : null;
                const gradedPct = total.declaredWeight > 0
                  ? (total.usedWeight / total.declaredWeight) * 100
                  : 0;
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
                        ? `${round2(total.earned)} / ${round2(total.usedWeight)}`
                        : '—'}
                    </td>
                    <td className="p-2.5 text-center text-muted-foreground whitespace-nowrap">
                      {total.usedWeight > 0
                        ? `${round2(total.usedWeight)}% (${gradedPct.toFixed(0)}%)`
                        : '—'}
                    </td>
                    <td className="p-2.5 text-center font-semibold text-foreground">
                      {total.normalized == null ? '—' : `${total.normalized.toFixed(1)}%`}
                    </td>
                    <td className="p-2.5 text-center font-bold whitespace-nowrap">
                      {g ?? <span className="font-normal text-muted-foreground">—</span>}
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
          แม่กุญแจ = คอลัมน์ที่นักศึกษายังไม่เห็นจนกว่าจะประกาศผล ·
          คอลัมน์ "ได้" เทียบกับน้ำหนักที่ตรวจแล้ว ไม่ใช่เทียบ 100 ·
          ตัวอักษรเกรดขึ้นเมื่อตรวจครบ {declaredWeight}% แล้วเท่านั้น
          ก่อนหน้านั้นแสดงเป็นขีด เพราะคิดจากคะแนนแค่บางส่วนยังตัดเกรดไม่ได้ ·
          นักศึกษาจะไม่เห็นตัวอักษรเกรดจนกว่าจะตรวจครบและอาจารย์ประกาศผล
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
