/* Harness สำหรับถ่ายภาพหน้าจอที่ความกว้าง 390px — ไม่ได้อยู่ในแอปจริง
 * ประกอบ "ชิ้นส่วนที่เห็นได้" ของแต่ละเรื่องด้วยข้อมูลตัวอย่าง เพื่อเทียบก่อน/หลัง
 * ไม่ต่อฐานข้อมูล ไม่มีคีย์ใด ๆ */
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';

const params = new URLSearchParams(location.search);
const view = params.get('v') ?? '';

/* ─────────── เรื่องที่ 1: แถวหมวดคะแนนฝั่งนักศึกษา ─────────── */
const Row1Before = () => (
  <div className="flex items-center gap-2 text-left py-1">
    <span className="w-3" />
    <span className="text-xs text-muted-foreground w-24 truncate">LABs</span>
    <span className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
      <span className="block h-full w-full rounded-full gradient-primary" />
    </span>
    <span className="text-xs font-semibold text-foreground w-20 text-right shrink-0">20.0/20</span>
  </div>
);

const Row1After = () => (
  <div className="flex items-start gap-2 text-left py-1">
    <span className="w-3" />
    <span className="flex-1 min-w-0">
      <span className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">LABs</span>
        <span className="text-xs font-semibold text-foreground text-right shrink-0">4.0/4</span>
      </span>
      <span className="block h-1.5 mt-1 rounded-full bg-muted overflow-hidden">
        <span className="block h-full rounded-full gradient-primary" style={{ width: '20%' }} />
      </span>
      <span className="block text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
        ตรวจแล้ว 2 จาก 10 ชิ้นที่วางแผนไว้ · เต็มหมวดนี้ 20 คะแนน
        <span className="block text-warning">คะแนนอาจเปลี่ยนเมื่ออาจารย์เพิ่มงานหรือตรวจงานเพิ่ม</span>
      </span>
    </span>
  </div>
);

/* ─────────── เรื่องที่ 2: หน้าตรวจงาน ─────────── */
const Grade2Before = () => (
  <div className="space-y-3">
    <select className="w-full px-3 py-2.5 rounded-xl bg-card shadow-card text-xs text-foreground">
      <option>ใบงานที่ 1 เรื่องตัวแปร (เต็ม 10)</option>
    </select>
    <div className="bg-card rounded-2xl p-4 shadow-card space-y-2">
      <p className="text-sm font-semibold text-foreground">นายสมชาย ใจดี</p>
      <p className="text-[10px] text-muted-foreground">6754321001-1 · ส่งเมื่อ 28 ก.ย. 2569 14:02</p>
      <div className="flex gap-2">
        <div className="w-24 px-3 py-2 rounded-xl bg-muted text-xs text-muted-foreground">0-10</div>
        <div className="flex-1 px-3 py-2 rounded-xl bg-muted text-xs text-muted-foreground">คอมเมนต์</div>
        <div className="shrink-0 px-3 py-2 rounded-xl gradient-primary" />
      </div>
    </div>
    <p className="text-[10px] text-destructive text-center">
      ต้องกดเปลี่ยนดรอปดาวน์ทีละชิ้นจึงจะรู้ว่างานไหนยังตรวจไม่ครบ
    </p>
  </div>
);

const A2 = ({ title, full, comp, due, sub, tot, graded, done }: {
  title: string; full: number; comp: string | null; due: string;
  sub: number; tot: number; graded: number; done: boolean;
}) => (
  <div className="bg-card rounded-2xl shadow-card overflow-hidden">
    <div className="w-full text-left p-3.5 space-y-2">
      <div className="flex items-start gap-2">
        <span className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground">›</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            เต็ม {full} คะแนน · {comp
              ? <span>🔗 เข้าหมวด {comp}</span>
              : <span className="text-warning">ไม่ได้ผูกหมวดคะแนน</span>}
            <br />กำหนดส่ง {due}
          </p>
        </div>
        <span className={`shrink-0 px-2 py-1 rounded-full text-[10px] font-medium ${
          done ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}>
          {done ? 'ตรวจครบ' : 'ยังไม่ครบ'}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>ส่งแล้ว <span className="font-semibold text-foreground">{sub}</span> จาก {tot}</span>
        <span>·</span>
        <span>ตรวจแล้ว <span className="font-semibold text-foreground">{graded}</span> จาก {sub}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${done ? 'bg-success' : 'gradient-primary'}`}
          style={{ width: `${sub > 0 ? (graded / sub) * 100 : 0}%` }} />
      </div>
    </div>
  </div>
);

