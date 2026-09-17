import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ScanFace, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { fetchInstructorCourses } from '@/lib/attendance-data';

interface Item {
  studentId: string;
  name: string;
  code: string | null;
  status: string | null;
  trainedAt: string | null;
  faceCount: number;
}

const badge = (status: string | null) => {
  if (status === 'trained') return { label: 'เทรนแล้ว', cls: 'bg-success text-success-foreground', Icon: CheckCircle2 };
  if (status === 'failed') return { label: 'เทรนไม่สำเร็จ', cls: 'bg-destructive text-destructive-foreground', Icon: XCircle };
  if (status) return { label: 'รอเทรน', cls: 'bg-warning text-warning-foreground', Icon: Clock };
  return { label: 'ยังไม่ลงทะเบียนใบหน้า', cls: 'bg-muted text-muted-foreground', Icon: ScanFace };
};

const FaceRegistrationStatusPage = () => {
  const { user } = useAuth();
  const [courses, setCourses] = useState<{ id: string; code: string; name: string }[]>([]);
  const [courseId, setCourseId] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    fetchInstructorCourses(user.id).then(cs => { setCourses(cs); setCourseId(p => p || cs[0]?.id || ''); });
  }, [user?.id]);

  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: enrolls } = await supabase
        .from('course_enrollments')
        .select('student_id, student_code_raw, student_name_raw')
        .eq('course_id', courseId);
      const ids = (enrolls ?? []).map(e => e.student_id).filter(Boolean) as string[];

      const [{ data: profs }, { data: regs }, { data: faces }] = await Promise.all([
        ids.length ? supabase.from('profiles').select('user_id, name, student_code').in('user_id', ids) : Promise.resolve({ data: [] as never[] }),
        ids.length ? supabase.from('registration_statuses').select('user_id, status, trained_at').in('user_id', ids) : Promise.resolve({ data: [] as never[] }),
        ids.length ? supabase.from('face_images').select('student_id').in('student_id', ids) : Promise.resolve({ data: [] as never[] }),
      ]);
      if (cancelled) return;

      const pMap = new Map((profs ?? []).map(p => [p.user_id, p]));
      const rMap = new Map((regs ?? []).map(r => [r.user_id, r]));
      const counts = new Map<string, number>();
      (faces ?? []).forEach(f => counts.set(f.student_id, (counts.get(f.student_id) ?? 0) + 1));

      setItems((enrolls ?? []).map(e => {
        const p = e.student_id ? pMap.get(e.student_id) : undefined;
        const r = e.student_id ? rMap.get(e.student_id) : undefined;
        return {
          studentId: e.student_id ?? e.student_code_raw,
          name: p?.name ?? e.student_name_raw,
          code: p?.student_code ?? e.student_code_raw,
          status: r?.status ?? null,
          trainedAt: r?.trained_at ?? null,
          faceCount: e.student_id ? counts.get(e.student_id) ?? 0 : 0,
        };
      }));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [courseId]);

  const stats = useMemo(() => ({
    trained: items.filter(i => i.status === 'trained').length,
    pending: items.filter(i => i.status && i.status !== 'trained' && i.status !== 'failed').length,
    none: items.filter(i => i.faceCount === 0).length,
  }), [items]);

  return (
    <MobileLayout title="สถานะลงทะเบียนใบหน้า">
      <div className="px-4 py-4 space-y-4">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {courses.map(c => (
            <button key={c.id} onClick={() => setCourseId(c.id)}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-medium ${courseId === c.id ? 'gradient-primary text-primary-foreground shadow-elevated' : 'bg-card text-muted-foreground shadow-card'}`}>
              {c.code}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'เทรนแล้ว', value: stats.trained, color: 'text-success' },
            { label: 'รอเทรน', value: stats.pending, color: 'text-warning' },
            { label: 'ยังไม่ลงทะเบียน', value: stats.none, color: 'text-destructive' },
          ].map(s => (
            <div key={s.label} className="bg-card rounded-xl p-3 text-center shadow-card">
              <p className={`text-xl font-bold font-display ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        {loading && <p className="text-xs text-muted-foreground text-center py-4">กำลังโหลด...</p>}
        <div className="space-y-2">
          {items.map(it => {
            const b = badge(it.faceCount === 0 ? null : it.status ?? 'pending');
            return (
              <div key={it.studentId} className="bg-card rounded-xl p-3 flex items-center gap-3 shadow-card">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${b.cls}`}>
                  <b.Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{it.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {it.code} · {it.faceCount} ภาพ
                    {it.trainedAt ? ` · เทรน ${new Date(it.trainedAt).toLocaleDateString('th-TH')}` : ''}
                  </p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${b.cls}`}>{b.label}</span>
              </div>
            );
          })}
          {!loading && items.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">ยังไม่มีนักศึกษาในรายวิชานี้</p>}
        </div>
      </div>
    </MobileLayout>
  );
};

export default FaceRegistrationStatusPage;
