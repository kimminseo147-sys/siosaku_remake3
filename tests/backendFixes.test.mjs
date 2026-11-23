// [학습] 2026-11-06 결정 반영 테스트 (03_백엔드_필수확인_수정제안.md의 A·B·C·D)
// [학습]   A-1: 마감 2단계 실패 시 먼저 저장된 항목을 알리고, 같은 보고 재전송 시 다시 쓰지 않음
// [학습]   B-1: 마감 함수가 없으면 대체 저장 없이 실패 (reports.test.mjs에도 있음)
// [학습]   C-1: 반려된 줄은 정정 금지
// [학습]   D  : 운영 SQL의 실제 오류 문구를 한국어 메시지로 바꿈
// [학습] 가짜 Supabase는 "운영 DB처럼 제안 함수가 설치된 상태"로 띄웁니다(options.rpc).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { startMock } from './mockSupabase.mjs';

const PORT = 4191, DATE = '2026-10-29';
const ID = { osaka: 'aaaaaaaa-1111-4111-8111-000000000001', shoku: 'aaaaaaaa-1111-4111-8111-000000000002', rejected: 'aaaaaaaa-1111-4111-8111-000000000003' };
const row = (id, name, extra) => ({ inventory_id: id, inventory_version: 1, product_id: name, name, opening_qty: null, closing_qty: null,
  receipt_status: 'received', movement_status: 'none', review_status: 'pending', observed_sales_qty: null, ...extra });

// [학습] 테스트마다 바꾸는 상태: 하루치 재고, 마감 함수 응답
const state = { items: [], closing: null };
const resetDay = () => {
  state.items = [
    row(ID.osaka, '오사카 시오빵', { opening_qty: 20 }),
    row(ID.shoku, '쇼쿠판', { receipt_status: 'not_received' }),
  ];
  state.closing = () => [200, { import_id: 'imp', rows: 1, applied: 1, verified: 1, pending: 0, details: [], missing_close: [] }];
};

let mock, child; const base = `http://127.0.0.1:${PORT}`;
before(async () => {
  resetDay();
  mock = await startMock({
    rpc: {
      bq_get_inventory_items: () => [200, { branch: '하남 신세계', store_code: 'HANAM', record_date: DATE, items: state.items }],
      bq_apply_closing_report: args => state.closing(args),
      // [학습] ID.rejected로 반려를 요청하면 운영 SQL과 같은 문구의 오류를 냅니다(D 확인용).
      bq_reject_inventory: args => (args.p_inventory_id === ID.rejected
        ? [400, { code: 'P0001', message: 'Rejection reason required' }]
        : [200, { inventory_id: args.p_inventory_id, inventory_version: 2, review_status: 'rejected', observed_sales_qty: null }]),
    },
  });
  child = spawn(process.execPath, ['backend/server.mjs'], { env: { ...process.env, SUPABASE_URL: mock.url, SUPABASE_PUBLISHABLE_KEY: 'pub', SUPABASE_SECRET_KEY: 'sb_secret_test', PORT: String(PORT), AUTH_MODE: 'dev', DEV_ACTOR_USER_ID: 'dddddddd-0000-4000-8000-000000000001' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', d => String(d).includes('실행') && resolve());
    child.on('exit', code => reject(new Error('server exited ' + code)));
  });
});
after(() => { child?.kill(); mock?.server.close(); });

const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const close = items => post('/api/stores/HANAM/reports/closing', { businessDate: DATE, rawText: '마감 원문', items });
const callsSince = (n, re) => mock.calls.slice(n).filter(c => re.test(c.url));

// ── D ───────────────────────────────────────────────────
test('D: 운영 SQL 문구 "Closing raw payload required" → 422 NO_TEXT', async () => {
  resetDay();
  state.closing = () => [400, { code: 'P0001', message: 'Closing raw payload required' }];
  const res = await close([{ productName: '오사카 시오빵', closingQty: 3 }]);
  assert.equal(res.status, 422);
  const { error } = await res.json();
  assert.equal(error.code, 'NO_TEXT');
  assert.match(error.message, /마감 보고 원문/);
});

test('D: 운영 SQL 문구 "Rejection reason required" → 422 REASON_REQUIRED', async () => {
  // [학습] 서버 사전 검사는 통과하는 사유를 보내고, 가짜 DB가 운영 문구로 사유 누락 오류를 내게 합니다.
  const res = await post(`/api/inventory/${ID.rejected}/reject`, { expectedVersion: 1, reason: '날짜 오입력' });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, 'REASON_REQUIRED');
});

// ── B-1 ─────────────────────────────────────────────────
test('B-1: 마감 함수 없음 → 500 CLOSING_RPC_MISSING, 상품별 정정으로 대신 저장하지 않음', async () => {
  resetDay();
  state.closing = () => [404, { code: 'PGRST202', message: 'Could not find the function' }];
  const n = mock.calls.length;
  const res = await close([{ productName: '오사카 시오빵', closingQty: 3 }]);
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error.code, 'CLOSING_RPC_MISSING');
  assert.equal(callsSince(n, /bq_correct_inventory|bq_register_inventory/).length, 0);
});

test('B-1: 함수가 있으면 mode=function으로 한 번에 처리', async () => {
  resetDay();
  const res = await close([{ productName: '오사카 시오빵', closingQty: 3 }]);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, 'function');
  assert.equal(body.applied, 1);
});

