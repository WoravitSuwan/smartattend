import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, Clock, AlertCircle, Pencil, ImageIcon } from 'lucide-react';
import {
  AttendanceRow, SummaryRow, fetchMyAttendance, fetchSummary,
  statusClass, statusLabel, fmtDateTime,
} from '@/lib/attendance-data';

const AttendanceHistoryPage = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [course, setCourse] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [r, s] = await Promise.all([fetchMyAttendance(user.id), fetchSummary({ studentId: user.id })]);
      if (cancelled) return;
      setRows(r);
      setSummary(s);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const courses = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach(r => map.set(r.courseId, r.courseCode));
    return Array.from(map, ([id, code]) => ({ id, code }));
  }, [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (course !== 'all' && r.courseId !== course) return false;
    const d = (r.checkedInAt ?? r.startedAt ?? '').slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }), [rows, course, from, to]);

  // Group into day sections (rows already arrive newest-first) so a
  // semester's worth of records reads as a scannable timeline instead of
  // one long flat list.
  const groups = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const yesterdayKey = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const dayLabel = (key: string) => {
      if (key === todayKey) return 'วันนี้';
      if (key === yesterdayKey) return 'เมื่อวาน';
      return new Date(key).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
    };
    const byDay = new Map<string, typeof filtered>();
    for (const r of filtered) {
      const key = (r.checkedInAt ?? r.startedAt ?? '').slice(0, 10) || 'ไม่ทราบวันที่';
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(r);
    }
    return Array.from(byDay, ([key, dayRows]) => ({ key, label: dayLabel(key), rows: dayRows }));
  }, [filtered]);

  const stat = useMemo(() => {
    const src = course === 'all' ? summary : summary.filter(s => s.course_id === course);
    const onTime = src.reduce((a, b) => a + Number(b.on_time_count), 0);
    const late = src.reduce((a, b) => a + Number(b.late_count), 0);
    const absent = src.reduce((a, b) => a + Number(b.absent_count), 0);
    const total = onTime + late + absent;
    return { onTime, late, absent, rate: total ? Math.round((1000 * (onTime + late)) / total) / 10 : 0 };
  }, [summary, course]);

  return (
    <MobileLayout title="ประวัติการเข้าเรียน">
      <div className="px-4 py-4 space-y-4">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <button onClick={() => setCourse('all')}
            className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-medium transition-all ${course === 'all' ? 'gradient-primary text-primary-foreground shadow-elevated' : 'bg-card text-muted-foreground shadow-card'}`}>
            ทุกวิชา
          </button>
          {courses.map(c => (
            <button key={c.id} onClick={() => setCourse(c.id)}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-medium transition-all ${course === c.id ? 'gradient-primary text-primary-foreground shadow-elevated' : 'bg-card text-muted-foreground shadow-card'}`}>
              {c.code}
            </button>
          ))}
        </div>

        <div className="flex gap-2 items-center">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="flex-1 bg-card rounded-xl px-3 py-2 text-xs shadow-card border border-border text-foreground" />
          <span className="text-xs text-muted-foreground">ถึง</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="flex-1 bg-card rounded-xl px-3 py-2 text-xs shadow-card border border-border text-foreground" />
        </div>

        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'ตรงเวลา', value: stat.onTime, color: 'text-success' },
            { label: 'มาสาย', value: stat.late, color: 'text-warning' },
            { label: 'ขาดเรียน', value: stat.absent, color: 'text-destructive' },
            { label: 'เข้าเรียน', value: `${stat.rate}%`, color: 'text-primary' },
          ].map(s => (
            <div key={s.label} className="bg-card rounded-xl p-3 text-center shadow-card">
              <p className={`text-lg font-bold font-display ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        {loading && <p className="text-xs text-muted-foreground text-center py-6">กำลังโหลด...</p>}
        {!loading && filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">ยังไม่มีประวัติการเข้าเรียน</p>
        )}

        <div className="space-y-4">
          {groups.map((g, gi) => (
            <div key={g.key}>
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-0.5">
                {g.label}
              </h3>
              <div className="space-y-2">
                {g.rows.map((r, i) => (
                  <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(gi * 3 + i, 12) * 0.03 }}
                    className="bg-card rounded-xl p-3 flex items-center gap-3 shadow-card">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${statusClass[r.status]}`}>
                      {r.status === 'on_time' ? <CheckCircle className="w-4 h-4" /> : r.status === 'late' ? <Clock className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{r.courseCode} - {r.courseName}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDateTime(r.checkedInAt ?? r.startedAt)}
                        {r.confidence != null ? ` · ${Math.round(Number(r.confidence) * 100)}%` : ''}
                      </p>
                      {r.editedAt && (
                        <p className="text-[10px] text-warning flex items-center gap-1 mt-0.5" title={`แก้ไขโดยอาจารย์: ${r.editReason ?? '-'}`}>
                          <Pencil className="w-3 h-3" /> ถูกแก้ไข: {r.editReason ?? '-'}
                        </p>
                      )}
                    </div>
                    {r.photo && (
                      <button onClick={() => setZoom(r.photo)} className="w-9 h-9 rounded-lg overflow-hidden border border-border shrink-0">
                        <img src={r.photo} alt="หลักฐานการเช็คชื่อ" className="w-full h-full object-cover" />
                      </button>
                    )}
                    {!r.photo && <ImageIcon className="w-4 h-4 text-muted-foreground/40 shrink-0" />}
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${statusClass[r.status]}`}>
                      {statusLabel[r.status]}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {zoom && (
        <div className="fixed inset-0 z-50 bg-foreground/70 flex items-center justify-center p-6" onClick={() => setZoom(null)}>
          <img src={zoom} alt="ภาพหลักฐานขยาย" className="max-w-full max-h-full rounded-2xl" />
        </div>
      )}
    </MobileLayout>
  );
};

export default AttendanceHistoryPage;
