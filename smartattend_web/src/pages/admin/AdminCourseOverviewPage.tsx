import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Building2, User, BookOpen, Search, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Instructor {
  user_id: string;
  name: string | null;
  email: string | null;
  department: string | null;
  faculty: string | null;
}
interface CourseRow {
  id: string;
  code: string;
  name: string;
  section: string | null;
  semester: string | null;
  instructor_id: string;
}
interface EnrollRow {
  course_id: string;
  status: string;
}

export default function AdminCourseOverviewPage() {
  const navigate = useNavigate();
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [openDept, setOpenDept] = useState<Record<string, boolean>>({});
  const [openInstr, setOpenInstr] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      // 1) instructor user_ids
      const { data: roles } = await (supabase as any)
        .from('user_roles')
        .select('user_id')
        .eq('role', 'instructor');
      const ids = (roles ?? []).map((r: any) => r.user_id);
      if (!alive) return;
      if (ids.length === 0) { setInstructors([]); setCourses([]); setEnrollments([]); setLoading(false); return; }

      const [{ data: profs }, { data: crs }] = await Promise.all([
        (supabase as any).from('profiles').select('user_id, name, email, department, faculty').in('user_id', ids),
        (supabase as any).from('courses').select('id, code, name, section, semester, instructor_id').in('instructor_id', ids),
      ]);
      const courseIds = (crs ?? []).map((c: any) => c.id);
      const { data: enr } = courseIds.length
        ? await (supabase as any).from('course_enrollments').select('course_id, status').in('course_id', courseIds)
        : { data: [] as EnrollRow[] };

      if (!alive) return;
      setInstructors(profs ?? []);
      setCourses(crs ?? []);
      setEnrollments((enr ?? []) as EnrollRow[]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    // dept -> instructors[] with their courses
    const byDept = new Map<string, Map<string, { instr: Instructor; courses: CourseRow[] }>>();
    for (const ins of instructors) {
      const dept = ins.department?.trim() || 'ไม่ระบุสาขา';
      const insCourses = courses.filter(c => c.instructor_id === ins.user_id);

      // filter
      const matchInstr = !q || (ins.name ?? '').toLowerCase().includes(q) || (ins.email ?? '').toLowerCase().includes(q);
      const filteredCourses = q
        ? insCourses.filter(c => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
        : insCourses;
      if (q && !matchInstr && filteredCourses.length === 0) continue;

      if (!byDept.has(dept)) byDept.set(dept, new Map());
      byDept.get(dept)!.set(ins.user_id, { instr: ins, courses: matchInstr ? insCourses : filteredCourses });
    }
    return Array.from(byDept.entries())
      .map(([dept, m]) => ({ dept, instructors: Array.from(m.values()).sort((a, b) => (a.instr.name ?? '').localeCompare(b.instr.name ?? '', 'th')) }))
      .sort((a, b) => a.dept.localeCompare(b.dept, 'th'));
  }, [instructors, courses, query]);

  const enrollCount = (cid: string) => {
    const list = enrollments.filter(e => e.course_id === cid);
    return { confirmed: list.filter(e => e.status === 'confirmed').length, total: list.length };
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold font-display text-foreground">ภาพรวมรายวิชาทั้งมหาวิทยาลัย</h1>
        <p className="text-xs text-muted-foreground mt-1">จัดกลุ่มตามสาขา → อาจารย์ → รายวิชา</p>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="ค้นหาชื่ออาจารย์ / รหัสวิชา / ชื่อวิชา..."
          className="w-full h-10 pl-9 pr-3 rounded-xl bg-card border border-border text-sm text-foreground"
        />
      </div>

      {loading ? (
        <p className="text-center text-xs text-muted-foreground py-10">กำลังโหลด...</p>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center bg-card">
          <BookOpen className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm text-foreground font-medium">ไม่พบข้อมูล</p>
        </div>
      ) : (
        <div className="space-y-2">
          {grouped.map(g => {
            const deptOpen = openDept[g.dept] ?? true;
            const totalCourses = g.instructors.reduce((s, i) => s + i.courses.length, 0);
            return (
              <div key={g.dept} className="rounded-xl border border-border bg-card overflow-hidden">
                <button
                  onClick={() => setOpenDept(o => ({ ...o, [g.dept]: !deptOpen }))}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                >
                  {deptOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  <Building2 className="w-4 h-4 text-primary" />
                  <span className="flex-1 text-sm font-semibold text-foreground">{g.dept}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {g.instructors.length} อาจารย์ · {totalCourses} วิชา
                  </span>
                </button>

                {deptOpen && (
                  <div className="border-t border-border/60 divide-y divide-border/60">
                    {g.instructors.map(({ instr, courses: ics }) => {
                      const key = instr.user_id;
                      const iopen = openInstr[key] ?? false;
                      return (
                        <div key={key} className="bg-background/40">
                          <button
                            onClick={() => setOpenInstr(o => ({ ...o, [key]: !iopen }))}
                            className="w-full flex items-center gap-3 px-4 py-2.5 pl-10 hover:bg-muted/40 transition-colors text-left"
                          >
                            {iopen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                            <User className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="flex-1 text-sm text-foreground">{instr.name ?? instr.email ?? '-'}</span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                              {ics.length} วิชา
                            </span>
                          </button>
                          {iopen && (
                            <div className="pl-16 pr-4 pb-3 pt-1 space-y-1">
                              {ics.length === 0 ? (
                                <p className="text-[11px] text-muted-foreground py-2">ยังไม่มีวิชา</p>
                              ) : ics.map(c => {
                                const cnt = enrollCount(c.id);
                                return (
                                  <button
                                    key={c.id}
                                    onClick={() => navigate(`/admin/course-roster/${c.id}`)}
                                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/60 text-left transition-colors"
                                  >
                                    <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-mono text-foreground truncate">
                                        {c.code} · <span className="font-sans">{c.name}</span>
                                      </p>
                                      <p className="text-[10px] text-muted-foreground">
                                        {c.semester ?? '-'}{c.section ? ` · ${c.section}` : ''}
                                      </p>
                                    </div>
                                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                      <Users className="w-3 h-3" />
                                      {cnt.confirmed}/{cnt.total}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
