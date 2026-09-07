import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 배포 주소. og:image 같은 태그는 절대 URL 이어야 한다.
 * 1) SITE_URL 환경변수가 있으면 그것
 * 2) Vercel 빌드면 Vercel 이 넣어주는 VERCEL_PROJECT_PRODUCTION_URL
 * 3) 둘 다 없으면(로컬) localhost
 */
function siteUrl() {
  const explicit = process.env.SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return 'https://' + vercel.replace(/\/$/, '');
  return 'http://localhost:4173';
}

/** index.html 의 %SITE_URL% 을 바꿔 넣는다 */
function siteUrlPlugin() {
  return {
    name: 'site-url',
    transformIndexHtml(html) {
      return html.replaceAll('%SITE_URL%', siteUrl());
    },
  };
}

// 로컬 개발은 `npx vercel dev` 로 띄운다 (프론트 + /api 함수 동시 실행).
// `npm run dev`(vite만)로 띄우면 /api 호출은 3000번 포트의 vercel dev 로 넘긴다.
export default defineConfig({
  plugins: [react(), siteUrlPlugin()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
});
