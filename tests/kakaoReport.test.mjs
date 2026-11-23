// [학습] 카톡 보고 파서 테스트. 예시는 v1 scripts/verify-report-context.mjs의 실제 보고 형식을 그대로 썼습니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReport, parseQuantity, nameKey } from '../frontend/parsers/kakaoReport.js';

// [학습] DB bq_get_catalog 응답과 같은 모양의 작은 상품 목록
const products = [
  { product_id: 'p1', name: '오사카 시오빵', active: true, aliases: [] },
  { product_id: 'p2', name: '메론 시오빵', active: true, aliases: ['멜론 시오빵', '멜론시오빵'] },
  { product_id: 'p3', name: '갈릭 시오빵', active: true, aliases: [] },
  { product_id: 'p4', name: '명란 시오빵', active: true, aliases: [] },
  { product_id: 'p5', name: '불닭마요 시오빵', active: true, aliases: ['불닭 시오빵'] },
  { product_id: 'p6', name: '우유 크림 시오빵', active: true, aliases: ['우유 시오빵'] },
  { product_id: 'p7', name: '쇼쿠판', active: true, aliases: [] },
  { product_id: 'p8', name: '미니 쇼쿠판', active: true, aliases: [] },
];
const opt = (expectedType, extra = {}) => ({ expectedType, storeCode: 'HANAM', products, fallbackDate: '2026-10-26', ...extra });
const rows = [['갈릭 시오빵', 5, 5], ['멜론 시오빵', 8, 4], ['명란 시오빵', 7, 6], ['불닭 시오빵', 6, 5], ['오사카 시오빵', 20, 17], ['우유 시오빵', 5, 1]];

test('실제 보고 형식: 오픈·마감, 별칭 → 표준명', () => {
  for (const [label, type, idx] of [['오픈', 'opening', 1], ['마감', 'closing', 2]]) {
    const text = `하남 신세계\n10월 26일 ${label}\n` + rows.map(r => `${r[0]} / ${r[idx]}개`).join('\n');
    const r = parseReport(text, opt(type));
    assert.deepEqual(r.issues, []);
    assert.equal(r.date, '2026-10-26');
    assert.equal(r.lines.length, 6);
    assert.equal(r.lines.find(l => l.rawName === '멜론 시오빵').product.name, '메론 시오빵');
    assert.equal(r.lines.find(l => l.rawName === '불닭 시오빵').product.name, '불닭마요 시오빵');
    assert.equal(r.lines.find(l => l.rawName === '우유 시오빵').product.name, '우유 크림 시오빵');
  }
});

test('DB와 같은 비교 규칙: 공백·대소문자 무시', () => {
  assert.equal(nameKey(' 멜론  시오빵 '), nameKey('멜론시오빵'));
  assert.equal(parseReport('오픈\n멜론시오빵 / 3', opt('opening')).lines[0].product.name, '메론 시오빵');
});

test('쇼쿠판과 미니 쇼쿠판은 다른 상품', () => {
  const r = parseReport('오픈\n쇼쿠판 / 3\n미니 쇼쿠판 / 4', opt('opening'));
  assert.deepEqual(r.lines.map(l => l.product.name), ['쇼쿠판', '미니 쇼쿠판']);
});

test('오픈 0·미입고 = 미입고 / 진열+보관 합산', () => {
  assert.deepEqual(parseQuantity('0', 'opening'), { qty: null, notReceived: true, label: null });
  assert.equal(parseQuantity('미입고', 'opening').notReceived, true);
  assert.equal(parseQuantity('40+20개', 'opening').qty, 60);
  assert.equal(parseQuantity('진열 10 + 보관 5', 'opening').qty, 15);
});

test('마감 0·품절·완판·소진 = 0개 (품절), 라벨 보존', () => {
  assert.deepEqual(parseQuantity('0', 'closing'), { qty: 0, notReceived: false, label: null });
  for (const w of ['품절', '완판', '소진']) assert.deepEqual(parseQuantity(w, 'closing'), { qty: 0, notReceived: false, label: w });
  assert.ok(parseQuantity('품절', 'opening').error, '오픈의 품절은 형식 오류');
  assert.ok(parseQuantity('3.5', 'closing').error);
});

test('17시 보고는 저장 막음', () => {
  assert.ok(parseReport('10월 26일 17시 재고\n오사카 시오빵 / 3', opt('closing')).issues.some(i => i.includes('17시')));
  assert.ok(parseReport('오후 5시\n오사카 시오빵 / 3', opt('closing')).issues.length);
});

test('선택한 종류와 본문이 다르면 막음, 둘 다 있으면 막음', () => {
  assert.ok(parseReport('마감\n오사카 시오빵 / 3', opt('opening')).issues.length);
  assert.ok(parseReport('오픈 마감\n오사카 시오빵 / 3', opt('opening')).issues.length);
});

test('지점: 다른 지점이 적혀 있으면 막음, 같은 지점·없으면 통과', () => {
  assert.ok(parseReport('강동점\n오픈\n오사카 시오빵 / 3', opt('opening')).issues.some(i => i.includes('지점')));
  assert.deepEqual(parseReport('하남점\n오픈\n오사카 시오빵 / 3', opt('opening')).issues, []);
  assert.deepEqual(parseReport('오픈\n오사카 시오빵 / 3', opt('opening')).issues, []);
});

test('날짜: 없으면 선택 날짜 + 경고, 다르면 본문 날짜 + 경고, 잘못된 날짜는 막음', () => {
  const none = parseReport('오픈\n오사카 시오빵 / 3', opt('opening'));
  assert.equal(none.date, '2026-10-26'); assert.equal(none.usedFallback, true); assert.ok(none.warnings.length);
  const other = parseReport('10/25 오픈\n오사카 시오빵 / 3', opt('opening'));
  assert.equal(other.date, '2026-10-25'); assert.ok(other.warnings.some(w => w.includes('다릅니다')));
  assert.ok(parseReport('2월 30일 오픈\n오사카 시오빵 / 3', opt('opening')).issues.length);
  // 날짜만 있는 줄 "10/25", 상품 줄의 "미입고"는 머리줄로 오인하지 않음
  const dateOnly = parseReport('10/25\n오픈\n오사카 시오빵 / 3\n명란 시오빵 / 미입고', opt('opening'));
  assert.equal(dateOnly.date, '2026-10-25'); assert.equal(dateOnly.lines.length, 2); assert.equal(dateOnly.lines[1].notReceived, true);
});

test('사전에 없는 이름·중복 상품·수량 오류는 줄 단위로 표시', () => {
  const r = parseReport('오픈\n오사카시오 / 3\n오사카 시오빵 / 2\n오사카 시오빵 / 4\n명란 시오빵 / 많음', opt('opening'));
  assert.equal(r.lines[0].product, null);
  assert.equal(r.lines[2].duplicate, true);
  assert.ok(r.lines[3].error);
  assert.deepEqual(r.issues, []);
});
