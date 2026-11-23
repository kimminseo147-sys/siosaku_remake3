// [학습] 재고 한 줄 상태 판정 테스트(순수 함수라 서버 없이 바로 확인).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowStatus, showQty, summarizeRows } from '../frontend/domain/inventoryRows.js';

const base = { opening_qty: 20, closing_qty: 3, receipt_status: 'received', movement_status: 'none', review_status: 'verified', observed_sales_qty: 17 };

test('0과 NULL을 다르게 표시', () => { assert.equal(showQty(0), '0'); assert.equal(showQty(null), '–'); });
test('확정 + 판매량', () => assert.equal(rowStatus(base).label, '확정'));
test('마감 0은 품절 의심', () => assert.equal(rowStatus({ ...base, closing_qty: 0, observed_sales_qty: 20 }).label, '확정 · 품절 의심'));
test('입고 미확인 + 대기 = 확인 필요', () => assert.equal(rowStatus({ ...base, receipt_status: 'unknown', opening_qty: null, review_status: 'pending', observed_sales_qty: null }).label, '확인 필요'));
test('검토 대기는 판매량 미반영', () => assert.equal(rowStatus({ ...base, review_status: 'pending', observed_sales_qty: null }).label, '검토 대기'));
test('미입고는 판매 0과 다름', () => assert.equal(rowStatus({ ...base, receipt_status: 'not_received', opening_qty: null, closing_qty: null, observed_sales_qty: null }).label, '미입고'));
test('확정인데 이동 있음은 제외 사유 표시', () => assert.match(rowStatus({ ...base, movement_status: 'present', observed_sales_qty: null }).note, /이동/));
test('요약 합계', () => {
  const s = summarizeRows([base, { ...base, review_status: 'pending', observed_sales_qty: null }]);
  assert.deepEqual([s.total, s.verified, s.pending, s.sales], [2, 1, 1, 17]);
});