const Grade2After = () => (
  <div className="space-y-3">
    <div className="flex items-center gap-1.5">
      <div className="flex-1 py-1.5 rounded-xl text-[11px] font-semibold text-center bg-card text-muted-foreground shadow-card">ทั้งหมด</div>
      <div className="flex-1 py-1.5 rounded-xl text-[11px] font-semibold text-center gradient-primary text-primary-foreground">ยังไม่ตรวจ (2)</div>
      <div className="flex-1 py-1.5 rounded-xl text-[11px] font-semibold text-center bg-card text-muted-foreground shadow-card">ตรวจครบแล้ว</div>
    </div>
    <A2 title="ใบงานที่ 2 เรื่องลูป" full={10} comp="LABs" due="30 ก.ย. 2569 23:59" sub={8} tot={10} graded={5} done={false} />
    <A2 title="ใบงานที่ 3 เรื่องฟังก์ชัน" full={20} comp={null} due="5 ต.ค. 2569 23:59" sub={3} tot={10} graded={0} done={false} />
    <A2 title="ใบงานที่ 1 เรื่องตัวแปร" full={10} comp="LABs" due="20 ก.ย. 2569 23:59" sub={10} tot={10} graded={10} done />
  </div>
);

/* ─────────── เรื่องที่ 3: หมวดคะแนนในหน้าตั้งโครงสร้าง ─────────── */
const Box3Before = () => (
  <div className="rounded-xl border border-border p-2.5 space-y-2">
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">⠿</span>
      <div className="flex-1 px-2 py-1.5 rounded-lg bg-muted text-xs text-foreground">LABs</div>
      <div className="w-16 px-2 py-1.5 rounded-lg bg-muted text-xs text-center">20</div>
      <span className="text-[10px] text-muted-foreground">%</span>
      <span className="text-destructive">🗑</span>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <div className="px-2 py-1.5 rounded-lg bg-muted text-[11px]">ปฏิบัติการ</div>
      <div className="px-2 py-1.5 rounded-lg bg-muted text-[11px]">อาจารย์กรอกเอง</div>
    </div>
    <div className="px-2 py-1.5 rounded-lg bg-muted text-[11px]">วิธีคิดคะแนน: ตามสัดส่วนคะแนนรวม</div>
    <p className="text-[10px] text-muted-foreground leading-relaxed">
      รวมคะแนนที่ได้ทั้งหมวด หารด้วยคะแนนเต็มทั้งหมวด แล้วคูณน้ำหนักหมวด
      เหมาะกับหมวดที่งานคะแนนไม่เท่ากันและจำนวนงานไม่แน่นอน เช่น LAB ที่เพิ่มงานได้เรื่อย ๆ
    </p>
    <div className="flex items-center gap-3 flex-wrap text-[10px]">
      ตัดคะแนนต่ำสุดออก <span className="w-14 px-2 py-1 rounded-lg bg-muted text-center">0</span> รายการ
      <span>☐ ปิดบังคะแนนจนประกาศผล</span>
    </div>
    <p className="text-[10px] text-muted-foreground">2 รายการ · เต็มรวม 2 คะแนน</p>
  </div>
);

const Row3 = ({ name, w, n, mode }: { name: string; w: number; n: number; mode: string }) => (
  <div className="rounded-xl border border-border overflow-hidden">
    <div className="w-full flex items-center gap-2 p-2.5 text-left">
      <span className="text-muted-foreground shrink-0">›</span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs font-medium text-foreground truncate">{name}</span>
        <span className="block text-[10px] text-muted-foreground truncate">
          {w}% · {n} รายการ · {mode}
        </span>
      </span>
      <span className="shrink-0 text-destructive">🗑</span>
    </div>
  </div>
);

