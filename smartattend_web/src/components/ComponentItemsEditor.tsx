import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Link2, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { deleteGradeItem, gradeItemScoreCount } from '@/lib/grade-data';
import {
  saveComponentItems, type ItemDraft, type SaveItemsResult,
} from '@/lib/grade-structure-data';
import { itemWeightsComplete, type GradeComponent, type StructureItem } from '@/lib/grade-structure';

interface Row extends ItemDraft {
  key: string;
  /** manual = แก้ชื่อ/คะแนนเต็มได้ · assignment/attendance = มาจากที่อื่น */
  source: StructureItem['source'];
}

interface Props {
  component: GradeComponent;
  items: StructureItem[];
  /** เหตุผลกลางของพาเนลแม่ ใช้ลงประวัติ */
  reason?: string;
  /** โหลดข้อมูลใหม่หลังบันทึก */
  onSaved: () => void;
}

const toRows = (items: StructureItem[]): Row[] => [...items]
  .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
  .map(i => ({
    key: i.id, id: i.id, name: i.name, max_score: i.max_score,
    weight_in_component: i.weight_in_component, source: i.source,
  }));

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * แก้รายการคะแนนของหมวดหนึ่ง (ระดับที่สามของโครงสร้าง)
 *
 * บันทึกทั้งหมวดในครั้งเดียวผ่าน saveComponentItems เพราะกฎ "น้ำหนักย่อยรวม 100"
 * ของโหมด weighted_items ถูกบังคับด้วย CONSTRAINT TRIGGER แบบ DEFERRED ที่ตรวจ
 * ตอน COMMIT ถ้าบันทึกทีละรายการจะผิดกฎกลางทางเสมอ
 *
 * ของเดิมหน้าจอสร้างรายการผ่าน save_grade_item ซึ่งเขียน grade_items.weight
 * (คอลัมน์ที่เลิกใช้) และไม่ตั้ง component_id รายการที่สร้างจึงไม่ถูกนับในคะแนน
 */
