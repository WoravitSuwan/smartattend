import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronDown, ChevronRight, Copy, FileStack, HelpCircle, Loader2, Plus, Save, Trash2, X,
} from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import AttendanceCreditPreview from '@/components/AttendanceCreditPreview';
import ComponentItemsEditor from '@/components/ComponentItemsEditor';
import {
  applyTemplate, calcModeHelp, calcModeLabels, componentKinds, copyGradeStructure,
  deleteTemplate, fetchComponents, fetchStructureItems, fetchTemplates, saveGradeStructure,
  savePlannedItemCount, saveTemplate, scoreModeLabels,
  type ComponentDraft, type StructureTemplate,
} from '@/lib/grade-structure-data';
import {
  itemWeightsComplete, weightsComplete, type CalcMode, type GradeComponent,
  type ScoreMode, type StructureItem,
} from '@/lib/grade-structure';
import { fetchInstructorCourses } from '@/lib/attendance-data';
import { useAuth } from '@/lib/auth-context';

interface Row extends ComponentDraft { key: string }

const KINDS = Object.entries(componentKinds) as [string, string][];

/** ป้ายสั้นสำหรับแถวย่อ ป้ายเต็มยาวเกินกว่าจะใส่ในบรรทัดเดียวบนจอ 390px */
const calcModeShort: Record<CalcMode, string> = {
  proportional: 'ตามสัดส่วน',
  weighted_items: 'ถ่วงน้ำหนักย่อย',
};

/** กางอยู่หรือไม่ — แยกเป็นฟังก์ชันเพื่อให้อ่านง่ายใน JSX ที่ซ้อนหลายชั้น */
const open2 = (openKey: string | null, key: string) => openKey === key;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** คะแนนดิบเต็มรวมของหมวด คิดจากรายการที่มีอยู่จริง ณ ตอนนั้น */
const sumMaxScore = (items: StructureItem[]) =>
  round2(items.reduce((a, i) => a + (Number(i.max_score) || 0), 0));

/** น้ำหนักย่อยรวมของหมวด ใช้เฉพาะโหมด weighted_items */
const sumItemWeight = (items: StructureItem[]) =>
  round2(items.reduce((a, i) => a + (Number(i.weight_in_component) || 0), 0));

const toRows = (cs: GradeComponent[]): Row[] => cs.map(c => ({
  key: c.id, id: c.id, name: c.name, kind: c.kind,
  weight_percent: c.weight_percent, calc_mode: c.calc_mode, drop_lowest: c.drop_lowest,
  is_final_exam: c.is_final_exam, score_mode: c.score_mode,
  credit_on_time: c.credit_on_time, credit_late: c.credit_late,
  credit_excused: c.credit_excused, credit_absent: c.credit_absent,
  planned_item_count: c.planned_item_count,
}));

/**
 * ตั้งโครงสร้างคะแนนของรายวิชา — หมวดคะแนนถือน้ำหนัก รายการย่อยถือคะแนนเต็ม
 *
 * น้ำหนักรวมไม่ครบ 100 บันทึกได้ (กรอกคะแนนระหว่างเทอมต้องทำได้) แต่จะมีป้าย
 * เตือนค้างไว้ และประกาศผลไม่ได้จนกว่าจะครบ ซึ่งบังคับที่ฐานข้อมูล
 */
