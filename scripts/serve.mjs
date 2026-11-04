// [학습] Node.js 기본 http 모듈로 파일 제공 서버를 만듭니다. 추가 패키지 설치는 필요하지 않습니다.
import http from 'node:http';
// [학습] fs/promises는 파일 읽기를 Promise와 await로 처리하는 API입니다.
import fs from 'node:fs/promises';
// [학습] path는 Windows 등 운영체제에 맞춰 파일 경로를 계산합니다.
import path from 'node:path';

// 로컬 학습·개발용 정적 서버. 실제 운영용 백엔드가 아니다.
// [학습] 명령을 실행한 프로젝트 폴더를 파일 제공 기준으로 사용합니다.
const root = path.resolve('.');
// [학습] 브라우저가 파일을 HTML·CSS·JavaScript로 해석하도록 확장자별 Content-Type을 지정합니다.
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jsx': 'text/plain' };
// [학습] 요청이 올 때마다 콜백을 실행합니다. request는 요청 정보, response는 돌려줄 응답입니다.
const server = http.createServer(async (request, response) => {
  try {
    // [학습] URL에서 경로를 꺼내고 한글 등 인코딩된 문자를 복원합니다.
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    // [학습] / 요청은 index.html로 연결하며 상대 요청을 절대 파일 경로로 바꿉니다.
    const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(root, filename);
    // [학습] 프로젝트 바깥 경로·숨김 파일·보관 원본에 대한 요청을 거부합니다. 로컬 개발용의 간단한 방어입니다.
    if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some(part => part.startsWith('.')) || relative.startsWith('reference' + path.sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    // [학습] 파일을 읽고 200 성공 상태와 형식을 응답합니다. no-store는 개발 중 오래된 파일 재사용을 줄입니다.
    const contents = await fs.readFile(filename);
    response.writeHead(200, { 'Content-Type': `${mime[path.extname(filename)] || 'text/plain'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    // [학습] 실제 파일 내용을 브라우저에 전달하고 응답을 끝냅니다.
    response.end(contents);
  } catch {
    // [학습] 파일이 없거나 읽지 못하면 404 응답을 보냅니다.
    response.writeHead(404).end('Not found');
  }
});
// [학습] 이 컴퓨터에서만 접근 가능한 주소와 4173 포트로 실행합니다. 종료는 터미널 Ctrl+C입니다.
server.listen(4173, '127.0.0.1', () => console.log('시오사쿠 로컬 실행: http://127.0.0.1:4173'));
