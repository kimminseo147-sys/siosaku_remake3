# GitHub 업로드 안내

이 ZIP의 압축을 풀고 내부 파일·폴더를 저장소 루트에 업로드하세요. ZIP 파일 자체를 업로드하는 방식이 아닙니다.

- index.html: 웹 진입점
- frontend/App.jsx: React 화면과 이벤트 연결
- frontend/styles/: CSS
- frontend/config/: 상품 사전과 Supabase 연결
- frontend/domain/: 재고·판매·예측 등 브라우저 업무 로직
- frontend/parsers/: 카카오톡·Excel 입력 처리
- frontend/services/: Supabase DB 통신
- scripts/: 개발용 정적 서버와 검증·학습 도구
- docs/: 코드 설명과 입력 흐름 설계
- reference/: 비교 기준 원본

현재 별도 서버 백엔드, DB 스키마·마이그레이션 파일은 없습니다. frontend/domain과 frontend/services도 브라우저에서 실행됩니다. scripts/serve.mjs는 개발용 정적 서버입니다.

실행: npm start
주소: http://127.0.0.1:4173
Node.js와 인터넷 연결이 필요합니다.

2026-11-03 패키징 시 검증 결과:
- node scripts/verify-report-context.mjs: 통과
- npm run check: 실패. scripts/verify-split.mjs:51의 원본 App 코드 보존 비교에서 실패했습니다. 현행 코드가 원본과 동일하다는 검증은 완료되지 않았습니다.
- 실제 브라우저 동작 및 Supabase 권한·읽기·쓰기는 이번 패키징에서 검증하지 않았습니다.
- 비밀키의 대표 패턴 검색에서 일치 파일은 발견되지 않았습니다. Supabase 프로젝트 URL과 공개용 publishable key는 코드에 포함되어 있습니다. DB 권한 정책은 검증하지 않았습니다.

소스는 변경하지 않고 현재 상태 그대로 포함했습니다. 기존 downloads ZIP, .git 및 로컬 환경변수 파일은 포함하지 않았습니다.
