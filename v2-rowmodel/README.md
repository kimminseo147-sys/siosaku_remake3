# 시오사쿠 재고관리 v2 (한 줄씩 저장 모델)

v1(`../frontend`, `../index.html`)은 그대로 두고, 이 폴더에 새 DB(Bridge-Q v3.3)에 맞춘 복사본을 만들었습니다.

## 무엇이 바뀌었나

| | v1 | v2 (이 폴더) |
|---|---|---|
| 실행 구조 | 브라우저 → Supabase 테이블 직접 | 브라우저 → **Node 서버(/api)** → DB 함수(`bq_*`) |
| 저장 모델 | `inventory_records.items` JSON 한 덩어리 | `daily_inventory` 상품마다 한 줄 |
| 로그인 | 없음 | 지금은 점검 모드(로그인 없음, 고정 사용자). `AUTH_MODE=jwt`로 Supabase Auth 로그인 사용 |
| 지점 | 한글 이름 4개 | 코드 `GANGDONG`, `HANAM` (DB에 있는 2곳) |
| 판매량 | 브라우저가 계산 | DB가 확정(verified) 줄에만 계산한 값 표시 |
| 0 / 미확인 | 같이 취급 | 0은 `0`, 미확인(NULL)은 `–` |

진행 상황 (2026-11-04 3차)

| 순서 | 내용 | 상태 |
|---|---|---|
| 1 | 백엔드 골격 (로그인은 점검 모드로 꺼 둠, 마지막에 켬) | 완료 |
| 2 | 지점 코드화 (강동·하남만) | 완료 |
| 3 | 재고 조회, 0/NULL 구분 | 완료 |
| 4 | 카톡 오픈/마감 보고 입력 (Y안), 확정·정정, 반려 버튼, 17시 보고 차단 | 완료 (마감 반영·반려 DB 함수는 팀원 3 설치 대기) |
| 5 | 상품 사전 DB 하나로 통일, 사전에 없는 상품은 매번 선택 | 완료 |
| 6 | 예측 실행·결과 표시 | 완료 (결과 표는 제안 함수 설치 후) |
| 7 | 판매 분석 (기간 조회, 휴무일 표시) | 완료 (제안 함수 설치 후 동작) |
| - | 엑셀 일괄 등록 | 완료 (v1 규칙 유지 + DB 사전, 날짜별 저장) |
| - | 신상품 등록 | 보류 (신상품 수요예측 로직 미정) |
| 마지막 | 로그인(JWT) | 대기 |

## 카톡 보고 입력 방법 (팀 결정 2026-11-04)

마감 직원이 퇴근할 때 "재고 기록" 탭에서:

1. **오픈 보고** 버튼 → 오픈 카톡을 붙여넣기 → "보고 내용 확인" → 미리보기 확인 → 저장
2. 약 1분 뒤 **마감 보고** 버튼 → 마감 카톡을 붙여넣기 → 확인 → 저장

| 상황 | 처리 |
|---|---|
| 오픈 "0"·"미입고" | 그날 미입고 (수량 없음) |
| 오픈 보고에 없는 판매 중 상품(26종) | 그날 미입고로 자동 저장 |
| 마감 "0"·"품절·완판·소진" | 그날 품절 → 마감 0개 + 원문 라벨 |
| 오픈엔 있는데 마감에서 빠진 상품 | 직원 기재 누락 → 미리보기 경고, 저장하면 "마감 누락"(판매량 제외) |
| 마감에만 있는 상품 (오픈 보고에 없음) | **확인 필요**로 자동 저장: 입고 여부 미확인 + 마감 수량, 판매량·예측 제외. 오픈 수량을 알면 입력(선택) |
| 사전에 없는 상품명 | 기존 상품을 고르거나 그 줄을 빼야 저장 (매번 선택, 별칭으로 저장하지 않음) |
| 같은 날 다시 붙여넣기 | 이미 있는 줄은 덮어쓰지 않고 "기존 ↔ 새 값" 표시 + "새 값으로 정정" 버튼 |
| 17시 재고 보고 | 다루지 않음 (저장 막음) |
| 본문 지점이 선택 지점과 다름 | 저장 막음 (v1은 경고만 했음) |
| 조건 맞는 줄 | 자동 확정 → 바로 판매량·예측에 반영 |
| 잘못 넣은 줄(날짜·지점·상품) | 표의 "반려" 버튼 (반려 DB 함수 설치 후) |
| 오픈·마감 보고가 둘 다 없는 날 | 휴무일 (DB에 줄 없음, 판매 분석에 휴무 일수 표시) |

