import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { AttendanceRow, SummaryRow, fetchMyAttendance, fetchSummary } from '@/lib/attendance-data';

function weekKey(iso: string) {
  const d = new Date(iso);
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `W${week}`;
}

const StudentAnalyticsPage = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    Promise.all([fetchMyAttendance(user.id), fetchSummary({ studentId: user.id })])
      .then(([r, s]) => { setRows(r); setSummary(s); });
  }, [user?.id]);

  const weekly = useMemo(() => {
    const map = new Map<string, { present: number; total: number }>();
    [...rows].reverse().forEach(r => {
      const k = weekKey(r.checkedInAt ?? r.startedAt);
      const agg = map.get(k) ?? { present: 0, total: 0 };
      agg.total += 1;
      if (r.status !== 'absent') agg.present += 1;
      map.set(k, agg);
    });
    return Array.from(map, ([week, a]) => ({ week, rate: Math.round((1000 * a.present) / a.total) / 10 })).slice(-10);
  }, [rows]);

  const perCourse = useMemo(() => summary.map(s => ({
    code: s.course_code,
    rate: Number(s.attendance_rate ?? 0),
    onTime: Number(s.on_time_count),
    late: Number(s.late_count),
    absent: Number(s.absent_count),
  })), [summary]);

  return (
    <MobileLayout title="สถิติการเข้าเรียน">
      <div className="px-4 py-4 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> แนวโน้มรายสัปดาห์
          </h2>
          <div className="bg-card rounded-xl p-4 shadow-elevated">
            {weekly.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">ยังไม่มีข้อมูล</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={weekly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                  <Line type="monotone" dataKey="rate" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">เปอร์เซ็นต์ตามรายวิชา</h2>
          <div className="bg-card rounded-xl p-4 shadow-elevated">
            {perCourse.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">ยังไม่มีข้อมูล</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={perCourse}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="code" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                  <Bar dataKey="rate" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {perCourse.map(c => (
            <div key={c.code} className="bg-card rounded-xl p-3 flex items-center justify-between shadow-card">
              <div>
                <p className="text-sm font-medium text-foreground">{c.code}</p>
                <p className="text-[11px] text-muted-foreground">ตรงเวลา {c.onTime} · สาย {c.late} · ขาด {c.absent}</p>
              </div>
              <span className="text-sm font-bold text-primary">{c.rate}%</span>
            </div>
          ))}
        </div>
      </div>
    </MobileLayout>
  );
};

export default StudentAnalyticsPage;
