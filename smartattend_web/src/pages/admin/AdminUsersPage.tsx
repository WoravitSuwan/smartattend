import { useEffect, useMemo, useState } from 'react';
import { Search, Trash2, UserPlus, Filter, Loader2, Shield, GraduationCap, User as UserIcon, CheckCircle2, XCircle, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { logAudit } from '@/lib/audit-log';

type Role = 'admin' | 'instructor' | 'student';
type Tab = 'users' | 'requests';

interface Row {
  user_id: string;
  name: string | null;
  email: string | null;
  student_code: string | null;
  department: string | null;
  role: Role;
}

interface RoleRequest {
  id: string;
  user_id: string;
  requested_role: string;
  department: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at: string | null;
  profile?: { name: string | null; email: string | null } | null;
}

const ROLE_SECTIONS: { role: Role; label: string }[] = [
  { role: 'student', label: 'นักศึกษา' },
  { role: 'instructor', label: 'อาจารย์' },
  { role: 'admin', label: 'แอดมิน' },
];

export default function AdminUsersPage() {
  const [tab, setTab] = useState<Tab>('users');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [requests, setRequests] = useState<RoleRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    name: '', email: '', password: '', department: '', role: 'instructor' as Role,
  });

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: profiles }, { data: roles }, { data: reqs }] = await Promise.all([
        supabase.from('profiles').select('user_id, name, email, student_code, department'),
        supabase.from('user_roles').select('user_id, role'),
        supabase.from('role_requests').select('*').order('created_at', { ascending: false }),
      ]);
      const roleMap = new Map<string, Role>();
      for (const r of roles ?? []) roleMap.set(r.user_id, r.role as Role);
      const profileMap = new Map<string, { name: string | null; email: string | null }>();
      for (const p of profiles ?? []) profileMap.set(p.user_id, { name: p.name, email: p.email });

      setRows((profiles ?? []).map(p => ({
        user_id: p.user_id, name: p.name, email: p.email,
        student_code: p.student_code, department: p.department,
        role: roleMap.get(p.user_id) ?? 'student',
      })));
      setRequests((reqs ?? []).map(r => ({
        ...(r as RoleRequest),
        profile: profileMap.get((r as RoleRequest).user_id) ?? null,
      })));
    } catch (e) {
      console.error(e);
      toast.error('โหลดข้อมูลผู้ใช้ไม่สำเร็จ');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Realtime subscription for role_requests
  useEffect(() => {
    const channel = supabase
      .channel('admin-role-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'role_requests' },
        () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const filtered = useMemo(() => rows.filter(u => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (u.name ?? '').toLowerCase().includes(s)
      || (u.email ?? '').toLowerCase().includes(s)
      || (u.student_code ?? '').toLowerCase().includes(s);
  }), [rows, q]);

  const groupedByRole = useMemo(
    () => ROLE_SECTIONS.map(s => ({ ...s, rows: filtered.filter(u => u.role === s.role) })),
    [filtered],
  );

  const pendingRequests = requests.filter(r => r.status === 'pending');

  const handleCreate = async () => {
    const email = form.email.trim().toLowerCase();
    if (!form.name.trim() || !email || form.password.length < 8) {
      toast.error('กรอกชื่อ อีเมล และรหัสผ่าน (อย่างน้อย 8 ตัวอักษร)');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: { email, password: form.password, name: form.name.trim(), department: form.department, role: form.role },
      });
      if (error) throw error;
      if (!(data as { ok: boolean })?.ok) throw new Error((data as { error?: string })?.error ?? 'create_failed');
      toast.success('สร้างบัญชีเรียบร้อย');
      await logAudit({
        action: 'user.create', target: 'user', targetId: (data as { user_id?: string }).user_id,
        detail: `สร้างบัญชี ${email} (${form.role})`,
        after: { email, name: form.name, role: form.role, department: form.department },
      });
      setForm({ name: '', email: '', password: '', department: '', role: 'instructor' });
      setShowForm(false);
      await load();
    } catch (e) {
      toast.error(`สร้างบัญชีไม่สำเร็จ: ${e instanceof Error ? e.message : 'error'}`);
    } finally { setBusy(false); }
  };

  const handleDelete = async (row: Row) => {
    if (!confirm(`ลบผู้ใช้ ${row.name ?? row.email} อย่างถาวร?\n(รวมโปรไฟล์ บทบาท รูปใบหน้า และบัญชี login)`)) return;
    try {
      const before = { ...row };
      const { data, error } = await supabase.functions.invoke('admin-delete-user', {
        body: { user_id: row.user_id },
      });
      if (error) throw error;
      if (!(data as { ok: boolean })?.ok) throw new Error((data as { error?: string })?.error ?? 'delete_failed');
      await logAudit({
        action: 'user.delete', target: 'user', targetId: row.user_id,
        detail: `ลบผู้ใช้ ${row.name ?? row.email}`, before,
      });
      toast.success('ลบผู้ใช้เรียบร้อย');
      await load();
    } catch (e) {
      toast.error(`ลบไม่สำเร็จ: ${e instanceof Error ? e.message : 'error'}`);
    }
  };

  const reviewRequest = async (req: RoleRequest, decision: 'approve' | 'reject') => {
    if (!confirm(`${decision === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'}คำขอเป็นอาจารย์ของ ${req.profile?.name ?? req.profile?.email ?? req.user_id}?`)) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-review-role-request', {
        body: { request_id: req.id, decision },
      });
      if (error) throw error;
      if (!(data as { ok: boolean })?.ok) throw new Error((data as { error?: string })?.error ?? 'review_failed');
      toast.success(decision === 'approve' ? 'อนุมัติเรียบร้อย' : 'ปฏิเสธเรียบร้อย');
      await load();
    } catch (e) {
      toast.error(`ดำเนินการไม่สำเร็จ: ${e instanceof Error ? e.message : 'error'}`);
    } finally { setBusy(false); }
  };

  const RoleIcon = ({ r }: { r: Role }) =>
    r === 'admin' ? <Shield className="w-3 h-3" /> :
    r === 'instructor' ? <UserIcon className="w-3 h-3" /> :
    <GraduationCap className="w-3 h-3" />;

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold font-display text-foreground">จัดการผู้ใช้</h1>
          <p className="text-sm text-muted-foreground">
            {tab === 'users'
              ? `ผู้ใช้ทั้งหมด ${rows.length} คน (แสดง ${filtered.length})`
              : `คำขอทั้งหมด ${requests.length} รายการ · รออนุมัติ ${pendingRequests.length}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowForm(v => !v)}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2">
            <UserPlus className="w-4 h-4" /> {showForm ? 'ปิดฟอร์ม' : 'สร้างบัญชีทันที'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        {([
          { k: 'users' as Tab, label: `ผู้ใช้งาน (${rows.length})` },
          { k: 'requests' as Tab, label: `คำขอเป็นอาจารย์ (${pendingRequests.length} รอ)` },
        ]).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 inline-flex items-center gap-2 ${
              tab === t.k ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            {t.label}
            {t.k === 'requests' && pendingRequests.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-warning text-warning-foreground text-[10px] font-bold">
                {pendingRequests.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bg-card rounded-2xl p-5 shadow-card border border-border space-y-3">
          <p className="text-sm font-semibold">สร้างบัญชีทันที (สำรอง)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input placeholder="ชื่อ - นามสกุล" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              className="px-4 py-2.5 rounded-xl bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <input placeholder="อีเมล" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
              className="px-4 py-2.5 rounded-xl bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <input placeholder="รหัสผ่าน (อย่างน้อย 8 ตัว)" type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
              className="px-4 py-2.5 rounded-xl bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <input placeholder="ภาควิชา / สังกัด" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}
              className="px-4 py-2.5 rounded-xl bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Role })}
              className="px-4 py-2.5 rounded-xl bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/30 md:col-span-2">
              <option value="instructor">อาจารย์</option>
              <option value="student">นักศึกษา</option>
              <option value="admin">แอดมิน</option>
            </select>
          </div>
          <button onClick={handleCreate} disabled={busy}
            className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />} สร้างบัญชี
          </button>
        </div>
      )}

      {tab === 'users' && (
      <div className="space-y-4">
        <div className="bg-card rounded-2xl p-4 shadow-card border border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="ค้นหาชื่อ / อีเมล / รหัสนักศึกษา"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>

        {loading && (
          <div className="bg-card rounded-2xl p-8 shadow-card border border-border text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลด…
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="bg-card rounded-2xl p-8 shadow-card border border-border text-center text-muted-foreground text-sm">
            <Filter className="w-8 h-8 mx-auto mb-2 opacity-40" /> ไม่พบผู้ใช้
          </div>
        )}

        {!loading && groupedByRole.map(section => section.rows.length > 0 && (
          <div key={section.role} className="bg-card rounded-2xl shadow-card border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <RoleIcon r={section.role} />
              <h3 className="text-sm font-bold text-foreground">{section.label}</h3>
              <span className="text-xs text-muted-foreground">({section.rows.length})</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="py-2 px-2">ชื่อ</th>
                    <th className="py-2 px-2 hidden md:table-cell">อีเมล</th>
                    <th className="py-2 px-2 hidden sm:table-cell">รหัส/สังกัด</th>
                    <th className="py-2 px-2 text-right">การดำเนินการ</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map(u => (
                    <tr key={u.user_id} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="py-2.5 px-2 font-medium text-foreground">{u.name ?? '-'}</td>
                      <td className="py-2.5 px-2 text-muted-foreground hidden md:table-cell">{u.email ?? '-'}</td>
                      <td className="py-2.5 px-2 text-muted-foreground hidden sm:table-cell">{u.student_code ?? u.department ?? '-'}</td>
                      <td className="py-2.5 px-2">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleDelete(u)}
                            className="w-8 h-8 rounded-lg hover:bg-destructive/10 flex items-center justify-center text-destructive">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      )}

      {tab === 'requests' && (
        <div className="bg-card rounded-2xl p-4 shadow-card border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 px-2">ชื่อ</th>
                  <th className="py-2 px-2 hidden md:table-cell">อีเมล</th>
                  <th className="py-2 px-2 hidden sm:table-cell">ภาควิชา</th>
                  <th className="py-2 px-2 hidden md:table-cell">วันที่สมัคร</th>
                  <th className="py-2 px-2">สถานะ</th>
                  <th className="py-2 px-2 text-right">การดำเนินการ</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(req => {
                  const badge = req.status === 'pending' ? 'bg-warning/15 text-warning'
                    : req.status === 'approved' ? 'bg-success/15 text-success'
                    : 'bg-destructive/15 text-destructive';
                  return (
                    <tr key={req.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="py-2.5 px-2 font-medium text-foreground">{req.profile?.name ?? '-'}</td>
                      <td className="py-2.5 px-2 text-muted-foreground hidden md:table-cell">{req.profile?.email ?? '-'}</td>
                      <td className="py-2.5 px-2 text-muted-foreground hidden sm:table-cell">{req.department ?? '-'}</td>
                      <td className="py-2.5 px-2 text-xs text-muted-foreground hidden md:table-cell">
                        {new Date(req.created_at).toLocaleString('th-TH')}
                      </td>
                      <td className="py-2.5 px-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge}`}>
                          {req.status === 'pending' ? 'รออนุมัติ' : req.status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว'}
                        </span>
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="flex items-center justify-end gap-1">
                          {req.status === 'pending' && (
                            <>
                              <button onClick={() => reviewRequest(req, 'approve')} disabled={busy}
                                className="px-2.5 py-1 rounded-lg bg-success/15 text-success text-xs font-semibold inline-flex items-center gap-1 hover:bg-success/25 disabled:opacity-50">
                                <CheckCircle2 className="w-3.5 h-3.5" /> อนุมัติ
                              </button>
                              <button onClick={() => reviewRequest(req, 'reject')} disabled={busy}
                                className="px-2.5 py-1 rounded-lg bg-destructive/15 text-destructive text-xs font-semibold inline-flex items-center gap-1 hover:bg-destructive/25 disabled:opacity-50">
                                <XCircle className="w-3.5 h-3.5" /> ปฏิเสธ
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {requests.length === 0 && !loading && (
              <div className="py-12 text-center text-muted-foreground text-sm">
                <Mail className="w-8 h-8 mx-auto mb-2 opacity-40" /> ยังไม่มีคำขอ
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
