// [학습] Express 앱을 만드는 모듈. 하나의 서버가 두 가지 일을 합니다.
// [학습]  1) /api/... 요청 → routes.mjs(Express 라우터)가 로그인 확인 후 DB 함수 호출
// [학습]  2) 그 밖의 요청 → npm run build가 만든 화면 파일(dist/)을 제공
// [학습] 앱 만들기(app.mjs)와 포트 열기(server.mjs)를 나눠 두면, 테스트나 다른 실행 방식에서 앱만 가져다 쓰기 쉽습니다.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.mjs';
import { HttpError } from './errors.mjs';
import { createApiRouter, sendJson } from './routes.mjs';

function createApp() {
  const app = express();
  // [학습] 응답 헤더에 "Express를 쓴다"는 정보를 넣지 않습니다(공격자에게 줄 힌트를 줄임).
  app.disable('x-powered-by');

  // ── 1) API ─────────────────────────────────────────────
  app.use('/api', createApiRouter());

  // ── 2) 화면 파일 ──────────────────────────────────────────
  // [학습] dist/ 폴더 안의 파일만 제공합니다. 예전처럼 프로젝트 폴더 전체를 열지 않으므로
  // [학습]   backend/, .env, tests/ 같은 파일은 애초에 주소로 접근할 수 없습니다.
  // [학습]   express.static은 점(.)으로 시작하는 파일을 기본으로 숨깁니다(dotfiles: 'ignore').
  const staticDir = path.resolve(config.staticDir);
  if (fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: 'index.html' }));
  } else {
    // [학습] 빌드 결과가 없으면 안내 문구만 보여 줍니다. 개발 중에는 npm run dev(Vite 화면 서버)를 쓰면 됩니다.
    app.get('/', (_req, res) => res.type('text/plain; charset=utf-8').send(
      '화면 빌드(dist/)가 없습니다. 개발 중이면 npm run dev 후 http://localhost:5173 을, 배포용이면 npm run build 후 다시 npm start 하세요.'));
  }

  // ── 오류 처리 ─────────────────────────────────────────────
  // [학습] 처리 함수에서 throw한 오류가 모두 여기로 옵니다(Express 5는 async 함수의 오류도 자동으로 넘겨 줌).
  // [학습] 예상한 오류(HttpError)는 그 메시지를, 예상 못 한 오류는 일반 메시지만 보냅니다. 상세 내용은 서버 콘솔에만.
  app.use((error, _req, res, _next) => {
    if (error instanceof HttpError) { sendJson(res, error.status, { error: { code: error.code, message: error.message } }); return; }
    // [학습] express.json이 내는 오류: 깨진 JSON(400), 너무 큰 본문(413)
    if (error.type === 'entity.parse.failed') { sendJson(res, 400, { error: { code: 'BAD_JSON', message: '요청 내용(JSON)을 읽을 수 없습니다.' } }); return; }
    if (error.type === 'entity.too.large') { sendJson(res, 413, { error: { code: 'TOO_LARGE', message: '요청이 너무 큽니다.' } }); return; }
    console.error('[server] 예상하지 못한 오류', error);
    sendJson(res, 500, { error: { code: 'INTERNAL', message: '서버 내부 오류가 발생했습니다.' } });
  });

  return app;
}

export { createApp };
