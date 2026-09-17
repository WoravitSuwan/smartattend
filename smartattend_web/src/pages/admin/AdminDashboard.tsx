import { motion } from 'framer-motion';
import { Users, GraduationCap, BookOpen, Cpu, Activity, UserCheck, ScanFace, Brain } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const StatCard = ({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color: string;
}) => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
    className="bg-card rounded-2xl p-5 shadow-card border border-border">
    <div className="flex items-start justify-between">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-3xl font-bold font-display text-foreground mt-1 truncate">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
      </div>
      <div className={`w-11 h-11 rounded-xl ${color} flex items-center justify-center shrink-0`}>
        <Icon className="w-5 h-5 text-primary-foreground" />
      </div>
    </div>
  </motion.div>
);

interface Stats {
  students: number; instructors: number; admins: number;
  pendingRequests: number; courses: number;
  faceRegistered: number; faceMissing: number;
  latestRun: { name: string; status: string; acc: number | null } | null;
  activeModel: { run_id: string; num_classes: number } | null;
}

export default function AdminDashboard() {
  const [s, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: roles }, { count: pending }, { count: courseCount }, { data: faces }, { data: runs }, { data: models }] = await Promise.all([
        supabase.from('user_roles').select('user_id, role'),
        supabase.from('role_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('courses').select('id', { count: 'exact', head: true }),
        supabase.from('face_images').select('student_id'),
        supabase.from('training_runs').select('name, status, final_acc').order('started_at', { ascending: false }).limit(1),
        supabase.from('face_models').select('run_id, num_classes').eq('is_active', true).order('created_at', { ascending: false }).limit(1),
      ]);

      const studentIds = new Set((roles ?? []).filter(r => r.role === 'student').map(r => r.user_id));
      const registered = new Set((faces ?? []).map(f => f.student_id));
      const faceRegistered = Array.from(registered).filter(id => studentIds.has(id)).length;

      setStats({
        students: studentIds.size,
        instructors: (roles ?? []).filter(r => r.role === 'instructor').length,
        admins: (roles ?? []).filter(r => r.role === 'admin').length,
        pendingRequests: pending ?? 0,
        courses: courseCount ?? 0,
        faceRegistered,
        faceMissing: Math.max(studentIds.size - faceRegistered, 0),
        latestRun: runs?.[0] ? { name: runs[0].name, status: runs[0].status, acc: runs[0].final_acc } : null,
        activeModel: models?.[0] ?? null,
      });
    })();
  }, []);

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-display text-foreground">ภาพรวมระบบ</h1>
        <p className="text-sm text-muted-foreground">สถานะปัจจุบันของ SmartAttend</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard icon={GraduationCap} label="นักศึกษา" value={s?.students ?? '—'} sub="คน" color="gradient-primary" />
        <StatCard icon={Users} label="อาจารย์" value={s?.instructors ?? '—'} sub="คน" color="gradient-secondary" />
        <StatCard icon={UserCheck} label="ผู้ดูแลระบบ" value={s?.admins ?? '—'} sub="คน" color="gradient-primary" />
        <StatCard icon={BookOpen} label="รายวิชาทั้งหมด" value={s?.courses ?? '—'} sub="วิชา" color="gradient-secondary" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard icon={Activity} label="คำขอเป็นอาจารย์" value={s?.pendingRequests ?? '—'} sub="รออนุมัติ" color="bg-warning" />
        <StatCard icon={ScanFace} label="ลงทะเบียนใบหน้าแล้ว" value={s?.faceRegistered ?? '—'} sub="คน" color="bg-success" />
        <StatCard icon={ScanFace} label="ยังไม่ลงทะเบียนใบหน้า" value={s?.faceMissing ?? '—'} sub="คน" color="bg-destructive" />
        <StatCard icon={Cpu} label="อุปกรณ์ Raspberry Pi" value="ยังไม่เชื่อมต่อ" color="bg-muted" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-2xl p-5 shadow-card border border-border">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="w-4 h-4 text-primary" />
            <h2 className="text-base font-bold font-display text-foreground">การเทรนล่าสุด</h2>
          </div>
          {s?.latestRun ? (
            <div className="space-y-1">
              <p className="text-sm text-foreground">{s.latestRun.name}</p>
              <p className="text-xs text-muted-foreground">สถานะ: {s.latestRun.status}</p>
              <p className="text-xs text-muted-foreground">
                ความแม่นยำ: {s.latestRun.acc != null ? `${(Number(s.latestRun.acc) * 100).toFixed(1)}%` : '-'}
              </p>
            </div>
          ) : <p className="text-xs text-muted-foreground">ยังไม่มีการเทรนโมเดล</p>}
        </div>

        <div className="bg-card rounded-2xl p-5 shadow-card border border-border">
          <div className="flex items-center gap-2 mb-3">
            <Cpu className="w-4 h-4 text-primary" />
            <h2 className="text-base font-bold font-display text-foreground">โมเดลที่ใช้งานอยู่</h2>
          </div>
          {s?.activeModel ? (
            <div className="space-y-1">
              <p className="text-sm text-foreground break-all">{s.activeModel.run_id}</p>
              <p className="text-xs text-muted-foreground">จำนวนคลาส: {s.activeModel.num_classes}</p>
            </div>
          ) : <p className="text-xs text-muted-foreground">ยังไม่มีโมเดลที่เผยแพร่</p>}
        </div>
      </div>
    </div>
  );
}