const GradeStructurePanel = ({ courseId }: { courseId: string }) => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  /** หมวดตามที่ฐานข้อมูลเก็บไว้จริง (rows คือสำเนาที่แก้ค้างอยู่ในฟอร์ม) */
  const [saved, setSaved] = useState<GradeComponent[]>([]);
  const [items, setItems] = useState<StructureItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  /** หมวดที่กางรายการคะแนนอยู่ */
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});
  /** หมวดที่กางรายละเอียดอยู่ — กางได้ทีละหมวดเพื่อไม่ให้หน้ายาวเกินไป
   *  ของเดิมกางทุกหมวดพร้อมกัน 5 หมวดต้องเลื่อนจอหลายหน้ากว่าจะถึงหมวดสุดท้าย */
  const [openRow, setOpenRow] = useState<string | null>(null);
  /** คำอธิบายวิธีคิดคะแนนที่กำลังเปิดอยู่ — ย้ายออกจากทุกกล่องมาไว้ที่เดียว */
  const [helpFor, setHelpFor] = useState<CalcMode | null>(null);

  const [templates, setTemplates] = useState<StructureTemplate[]>([]);
  const [otherCourses, setOtherCourses] = useState<{ id: string; code: string; name: string }[]>([]);
  const [copyAsk, setCopyAsk] = useState(false);
  const [templateAsk, setTemplateAsk] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [cs, its, tpl] = await Promise.all([
      fetchComponents(courseId), fetchStructureItems(courseId), fetchTemplates(),
    ]);
    setRows(toRows(cs));
    setSaved(cs);
    setItems(its);
    setTemplates(tpl);
    setRemovedIds([]);
    setLoading(false);
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  const totalWeight = useMemo(
    () => Math.round(rows.reduce((a, r) => a + (Number(r.weight_percent) || 0), 0) * 100) / 100,
    [rows]);
  const complete = weightsComplete(rows.map(r => ({ weight_percent: r.weight_percent })));

  /** หมวดที่บันทึกแล้วจากฐานข้อมูล — ตัวแก้รายการต้องใช้ calc_mode ที่บันทึกจริง
   *  ไม่ใช่ค่าที่กำลังพิมพ์ค้างอยู่ในฟอร์ม ไม่งั้นกฎน้ำหนักย่อยจะไม่ตรงกับที่
   *  ฐานข้อมูลบังคับ
   *  คืน undefined ได้ เช่นระหว่างโหลดใหม่หลังบันทึก — ผู้เรียกต้องเช็คก่อนใช้ */
  const savedById = useMemo(
    () => new Map(saved.map(c => [c.id, c])), [saved]);
  const savedOf = (id: string) => savedById.get(id);

  const itemsOf = useCallback(
    (componentId?: string | null) =>
      componentId ? items.filter(i => i.component_id === componentId) : [],
    [items]);

  const setRow = (key: string, patch: Partial<ComponentDraft>) =>
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = () => setRows(prev => [...prev, {
    key: `new-${Date.now()}`, name: '', kind: 'other', weight_percent: 0,
    calc_mode: 'proportional', drop_lowest: 0, is_final_exam: false, score_mode: 'manual',
  }]);

  const removeRow = (key: string) => {
    const row = rows.find(r => r.key === key);
    if (row?.id) setRemovedIds(prev => [...prev, row.id!]);
    setRows(prev => prev.filter(r => r.key !== key));
  };

  const problems = useMemo(() => {
    const out: string[] = [];
    if (rows.some(r => !r.name.trim())) out.push('มีหมวดที่ยังไม่ใส่ชื่อ');
    const names = rows.map(r => r.name.trim()).filter(Boolean);
    if (new Set(names).size !== names.length) out.push('มีชื่อหมวดซ้ำกัน');
    if (rows.some(r => r.weight_percent < 0 || r.weight_percent > 100)) {
      out.push('น้ำหนักหมวดต้องอยู่ระหว่าง 0 - 100');
    }
    for (const r of rows) {
      if (r.calc_mode !== 'weighted_items' || !r.id) continue;
      const its = itemsOf(r.id);
      if (its.length > 0 && !itemWeightsComplete(its)) {
        out.push(`หมวด "${r.name}" คิดแบบถ่วงน้ำหนักรายการย่อย ต้องให้น้ำหนักย่อยรวมเป็น 100`);
      }
    }
    if (rows.filter(r => r.is_final_exam).length > 1) {
      out.push('ตั้งหมวดสอบปลายภาค (ปิดบังคะแนน) ได้มากกว่าหนึ่งหมวด แต่ปกติควรมีหมวดเดียว');
    }
    return out;
  }, [rows, itemsOf]);

  const save = async (deleteMissing: boolean) => {
    setSaving(true);
    const { error } = await saveGradeStructure(
      courseId,
      rows.map(({ key, ...r }) => ({ ...r, name: r.name.trim() })),
      { deleteMissing, reason: reason.trim() || undefined },
    );
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error(error.message || 'บันทึกโครงสร้างคะแนนไม่สำเร็จ');
      return;
    }
    // planned_item_count ไม่ได้ผ่าน save_grade_structure_v2 จึงบันทึกต่อท้าย
    // เฉพาะหมวดที่ค่าเปลี่ยนจริง เพื่อไม่ยิง RPC เกินจำเป็น
    const before = new Map(saved.map(c => [c.id, c.planned_item_count ?? null]));
    const changed = rows.filter(r =>
      r.id && (r.planned_item_count ?? null) !== (before.get(r.id) ?? null));
    for (const r of changed) {
      const { error: e2 } = await savePlannedItemCount(r.id!, r.planned_item_count ?? null);
      if (e2) toast.error(`บันทึกจำนวนงานที่วางแผนไว้ของ "${r.name}" ไม่สำเร็จ`);
    }

    toast.success('บันทึกโครงสร้างคะแนนแล้ว');
    setReason('');
    load();
  };

  const doCopy = async (fromCourseId: string) => {
    setBusy(true);
    const { error } = await copyGradeStructure(fromCourseId, courseId, true);
    setBusy(false);
    setCopyAsk(false);
    if (error) { toast.error(error.message || 'คัดลอกไม่สำเร็จ'); return; }
    toast.success('คัดลอกโครงสร้างคะแนนแล้ว (ไม่ได้คัดลอกคะแนนของนักศึกษา)');
    load();
  };

  const doSaveTemplate = async () => {
    if (!templateName.trim()) { toast.error('กรุณาตั้งชื่อแม่แบบ'); return; }
    setBusy(true);
    const { error } = await saveTemplate(courseId, templateName.trim());
    setBusy(false);
    if (error) { toast.error(error.message || 'บันทึกแม่แบบไม่สำเร็จ'); return; }
    toast.success('บันทึกแม่แบบแล้ว');
    setTemplateName('');
    setTemplateAsk(false);
    load();
  };

  const doApplyTemplate = async (id: string) => {
    setBusy(true);
    const { error } = await applyTemplate(id, courseId);
    setBusy(false);
    if (error) { toast.error(error.message || 'ใช้แม่แบบไม่สำเร็จ'); return; }
    toast.success('ใช้แม่แบบแล้ว');
    load();
  };

  useEffect(() => {
    // รายวิชาอื่นของอาจารย์คนเดียวกัน สำหรับปุ่มคัดลอก
    if (!user?.id) return;
    let cancelled = false;
    fetchInstructorCourses(user.id)
      .then(cs => {
        if (cancelled) return;
        setOtherCourses((cs as { id: string; code: string; name: string }[])
          .filter(c => c.id !== courseId));
      })
      .catch(() => { /* ไม่มีรายวิชาอื่นก็ไม่เป็นไร ปุ่มคัดลอกจะถูกปิดไว้ */ });
    return () => { cancelled = true; };
  }, [courseId, user?.id]);

  return (
    <div className="bg-card rounded-2xl p-4 shadow-card space-y-3">
      {/* แถบสรุปน้ำหนักรวมติดอยู่ด้านบนตลอดที่เลื่อนจอ จะได้รู้ว่าครบ 100% หรือยัง
          โดยไม่ต้องเลื่อนกลับขึ้นไป · -mx-4/px-4 เพื่อให้พื้นหลังเต็มความกว้างการ์ด */}
      <div className="sticky top-0 z-10 bg-card -mx-4 px-4 -mt-4 pt-4 pb-2
                      flex items-start justify-between gap-2 border-b border-border">
        <div>
          <p className="text-xs font-semibold text-foreground">
            โครงสร้างคะแนน · น้ำหนักรวม {totalWeight}%
          </p>
          <p className={`text-[10px] mt-0.5 leading-relaxed ${complete ? 'text-success' : 'text-warning'}`}>
            {complete
              ? 'น้ำหนักรวมครบ 100% พร้อมประกาศผลได้'
              : `ยังไม่ครบ 100% (${totalWeight < 100
                  ? `ขาดอีก ${Math.round((100 - totalWeight) * 100) / 100}%`
                  : `เกินมา ${Math.round((totalWeight - 100) * 100) / 100}%`}) — กรอกคะแนนได้ปกติ แต่ยังประกาศผลไม่ได้`}
          </p>
        </div>
        <button onClick={addRow} className="inline-flex items-center gap-1 text-[11px] text-primary font-medium shrink-0">
          <Plus className="w-3.5 h-3.5" /> เพิ่มหมวด
        </button>
      </div>

      {loading ? (
        <p className="text-[11px] text-muted-foreground py-2">กำลังโหลด...</p>
      ) : (
        <>
          {rows.length === 0 && (
            <p className="text-[11px] text-muted-foreground py-2">
              ยังไม่มีหมวดคะแนน — กด "เพิ่มหมวด" หรือคัดลอกจากรายวิชาอื่น/แม่แบบด้านล่าง
            </p>
          )}

          <div className="space-y-2">
            {rows.map(r => {
              const its = itemsOf(r.id);
              const itemWeightBad = r.calc_mode === 'weighted_items'
                && its.length > 0 && !itemWeightsComplete(its);
              return (
                <div key={r.key} className="rounded-xl border border-border overflow-hidden">
                  {/* ── แถวย่อ: เห็นทุกหมวดในหน้าเดียว กดจึงกางแก้ไข ── */}
                  <button type="button"
                    onClick={() => setOpenRow(o => (o === r.key ? null : r.key))}
                    className="w-full flex items-center gap-2 p-2.5 text-left">
                    {open2(openRow, r.key)
                      ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-medium text-foreground truncate">
                        {r.name.trim() || 'หมวดใหม่ (ยังไม่ใส่ชื่อ)'}
                      </span>
                      <span className={`block text-[10px] truncate ${
                        itemWeightBad ? 'text-destructive' : 'text-muted-foreground'
                      }`}>
                        {r.weight_percent}% · {its.length} รายการ · {calcModeShort[r.calc_mode]}
                        {itemWeightBad && ' · น้ำหนักย่อยยังไม่ครบ 100%'}
                      </span>
                    </span>
                    <span className="p-1 rounded-lg shrink-0" role="button" tabIndex={-1}
                      onClick={e => { e.stopPropagation(); removeRow(r.key); }}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </span>
                  </button>

                  {open2(openRow, r.key) && (
                  <div className="px-2.5 pb-2.5 space-y-2 border-t border-border pt-2.5">
                  <div className="flex items-center gap-2">
                    <input value={r.name} onChange={e => setRow(r.key, { name: e.target.value })}
                      placeholder="ชื่อหมวด เช่น LABs"
                      className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-muted text-xs text-foreground outline-none" />
                    <div className="flex items-center gap-1 shrink-0">
                      <input value={r.weight_percent} type="number" min={0} max={100} step="any"
                        onChange={e => setRow(r.key, { weight_percent: Number(e.target.value) })}
                        className="w-16 px-2 py-1.5 rounded-lg bg-muted text-xs text-foreground text-center outline-none" />
                      <span className="text-[10px] text-muted-foreground">%</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <select value={r.kind} onChange={e => setRow(r.key, { kind: e.target.value })}
                      className="px-2 py-1.5 rounded-lg bg-muted text-[11px] text-foreground outline-none">
                      {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                    <select value={r.score_mode}
                      onChange={e => setRow(r.key, { score_mode: e.target.value as ScoreMode })}
                      className="px-2 py-1.5 rounded-lg bg-muted text-[11px] text-foreground outline-none">
                      {Object.entries(scoreModeLabels).map(([k, label]) =>
                        <option key={k} value={k}>{label}</option>)}
                    </select>
                  </div>

                  {/* คำอธิบายยาวย้ายไปอยู่หลังเครื่องหมายคำถาม ไม่พิมพ์ซ้ำทุกกล่อง */}
                  <div className="flex items-center gap-1.5">
                    <select value={r.calc_mode}
                      onChange={e => setRow(r.key, { calc_mode: e.target.value as CalcMode })}
                      className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-muted text-[11px] text-foreground outline-none">
                      {Object.entries(calcModeLabels).map(([k, label]) =>
                        <option key={k} value={k}>วิธีคิดคะแนน: {label}</option>)}
                    </select>
                    <button type="button" onClick={() => setHelpFor(r.calc_mode)}
                      aria-label={`คำอธิบายวิธีคิดคะแนนแบบ ${calcModeLabels[r.calc_mode]}`}
                      className="p-1 rounded-lg hover:bg-muted shrink-0">
                      <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </div>

                  {/* จำนวนงานที่วางแผนไว้ — ใช้กับโหมดตามสัดส่วนเท่านั้น
                      โหมดถ่วงน้ำหนักรายการย่อยบังคับให้น้ำหนักย่อยรวม 100 อยู่แล้ว
                      ตัวหารจึงคงที่ ไม่ต้องประมาณ */}
                  {r.calc_mode === 'proportional' && (
                    <div className="space-y-1">
                      <label className="flex items-center gap-1.5 text-[10px] text-foreground">
                        จำนวนงานที่วางแผนไว้ทั้งเทอม
                        <input type="number" min={1} max={200}
                          value={r.planned_item_count ?? ''}
                          placeholder="ไม่ระบุ"
                          onChange={e => setRow(r.key, {
                            planned_item_count: e.target.value === ''
                              ? null : Number(e.target.value),
                          })}
                          className="w-16 px-2 py-1 rounded-lg bg-muted text-center outline-none" />
                        ชิ้น (ไม่บังคับ)
                      </label>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        {r.planned_item_count == null
                          ? 'เว้นว่าง = คิดคะแนนจากงานที่มีอยู่จริง นักศึกษาที่ได้เต็มทุกชิ้น'
                            + 'จะเห็นว่าได้คะแนนหมวดนี้เต็มแล้ว แม้จะยังโพสต์งานไม่ครบ'
                          : `นักศึกษาจะเห็นว่า "ตรวจแล้ว n จาก ${r.planned_item_count} ชิ้นที่วางแผนไว้" `
                            + 'และคะแนนจะคิดเทียบกับจำนวนนี้ ไม่ใช่จำนวนงานที่มีอยู่'}
                      </p>
                      {r.id && r.planned_item_count != null
                        && its.length > r.planned_item_count && (
                        <p className="text-[10px] text-warning leading-relaxed">
                          หมวดนี้มีงานจริง {its.length} ชิ้น เกินที่วางแผนไว้
                          {' '}{r.planned_item_count} ชิ้น — ระบบจะใช้จำนวนจริงเป็นตัวหาร
                          เพื่อไม่ให้คะแนนเกินน้ำหนักหมวด ควรแก้ตัวเลขที่วางแผนไว้ให้ตรง
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-3 flex-wrap">
                    <label className="flex items-center gap-1.5 text-[10px] text-foreground">
                      ตัดคะแนนต่ำสุดออก
                      <input value={r.drop_lowest} type="number" min={0} max={20}
                        onChange={e => setRow(r.key, { drop_lowest: Number(e.target.value) })}
                        className="w-14 px-2 py-1 rounded-lg bg-muted text-center outline-none" />
                      รายการ
                    </label>
                    <label className="flex items-center gap-1.5 text-[10px] text-foreground">
                      <input type="checkbox" checked={r.is_final_exam}
                        onChange={e => setRow(r.key, { is_final_exam: e.target.checked })} />
                      ปิดบังคะแนนจนประกาศผล
                    </label>
                  </div>

                  {r.id ? (
                    <>
                      <button
                        onClick={() => setOpenItems(o => ({ ...o, [r.id!]: !o[r.id!] }))}
                        className={`flex items-center gap-1 text-[10px] ${
                          itemWeightBad ? 'text-destructive' : 'text-muted-foreground'
                        }`}>
                        {openItems[r.id] ? <ChevronDown className="w-3 h-3" />
                                         : <ChevronRight className="w-3 h-3" />}
                        {its.length} รายการ
                        {/* คะแนนเต็มรวมคิดจากรายการจริงในหมวด ไม่ใช่ค่าคงที่
                            โพสต์งานเพิ่มเข้าหมวดแล้วตัวเลขนี้ขยับตามทันที */}
                        {its.length > 0 && ` · เต็มรวม ${sumMaxScore(its)} คะแนน`}
                        {r.calc_mode === 'weighted_items' && its.length > 0 &&
                          ` · น้ำหนักย่อยรวม ${sumItemWeight(its)}%`}
                        {itemWeightBad && ' — ต้องรวมเป็น 100%'}
                      </button>
                      {openItems[r.id] && savedOf(r.id) && (
                        <ComponentItemsEditor
                          component={savedOf(r.id)!}
                          items={its}
                          reason={reason}
                          onSaved={load}
                        />
                      )}
                    </>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">
                      บันทึกหมวดนี้ก่อน แล้วจะเพิ่มรายการคะแนนในหมวดได้
                    </p>
                  )}

                  {r.score_mode === 'auto_attendance' && (
                    <div className="grid grid-cols-4 gap-1.5 pt-1 border-t border-border">
                      {([
                        ['credit_on_time', 'ตรงเวลา'], ['credit_late', 'สาย'],
                        ['credit_excused', 'ลา'], ['credit_absent', 'ขาด'],
                      ] as const).map(([field, label]) => (
                        <label key={field} className="text-[9px] text-muted-foreground">
                          {label}
                          <input type="number" min={0} max={1} step="0.1"
                            value={r[field] ?? 0}
                            onChange={e => setRow(r.key, { [field]: Number(e.target.value) })}
                            className="w-full px-1 py-1 rounded-lg bg-muted text-[11px] text-foreground text-center outline-none" />
                        </label>
                      ))}
                    </div>
                  )}

                  {/* ตารางตัวอย่างคะแนนเข้าเรียนแสดงเฉพาะตอนที่หมวดนี้กางอยู่
                      ซึ่งเป็นจริงเสมอในบล็อกนี้ ทำให้ไม่ยิง RPC ของทุกหมวดพร้อมกัน
                      ตอนเปิดหน้าอย่างที่เคยเป็น */}
                  {r.score_mode === 'auto_attendance' && r.id && (
                    <AttendanceCreditPreview componentId={r.id} credits={{
                      on_time: r.credit_on_time ?? 1,
                      late: r.credit_late ?? 0.5,
                      excused: r.credit_excused ?? 1,
                      absent: r.credit_absent ?? 0,
                    }} />
                  )}
                  </div>
                  )}
                </div>
              );
            })}
          </div>

          {problems.length > 0 && (
            <ul className="text-[10px] text-destructive space-y-0.5 list-disc list-inside">
              {problems.map(p => <li key={p}>{p}</li>)}
            </ul>
          )}

          <input value={reason} onChange={e => setReason(e.target.value)}
            placeholder="เหตุผลในการเปลี่ยนโครงสร้าง (บันทึกลงประวัติ)"
            className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />

          <button onClick={() => save(removedIds.length > 0)} disabled={saving || problems.length > 0}
            className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold disabled:opacity-50">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            บันทึกโครงสร้างคะแนน
            {removedIds.length > 0 && ` (ลบ ${removedIds.length} หมวด)`}
          </button>

          <div className="flex gap-2 pt-1 border-t border-border">
            <button onClick={() => setCopyAsk(true)} disabled={otherCourses.length === 0}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-xl bg-muted text-[11px] font-semibold text-foreground disabled:opacity-50">
              <Copy className="w-3.5 h-3.5" /> คัดลอกจากวิชาอื่น
            </button>
            <button onClick={() => setTemplateAsk(true)} disabled={rows.length === 0}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-xl bg-muted text-[11px] font-semibold text-foreground disabled:opacity-50">
              <FileStack className="w-3.5 h-3.5" /> บันทึกเป็นแม่แบบ
            </button>
          </div>

          {templates.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[10px] text-muted-foreground">แม่แบบของคุณ</p>
              {templates.map(t => (
                <div key={t.id} className="flex items-center gap-2">
                  <span className="flex-1 text-[11px] text-foreground truncate">
                    {t.name} <span className="text-muted-foreground">({t.componentCount} หมวด)</span>
                  </span>
                  <button onClick={() => doApplyTemplate(t.id)} disabled={busy}
                    className="px-2 py-1 rounded-lg bg-primary/10 text-primary text-[10px] font-semibold disabled:opacity-50">
                    ใช้
                  </button>
                  <button onClick={async () => {
                    await deleteTemplate(t.id); load();
                  }} className="p-1 rounded-lg hover:bg-muted">
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* คำอธิบายวิธีคิดคะแนน — มีที่เดียว เปิดจากเครื่องหมายคำถามของหมวดไหนก็ได้
          ของเดิมพิมพ์ข้อความยาวนี้ซ้ำในทุกกล่อง ทำให้หน้ายาวขึ้นเท่าจำนวนหมวด */}
      {helpFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center
                        bg-black/40 p-4" onClick={() => setHelpFor(null)}>
          <div className="w-full max-w-sm bg-card rounded-2xl p-4 shadow-float space-y-2"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-bold text-foreground">
                {calcModeLabels[helpFor]}
              </p>
              <button onClick={() => setHelpFor(null)} aria-label="ปิด"
                className="p-1 rounded-lg hover:bg-muted shrink-0">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <p className="text-xs text-foreground/80 leading-relaxed">{calcModeHelp[helpFor]}</p>
            <button onClick={() => setHelpFor(null)}
              className="w-full py-2 rounded-xl bg-muted text-xs font-semibold text-foreground">
              เข้าใจแล้ว
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={copyAsk} busy={busy}
        title="คัดลอกโครงสร้างคะแนนจากรายวิชาอื่น"
        description={
          <>
            <p>คัดลอกเฉพาะหมวดและรายการคะแนน <b>ไม่คัดลอกคะแนนของนักศึกษา</b></p>
            <p>รายวิชานี้ต้องยังไม่มีหมวดคะแนน ถ้ามีอยู่แล้วให้ลบก่อน</p>
          </>
        }
        choices={otherCourses.slice(0, 4).map(c => ({
          value: c.id, label: c.code, detail: c.name, tone: 'muted' as const,
        }))}
        onCancel={() => setCopyAsk(false)}
        onConfirm={doCopy}
      />

      <ConfirmDialog
        open={templateAsk} busy={busy}
        title="บันทึกเป็นแม่แบบส่วนตัว"
        description={
          <>
            <p>เก็บโครงสร้างนี้ไว้ใช้กับรายวิชาอื่นหรือเทอมถัดไป โดยไม่มีคะแนนของนักศึกษาติดไป</p>
            <input value={templateName} onChange={e => setTemplateName(e.target.value)}
              placeholder="ชื่อแม่แบบ เช่น วิชาปฏิบัติ 3 หน่วยกิต" autoFocus
              className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
          </>
        }
        choices={[{ value: 'save', label: 'บันทึกแม่แบบ', tone: 'primary' }]}
        onCancel={() => { setTemplateAsk(false); setTemplateName(''); }}
        onConfirm={doSaveTemplate}
      />
    </div>
  );
};

export default GradeStructurePanel;
