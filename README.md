# 시오사쿠 코드 분리본

이번 작업은 615행 단일 HTML을 책임별 파일로 분리한 1단계 작업입니다. 기존 계산식, 상품 사전, DB 테이블 및 화면 동작을 유지했습니다. 오류·보안·성능 개선은 코드 이해 이후 진행합니다.

현재 실행 소스에는 `[학습]` 표시의 한국어 설명 주석이 들어 있습니다. HTML·CSS·React·설정·업무 규칙·파서·DB 접근 전체를 대상으로 파일 역할, 함수 입력·반환값, 주요 문법과 실행 흐름을 설명합니다. 주석을 제거하면 최초 분리본과 코드가 동일한지도 검증합니다. `reference/original.html`은 비교 기준이므로 주석을 추가하지 않았습니다. `package.json`은 주석을 허용하지 않는 JSON 형식이라 그대로 두었습니다.

설명 주석을 한 파일에서 읽고 싶다면 `docs/전체코드_주석설명.md`를 열면 됩니다. 해당 문서는 학습용 사본이며 실제 실행은 frontend와 index.html의 코드를 사용합니다.

## 실행 방법

Node.js가 설치된 환경에서 이 폴더를 터미널로 열고 실행합니다.

```sh
npm start
```

브라우저에서 http://127.0.0.1:4173 을 엽니다. 종료는 터미널에서 Ctrl+C를 누릅니다. 별도의 npm 패키지 설치는 필요하지 않습니다. 기존과 같이 React, Babel, Supabase, SheetJS는 CDN에서 로드하므로 인터넷 연결은 필요합니다.

HTML을 더블클릭하여 `file://`로 열면 외부 JSX·모듈 로딩이 제한될 수 있으므로 위 정적 서버로 실행합니다. 이 서버는 개발용 파일 제공 도구이며 실제 운영용 백엔드가 아닙니다.

기존 Supabase 프로젝트에 연결됩니다. 저장·삭제는 실제 데이터에 반영되므로 코드 읽기와 실행 확인 시 조회부터 진행하세요. 공개 키의 위치만 변경했으며 권한 정책은 변경하지 않았습니다.

## 폴더별 역할

| 파일/폴더 | 역할 | 원본 행 |
| --- | --- | --- |
| `index.html` | 화면 진입점, CSS·라이브러리·React 진입 파일 연결 | 1~40, 613~615 |
| `frontend/styles/main.css` | 기존 디자인 및 모바일 CSS | 8~29 |
| `frontend/config/supabase.js` | Supabase 클라이언트 생성 | 42~45 |
| `frontend/config/catalog.js` | 지점, 기본 상품, 별칭 사전 | 46~59 |
| `frontend/domain/products.js` | 상품명 정리·표준화 | 61~82 |
| `frontend/domain/dates.js` | 날짜 검증, 요일 계산 | 83~89 |
| `frontend/domain/quantity.js` | 수량 검증·파싱·표시 | 90~106 |
| `frontend/domain/inventory.js` | 재고 상태, 판매량, 보고 반영 | 107~135, 180~200 |
| `frontend/parsers/kakao.js` | 카카오톡 보고 해석 | 136~179 |
| `frontend/parsers/excel.js` | Excel 읽기와 검증·미리보기 데이터 생성 | 201~263, 358~366 |
| `frontend/domain/analytics.js` | 판매·품질 집계 | 264~288 |
| `frontend/domain/forecasting.js` | 기존 임시 예측식 보관 | 289~305 |
| `frontend/services/inventoryRepository.js` | DB 조회·등록·수정·삭제 | 308~357, 467~471 |
| `frontend/App.jsx` | React 상태, 이벤트 연결, 화면 렌더링 | 368~612 |
| `reference/original.html` | 전달받은 원본 보관 | 전체 |
| `scripts/` | 로컬 실행, 분리 검증, 최초 추출 기록 | 신규 |

모든 `frontend/` 코드는 브라우저에서 실행됩니다. `domain/`은 화면과 독립적인 업무 규칙, `services/`는 DB 통신을 담당합니다. 별도 서버나 DB 마이그레이션은 만들지 않았습니다.

React 상태와 이벤트 연결은 우선 `App.jsx`에 함께 남겨 두었습니다. 이를 페이지·컴포넌트·훅으로 더 잘게 나누는 것은 각 상태가 어떻게 연결되는지 이해하면서 진행할 수 있습니다. 현재 분리만으로 표준화·파서·예측·DB 코드는 각각 별도 파일에서 읽을 수 있습니다.

## 파일이 연결되는 방식

```text
index.html
  ├─ main.css: 모양 지정
  ├─ CDN: React / ReactDOM / Babel / Supabase / SheetJS 로드
  └─ App.jsx: React 상태와 화면 연결
       ├─ config: 기본 정보
       ├─ parsers → domain: 업로드 내용을 해석하고 검증
       ├─ domain: 재고·판매·예측 계산
       └─ services → Supabase: DB 조회·저장
```

`export`는 다른 파일에 함수를 제공하고, `import`는 제공된 함수를 가져옵니다. 파일을 옮겨도 함수 이름과 계산 내용은 그대로입니다.

현재는 기존 Babel standalone 방식을 유지합니다. Babel이 App.jsx를 변환한 뒤 HTML 안에 실행 코드로 삽입하기 때문에 **App.jsx의 import는 index.html 기준**입니다. 다른 `.js` 모듈의 import는 각 파일 기준입니다. 이 차이는 App.jsx 첫 줄에도 표시했습니다. 빌드 도구 도입은 후속 단계에서 판단합니다.

## 코드 읽기 순서

1. `index.html`: 브라우저가 무엇을 어떤 순서로 불러오는지 확인합니다.
2. `quantity.js`, `dates.js`: 작은 함수부터 매개변수·반환값을 익힙니다.
3. `products.js`, `inventory.js`: 상품명과 재고가 어떻게 해석되는지 읽습니다.
4. `kakao.js`, `excel.js`: 원문이 재고 데이터로 바뀌는 과정을 읽습니다.
5. `inventoryRepository.js`: 프로그램 데이터와 DB 데이터의 변환·저장 과정을 읽습니다.
6. `analytics.js`, `forecasting.js`: 집계와 기존 임시 예측식을 읽습니다.
7. `App.jsx`: 상태 → 계산 → 사용자 입력 → 저장 → 다시 조회 흐름으로 읽습니다.

## 검증과 한계

```sh
npm run check
```

원본과 분리본의 수량 처리, 재고 계산, 카카오톡 파싱, Excel 행 분석, 집계, 예측 결과를 비교합니다. 화면 코드·CSS 보존, JS 문법과 import 파일 존재 여부도 확인합니다. 이는 기존 동작 보존 검사이며 기존 업무 규칙 자체가 올바르다는 뜻은 아닙니다.

브라우저에서의 JSX 실행, 실제 DB 권한·읽기·쓰기, 모바일 화면은 별도 확인이 필요합니다. 기존 CDN 버전과 기존 데이터 처리의 알려진 개선 대상은 이번 분리에서 변경하지 않았습니다.

`scripts/split-source.mjs`는 최초 분리 과정을 기록한 도구입니다. 실행하면 분리된 소스를 원본 기준으로 덮어쓰므로 이후 수정 작업 중에는 재실행하지 마세요.
