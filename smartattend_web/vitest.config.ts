import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // ค่าปลอมสำหรับเทสต์เท่านั้น ไม่ใช่ค่าจริงและไม่ต่อเน็ต
    //
    // โมดูล integrations/supabase/client.ts โยน error ทันทีตอน import ถ้าไม่มี
    // ค่าเชื่อมต่อ เทสต์ที่ import ไฟล์ lib ใด ๆ ที่แตะ client จึงพังทั้งไฟล์
    // เดิมเทสต์อาศัยไฟล์ .env ของเครื่องที่รัน ซึ่งเป็นความลับและไม่อยู่ใน repo
    // เทสต์หน่วยไม่ควรต้องมีคีย์จริงถึงจะรันได้
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only_not_a_real_key",
      VITE_SUPABASE_PROJECT_ID: "smartattend-test",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