const Box3After = () => (
  <div className="space-y-2">
    <div className="sticky top-0 bg-card pb-2 border-b border-border">
      <p className="text-xs font-semibold text-foreground">โครงสร้างคะแนน · น้ำหนักรวม 100%</p>
      <p className="text-[10px] mt-0.5 text-success">น้ำหนักรวมครบ 100% พร้อมประกาศผลได้</p>
    </div>
    <Row3 name="LABs" w={20} n={2} mode="ตามสัดส่วน" />
    <Row3 name="งานที่มอบหมาย" w={20} n={5} mode="ตามสัดส่วน" />
    <Row3 name="จิตพิสัย" w={10} n={1} mode="ตามสัดส่วน" />
    <Row3 name="สอบกลางภาค" w={20} n={1} mode="ตามสัดส่วน" />
    <Row3 name="สอบปลายภาค" w={30} n={1} mode="ตามสัดส่วน" />
  </div>
);

/* ─────────── เรื่องที่ 5: แถบล่าง ─────────── */
const Bar5Before = () => (
  <div className="bg-card/95 border-t border-border">
    <div className="flex overflow-x-auto">
      {['Dashboard', 'จัดการผู้ใช้', 'ภาพรวมวิชา', 'รายวิชา', 'Dataset ใบหน้า', 'เทรนโมเดล', 'ประวัติเทรน', 'กราฟเทรน', 'Audit Log']
        .map(l => (
          <div key={l} className="flex flex-col items-center gap-1 py-2.5 px-4 min-w-[72px] shrink-0">
            <span className="w-5 h-5 rounded bg-muted-foreground/30" />
            <span className="text-[10px] font-medium whitespace-nowrap text-muted-foreground">{l}</span>
          </div>
        ))}
    </div>
  </div>
);

