/* eslint-disable @typescript-eslint/no-explicit-any */
// ตัวแทน supabase client สำหรับถ่ายภาพหน้าจอเท่านั้น ไม่ต่อเน็ตและไม่มีคีย์
// คืนข้อมูลตัวอย่างชุดเดียวกับที่ใช้เล่าปัญหาในสเปก
const ok = (data: any) => Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : 0 });

const chain = (data: any): any => {
  const self: any = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'then') return (res: any) => ok(data).then(res);
      return () => self;
    },
  });
  return self;
};

export const supabase: any = {
  from: (table: string) => chain((MOCK as any)[table] ?? []),
  rpc: (fn: string) => ok((MOCK_RPC as any)[fn] ?? null),
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
  removeChannel: () => {},
  storage: { from: () => ({ createSignedUrl: () => ok({ signedUrl: '#' }) }) },
};

export const MOCK: Record<string, unknown> = {};
export const MOCK_RPC: Record<string, unknown> = {};