## 엑셀 일괄 등록

"재고 기록" 탭 → "📗 엑셀 일괄 등록 열기" → 기간 선택 → 파일 선택 → 검증 결과 확인 → 등록.

- 시트 "재고 데이터"의 `날짜 · 상품명 · 오픈재고 · 잔여재고` 열 (전처리 엑셀 형식)
- 오픈 0 = 미입고, 잔여 0·품절 = 품절(0개), 오픈 공란 = 입고 여부 미확인(판매량 제외), 잔여 공란 = 마감 누락
- 오픈 0인데 잔여 수량 있음 → 그 행만 **확인 필요**(입고 여부 미확인, 판매량·예측 제외)로 저장하고 그날 나머지는 정상 등록 (팀 결정)
- **한 행이라도 문제가 있는 날짜는 통째로 뺌** (v1과 같음): 수량 형식 오류, 같은 날 같은 상품 두 번, 사전에 없는 이름(고르기 전)
- 사전에 없는 이름은 이름마다 한 번 고르면 그 이름의 모든 행에 적용
- 이미 기록이 있는 날짜는 건너뜀. 같은 내용을 두 번 올려도 다시 저장되지 않음(내용 해시)
- 카톡 입력과 달리 "보고에 없는 상품 = 미입고" 자동 줄은 만들지 않음 (엑셀에 미입고가 0으로 직접 적혀 있음)
- 31일씩 나눠 서버로 보내고, 날짜마다 따로 저장(그 날짜는 전부 저장되거나 전부 취소)

**한계 (프로젝트 범위)**: 지점 간 이동 수량은 측정할 수 없어 모든 줄을 "이동 없음"으로 저장합니다. 17시 재고는 사용하지 않습니다.

## 파일 구조

```text
database/proposals/      팀원 3 검토용 SQL 초안 (실행 금지 표시)
  001_read_rpcs_...sql     내 지점 목록, 기간 재고, 예측 결과 조회
  002_write_rpcs_...sql    마감 반영, 반려
backend/                 서버(Node.js). 브라우저로 제공되지 않음
  server.mjs             진입점: /api 처리 + 정적 파일 제공
  routes.mjs             주소 → DB 함수 연결표 (기존/제안 표시)
  reports.mjs            카톡 오픈/마감 보고 저장 (서버에서 다시 검사, 자동 미입고, 비교, 마감 함수 없을 때 대체)
  validation.mjs         날짜·버전·정정 항목 입력 검증
  supabaseRest.mjs       토큰 검증, DB 함수 호출(/rest/v1/rpc), 오류 → 한국어 메시지
  config.mjs             .env 읽기, 지점 목록, 점검 모드
  errors.mjs             HTTP 오류 클래스
frontend/
  parsers/kakaoReport.js 카톡 보고 해석 (DB 상품 사전 사용, 수량 규칙, 17시·지점·날짜 검사)
  config/supabase.js     서버 설정 받기, 로그인 전용 클라이언트
  services/              서버 /api 호출 (authService, apiClient, inventoryRepository)
  domain/inventoryRows.js  재고 한 줄의 상태 배지·요약·정정 폼·확정 가능 여부
  domain/salesStats.js     판매 분석 집계 (확정 판매량만)
  domain/dates.js          날짜 검사
  App.jsx                화면 전부 (Babel standalone이 이 파일의 JSX만 변환하므로 화면 조각은 이 파일에)
tests/                   npm test (가짜 Supabase)
```

