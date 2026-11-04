// [학습] 카톡 보고 저장 API 테스트 (가짜 Supabase). 실제 DB 동작은 README "검증"의 PostgreSQL+PostgREST 시나리오로 확인했습니다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { startMock } from './mockSupabase.mjs';

let mock, child; const base = 'http://127.0.0.1:4193';
before(async () => {
  mock = await startMock();
  child = spawn(process.execPath, ['backend/server.mjs'], { env: { ...process.env, SUPABASE_URL: mock.url, SUPABASE_PUBLISHABLE_KEY: 'pub', SUPABASE_SECRET_KEY: 'sb_secret_test', PORT: '4193', AUTH_MODE: 'dev', DEV_ACTOR_USER_ID: 'dddddddd-0000-4000-8000-000000000001' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise(r => child.stdout.on('data', d => String(d).includes('실행') && r()));
});
after(() => { child?.kill(); mock?.server.close(); });

const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const open = items => post('/api/stores/HANAM/reports/opening', { businessDate: '2026-10-29', rawText: '오픈 원문', items });
const lastRegister = () => mock.calls.filter(c => c.url.endsWith('bq_register_inventory')).at(-1)?.body;

test('오픈: 서버가 다시 검사 (0개 입고, 사전에 없는 상품, 중복, 원문 없음)', async () => {
  assert.equal((await open([{ rawLine: 'a', productName: '쇼쿠판', notReceived: false, openingQty: 0 }])).status, 422);
  assert.equal((await open([{ rawLine: 'a', productName: '없는빵', notReceived: false, openingQty: 3 }])).status, 422);
  assert.equal((await open([{ productName: '쇼쿠판', notReceived: true }, { productName: '쇼쿠판', notReceived: true }])).status, 422);
  assert.equal((await post('/api/stores/HANAM/reports/opening', { businessDate: '2026-10-29', rawText: ' ', items: [] })).status, 422);
});

test('오픈: 이미 있는 줄은 등록하지 않고 비교로 돌려줌, 이동은 항상 none', async () => {
  const res = await open([{ rawLine: '오사카 / 25', productName: '오사카 시오빵', notReceived: false, openingQty: 25 }]);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.comparisons[0].name, '오사카 시오빵');
  assert.deepEqual(body.comparisons[0].changes, { receipt_status: 'received', opening_qty: 25 });
  const reg = lastRegister();
  assert.equal(reg.p_finalize, true);
  assert.ok(reg.p_items.every(i => i.movement_status === 'none'));
  assert.ok(!reg.p_items.some(i => i.raw_product_name === '오사카 시오빵'));
});

test('마감: 수량 검사 (음수·소수), 마감 함수 없으면 대체 방식', async () => {
  const close = items => post('/api/stores/HANAM/reports/closing', { businessDate: '2026-10-29', rawText: '마감 원문', items });
  assert.equal((await close([{ productName: '오사카 시오빵', closingQty: -1 }])).status, 422);
  assert.equal((await close([{ productName: '오사카 시오빵', closingQty: 1.5 }])).status, 422);
  const res = await close([{ rawLine: '오사카 / 2', productName: '오사카 시오빵', closingQty: 2 }]);
  const body = await res.json();
  assert.equal(body.mode, 'fallback');
  assert.equal(body.details[0].status, 'already_closed');  // 가짜 DB의 오사카 줄은 이미 마감 0
});

test('반려: 사유 없으면 422, 함수 없으면 501', async () => {
  const id = 'aaaaaaaa-1111-4111-8111-000000000001';
  assert.equal((await post(`/api/inventory/${id}/reject`, { expectedVersion: 1, reason: ' ' })).status, 422);
  assert.equal((await post(`/api/inventory/${id}/reject`, { expectedVersion: 1, reason: '날짜 오입력' })).status, 501);
});
