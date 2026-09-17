import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { SummaryRow, fetchInstructorCourses, fetchSummary } from '@/lib/attendance-data';

const ExportScoresPage = () => {
  const { user } = useAuth();
  const [courses, setCourses] = useState<{ id: string; code: string; name: string }[]>([]);
  const [courseId, setCourseId] = useState('');
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [people, setPeople] = useState<Record<string, { name: string; code: string | null }>>({});

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
      if (!ids.length) { setPeople({}); return; }
      const { data } = await supabase.from('profiles').select('user_id, name, student_code').in('user_id', ids);
      const map: Record<string, { name: string; code: string | null }> = {};
      (data ?? []).forEach(p => { map[p.user_id] = { name: p.name, code: p.student_code }; });
      setPeople(map);
    })();
  }, [courseId]);

  const rows = useMemo(() => summary.map((s, i) => ({
    'ลำดับ': i + 1,
    'รหัสนักศึกษา': people[s.student_id]?.code ?? '-',
    'ชื่อ-นามสกุล': people[s.student_id]?.name ?? 'นักศึกษา',
    'มาเรียน': Number(s.on_time_count),
    'มาสาย': Number(s.late_count),
    'ขาดเรียน': Number(s.absent_count),
    'เปอร์เซ็นต์': Number(s.attendance_rate ?? 0),
  })), [summary, people]);

  const handleExport = () => {
    if (!rows.length) { toast.error('ไม่มีข้อมูลให้ส่งออก'); return; }
    const course = courses.find(c => c.id === courseId);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'attendance');
    XLSX.writeFile(wb, `${course?.code ?? 'course'}_attendance_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('ส่งออกไฟล์ Excel แล้ว');
  };

  return (
    <MobileLayout title="ส่งออกรายงาน">
      <div className="px-4 py-4 space-y-4">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {courses.map(c => (
            <button key={c.id} onClick={() => setCourseId(c.id)}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-medium ${courseId === c.id ? 'gradient-primary text-primary-foreground shadow-elevated' : 'bg-card text-muted-foreground shadow-card'}`}>
              {c.code}
            </button>
          ))}
        </div>

        <button onClick={handleExport}
          className="w-full gradient-primary text-primary-foreground rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2">
          <Download className="w-4 h-4" /> ส่งออกเป็น Excel
        </button>

        <div className="bg-card rounded-xl shadow-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                {['ลำดับ', 'รหัสนักศึกษา', 'ชื่อ-นามสกุล', 'มาเรียน', 'มาสาย', 'ขาดเรียน', '%'].map(h => (
                  <th key={h} className="px-2 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r['ลำดับ']}`} className="border-b border-border/40">
                  <td className="px-2 py-2">{r['ลำดับ']}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{r['รหัสนักศึกษา']}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{r['ชื่อ-นามสกุล']}</td>
                  <td className="px-2 py-2 text-success">{r['มาเรียน']}</td>
                  <td className="px-2 py-2 text-warning">{r['มาสาย']}</td>
                  <td className="px-2 py-2 text-destructive">{r['ขาดเรียน']}</td>
                  <td className="px-2 py-2 font-semibold">{r['เปอร์เซ็นต์']}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="py-8 text-center">
              <FileSpreadsheet className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">ยังไม่มีข้อมูลการเข้าเรียน</p>
            </div>
          )}
        </div>
      </div>
    </MobileLayout>
  );
};

export default ExportScoresPage;
