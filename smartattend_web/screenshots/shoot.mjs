import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'screenshots/out';
fs.mkdirSync(OUT, { recursive: true });

const views = ['1-before','1-after','2-before','2-after','3-before','3-after',
               '4-before','4-after','5-before','5-after'];

const browser = await chromium.launch({
  // ใช้ Chromium ที่ติดตั้งไว้แล้วในเครื่อง เวอร์ชัน playwright ในโปรเจกต์คนละรุ่น
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },   // ความกว้าง 390px ตามที่สเปกกำหนด
  deviceScaleFactor: 2,
});

for (const v of views) {
  await page.goto(`http://127.0.0.1:5199/screenshots/harness/index.html?v=${v}`,
                  { waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
  const full = v.startsWith('4-');   // เรื่อง 4 ต้องเห็นทั้งหน้าเพื่อดูพื้นที่ว่างด้านล่าง
  await page.screenshot({ path: `${OUT}/${v}.png`, fullPage: full });
  console.log('ถ่ายแล้ว', v);
}
await browser.close();
