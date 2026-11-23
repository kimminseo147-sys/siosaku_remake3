// [학습] Vite 설정. Vite = 화면 코드(JSX)를 개발 중엔 바로 보여 주고, 배포 땐 dist/ 폴더로 묶어 주는 도구입니다.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // [학습] 개발 중(npm run dev)에는 화면은 Vite(5173), API는 Express(4173)가 따로 돌아갑니다.
    // [학습]   브라우저가 /api/... 를 부르면 Vite가 Express로 대신 전달(proxy)해 줘서, 코드에서는 주소를 바꿀 필요가 없습니다.
    proxy: { '/api': 'http://127.0.0.1:4173' },
  },
  // [학습] npm run build 결과가 들어갈 폴더. Express(npm start)가 이 폴더를 화면으로 제공합니다.
  build: { outDir: 'dist', emptyOutDir: true },
});
