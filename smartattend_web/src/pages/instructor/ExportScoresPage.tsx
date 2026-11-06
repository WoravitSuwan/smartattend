import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { SummaryRow, fetchInstructorCourses, fetchSummary } from '@/lib/attendance-data';
import { fetchComponents, fetchStructureItems } from '@/lib/grade-structure-data';
import { fetchGradeScale, fetchStudentGrades, isFullyGraded, letterGradeFrom,
         type GradeScaleRow } from '@/lib/grade-data';
import { courseScore, type GradeComponent, type StructureItem } from '@/lib/grade-structure';

/** ปัดสองตำแหน่งตอนเขียนลงไฟล์เท่านั้น ไม่ปัดระหว่างคำนวณ */
const round2 = (n: number) => Math.round(n * 100) / 100;

const ExportScoresPage = () => {
  const { user } = useAuth();
  const [courses, setCourses] = useState<{ id: string; code: string; name: string }[]>([]);
  const [courseId, setCourseId] = useState('');
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [people, setPeople] = useState<Record<string, { name: string; code: string | null }>>({});

  /** โครงสร้างคะแนนและคะแนนดิบของทั้งวิชา ใช้ทำไฟล์คะแนนครบทุกระดับ */
  const [components, setComponents] = useState<GradeComponent[]>([]);
  const [items, setItems] = useState<StructureItem[]>([]);
  /** คีย์ `${itemId}:${studentId}` */
  const [grades, setGrades] = useState<Record<string, number | null>>({});
  const [scale, setScale] = useState<GradeScaleRow[]>([]);
  /** นักศึกษาที่ถูกระงับสิทธิ์จากการขาดเรียนครบ 4 ครั้ง */
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

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

      // โครงสร้างคะแนนและคะแนนดิบ — โหลดครั้งเดียวตอนเลือกวิชา ไม่ใช่ตอนกดส่งออก
      // เพื่อให้ปุ่มตอบสนองทันทีและบอกได้ล่วงหน้าว่าวิชานี้มีคะแนนให้ส่งออกไหม
      const [comps, its, sc] = await Promise.all([
        fetchComponents(courseId), fetchStructureItems(courseId), fetchGradeScale(courseId),
      ]);
      setComponents(comps);
      setItems(its);
      setScale(sc.scale);

      // ดึงคะแนนทุกคนครั้งเดียว แล้วทำเป็นตารางค้นหา เร็วกว่ายิงทีละคน
      const rows = await fetchStudentGrades(its.map(i => i.id));
      const g: Record<string, number | null> = {};
      rows.forEach(r => { g[`${r.grade_item_id}:${r.student_id}`] = r.score; });
      setGrades(g);

      // สถานะระงับสิทธิ์อ่านจากคอลัมน์ที่ trigger recompute_attendance_block ดูแลอยู่
      // ไม่นับใหม่ที่ฝั่งเว็บ เพื่อให้ไฟล์ตรงกับสิทธิ์สแกนจริงของนักศึกษา
      const { data: enr } = await supabase
        .from('course_enrollments')
        .select('student_id, attendance_blocked')
        .eq('course_id', courseId)
        .eq('status', 'confirmed');
      setBlocked(new Set((enr ?? [])
        .filter(e => e.attendance_blocked && e.student_id)
        .map(e => e.student_id as string)));
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

  /**
   * แถวคะแนนครบทุกระดับของทั้งวิชา
   *
   * คิดด้วย courseScore() ซึ่งเป็นสูตรเดียวกับที่ฐานข้อมูลใช้ และเป็นตัวเดียวกับ
   * ที่หน้ากรอกคะแนนกับหน้าคะแนนของนักศึกษาใช้ ตัวเลขในไฟล์จึงตรงกับที่เห็นบนจอ
   * ไม่ใช่สูตรชุดที่สองที่ต้องคอยไล่ให้ตรงกัน
   *
   * ส่งออกได้ทุกเมื่อ ไม่ต้องรอประกาศผล — ช่องที่ยังไม่ตรวจเว้นว่างไว้
   * และคอลัมน์เกรดจะบอกว่า "ยังไม่ครบ" แทนการเดาเกรดจากคะแนนบางส่วน
   */
  const fullRows = useMemo(() => {
    if (!components.length || !items.length) return [];
    const itemsOf = (cid: string) => items.filter(i => i.component_id === cid)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const attendanceOf = new Map(summary.map(x => [x.student_id, x]));

    return summary.map((sm, i) => {
      const sid = sm.student_id;
      const cs = courseScore(components, itemsOf, id => grades[`${id}:${sid}`] ?? null);
      const att = attendanceOf.get(sid);

      const row: Record<string, string | number> = {
        'ลำดับ': i + 1,
        'รหัสนักศึกษา': people[sid]?.code ?? '-',
        'ชื่อ-นามสกุล': people[sid]?.name ?? 'นักศึกษา',
      };

      // คะแนนดิบรายช่อง จัดกลุ่มตามหมวดเพื่อให้อ่านไล่ไปทางขวาได้เป็นเรื่องเป็นราว
      for (const c of components) {
        for (const it of itemsOf(c.id)) {
          const v = grades[`${it.id}:${sid}`];
          row[`${c.name} · ${it.name} (เต็ม ${it.max_score})`] = v ?? '';
        }
        const pc = cs.perComponent.find(p => p.component.id === c.id);
        row[`รวม ${c.name} (เต็ม ${c.weight_percent})`] =
          pc && pc.score.hasAnyScore ? round2(pc.score.earned) : '';
      }

      row['คะแนนรวมทั้งวิชา (เต็ม 100)'] = round2(cs.earned);
      row['ตรวจแล้วกี่เปอร์เซ็นต์'] = round2(cs.usedWeight);

      // ไม่ตัดเกรดให้ถ้ายังตรวจไม่ครบ เพราะเกรดจากคะแนนบางส่วนทำให้เข้าใจผิด
      row['เกรด'] = isFullyGraded({ usedWeight: cs.usedWeight })
        ? (letterGradeFrom(scale, cs.earned) ?? '-')
        : 'ยังไม่ครบ';

      row['มาเรียน'] = Number(att?.on_time_count ?? 0);
      row['มาสาย'] = Number(att?.late_count ?? 0);
      row['ขาดเรียน'] = Number(att?.absent_count ?? 0);
      row['เปอร์เซ็นต์เข้าเรียน'] = Number(att?.attendance_rate ?? 0);
      row['สถานะ'] = blocked.has(sid) ? 'ถูกระงับสิทธิ์ (ขาดครบ 4 ครั้ง)' : 'ปกติ';
      return row;
    });
  }, [components, items, grades, scale, summary, people, blocked]);

  const handleExportFull = () => {
    if (!fullRows.length) { toast.error('วิชานี้ยังไม่มีคะแนนให้ส่งออก'); return; }
    setBusy(true);
    try {
      const course = courses.find(c => c.id === courseId);
      const ws = XLSX.utils.json_to_sheet(fullRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'scores');
      XLSX.writeFile(wb,
        `${course?.code ?? 'course'}_scores_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`ส่งออกคะแนน ${fullRows.length} คนแล้ว`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ส่งออกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

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

        <div className="space-y-2">
          <button onClick={handleExportFull} disabled={busy}
            className="w-full gradient-primary text-primary-foreground rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            <FileSpreadsheet className="w-4 h-4" />
            {busy ? 'กำลังสร้างไฟล์…' : 'ส่งออกคะแนนทั้งหมด'}
          </button>
          <p className="text-[11px] text-muted-foreground px-1">
            คะแนนรายช่อง คะแนนรวมแต่ละหมวด คะแนนรวมทั้งวิชา เกรด และสถิติการเข้าเรียน
            ส่งออกได้ทุกเมื่อ ไม่ต้องรอประกาศผล — ช่องที่ยังไม่ตรวจจะเว้นว่าง
          </p>

          <button onClick={handleExport}
            className="w-full bg-card text-foreground shadow-card rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2">
            <Download className="w-4 h-4" /> ส่งออกเฉพาะการเข้าเรียน
          </button>
        </div>

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
