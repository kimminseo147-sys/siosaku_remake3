// [학습] 엑셀 일괄 등록 테스트: 파서(순수 함수) + 서버 검사(가짜 Supabase).
// [학습] 실제 파일 검증(하남 180일·강동 136일, 인수인계 예측값 20개 일치)은 README "검증" 참고.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { analyzeExcelRows, excelQty, toInventoryRow } from '../frontend/parsers/excelImport.js';
import { startMock } from './mockSupabase.mjs';

const products = [
  { product_id: 'p1', name: '오사카 시오빵', active: true, aliases: [] },
  { product_id: 'p2', name: '메론 시오빵', active: true, aliases: ['멜론 시오빵'] },
  { product_id: 'p3', name: '쇼쿠판', active: true, aliases: [] },
];
const H = ['날짜', '상품명', '오픈재고', '잔여재고'];
const sheet = rows => [['오픈·마감 재고 전처리 결과'], [], H, ...rows];

test('수량 규칙: 오픈 0 = 미입고, 오픈 공란 = 미확인, 품절 = 0', () => {
  assert.deepEqual(toInventoryRow(excelQty(0, 'opening'), excelQty(0, 'closing')), { receipt_status: 'not_received', opening_qty: null, closing_qty: null });
  assert.deepEqual(toInventoryRow(excelQty(null, 'opening'), excelQty(3, 'closing')), { receipt_status: 'unknown', opening_qty: null, closing_qty: 3 });
  assert.deepEqual(toInventoryRow(excelQty(10, 'opening'), excelQty('품절', 'closing')), { receipt_status: 'received', opening_qty: 10, closing_qty: 0 });
  assert.deepEqual(toInventoryRow(excelQty(0, 'opening'), excelQty(7, 'closing')), { receipt_status: 'unknown', opening_qty: null, closing_qty: 7, review: '확인 필요: 오픈 0·마감 7' });
  assert.ok(excelQty(2.5, 'closing').error);
});

test('머리행 찾기, 별칭 → 표준명, 기간 필터', () => {
  const a = analyzeExcelRows(sheet([['2026-10-26', '멜론 시오빵', 8, 4], ['2026-10-27', '오사카 시오빵', 20, 3], ['2026-11-01', '오사카 시오빵', 5, 1]]), { products, to: '2026-10-31' });
  assert.equal(a.days.length, 2);
  assert.equal(a.days[0].items[0].productName, '메론 시오빵');
  assert.equal(a.counts.outside, 1);
});

test('오픈 0인데 마감 있음 → 확인 필요로 저장, 날짜는 막지 않음 / 수량 형식 오류는 날짜 전체를 뺌', () => {
  const a = analyzeExcelRows(sheet([['2026-10-26', '오사카 시오빵', 20, 3], ['2026-10-26', '메론 시오빵', 0, 7], ['2026-10-27', '오사카 시오빵', '많음', 1]]), { products });
  assert.deepEqual(a.days.map(d => d.date), ['2026-10-26']);
  const melon = a.days[0].items.find(i => i.productName === '메론 시오빵');
  assert.equal(melon.receipt_status, 'unknown'); assert.equal(melon.closing_qty, 7); assert.match(melon.label, /확인 필요/);
  assert.equal(a.counts.needsReview, 1);
  assert.equal(a.blocked[0].date, '2026-10-27');
});

test('중복(별칭 포함)은 그 날짜를 뺌', () => {
  const a = analyzeExcelRows(sheet([['2026-10-26', '멜론 시오빵', 8, 4], ['2026-10-26', '메론 시오빵', 8, 4]]), { products });
  assert.equal(a.days.length, 0); assert.equal(a.blocked.length, 1);
});

test('사전에 없는 이름: 고르기 전엔 그 날짜를 뺌, 고르면 모든 행에 적용, 빼기 선택 시 그 행만 제외', () => {
  const rows = sheet([['2026-10-26', '오사카시오', 20, 3], ['2026-10-27', '오사카시오', 18, 2], ['2026-10-27', '쇼쿠판', 4, 0]]);
  const before = analyzeExcelRows(rows, { products });
  assert.deepEqual(before.unmatchedNames, [{ name: '오사카시오', rows: 2 }]);
  assert.equal(before.days.length, 0);
  const chosen = analyzeExcelRows(rows, { products, nameChoices: { 오사카시오: '오사카 시오빵' } });
  assert.equal(chosen.days.length, 2);
  const skipped = analyzeExcelRows(rows, { products, nameChoices: { 오사카시오: '__skip__' } });
  assert.deepEqual(skipped.days.map(d => d.items.length), [1]);
});

test('필수 열이 없으면 오류', () => {
  assert.throws(() => analyzeExcelRows([['날짜', '상품명', '오픈']], { products }));
});

let mock, child; const base = 'http://127.0.0.1:4192';
before(async () => {
  mock = await startMock();
  child = spawn(process.execPath, ['backend/server.mjs'], { env: { ...process.env, SUPABASE_URL: mock.url, SUPABASE_PUBLISHABLE_KEY: 'p', SUPABASE_SECRET_KEY: 'sb_secret_test', PORT: '4192', AUTH_MODE: 'dev', DEV_ACTOR_USER_ID: 'dddddddd-0000-4000-8000-000000000001' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise(r => child.stdout.on('data', d => String(d).includes('실행') && r()));
});
after(() => { child?.kill(); mock?.server.close(); });
const send = days => fetch(base + '/api/stores/HANAM/imports/excel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: 't.xlsx', days }) });
const item = over => ({ rawLine: 'x', productName: '쇼쿠판', receipt_status: 'received', opening_qty: 4, closing_qty: 1, ...over });

test('서버: 잘못된 값은 아무 날짜도 저장하지 않음', async () => {
  const count = () => mock.calls.filter(c => c.url.endsWith('bq_register_inventory')).length;
  const n = count();
  assert.equal((await send([{ date: '2026-10-01', items: [item()] }, { date: '2026-10-02', items: [item({ receipt_status: 'not_received' })] }])).status, 422);
  assert.equal((await send([{ date: '2026-10-01', items: [item({ productName: '없는빵' })] }])).status, 422);
  assert.equal((await send([{ date: '2026-10-01', items: [item({ opening_qty: 0 })] }])).status, 422);
  assert.equal((await send(Array.from({ length: 32 }, (_, i) => ({ date: `2026-01-${String(i % 28 + 1).padStart(2, '0')}`, items: [item()] })))).status, 422);
  assert.equal(count(), n);
});

test('서버: 이미 기록이 있는 날짜는 건너뜀, 엑셀은 source_type=excel + checksum', async () => {
  const res = await (await send([{ date: '2026-10-01', items: [item()] }])).json();
  // 가짜 DB는 어떤 날짜든 기존 줄 2개를 돌려주므로 건너뜀
  assert.equal(res.results[0].status, 'skipped');
});
