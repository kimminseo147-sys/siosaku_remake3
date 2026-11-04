// [학습] 시오사쿠 서버 진입점. 하나의 Node 서버가 두 가지 일을 합니다.
// [학습]  1) /api/... 요청 → routes.mjs가 로그인 확인 후 DB 함수 호출
// [학습]  2) 그 밖의 요청 → index.html, frontend/ 파일 제공 (기존 scripts/serve.mjs와 같은 역할)
// [학습] 실행: npm start  (이 폴더에 .env가 있어야 합니다)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';
import { HttpError } from './errors.mjs';
import { handleApi } from './routes.mjs';

const root = path.resolve('.');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jsx': 'text/plain', '.json': 'application/json' };

// [학습] 브라우저에 절대 보내면 안 되는 위치. backend/(서버 코드), 점(.)으로 시작하는 파일(.env 등)을 막습니다.
const BLOCKED_DIRS = ['backend', 'reference', 'node_modules', 'tests'];

// [학습] JSON 응답을 보내는 도우미. 보안 헤더 두 개를 함께 붙입니다.
function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

// [학습] POST 본문(JSON)을 읽습니다. 64KB를 넘으면 거부합니다(비정상적으로 큰 요청 방어).
const MAX_BODY = 64 * 1024;
async function readJsonBody(request, maxBytes = MAX_BODY) {
  if (!String(request.headers['content-type'] || '').includes('application/json')) {
    throw new HttpError(415, 'JSON_ONLY', 'JSON 형식으로 보내야 합니다.');
  }
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'TOO_LARGE', '요청이 너무 큽니다.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'BAD_JSON', '요청 내용(JSON)을 읽을 수 없습니다.'); }
}

async function serveStatic(request, response, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end('Method not allowed'); return; }
  const pathname = decodeURIComponent(url.pathname);
  const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  const relative = path.relative(root, filename);
  const parts = relative.split(path.sep);
  if (relative.startsWith('..') || path.isAbsolute(relative) || parts.some(p => p.startsWith('.')) || BLOCKED_DIRS.includes(parts[0])) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const contents = await fs.readFile(filename);
    response.writeHead(200, { 'Content-Type': `${mime[path.extname(filename)] || 'text/plain'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(contents);
  } catch {
    response.writeHead(404).end('Not found');
  }
}

const server = http.createServer(async (request, response) => {
  let url;
  try { url = new URL(request.url, 'http://localhost'); }
  catch { response.writeHead(400).end('Bad request'); return; }

  if (!url.pathname.startsWith('/api/')) { await serveStatic(request, response, url); return; }

  try {
    // [학습] 본문은 주소·방식이 맞는 API를 찾은 뒤에만 읽습니다(routes.mjs가 readBody를 부름).
    const result = await handleApi(request, url, maxBytes => readJsonBody(request, maxBytes));
    sendJson(response, 200, result);
  } catch (error) {
    // [학습] 예상한 오류(HttpError)는 그 메시지를, 예상 못 한 오류는 일반 메시지만 보냅니다. 상세 내용은 서버 콘솔에만.
    if (error instanceof HttpError) { sendJson(response, error.status, { error: { code: error.code, message: error.message } }); return; }
    console.error('[server] 예상하지 못한 오류', error);
    sendJson(response, 500, { error: { code: 'INTERNAL', message: '서버 내부 오류가 발생했습니다.' } });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`시오사쿠 서버 실행: http://${config.host}:${config.port}`);
  if (config.authMode === 'dev') console.log(`⚠️ 점검 모드(로그인 없음): 모든 요청을 사용자 ${config.devActorUserId} 로 처리합니다. 배포 전 AUTH_MODE=jwt로 바꾸세요.`);
});
