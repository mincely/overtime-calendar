import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  // Electron 生产模式用 file:// 加载，必须相对路径
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    // 显式绑 IPv4，否则 localhost 可能解析成 ::1，wait-on 等 127.0.0.1 会一直卡住
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
});