v1에서 복사만 해 두었던 파일(코드 상품사전 `catalog.js`, `products.js`, `kakao.js`, `excel.js`, `analytics.js`, `forecasting.js` 등)과 `scripts/`는 v2에서 지웠습니다. v1 원본 폴더(`../frontend`)는 그대로입니다.

## 실행 방법

1. `.env.example`을 복사해 `.env`를 만들고 값을 채웁니다. (Supabase 대시보드 > Project Settings > API)
   - `SUPABASE_SECRET_KEY`는 서버 전용입니다. 카카오톡·GitHub에 올리지 마세요. `.gitignore`에 `.env`가 들어 있습니다.
2. 이 폴더에서 `npm start` → http://127.0.0.1:4173
3. 테스트: `npm test` (가짜 DB, 실제 DB에 접속하지 않음)

npm 패키지 설치는 필요 없습니다(Node 18 이상).

## 점검 모드 (지금 설정: 로그인 없음)

지금은 점검하기 편하도록 로그인 화면 없이 동작합니다(`.env`의 `AUTH_MODE=dev`).

- 로그인은 없지만 DB 함수는 모든 수정에 "누가 했는지"를 이력으로 남기기 때문에, **Supabase에 실제 사용자 1명이 있어야 합니다.** 서버는 모든 요청을 이 사용자로 처리합니다.
- 안전장치: 점검 모드는 이 컴퓨터(`127.0.0.1`)에서만 켜집니다. 외부 주소로 실행하려 하면 서버가 시작을 거부합니다.
- `AUTH_MODE`를 비우거나 `jwt`로 바꾸면 로그인 화면이 다시 나옵니다(코드는 그대로 남아 있음).

### 준비 (관리자가 1번만)

1. Supabase 대시보드 > Authentication > Users > Add user 로 점검용 사용자 생성 (예: `dev@siosaku.test`)
2. 생성된 사용자의 UUID를 복사해 `.env`의 `DEV_ACTOR_USER_ID=`에 붙여 넣기
3. SQL Editor에서 그 사용자에게 지점 권한 부여 (확정·정정·예측 실행까지 하려면 `editor`)

```sql
-- 관리자만 SQL Editor에서 실행. 이메일·지점·역할(viewer/editor/admin)을 바꿔서 사용
INSERT INTO public.user_store_access (user_id, store_id, access_role)
SELECT u.id, s.store_id, 'editor'
FROM auth.users u, public.stores s
WHERE u.email = 'dev@siosaku.test' AND s.store_code IN ('HANAM', 'GANGDONG');
```

> 칼럼명은 인수인계 스키마 v3.0 기준입니다. 실행 전에 팀원 3에게 확인하세요.

### 나중에 로그인 켤 때

1. `.env`에서 `AUTH_MODE=jwt`로 변경 (`DEV_ACTOR_USER_ID`는 지워도 됨)
2. 팀원별 계정 생성 + 위 SQL로 각자 지점 권한 부여

## API 목록

