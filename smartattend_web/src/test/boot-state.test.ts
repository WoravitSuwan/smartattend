import { describe, it, expect } from 'vitest';
import { bootView, clearSupabaseSession, SUPABASE_STORAGE_PREFIX } from '@/lib/boot-state';

describe('bootView', () => {
  it('ข้อมูลมาแล้วถือว่าพร้อม', () => {
    expect(bootView({ ready: true })).toBe('ready');
  });

  it('ยังไม่มาและยังไม่เลยกำหนด ให้รอต่อ', () => {
    expect(bootView({ ready: false })).toBe('waiting');
  });

  it('รู้ว่าพลาดแล้ว ให้แสดงสาเหตุทันทีไม่ต้องรอครบเวลา', () => {
    expect(bootView({ ready: false, failed: true })).toBe('failed');
  });

  it('รอนานเกินกำหนด ถือว่าพลาด', () => {
    expect(bootView({ ready: false, timedOut: true })).toBe('failed');
  });

  it('ข้อมูลมาแล้วต้องชนะ ไม่ว่าจะช้าไปหรือเคยพลาด', () => {
    // กันกรณีที่คำขอสำเร็จหลังเลยกำหนดไปแล้ว ไม่ควรค้างหน้าผิดพลาดทับข้อมูลที่ได้มา
    expect(bootView({ ready: true, timedOut: true })).toBe('ready');
    expect(bootView({ ready: true, failed: true })).toBe('ready');
  });
});

/** localStorage จำลองเท่าที่ clearSupabaseSession ใช้ */
function fakeStore(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    keys: () => Array.from(map.keys()),
  };
}

describe('clearSupabaseSession', () => {
  it('ลบคีย์ของ supabase และคืนจำนวนที่ลบ', () => {
    const store = fakeStore({
      [`${SUPABASE_STORAGE_PREFIX}abc-auth-token`]: 'x',
      [`${SUPABASE_STORAGE_PREFIX}def-auth-token`]: 'y',
    });
    expect(clearSupabaseSession(store)).toBe(2);
    expect(store.keys()).toEqual([]);
  });

  it('ไม่แตะค่าที่ผู้ใช้ตั้งเอง เช่นธีม', () => {
    const store = fakeStore({
      [`${SUPABASE_STORAGE_PREFIX}abc-auth-token`]: 'x',
      theme: 'dark',
      'view-mode': 'compact',
    });
    expect(clearSupabaseSession(store)).toBe(1);
    expect(store.keys()).toEqual(['theme', 'view-mode']);
  });

  it('ไม่มีคีย์ของ supabase ก็ไม่ลบอะไรเลย', () => {
    const store = fakeStore({ theme: 'light' });
    expect(clearSupabaseSession(store)).toBe(0);
    expect(store.keys()).toEqual(['theme']);
  });
});