const ComponentItemsEditor = ({ component, items, reason, onSaved }: Props) => {
  const [rows, setRows] = useState<Row[]>(() => toRows(items));
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [overflowAsk, setOverflowAsk] = useState<string | null>(null);
  const [deleteAsk, setDeleteAsk] = useState<{ id: string; name: string; count: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ข้อมูลจากฐานข้อมูลเปลี่ยน (บันทึกเสร็จ / คัดลอกโครงสร้าง) ให้ตามไปด้วย
  useEffect(() => { setRows(toRows(items)); setRemovedIds([]); }, [items]);

  const weighted = component.calc_mode === 'weighted_items';

  const subTotal = useMemo(
    () => round2(rows.reduce((a, r) => a + (Number(r.weight_in_component) || 0), 0)),
    [rows]);
  const subWeightOk = itemWeightsComplete(
    rows.map(r => ({ weight_in_component: r.weight_in_component ?? 0 })));

  const maxTotal = useMemo(
    () => round2(rows.reduce((a, r) => a + (Number(r.max_score) || 0), 0)),
    [rows]);

  const dirty = useMemo(() => {
    if (removedIds.length > 0) return true;
    if (rows.length !== items.length) return true;
    const before = new Map(items.map(i => [i.id, i]));
    return rows.some(r => {
      if (!r.id) return true;
      const b = before.get(r.id);
      if (!b) return true;
      return b.name !== r.name
        || Number(b.max_score) !== Number(r.max_score)
        || Number(b.weight_in_component) !== Number(r.weight_in_component ?? 0);
    });
  }, [rows, items, removedIds]);

  const setRow = (key: string, patch: Partial<ItemDraft>) =>
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = () => setRows(prev => [...prev, {
    key: `new-${Date.now()}-${prev.length}`, name: '', max_score: 10,
    weight_in_component: 0, source: 'manual',
  }]);

  /** เอาออกจากรายชื่อ — รายการที่ยังไม่มีคะแนนจะถูกลบจริงเมื่อกดบันทึก
   *  รายการที่มีคะแนนแล้ว ฐานข้อมูลจะกันไว้และคืนชื่อมาใน blocked */
  const removeRow = (key: string) => {
    const row = rows.find(r => r.key === key);
    if (row?.id) setRemovedIds(prev => [...prev, row.id!]);
    setRows(prev => prev.filter(r => r.key !== key));
  };

  const problems = useMemo(() => {
    const out: string[] = [];
    if (rows.some(r => !r.name.trim())) out.push('มีรายการที่ยังไม่ใส่ชื่อ');
    const names = rows.map(r => r.name.trim()).filter(Boolean);
    if (new Set(names).size !== names.length) out.push('มีชื่อรายการซ้ำกัน');
    if (rows.some(r => !(Number(r.max_score) > 0))) out.push('คะแนนเต็มต้องมากกว่า 0 ทุกรายการ');
    if (weighted && rows.length > 0 && !subWeightOk) {
      out.push(`น้ำหนักย่อยรวมต้องเป็น 100 พอดี (ขณะนี้ ${subTotal})`);
    }
    return out;
  }, [rows, weighted, subWeightOk, subTotal]);

  const report = (r: SaveItemsResult) => {
    const parts: string[] = [];
    if (r.created > 0) parts.push(`เพิ่ม ${r.created}`);
    if (r.updated > 0) parts.push(`แก้ ${r.updated}`);
    if (r.removed > 0) parts.push(`ลบ ${r.removed}`);
    if (r.adjusted > 0) parts.push(`ปรับคะแนนนักศึกษา ${r.adjusted} รายการ`);
    toast.success(`บันทึกรายการของ "${component.name}" แล้ว${parts.length ? ` · ${parts.join(' · ')}` : ''}`);
    if (r.blocked.length > 0) {
      toast.error(
        `ลบ ${r.blocked.join(', ')} ไม่ได้เพราะมีคะแนนของนักศึกษาอยู่ — `
        + 'ใช้ปุ่มถังขยะของรายการนั้นแล้วพิมพ์ชื่อยืนยัน',
      );
    }
  };

  const save = async (onOverflow: 'reject' | 'rescale' | 'clamp' = 'reject') => {
    setSaving(true);
    const { result, error } = await saveComponentItems(
      component.id,
      rows.map(r => ({
        id: r.id ?? null,
        name: r.name.trim(),
        max_score: Number(r.max_score),
        weight_in_component: weighted ? Number(r.weight_in_component ?? 0) : 0,
      })),
      { deleteMissing: removedIds.length > 0, onOverflow, reason: reason?.trim() || undefined },
    );
    setSaving(false);

    if (error) {
      // ฐานข้อมูลปฏิเสธเพราะมีคะแนนเกินคะแนนเต็มใหม่ → ให้อาจารย์เลือกวิธี
      if (onOverflow === 'reject' && /เกินคะแนนเต็มใหม่/.test(error.message ?? '')) {
        setOverflowAsk(error.message ?? '');
        return;
      }
      console.error(error);
      toast.error(error.message?.trim() || 'บันทึกรายการคะแนนไม่สำเร็จ');
      return;
    }

    setOverflowAsk(null);
    if (result) report(result);
    onSaved();
  };

  const askDelete = async (row: Row) => {
    if (!row.id) { removeRow(row.key); return; }
    const n = await gradeItemScoreCount(row.id);
    setDeleteAsk({ id: row.id, name: row.name, count: n });
  };

  const doDelete = async () => {
    if (!deleteAsk) return;
    setDeleting(true);
    const { data, error } = await deleteGradeItem(
      deleteAsk.id, reason?.trim() || undefined,
      deleteAsk.count > 0 ? deleteAsk.name : undefined,
    );
    setDeleting(false);
    if (error) { toast.error(error.message?.trim() || 'ลบไม่สำเร็จ'); return; }
    toast.success(Number(data) > 0
      ? `ลบรายการและคะแนน ${data} รายการแล้ว (บันทึกในประวัติ)`
      : 'ลบรายการคะแนนแล้ว');
    setDeleteAsk(null);
    onSaved();
  };

  return (
    <div className="rounded-lg bg-background/60 p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-foreground">
          รายการคะแนนในหมวดนี้ ({rows.length})
          {rows.length > 0 && (
            <span className="font-normal text-muted-foreground">
              {' · '}คะแนนดิบรวม {maxTotal}
            </span>
          )}
        </p>
        <button onClick={addRow} className="inline-flex items-center gap-1 text-[10px] text-primary font-medium shrink-0">
          <Plus className="w-3 h-3" /> เพิ่มรายการ
        </button>
      </div>

      {rows.length === 0 && (
        <p className="text-[10px] text-muted-foreground">
          ยังไม่มีรายการ — หมวดนี้จะยังไม่มีคะแนนให้กรอก
        </p>
      )}

      {rows.map(r => {
        const synced = r.source !== 'manual';
        return (
          <div key={r.key} className="flex items-center gap-1.5">
            <input value={r.name} readOnly={synced} disabled={synced}
              onChange={e => setRow(r.key, { name: e.target.value })}
              placeholder="ชื่อรายการ เช่น LAB1"
              title={synced ? 'ชื่อมาจากงานที่มอบหมาย แก้ที่หน้าโพสต์งาน' : undefined}
              className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-muted text-[11px] text-foreground outline-none disabled:opacity-70" />
            {synced && <Link2 className="w-3 h-3 text-muted-foreground shrink-0" />}
            <label className="flex items-center gap-1 shrink-0 text-[9px] text-muted-foreground">
              เต็ม
              <input type="number" min={1} step="any" value={r.max_score}
                readOnly={synced} disabled={synced}
                onChange={e => setRow(r.key, { max_score: Number(e.target.value) })}
                className="w-14 px-1.5 py-1 rounded-lg bg-muted text-[11px] text-foreground text-center outline-none disabled:opacity-70" />
            </label>
            {weighted && (
              <label className="flex items-center gap-1 shrink-0 text-[9px] text-muted-foreground">
                น้ำหนัก
                <input type="number" min={0} max={100} step="any"
                  value={r.weight_in_component ?? 0}
                  onChange={e => setRow(r.key, { weight_in_component: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 rounded-lg bg-muted text-[11px] text-foreground text-center outline-none" />
                %
              </label>
            )}
            <button onClick={() => askDelete(r)} title="ลบรายการนี้"
              className="p-0.5 rounded-lg hover:bg-muted shrink-0">
              <Trash2 className="w-3 h-3 text-destructive" />
            </button>
          </div>
        );
      })}

      {weighted && rows.length > 0 && (
        <p className={`text-[10px] ${subWeightOk ? 'text-success' : 'text-destructive'}`}>
          น้ำหนักย่อยรวม {subTotal}%
          {subWeightOk
            ? ' ครบแล้ว'
            : subTotal < 100
              ? ` — ขาดอีก ${round2(100 - subTotal)}%`
              : ` — เกินมา ${round2(subTotal - 100)}%`}
        </p>
      )}

      {rows.some(r => r.source !== 'manual') && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          รายการที่มีสัญลักษณ์โซ่มาจากงานที่มอบหมาย ชื่อและคะแนนเต็มแก้ที่หน้าโพสต์งาน
          ที่นี่ปรับได้แต่ลำดับและน้ำหนักย่อย
        </p>
      )}

      {problems.length > 0 && (
        <ul className="text-[10px] text-destructive space-y-0.5 list-disc list-inside">
          {problems.map(p => <li key={p}>{p}</li>)}
        </ul>
      )}

      <button onClick={() => save()} disabled={saving || problems.length > 0 || !dirty}
        className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-primary/10 text-primary text-[11px] font-semibold disabled:opacity-40">
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
        บันทึกรายการของหมวดนี้
        {removedIds.length > 0 && ` (เอาออก ${removedIds.length} รายการ)`}
      </button>

      <ConfirmDialog
        open={!!overflowAsk} busy={saving}
        title="มีคะแนนที่เกินคะแนนเต็มใหม่"
        description={
          <>
            <p>{overflowAsk}</p>
            <p>เลือกวิธีจัดการ — ทุกวิธีบันทึกคะแนนเดิมและคะแนนใหม่ไว้ในประวัติทุกแถว</p>
          </>
        }
        choices={[
          {
            value: 'rescale', label: 'ปรับตามอัตราส่วนทุกคน', tone: 'primary',
            detail: 'ลำดับที่ของนักศึกษาไม่เปลี่ยน',
          },
          {
            value: 'clamp', label: 'ตัดเฉพาะคนที่เกิน', tone: 'muted',
            detail: 'คนที่เกินจะได้คะแนนเต็มใหม่เท่ากันหมด',
          },
        ]}
        cancelLabel="ยกเลิกการบันทึก"
        onCancel={() => setOverflowAsk(null)}
        onConfirm={v => save(v as 'rescale' | 'clamp')}
      />

      <ConfirmDialog
        open={!!deleteAsk} busy={deleting}
        title={`ลบรายการ "${deleteAsk?.name ?? ''}"`}
        description={deleteAsk && (
          deleteAsk.count > 0 ? (
            <>
              <p className="text-destructive font-medium">
                จะลบคะแนนของนักศึกษา {deleteAsk.count} คนในรายการนี้ทิ้งไปด้วย และกู้คืนไม่ได้
              </p>
              <p>ถ้าเพียงต้องการแก้ชื่อหรือคะแนนเต็ม ให้แก้ในช่องแล้วกดบันทึก คะแนนจะไม่หาย</p>
            </>
          ) : <p>รายการนี้ยังไม่มีคะแนนของนักศึกษา ลบได้ทันที</p>
        )}
        requireText={deleteAsk && deleteAsk.count > 0 ? deleteAsk.name : null}
        requireTextLabel="พิมพ์ชื่อรายการให้ตรงเพื่อยืนยัน"
        choices={[{ value: 'delete', label: 'ลบรายการนี้', tone: 'danger' }]}
        onCancel={() => setDeleteAsk(null)}
        onConfirm={doDelete}
      />
    </div>
  );
};

export default ComponentItemsEditor;
