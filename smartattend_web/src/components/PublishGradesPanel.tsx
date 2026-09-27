import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Loader2, Lock, LockOpen, Megaphone } from 'lucide-react';
import {
  fetchPublishReadiness, gradeSourceLabels, publishFinalGrades, relockCourseGrades,
  unlockCourseGrades, type PublishReadiness, type SpecialGradeInput,
} from '@/lib/publish-data';

interface Props {
  courseId: string;
  published: boolean;
  locked: boolean;
  onChanged: () => void;
}

/**
 * ประกาศผลและล็อกคะแนน (สเปกข้อ 5.2 และ 5.3)
 *
 * ก่อนประกาศต้องรายงานสามอย่าง: ช่องว่างกี่ช่องของใคร · น้ำหนักครบ 100 หรือยัง ·
 * มีใครควรได้ I หรือ W  ถ้ายังไม่ครบห้ามประกาศ เว้นแต่อาจารย์ยืนยันพร้อมเหตุผล
 * ซึ่งบังคับที่ฐานข้อมูล ไม่ใช่แค่ที่หน้าจอ
 */
const PublishGradesPanel = ({ courseId, published, locked, onChanged }: Props) => {
  const [r, setR] = useState<PublishReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [useSuggested, setUseSuggested] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setR(await fetchPublishReadiness(courseId));
    setLoading(false);
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  const publish = async () => {
    if (!r) return;
    const force = !r.ready;
    if (force && !reason.trim()) {
      toast.error('คะแนนยังไม่ครบ ต้องระบุเหตุผลก่อนยืนยันประกาศผล');
      return;
    }
    const special: SpecialGradeInput[] = useSuggested
      ? r.suggested_special.map(s => ({
          student_id: s.student_id, grade: s.grade, source: s.source, reason: s.why,
        }))
      : [];

    setBusy(true);
    const { data, error } = await publishFinalGrades({
      courseId, force, reason: reason.trim() || undefined, special,
    });
    setBusy(false);
    if (error) { toast.error(error.message || 'ประกาศผลไม่สำเร็จ'); return; }
    const res = data as { published?: number; special?: number } | null;
    toast.success(
      `ประกาศผลแล้ว ${res?.published ?? 0} คน`
      + ((res?.special ?? 0) > 0 ? ` · เกรดพิเศษ ${res?.special} คน` : '')
      + ' · คะแนนถูกล็อกแล้ว',
    );
    setReason('');
    onChanged();
    load();
  };

  const unlock = async () => {
    if (!reason.trim()) { toast.error('การปลดล็อกคะแนนต้องระบุเหตุผล'); return; }
    setBusy(true);
    const { error } = await unlockCourseGrades(courseId, reason.trim());
    setBusy(false);
    if (error) { toast.error(error.message || 'ปลดล็อกไม่สำเร็จ'); return; }
    toast.success('ปลดล็อกคะแนนแล้ว — แก้เสร็จแล้วกดล็อกกลับเพื่อแจ้งนักศึกษา');
    setReason('');
    onChanged();
  };

  const relock = async () => {
    setBusy(true);
    const { data, error } = await relockCourseGrades(courseId);
    setBusy(false);
    if (error) { toast.error(error.message || 'ล็อกกลับไม่สำเร็จ'); return; }
    toast.success(`ล็อกคะแนนแล้ว · แจ้งนักศึกษาที่คะแนนเปลี่ยน ${Number(data ?? 0)} คน`);
    onChanged();
  };

  if (loading) {
    return <p className="text-[11px] text-muted-foreground py-2">กำลังตรวจความพร้อม...</p>;
  }
  if (!r) return null;

  return (
    <div className="bg-card rounded-2xl p-4 shadow-card space-y-3">
      <p className="text-xs font-semibold text-foreground">ประกาศผลการเรียน</p>

      {/* ── รายงานความพร้อม ── */}
      <div className="space-y-1.5 text-[11px]">
        <div className="flex items-start gap-1.5">
          {r.weight_ok
            ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
            : <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />}
          <span className={r.weight_ok ? 'text-foreground' : 'text-destructive'}>
            น้ำหนักรวม {r.total_weight}%
            {r.weight_ok ? ' ครบแล้ว' : ' — ต้องเท่ากับ 100% พอดีก่อนประกาศ'}
          </span>
        </div>

        <div className="flex items-start gap-1.5">
          {r.blank_count === 0
            ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
            : <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />}
          <span className={r.blank_count === 0 ? 'text-foreground' : 'text-warning'}>
            {r.blank_count === 0
              ? 'กรอกคะแนนครบทุกช่องแล้ว'
              : `ยังมีช่องว่าง ${r.blank_count} ช่อง`}
          </span>
        </div>

        {r.blanks.length > 0 && (
          <ul className="ml-5 space-y-0.5 text-[10px] text-muted-foreground max-h-32 overflow-y-auto">
            {r.blanks.slice(0, 12).map((b, i) => (
              <li key={`${b.student_code}-${b.item}-${i}`}>
                {b.student_name} ({b.student_code}) · {b.component} → {b.item}
              </li>
            ))}
            {r.blank_count > 12 && <li>และอีก {r.blank_count - 12} ช่อง</li>}
          </ul>
        )}

        {r.suggested_special.length > 0 && (
          <div className="rounded-xl bg-muted/60 p-2 space-y-1">
            <label className="flex items-start gap-1.5 text-[11px] font-medium text-foreground">
              <input type="checkbox" checked={useSuggested} className="mt-0.5"
                onChange={e => setUseSuggested(e.target.checked)} />
              ใช้เกรดพิเศษที่ระบบแนะนำ ({r.suggested_special.length} คน)
            </label>
            <ul className="ml-5 space-y-0.5 text-[10px] text-muted-foreground">
              {r.suggested_special.map(s => (
                <li key={s.student_id}>
                  {s.name} ({s.code}) → <b className="text-foreground">{s.grade}</b>
                  {' '}· {gradeSourceLabels[s.source] ?? s.source}
                  <br />
                  <span className="opacity-80">{s.why}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <input value={reason} onChange={e => setReason(e.target.value)}
        placeholder={published
          ? 'เหตุผลในการปลดล็อก (จำเป็น)'
          : r.ready ? 'หมายเหตุ (ไม่บังคับ)' : 'เหตุผลที่ประกาศทั้งที่คะแนนยังไม่ครบ (จำเป็น)'}
        className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />

      {!published ? (
        <button onClick={publish} disabled={busy || !r.weight_ok}
          className={`w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold disabled:opacity-50 ${
            r.ready ? 'gradient-primary text-primary-foreground'
                    : 'bg-warning/15 text-warning border border-warning/30'
          }`}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Megaphone className="w-3.5 h-3.5" />}
          {!r.weight_ok
            ? `ประกาศไม่ได้ — น้ำหนักรวม ${r.total_weight}%`
            : r.ready ? 'ประกาศผลการเรียน' : 'ยืนยันประกาศทั้งที่คะแนนยังไม่ครบ'}
        </button>
      ) : locked ? (
        <div className="space-y-2">
          <p className="text-[11px] text-success flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" /> ประกาศผลแล้วและคะแนนถูกล็อก
          </p>
          <button onClick={unlock} disabled={busy}
            className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-muted text-xs font-semibold text-foreground disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LockOpen className="w-3.5 h-3.5" />}
            ปลดล็อกเพื่อแก้คะแนน
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-warning flex items-center gap-1.5">
            <LockOpen className="w-3.5 h-3.5" /> คะแนนถูกปลดล็อกอยู่ — แก้ได้ แต่ยังไม่แจ้งนักศึกษา
          </p>
          <button onClick={relock} disabled={busy}
            className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
            ล็อกกลับและแจ้งนักศึกษาที่คะแนนเปลี่ยน
          </button>
        </div>
      )}
    </div>
  );
};

export default PublishGradesPanel;
