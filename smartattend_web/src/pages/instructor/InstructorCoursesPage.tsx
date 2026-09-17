import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { fetchInstructorCourses } from '@/lib/attendance-data';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { BookOpen, Users, Loader2 } from 'lucide-react';

interface CourseItem {
  id: string;
  code: string;
  name: string;
  section: string | null;
  semester: string | null;
  studentCount: number;
}

const InstructorCoursesPage = () => {
  const { user } = useAuth();
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      setLoading(true);
      const cs = await fetchInstructorCourses(user.id);
      if (cs.length === 0) { setCourses([]); setLoading(false); return; }

      const { data: enrolls } = await supabase
        .from('course_enrollments')
        .select('course_id')
        .in('course_id', cs.map(c => c.id));

      const counts = new Map<string, number>();
      (enrolls ?? []).forEach(e => counts.set(e.course_id, (counts.get(e.course_id) ?? 0) + 1));

      setCourses(cs.map(c => ({
        id: c.id,
        code: c.code,
        name: c.name,
        section: c.section,
        semester: c.semester,
        studentCount: counts.get(c.id) ?? 0,
      })));
      setLoading(false);
    })();
  }, [user?.id]);

  return (
    <MobileLayout title="My Courses">
      <div className="px-4 py-4 space-y-3">
        {loading && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && courses.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-10">ยังไม่มีรายวิชา</p>
        )}
        {courses.map((course, i) => (
          <motion.div key={course.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className="bg-card rounded-2xl p-5 shadow-elevated"
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-primary-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-base font-bold font-display text-foreground">{course.code} - {course.name}</p>
                <p className="text-xs text-muted-foreground">Section {course.section ?? '-'}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">ภาคเรียน: {course.semester ?? '-'}</div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="w-3.5 h-3.5" /> {course.studentCount} คน</div>
            </div>
          </motion.div>
        ))}
      </div>
    </MobileLayout>
  );
};

export default InstructorCoursesPage;