const Bar5After = () => (
  <div className="bg-card/95 border-t border-border">
    <div className="grid grid-cols-5">
      {[['ภาพรวม', true], ['ผู้ใช้', false], ['รายวิชา', false], ['ใบหน้า', false], ['เพิ่มเติม', false]]
        .map(([l, active]) => (
          <div key={l as string} className="flex flex-col items-center gap-1 py-2.5 px-1 min-w-0">
            <span className={`w-5 h-5 rounded shrink-0 ${active ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
            <span className={`text-[11px] font-medium leading-none truncate max-w-full ${
              active ? 'text-primary' : 'text-muted-foreground'}`}>{l as string}</span>
          </div>
        ))}
    </div>
  </div>
);

const Sheet5 = () => (
  <div className="rounded-t-3xl bg-card shadow-float">
    <div className="px-4 pt-4 pb-2 flex items-center justify-between">
      <p className="text-sm font-bold font-display text-foreground">เพิ่มเติม</p>
      <span className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center text-muted-foreground">✕</span>
    </div>
    <div className="px-4 pb-4 space-y-4">
      {[['ผู้ใช้และรายวิชา', ['ภาพรวมวิชาทั้งมหาวิทยาลัย']],
        ['การฝึกแบบจำลอง', ['เทรนโมเดล', 'ประวัติเทรน', 'กราฟเทรน']],
        ['การตรวจสอบระบบ', ['บันทึกการใช้งาน (Audit Log)']]].map(([t, items]) => (
        <div key={t as string}>
          <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">{t as string}</p>
          <div className="space-y-1">
            {(items as string[]).map(i => (
              <div key={i} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-foreground">
                <span className="w-4 h-4 rounded bg-muted-foreground/30 shrink-0" />
                <span className="truncate">{i}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

/* ─────────── เรื่องที่ 4: เมนูด้านข้าง ─────────── */
const Side4 = ({ fixed }: { fixed: boolean }) => (
  <div className={`flex w-full bg-background ${fixed ? 'h-[520px] overflow-hidden' : 'min-h-[520px]'}`}>
    <aside className={`w-40 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col ${fixed ? 'h-full' : ''}`}>
      <div className="p-3 border-b border-sidebar-border text-xs font-bold text-sidebar-foreground">Admin Panel</div>
      <nav className={`p-2 space-y-1 ${fixed ? 'flex-1 min-h-0 overflow-y-auto' : 'flex-1'}`}>
        {['Dashboard', 'จัดการผู้ใช้', 'ภาพรวมวิชา', 'รายวิชา', 'Dataset ใบหน้า', 'เทรนโมเดล', 'ประวัติเทรน', 'กราฟเทรน', 'Audit Log'].map(l => (
          <div key={l} className="px-2 py-2 rounded-lg text-[11px] text-sidebar-foreground">{l}</div>
        ))}
      </nav>
      <div className={`p-2 border-t border-sidebar-border ${fixed ? 'shrink-0' : ''}`}>
        <div className="px-2 py-1 text-[10px] text-muted-foreground">ผู้ดูแลระบบ</div>
        <div className="mt-1 px-2 py-1.5 rounded-lg bg-destructive/10 text-destructive text-[11px]">ออกจากระบบ</div>
      </div>
    </aside>
    <div className={`flex-1 min-w-0 flex flex-col ${fixed ? '' : ''}`}>
      <div className="h-10 shrink-0 border-b border-border bg-card/50" />
      <main className={`flex-1 p-3 ${fixed ? 'min-h-0 overflow-y-auto' : ''}`}>
        {Array.from({ length: 14 }, (_, i) => (
          <div key={i} className="h-12 mb-2 rounded-xl bg-card shadow-card" />
        ))}
      </main>
    </div>
  </div>
);

const Frame = ({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) => (
  <div className="min-h-screen brand-surface p-3 space-y-2">
    <p className="text-[11px] font-bold text-foreground">{title}</p>
    {note && <p className="text-[10px] text-muted-foreground leading-relaxed">{note}</p>}
    <div className="bg-card rounded-2xl p-3 shadow-card">{children}</div>
  </div>
);

const VIEWS: Record<string, React.ReactNode> = {
  '1-before': <Frame title="เรื่อง 1 — ก่อน" note="LAB 20% มีงาน 2 ชิ้น ได้เต็มทั้งคู่ · ตัวเลขบอกว่า 20.0/20 ทำให้เข้าใจว่าได้ LAB เต็มทั้งเทอมแล้ว"><Row1Before /></Frame>,
  '1-after': <Frame title="เรื่อง 1 — หลัง" note="ตั้งจำนวนงานที่วางแผนไว้ 10 ชิ้น · ตัวเลขเทียบกับที่วางแผน และบอกตรง ๆ ว่าคะแนนยังเปลี่ยนได้"><Row1After /></Frame>,
  '2-before': <Frame title="เรื่อง 2 — ก่อน"><Grade2Before /></Frame>,
  '2-after': <Frame title="เรื่อง 2 — หลัง"><Grade2After /></Frame>,
  '3-before': <Frame title="เรื่อง 3 — ก่อน" note="หนึ่งหมวดกินพื้นที่เกือบเต็มจอ 5 หมวดต้องเลื่อนหลายหน้า"><Box3Before /></Frame>,
  '3-after': <Frame title="เรื่อง 3 — หลัง" note="5 หมวดอยู่ในหน้าจอเดียว แถบน้ำหนักรวมติดอยู่ด้านบน"><Box3After /></Frame>,
  '4-before': <div className="h-screen overflow-y-auto"><Side4 fixed={false} /></div>,
  '4-after': <Side4 fixed />,
  '5-before': <Frame title="เรื่อง 5 — ก่อน" note="9 แท็บ ต้องเลื่อนแนวนอน ตัวหนังสือ 10px"><Bar5Before /></Frame>,
  '5-after': <Frame title="เรื่อง 5 — หลัง" note="5 ช่องพอดีจอ ตัวหนังสือ 11px ไม่เลื่อนแนวนอน"><><Bar5After /><div className="mt-3"><Sheet5 /></div></></Frame>,
};

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{VIEWS[view] ?? <div className="p-4 text-sm">ไม่พบมุมมอง {view}</div>}</React.StrictMode>,
);
