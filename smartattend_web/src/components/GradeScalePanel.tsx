import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import {
  FALLBACK_GRADE_SCALE, fetchGradeScale, saveCourseGradeScale, type GradeScaleRow,
} from '@/lib/grade-data';

interface Row extends GradeScaleRow { key: string }

const toRows = (scale: GradeScaleRow[]): Row[] =>
  scale.map((r, i) => ({ ...r, key: `${r.grade}-${i}` }));

/** ตั้งเกณฑ์ตัดเกรดของรายวิชา
 *
 *  แหล่งความจริงคือตาราง grade_scales — ถ้ารายวิชายังไม่กำหนดเอง จะใช้ค่า
 *  เริ่มต้นของระบบ (แถว course_id IS NULL) และกดล้างเพื่อกลับไปใช้ค่านั้นได้
 */
const GradeScalePanel = ({ courseId }: { courseId: string }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [isCourseSpecific, setIsCourseSpecific] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { scale, isCourseSpecific: own } = await fetchGradeScale(courseId);
    setRows(toRows(scale));
    setIsCourseSpecific(own);
    setLoading(false);
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  const setRow = (key: string, patch: Partial<GradeScaleRow>) =>
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = () =>
    setRows(prev => [...prev, { key: `new-${Date.now()}`, grade: '', min_score: 0, grade_point: 0 }]);

  const removeRow = (key: string) => setRows(prev => prev.filter(r => r.key !== key));

  /** ตรวจก่อนส่ง — กฎชุดเดียวกับที่ RPC ตรวจซ้ำอีกชั้น */
  const problems = (() => {
    const out: string[] = [];
    if (rows.length > 0 && rows.length < 2) out.push('ต้องมีอย่างน้อย 2 ระดับ');
    if (rows.some(r => !r.grade.trim())) out.push('มีระดับที่ยังไม่ใส่ชื่อเกรด');
    if (rows.some(r => !Number.isFinite(r.min_score) || r.min_score < 0 || r.min_score > 100)) {
      out.push('คะแนนขั้นต่ำต้องอยู่ระหว่าง 0-100');
    }
    if (rows.length > 0 && !rows.some(r => Number(r.min_score) === 0)) {
      out.push('ต้องมีเกรดต่ำสุดที่คะแนนขั้นต่ำเป็น 0');
    }
    const names = rows.map(r => r.grade.trim()).filter(Boolean);
    if (new Set(names).size !== names.length) out.push('มีชื่อเกรดซ้ำกัน');
    return out;
  })();

  const save = async (next: GradeScaleRow[] | null) => {
    setSaving(true);
    const payload = next ?? rows.map(({ grade, min_score, grade_point }) => ({
      grade: grade.trim(), min_score: Number(min_score), grade_point: Number(grade_point),
    }));
    const { error } = await saveCourseGradeScale(courseId, payload, reason.trim() || undefined);
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error(error.message || 'บันทึกเกณฑ์ตัดเกรดไม่สำเร็จ');
      return;
    }
    toast.success(payload.length === 0
      ? 'กลับไปใช้เกณฑ์เริ่มต้นของระบบแล้ว'
      : 'บันทึกเกณฑ์ตัดเกรดของรายวิชาแล้ว');
    setReason('');
    load();
  };

  const sorted = [...rows].sort((a, b) => Number(b.min_score) - Number(a.min_score));

  return (
    <div className="bg-card rounded-2xl p-4 shadow-card space-y-3">
      <div>
        <p className="text-xs font-semibold text-foreground">เกณฑ์ตัดเกรด</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {isCourseSpecific
            ? 'รายวิชานี้ใช้เกณฑ์ที่อาจารย์กำหนดเอง'
            : 'รายวิชานี้ใช้เกณฑ์เริ่มต้นของระบบ — แก้ค่าด้านล่างแล้วกดบันทึกเพื่อกำหนดเอง'}
        </p>
      </div>

      {loading ? (
        <p className="text-[11px] text-muted-foreground py-2">กำลังโหลด...</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[10px] text-muted-foreground px-1">
              <span>เกรด</span><span>คะแนนขั้นต่ำ</span><span>แต้ม (GPA)</span><span />
            </div>
            {sorted.map(r => (
              <div key={r.key} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                <input value={r.grade} onChange={e => setRow(r.key, { grade: e.target.value })}
                  placeholder="A" maxLength={5}
                  className="px-2 py-1.5 rounded-lg bg-muted text-xs text-foreground outline-none" />
                <input value={r.min_score} type="number" min={0} max={100} step="any"
                  onChange={e => setRow(r.key, { min_score: Number(e.target.value) })}
                  className="px-2 py-1.5 rounded-lg bg-muted text-xs text-foreground outline-none" />
                <input value={r.grade_point} type="number" min={0} max={4} step="any"
                  onChange={e => setRow(r.key, { grade_point: Number(e.target.value) })}
                  className="px-2 py-1.5 rounded-lg bg-muted text-xs text-foreground outline-none" />
                <button onClick={() => removeRow(r.key)} className="p-1 rounded-lg hover:bg-muted"
                  title="ลบระดับนี้">
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </button>
              </div>
            ))}
          </div>

          <button onClick={addRow}
            className="inline-flex items-center gap-1 text-[11px] text-primary font-medium">
            <Plus className="w-3.5 h-3.5" /> เพิ่มระดับ
          </button>

          {problems.length > 0 && (
            <ul className="text-[10px] text-destructive space-y-0.5 list-disc list-inside">
              {problems.map(p => <li key={p}>{p}</li>)}
            </ul>
          )}

          <input value={reason} onChange={e => setReason(e.target.value)}
            placeholder="เหตุผลในการเปลี่ยนเกณฑ์ (บันทึกลงประวัติ)"
            className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />

          <div className="flex gap-2">
            <button onClick={() => save(null)} disabled={saving || problems.length > 0}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              บันทึกเกณฑ์ของรายวิชานี้
            </button>
            {isCourseSpecific && (
              <button onClick={() => save([])} disabled={saving}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-muted text-xs font-semibold text-foreground disabled:opacity-50"
                title="ล้างเกณฑ์ของรายวิชา กลับไปใช้ค่าเริ่มต้นของระบบ">
                <RotateCcw className="w-3.5 h-3.5" /> ใช้ค่าเริ่มต้น
              </button>
            )}
          </div>

          {!isCourseSpecific && (
            <p className="text-[10px] text-muted-foreground">
              ค่าเริ่มต้นของระบบ: {FALLBACK_GRADE_SCALE.map(r => `${r.grade}≥${r.min_score}`).join(' · ')}
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default GradeScalePanel;