| 주소 | DB 함수 | 구분 |
|---|---|---|
| GET /api/me | bq_list_my_stores (없으면 강동·하남 목록) | 제안 |
| GET /api/stores/:code/catalog | bq_get_catalog | 기존 |
| GET /api/stores/:code/inventory?date= | bq_get_inventory_items | 기존 |
| GET /api/stores/:code/inventory-range?from=&to= | bq_get_inventory_range | 제안 |
| POST /api/inventory/:id/verify `{expectedVersion}` | bq_verify_inventory | 기존 |
| POST /api/inventory/:id/correct `{expectedVersion, changes, reason, reverify}` | bq_correct_inventory | 기존 |
| POST /api/inventory/:id/reject `{expectedVersion, reason}` | bq_reject_inventory | 제안 |
| POST /api/stores/:code/reports/opening `{businessDate, rawText, items}` | bq_register_inventory (+ 자동 미입고 줄) | 기존 |
| POST /api/stores/:code/reports/closing `{businessDate, rawText, items}` | bq_apply_closing_report, 없으면 bq_correct_inventory로 대체 | 제안/기존 |
| POST /api/stores/:code/forecasts `{forecastDate}` | bq_make_ewma_forecast (operational, 최소 6건 고정) | 기존 |
| GET /api/stores/:code/forecasts?date= | bq_get_forecast_results | 제안 |
| GET /api/forecasts/:runId/replay | bq_replay_forecast | 기존 |

제안 함수가 아직 DB에 없으면 서버는 501 `RPC_MISSING`을 돌려주고, 화면은 "함수가 아직 설치되지 않았습니다" 안내를 보여줍니다.

## 검증한 것 / 못 한 것

- `npm test` 63개 통과 (가짜 Supabase: 서버 입력 검사, 권한·오류 변환, 점검 모드, 파서, 집계)
- **실제 DB 연결 시험**: 빈 PostgreSQL 16에 인수인계 SQL(01·02·16) + 초안(001·002)을 설치하고, Supabase와 같은 API 서버(PostgREST 12)를 붙여 v2 서버를 그대로 실행
  - 마감 반영 함수가 **있는** DB와 **없는** DB(지금 실제 상태) 양쪽에서 같은 결과
  - 오픈 저장(입고 3 + 미입고 1 + 자동 미입고 22) → 마감 저장(품절 0, 오픈 수량 보충) → 판매량 계산·자동 확정 → 마감 누락 표시 → 재입력 비교·정정 → 반려(함수 없으면 안내) → 예측 실행·결과·기간 조회
  - 상품 85 / 별칭 164 / 예측 대상 10 / α 20행이 인수인계 문서와 일치, 코드 별칭 168개가 DB 매칭과 전부 같음, EWMA 값(17.61)이 독립 계산과 일치
- **실제 엑셀 2개로 시험**: 하남 180일, 강동 142일 전부 등록(강동 "오픈 0인데 잔여 있음" 6행은 확인 필요로 저장). 등록 후 하남 판매량 2,302건 · 예측 대상 관측치 1,532건 · 마감 0 365건, 10/30·10/31 예측값 20개가 **인수인계 문서와 전부 일치**
- 실제 브라우저(휴대폰 폭): 엑셀 하남 180일 등록, 사전에 없는 상품 → 저장 막힘 → 상품 선택 → 저장, 마감에만 있는 상품 → 오픈 수량 입력 → 저장, 17시 보고 차단
- 못 함: **실제 Supabase 프로젝트 연결** (`.env` 비밀키 필요). 그리고 01·16 외의 SQL이 실제 DB에 실행됐는지 모름

## 팀원 3에게 요청

요청서(Claude Docs): "시오사쿠 v2 DB 작업 요청서 (팀원 3)". 요약:

1. 03~15번, 17번 SQL 파일이 있는지, 실제 DB에 실행했는지 확인
2. `002` 마감 반영 함수 설치 (없으면 서버가 정정으로 대신: 일부만 저장될 수 있고 정정 이력이 쌓임)
3. `002` 반려 함수 설치 (없으면 반려 버튼이 "함수 없음" 안내)
4. `001` 읽기 함수 3개 설치 (판매 분석, 예측 결과 표)
5. 공휴일 달력 보완
6. 점검용 사용자 + 지점 권한
7. 지점별 판매 상품표: `database/지점별_상품표.xlsx` (기준: 최근 7 영업일 중 3일 이상 입고 + 하남 일회성 4종 포함 → 강동 18종, 하남 14종)
