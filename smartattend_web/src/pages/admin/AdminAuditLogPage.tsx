import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ScrollText, Filter, Download, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface AuditEntry {
  id: string;
  createdAt: string; // ISO
  actorId: string | null;
  actorName: string;
  actorRole: string;
  action: string;
  target: string;
  detail: string;
  ip: string | null;
}

// Maps known raw action strings to readable Thai labels + a badge color.
// Falls back to the raw action string if not found.
const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  'login': { label: 'เข้าสู่ระบบ', color: 'bg-blue-500/15 text-blue-500 border-blue-500/30' },
  'user.create': { label: 'สร้างผู้ใช้', color: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
  'user.delete': { label: 'ลบผู้ใช้', color: 'bg-red-500/15 text-red-500 border-red-500/30' },
  'user.invite': { label: 'เชิญผู้ใช้', color: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
  'user.invite.revoke': { label: 'ยกเลิกคำเชิญ', color: 'bg-red-500/15 text-red-500 border-red-500/30' },
  'user.invite.resend': { label: 'ส่งคำเชิญซ้ำ', color: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
  'grade.update': { label: 'แก้ไขคะแนน', color: 'bg-purple-500/15 text-purple-500 border-purple-500/30' },
  'grade.announce': { label: 'ประกาศคะแนน', color: 'bg-purple-500/15 text-purple-500 border-purple-500/30' },
  'attendance.manual_edit': { label: 'แก้ไขการเข้าเรียน', color: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
  'edit_attendance': { label: 'แก้ไขการเข้าเรียน', color: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
  'attendance.flagged_liveness': { label: 'ตรวจพบความผิดปกติ (Liveness)', color: 'bg-red-500/15 text-red-500 border-red-500/30' },
  'leave.submit': { label: 'ยื่นใบลา', color: 'bg-cyan-500/15 text-cyan-500 border-cyan-500/30' },
  'leave.approve': { label: 'อนุมัติใบลา', color: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
  'leave.reject': { label: 'ปฏิเสธใบลา', color: 'bg-red-500/15 text-red-500 border-red-500/30' },
  'training.run': { label: 'เทรนโมเดล', color: 'bg-primary/15 text-primary border-primary/30' },
  'training.failed': { label: 'เทรนโมเดลล้มเหลว', color: 'bg-red-500/15 text-red-500 border-red-500/30' },
};

function actionMeta(action: string) {
  return ACTION_LABELS[action] ?? { label: action, color: 'bg-muted text-muted-foreground border-border' };
}

export default function AdminAuditLogPage() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actor, setActor] = useState<string>('all');
  const [action, setAction] = useState<string>('all');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('audit_logs')
          .select('id, actor_id, actor_name, actor_role, action, target, target_id, detail, before, after, reason, ip, created_at')
          .order('created_at', { ascending: false })
          .limit(500);
        if (error) throw error;
        setRows((data ?? []).map(d => ({
          id: d.id,
          createdAt: d.created_at,
          actorId: d.actor_id,
          actorName: d.actor_name ?? 'ไม่ทราบผู้ใช้',
          actorRole: d.actor_role ?? '-',
          action: d.action,
          target: d.target ?? '-',
          detail: d.detail ?? d.reason ?? '-',
          ip: d.ip,
        })));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const actors = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach(e => { if (e.actorId) map.set(e.actorId, e.actorName); });
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [rows]);

  const actions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(e => set.add(e.action));
    return Array.from(set);
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter(e => {
      if (actor !== 'all' && e.actorId !== actor) return false;
      if (action !== 'all' && e.action !== action) return false;
      const d = new Date(e.createdAt);
      if (from && d < new Date(from)) return false;
      if (to && d > new Date(to + 'T23:59:59')) return false;
      if (q && !(`${e.target} ${e.detail} ${e.actorName}`.toLowerCase().includes(q.toLowerCase()))) return false;
      return true;
    });
  }, [rows, actor, action, from, to, q]);

  const exportCSV = () => {
    const rowsCsv = [['เวลา', 'ผู้ใช้', 'บทบาท', 'ประเภท', 'เป้าหมาย', 'รายละเอียด', 'IP']];
    filtered.forEach(e => rowsCsv.push([e.createdAt, e.actorName, e.actorRole, actionMeta(e.action).label, e.target, e.detail, e.ip || '-']));
    const csv = rowsCsv.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audit-log-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold font-display text-foreground flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-primary" /> Audit Log
          </h1>
          <p className="text-sm text-muted-foreground">ประวัติการทำงานสำคัญในระบบ</p>
        </div>
        <button onClick={exportCSV} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-2xl p-4 md:p-5 shadow-card border border-border">
        <div className="flex items-center gap-2 mb-3 text-xs font-medium text-muted-foreground">
          <Filter className="w-4 h-4" /> ตัวกรอง
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground">จากวันที่</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="mt-1 w-full h-9 rounded-lg bg-background border border-border px-3 text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">ถึงวันที่</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="mt-1 w-full h-9 rounded-lg bg-background border border-border px-3 text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">ผู้ใช้</label>
            <select value={actor} onChange={e => setActor(e.target.value)}
              className="mt-1 w-full h-9 rounded-lg bg-background border border-border px-2 text-sm">
              <option value="all">ทั้งหมด</option>
              {actors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">ประเภท</label>
            <select value={action} onChange={e => setAction(e.target.value)}
              className="mt-1 w-full h-9 rounded-lg bg-background border border-border px-2 text-sm">
              <option value="all">ทั้งหมด</option>
              {actions.map(a => <option key={a} value={a}>{actionMeta(a).label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">ค้นหา</label>
            <div className="relative mt-1">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="คำค้น..."
                className="w-full h-9 rounded-lg bg-background border border-border pl-8 pr-3 text-sm" />
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-2xl shadow-card border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">{filtered.length} รายการ</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">เวลา</th>
                <th className="px-4 py-2.5 font-medium">ผู้ใช้</th>
                <th className="px-4 py-2.5 font-medium">ประเภท</th>
                <th className="px-4 py-2.5 font-medium">เป้าหมาย</th>
                <th className="px-4 py-2.5 font-medium">รายละเอียด</th>
                <th className="px-4 py-2.5 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูล...</td></tr>
              )}
              {!loading && filtered.map((e, i) => {
                const meta = actionMeta(e.action);
                return (
                  <motion.tr key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                    className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString('th-TH')}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-foreground">{e.actorName}</div>
                      <div className="text-[10px] text-muted-foreground uppercase">{e.actorRole}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] border ${meta.color}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{e.target}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{e.detail}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{e.ip || '-'}</td>
                  </motion.tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">ยังไม่มีบันทึกการทำงาน</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