// ── A-1 ─────────────────────────────────────────────────
test('A-1: 1단계(확인 필요 저장) 후 2단계 실패 → 오류에 먼저 저장된 항목과 재전송 안내', async () => {
  resetDay();
  state.closing = () => [409, { code: '40001', message: 'VERSION_CONFLICT expected 1, actual 2' }];
  const n = mock.calls.length;
  // [학습] 쇼쿠판: 오픈 보고에서 미입고였는데 마감에 나옴 → 1단계에서 "확인 필요"로 정정
  const res = await close([{ productName: '쇼쿠판', closingQty: 2 }, { productName: '오사카 시오빵', closingQty: 3 }]);
  assert.equal(res.status, 409);
  const { error } = await res.json();
  assert.equal(error.code, 'VERSION_CONFLICT');
  assert.match(error.message, /먼저 저장된 항목: 쇼쿠판/);
  assert.match(error.message, /다시 보내/);
  assert.equal(callsSince(n, /bq_correct_inventory/).length, 1);
});

test('A-1: 1단계 저장이 없으면 원래 오류 메시지 그대로', async () => {
  resetDay();
  state.closing = () => [409, { code: '40001', message: 'VERSION_CONFLICT expected 1, actual 2' }];
  const res = await close([{ productName: '오사카 시오빵', closingQty: 3 }]);
  assert.equal(res.status, 409);
  assert.doesNotMatch((await res.json()).error.message, /먼저 저장된 항목/);
});

test('A-1: 재전송 — 이미 "확인 필요"로 저장된 줄은 다시 쓰지 않고, 나머지만 마감 함수로 보냄', async () => {
  resetDay();
  // [학습] 첫 전송에서 1단계만 저장된 상태를 흉내: 쇼쿠판이 unknown + 마감 2
  state.items[1] = row(ID.shoku, '쇼쿠판', { receipt_status: 'unknown', closing_qty: 2, inventory_version: 2 });
  const n = mock.calls.length;
  const res = await close([{ productName: '쇼쿠판', closingQty: 2 }, { productName: '오사카 시오빵', closingQty: 3 }]);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.needsReview, ['쇼쿠판']);
  assert.equal(callsSince(n, /bq_correct_inventory|bq_register_inventory/).length, 0);
  const sent = callsSince(n, /bq_apply_closing_report/)[0].body.p_items.map(i => i.raw_product_name);
  assert.deepEqual(sent, ['오사카 시오빵']);
});

test('A-1: 재전송 — 이미 보충된 오픈 수량은 다시 보충하지 않음', async () => {
  resetDay();
  // [학습] 첫 전송에서 쇼쿠판 오픈 5가 보충된 상태
  state.items[1] = row(ID.shoku, '쇼쿠판', { opening_qty: 5, inventory_version: 2 });
  const n = mock.calls.length;
  const res = await close([{ productName: '쇼쿠판', closingQty: 2, openingQty: 5 }]);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).supplemented, []);
  assert.equal(callsSince(n, /bq_correct_inventory|bq_register_inventory/).length, 0);
});

// ── C-1 ─────────────────────────────────────────────────
const correct = (id, extra = {}) => post(`/api/inventory/${id}/correct`, { expectedVersion: 1, changes: { closing_qty: 4 }, reason: '오기 정정', storeCode: 'HANAM', businessDate: DATE, ...extra });

test('C-1: 반려된 줄은 정정 금지 (409 REJECTED_LOCKED, DB 정정 호출 없음)', async () => {
  resetDay();
  state.items.push(row(ID.rejected, '메론빵', { opening_qty: 10, review_status: 'rejected' }));
  const n = mock.calls.length;
  const res = await correct(ID.rejected);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.code, 'REJECTED_LOCKED');
  assert.equal(callsSince(n, /bq_correct_inventory/).length, 0);
});

test('C-1: 반려되지 않은 줄은 정상 정정', async () => {
  resetDay();
  const res = await correct(ID.osaka);
  assert.equal(res.status, 200);
});

test('C-1: 지점·날짜 없음 → 422 / 그날 없는 줄 → 404, DB 정정 호출 없음', async () => {
  resetDay();
  const n = mock.calls.length;
  assert.equal((await correct(ID.osaka, { storeCode: undefined })).status, 404);  // 알 수 없는 지점
  assert.equal((await correct(ID.osaka, { businessDate: undefined })).status, 422);
  assert.equal((await correct('aaaaaaaa-1111-4111-8111-00000000beef')).status, 404);
  assert.equal(callsSince(n, /bq_correct_inventory/).length, 0);
});

test('C-1: 오픈 보고에 반려된 상품이 있으면 비교(정정 제안)에서 빼고 skippedRejected로 알림', async () => {
  resetDay();
  state.items[1] = row(ID.shoku, '쇼쿠판', { opening_qty: 10, review_status: 'rejected' });
  const res = await post('/api/stores/HANAM/reports/opening', { businessDate: DATE, rawText: '오픈 원문',
    items: [{ rawLine: '오사카 / 25', productName: '오사카 시오빵', openingQty: 25 }, { rawLine: '쇼쿠판 / 3', productName: '쇼쿠판', openingQty: 3 }] });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.skippedRejected, ['쇼쿠판']);
  assert.deepEqual(body.comparisons.map(c => c.name), ['오사카 시오빵']);
});
