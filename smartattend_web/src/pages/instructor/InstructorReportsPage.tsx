import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { Download, Users } from 'lucide-react';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { SummaryRow, fetchInstructorCourses, fetchSummary, fetchSessionAttendance } from '@/lib/attendance-data';

interface Person { name: string; code: string | null }

const InstructorReportsPage = () => {
  const { user } = useAuth();
  const [courses, setCourses] = useState<{ id: string; code: string; name: string }[]>([]);
  const [courseId, setCourseId] = useState('');
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [trend, setTrend] = useState<{ label: string; rate: number }[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    fetchInstructorCourses(user.id).then(cs => { setCourses(cs); setCourseId(p => p || cs[0]?.id || ''); });
  }, [user?.id]);

  useEffect(() => {
    if (!courseId) return;
    (async () => {
      const s = await fetchSummary({ courseId });
      setSummary(s);
      const ids = s.map(x => x.student_id);
      if (ids.length) {
        const { data } = await supabase.from('profiles').select('user_id, name, student_code').in('user_id', ids);
        const map: Record<string, Person> = {};
        (data ?? []).forEach(p => { map[p.user_id] = { name: p.name, code: p.student_code }; });
        setPeople(map);
      } else setPeople({});

      const { data: sess } = await supabase.from('class_sessions').select('id, started_at')
        .eq('course_id', courseId).order('started_at', { ascending: true }).limit(12);
      const points: { label: string; rate: number }[] = [];
      for (const ss of sess ?? []) {
        const rows = await fetchSessionAttendance(ss.id);
        const present = rows.filter(r => r.status !== 'absent').length;
        points.push({
          label: new Date(ss.started_at).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit' }),
          rate: rows.length ? Math.round((1000 * present) / rows.length) / 10 : 0,
        });
      }
      setTrend(points);
    })();
  }, [courseId]);

  const rows = useMemo(() => summary.map(s => ({
    ...s,
    name: people[s.student_id]?.name ?? 'นักศึกษา',
    code: people[s.student_id]?.code ?? '-',
  })).sort((a, b) => Number(b.attendance_rate ?? 0) - Number(a.attendance_rate ?? 0)), [summary, people]);

  const exportExcel = () => {
    if (!rows.length) { toast.error('ไม่มีข้อมูลให้ส่งออก'); return; }
    const course = courses.find(c => c.id === courseId);
    const data = rows.map((r, i) => ({
      'ลำดับ': i + 1,
      'รหัสนักศึกษา': r.code,
      'ชื่อ-นามสกุล': r.name,
      'มาเรียน': Number(r.on_time_count),
      'มาสาย': Number(r.late_count),
      'ขาดเรียน': Number(r.absent_count),
      'เปอร์เซ็นต์': Number(r.attendance_rate ?? 0),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'attendance');
    const d = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `${course?.code ?? 'course'}_attendance_${d}.xlsx`);
    toast.success('ส่งออกไฟล์ Excel แล้ว');
  };

  return (
    <MobileLayout title="รายงานการเข้าเรียน">
      <div className="px-4 py-4 space-y-5">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {courses.map(c => (
            <button key={c.id} onClick={() => setCourseId(c.id)}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-medium ${courseId === c.id ? 'gradient-primary text-primary-foreground shadow-elevated' : 'bg-card text-muted-foreground shadow-card'}`}>
              {c.code}
            </button>
          ))}
        </div>

        <div className="bg-card rounded-xl p-4 shadow-card text-center">
          <Users className="w-5 h-5 text-secondary mx-auto mb-1" />
          <p className="text-2xl font-bold font-display text-foreground">{rows.length}</p>
          <p className="text-xs text-muted-foreground">นักศึกษาที่มีบันทึกการเข้าเรียน</p>
        </div>

        {trend.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">แนวโน้มการเข้าเรียน</h2>
            <div className="bg-card rounded-xl p-4 shadow-elevated">
              <ResponsiveContainer width="100%" height={170}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                  <Line type="monotone" dataKey="rate" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">สรุปรายบุคคล</h2>
            <button onClick={exportExcel} className="flex items-center gap-1 text-xs text-primary font-medium">
              <Download className="w-3 h-3" /> Export Excel
            </button>
          </div>
          <div className="space-y-2">
            {rows.map((s, i) => (
              <motion.div key={s.student_id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }}
                className="bg-card rounded-xl p-3 flex items-center gap-3 shadow-card">
                <span className="text-xs font-bold text-muted-foreground w-6">#{i + 1}</span>
                <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground">
                  {s.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {s.code} · ตรงเวลา {s.on_time_count} · สาย {s.late_count} · ขาด {s.absent_count}
                  </p>
                </div>
                <span className="text-xs font-bold text-primary">{s.attendance_rate ?? 0}%</span>
              </motion.div>
            ))}
            {rows.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">ยังไม่มีข้อมูลการเข้าเรียน</p>}
          </div>
        </div>
      </div>
    </MobileLayout>
  );
};

export default InstructorReportsPage;
