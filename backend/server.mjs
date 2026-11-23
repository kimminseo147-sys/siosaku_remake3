// [학습] 시오사쿠 서버 진입점. app.mjs가 만든 Express 앱을 포트에 연결(listen)합니다.
// [학습] 실행: npm start (배포용, dist/ 화면 포함) / npm run dev (개발용, 화면은 Vite가 따로 띄움)
// [학습] 환경변수는 .env(내 컴퓨터) 또는 Render 대시보드(배포)에서 들어옵니다. config.mjs 참고.
import { config } from './config.mjs';
import { createApp } from './app.mjs';

createApp().listen(config.port, config.host, () => {
  console.log(`시오사쿠 서버 실행: http://${config.host}:${config.port}`);
  if (config.authMode === 'dev') console.log(`⚠️ 점검 모드(로그인 없음): 모든 요청을 사용자 ${config.devActorUserId} 로 처리합니다. 배포 전 AUTH_MODE=jwt로 바꾸세요.`);
});
