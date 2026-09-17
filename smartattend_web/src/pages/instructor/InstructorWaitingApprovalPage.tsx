import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hourglass, CheckCircle2, XCircle, LogOut, RefreshCw, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';

type Status = 'pending' | 'approved' | 'rejected';

/** Landing page for instructor sign-ups awaiting admin approval. */
export default function InstructorWaitingApprovalPage() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) { navigate('/'); return; }
    const { data } = await supabase
      .from('role_requests')
      .select('status, department')
      .eq('user_id', uid)
      .maybeSingle();
    setStatus((data?.status as Status) ?? null);
    setDepartment(data?.department ?? null);
    setLoading(false);
  };

  useEffect(() => {
    let alive = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      await load();
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid || !alive) return;
      channel = supabase
        .channel(`role-req-${uid}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'role_requests', filter: `user_id=eq.${uid}`,
        }, () => { if (alive) load(); })
        .subscribe();
    })();
    return () => {
      alive = false;
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === 'approved') {
      // Force reload so auth-context re-resolves role.
      setTimeout(() => { window.location.href = '/instructor'; }, 800);
    }
  }, [status]);

  const handleLogout = () => { logout(); navigate('/', { replace: true }); };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const view = status === 'approved' ? {
    icon: <CheckCircle2 className="w-8 h-8 text-success" />,
    title: 'อนุมัติเรียบร้อย',
    desc: 'กำลังพาไปหน้าหลัก…',
    accent: 'border-success/40 bg-success/10',
  } : status === 'rejected' ? {
    icon: <XCircle className="w-8 h-8 text-destructive" />,
    title: 'คำขอถูกปฏิเสธ',
    desc: 'แอดมินไม่อนุมัติคำขอเป็นอาจารย์ของคุณ กรุณาติดต่อผู้ดูแลระบบ',
    accent: 'border-destructive/40 bg-destructive/10',
  } : {
    icon: <Hourglass className="w-8 h-8 text-warning" />,
    title: 'คำขอเป็นอาจารย์อยู่ระหว่างรอการอนุมัติ',
    desc: 'ระบบส่งคำขอของคุณให้แอดมินแล้ว โปรดรอการตรวจสอบ — หน้านี้จะอัปเดตอัตโนมัติเมื่อได้รับการอนุมัติ',
    accent: 'border-warning/40 bg-warning/10',
  };

  return (
    <div className="min-h-screen bg-background flex flex-col p-4">
      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-sm font-semibold">{user?.name}</p>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>
        <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs text-destructive font-medium px-3 py-1.5 rounded-lg bg-destructive/10">
          <LogOut className="w-3.5 h-3.5" /> ออกจากระบบ
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className={`w-full max-w-md rounded-3xl border ${view.accent} p-6 space-y-5`}
        >
          <div className="w-16 h-16 rounded-2xl bg-card flex items-center justify-center mx-auto shadow-card">
            {view.icon}
          </div>
          <div className="text-center space-y-1">
            <h1 className="text-lg font-bold font-display">{view.title}</h1>
            <p className="text-sm text-muted-foreground">{view.desc}</p>
            {department && (
              <p className="text-xs text-muted-foreground pt-2">ภาควิชา: <span className="text-foreground font-medium">{department}</span></p>
            )}
          </div>
          {status !== 'approved' && (
            <button onClick={load}
              className="w-full h-12 rounded-2xl border border-border font-semibold flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4" /> ตรวจสอบสถานะอีกครั้ง
            </button>
          )}
        </motion.div>
      </div>
    </div>
  );
}
