import fs from 'node:fs';
import path from 'node:path';

// 주석이 포함된 실행 소스를 학습용 Markdown 한 파일로 모읍니다.
// 이 문서는 실행 파일이 아니며 index.html과 frontend 파일을 수정하지 않습니다.
const files = [
  'index.html',
  'frontend/styles/main.css',
  'frontend/config/catalog.js',
  'frontend/config/supabase.js',
  'frontend/domain/dates.js',
  'frontend/domain/quantity.js',
  'frontend/domain/products.js',
  'frontend/domain/inventory.js',
  'frontend/parsers/kakao.js',
  'frontend/parsers/excel.js',
  'frontend/services/inventoryRepository.js',
  'frontend/domain/analytics.js',
  'frontend/domain/forecasting.js',
  'frontend/App.jsx',
  'package.json',
  'scripts/serve.mjs',
  'scripts/verify-split.mjs',
];
const intro = '# 시오사쿠 전체 실행 코드 — 한국어 주석 설명\n\n실행 코드 안의 `[학습]` 주석을 따라 읽으세요. 아래 코드는 파일별로 나뉜 실제 소스의 학습용 사본입니다. 실행은 프로젝트 폴더에서 `npm start`, 검증은 `npm run check`로 합니다.\n\n기존 DB 구조·예측식·업무 동작은 유지했습니다. 별도 백엔드 서버는 아직 없습니다. 보관 원본과 최초 추출·주석 작성 도구는 앱 실행 코드가 아니므로 이 모음에서 제외했습니다.\n\n';
const sections = files.map(filename => {
  const extension = path.extname(filename).slice(1);
  const language = extension === 'mjs' ? 'js' : extension;
  const extra = filename === 'package.json' ? '\nJSON은 주석을 허용하지 않습니다. type:module은 JS의 import/export 사용, start는 개발 서버 실행, check는 원본 비교 검사 명령입니다.\n' : '';
  return `## ${filename}\n${extra}\n\`\`\`${language}\n${fs.readFileSync(filename,'utf8').trimEnd()}\n\`\`\`\n`;
});
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/전체코드_주석설명.md', intro + sections.join('\n'));
console.log('docs/전체코드_주석설명.md 생성 완료');
