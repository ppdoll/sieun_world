import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 로컬 개발은 `npx vercel dev` 로 띄운다 (프론트 + /api 함수 동시 실행).
// `npm run dev`(vite만)로 띄우면 /api 호출은 3000번 포트의 vercel dev 로 넘긴다.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
});
