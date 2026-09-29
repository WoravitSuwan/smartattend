import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// คอนฟิกแยกสำหรับหน้าถ่ายภาพเท่านั้น ไม่กระทบ build ของแอปจริง
export default defineConfig({
  root: path.resolve(__dirname, '..'),
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, '../src') } },
  server: { port: 5199, host: '127.0.0.1' },
});
