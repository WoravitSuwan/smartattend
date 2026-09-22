import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ChevronDown, ChevronUp, Cpu, Terminal } from 'lucide-react';

interface Heartbeat { device_code: string; room: string | null; seen_at: string }
interface LogRow { id: number; device_code: string; level: string; message: string; created_at: string }

const OFFLINE_AFTER_MS = 15_000; // heartbeat ทุก ~4 วิ — ไม่เจอเกิน 15 วิ ถือว่าออฟไลน์
const LOG_LIMIT = 50;

const levelClass: Record<string, string> = {
  error: 'text-destructive',
  warning: 'text-warning',
  info: 'text-foreground',
  debug: 'text-muted-foreground',
};

function timeAgo(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  if (diff < 60_000) return `${Math.floor(diff / 1000)} วิที่แล้ว`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} นาทีที่แล้ว`;
  return `${Math.floor(diff / 3_600_000)} ชม.ที่แล้ว`;
}

/** สถานะและ log การทำงานของ Raspberry Pi ประจำห้อง — อ่านอย่างเดียว
 *  ให้อาจารย์/แอดมินดูได้จากเว็บโดยไม่ต้อง SSH เข้าเครื่อง */
export default function PiStatusPanel() {
  const [heartbeat, setHeartbeat] = useState<Heartbeat | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const loadHeartbeat = () => {
      supabase.from('device_heartbeats').select('device_code, room, seen_at')
        .order('seen_at', { ascending: false }).limit(1).maybeSingle()
        .then(({ data }) => setHeartbeat(data ?? null));
    };
    loadHeartbeat();
    const ch = supabase.channel('pi-heartbeat')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_heartbeats' }, loadHeartbeat)
      .subscribe();
    const poll = setInterval(loadHeartbeat, 10_000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, []);

  useEffect(() => {
    supabase.from('device_logs').select('id, device_code, level, message, created_at')
      .order('created_at', { ascending: false }).limit(LOG_LIMIT)
      .then(({ data }) => setLogs((data ?? []) as LogRow[]));

    const ch = supabase.channel('pi-logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'device_logs' }, (payload) => {
        setLogs(prev => [payload.new as LogRow, ...prev].slice(0, LOG_LIMIT));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const online = heartbeat ? (now - new Date(heartbeat.seen_at).getTime()) < OFFLINE_AFTER_MS : false;

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">กล้อง Pi หน้าห้อง</span>
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
            online ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-success' : 'bg-destructive'}`} />
            {online ? 'ออนไลน์' : 'ออฟไลน์'}
          </span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-border">
          <div className="px-4 py-2 text-[11px] text-muted-foreground border-b border-border/60">
            {heartbeat ? `พบเห็นล่าสุด ${timeAgo(heartbeat.seen_at, now)}` : 'ไม่เคยเชื่อมต่อ'}
          </div>
          <div className="px-4 py-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            <Terminal className="w-3 h-3" /> Log การทำงาน
          </div>
          <div className="max-h-64 overflow-y-auto px-4 pb-3 space-y-1 font-mono">
            {logs.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">ยังไม่มี log</p>}
            {logs.map(l => (
              <div key={l.id} className="text-[11px] leading-relaxed">
                <span className="text-muted-foreground">{new Date(l.created_at).toLocaleTimeString('th-TH')}</span>
                {' '}
                <span className={levelClass[l.level] ?? 'text-foreground'}>{l.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
