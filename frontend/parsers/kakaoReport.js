// [학습] 카카오톡 오픈/마감 보고 해석기 (v2). 순수 함수: 화면·서버·DB를 모릅니다. 입력 → 결과만.
// [학습] v1(kakao.js)과 다른 점
// [학습]   ① 상품 사전: 코드 사전(catalog.js) 대신 DB 사전(bq_get_catalog의 name + aliases)을 받아서 씁니다.
// [학습]   ② 수량 규칙(팀 결정 2026-11-04): 오픈 "0"·"미입고" = 그날 미입고 / 마감 "0"·"품절·완판·소진" = 그날 품절(0개)
// [학습]   ③ 17시 재고 보고는 다루지 않습니다(오픈−마감 쌍만 사용). 감지되면 저장을 막습니다.
import { isValidDay } from '../domain/dates.js';

// [학습] DB의 bq_name_key와 같은 규칙: 소문자 + 모든 공백 제거. 화면 미리보기와 DB 저장 결과가 같아지게 합니다.
const nameKey = value => String(value ?? '').toLowerCase().replace(/\s+/g, '');

// [학습] 상품 목록 → "비교키 → 상품" 지도. 표준명과 별칭을 모두 넣습니다.
function buildProductIndex(products) {
  const index = new Map();
  for (const p of products || []) {
    for (const name of [p.name, ...(p.aliases || [])]) {
      const key = nameKey(name);
      if (key && !index.has(key)) index.set(key, p);
    }
  }
  return index;
}

// [학습] 본문에 적힌 지점명. 한 줄에 지점명만 있을 때만 인정합니다(자유 문장 속 지점명은 추측하지 않음).
const STORE_WORDS = {
  GANGDONG: ['강동 본점', '강동점', '강동', '강동 본점점'],
  HANAM: ['하남 신세계', '하남 신세계점', '하남점', '하남'],
};

// [학습] 날짜 해석: "2026년 10월 26일", "10월 26일", "10/26", "10.26". 연도가 없으면 선택 날짜의 연도를 씁니다.
function parseReportDate(text, fallback) {
  const ymd = String(text).match(/(?:20\d{2})[년.\/-]\s*\d{1,2}[월.\/-]\s*\d{1,2}/);
  let y, m, d;
  if (ymd) [y, m, d] = ymd[0].match(/\d+/g).map(Number);
  else {
    const kor = String(text).match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    const short = String(text).match(/(?:^|\s)(\d{1,2})\s*[.\/\-]\s*(\d{1,2})(?:\.|\s|$)/);
    if (kor) { m = Number(kor[1]); d = Number(kor[2]); }
    else if (short) { m = Number(short[1]); d = Number(short[2]); }
    else return { date: fallback, usedFallback: true };
    y = Number(String(fallback).slice(0, 4));
  }
  const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { date: isValidDay(date) ? date : null, usedFallback: false };
}

// [학습] 수량 칸 해석. 반환: { qty, notReceived, label } 또는 { error }
// [학습] "40+20개"처럼 진열+보관을 나눠 적은 경우는 합칩니다(v1과 같음).
function parseQuantity(raw, type) {
  const text = String(raw ?? '').trim();
  const compact = text.replace(/\s|진열|보관/g, '');
  if (type === 'opening' && /^(미입고|입고없음)$/.test(compact)) return { qty: null, notReceived: true, label: text };
  if (type === 'closing' && /^(품절|소진|완판)$/.test(compact)) return { qty: 0, notReceived: false, label: text };
  if (!/^\d+(?:개)?(?:\+\d+(?:개)?)*$/.test(compact)) return { error: `수량 형식 오류 (${text})` };
  const qty = compact.replace(/개/g, '').split('+').map(Number).reduce((s, v) => s + v, 0);
  if (!Number.isSafeInteger(qty) || qty > 100000) return { error: `수량이 너무 큽니다 (${text})` };
  // [학습] 오픈 0 = 그날 미입고(팀 결정). 마감 0 = 품절이므로 그대로 0.
  if (type === 'opening' && qty === 0) return { qty: null, notReceived: true, label: null };
  return { qty, notReceived: false, label: null };
}

// [학습] 보고 한 건 해석.
// [학습] 입력: text(카톡 본문), expectedType('opening'|'closing': 사용자가 누른 버튼), storeCode, products(DB 상품 목록), fallbackDate
// [학습] 반환: { type, date, usedFallback, lines[], issues[](저장 막음), warnings[](확인만) }
function parseReport(text, { expectedType, storeCode, products, fallbackDate }) {
  const all = String(text ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const issues = [], warnings = [];
  // [학습] 머리줄(날짜·보고 종류): 슬래시가 없거나, "10/26 오픈"처럼 숫자 날짜로 시작하는 줄.
  // [학습] "오사카 시오빵 / 미입고"처럼 상품명으로 시작하는 줄은 "입고"가 들어 있어도 상품 줄입니다(v1에서 날짜 줄을 놓치던 문제 수정).
  const startsWithDate = line => /^\d{1,4}\s*[\/.\-년월]\s*\d/.test(line);
  const isHeader = line => (!line.includes('/') || startsWithDate(line)) && /(오픈|마감|입고|17\s*시|17:00|오후\s*5\s*시)/.test(line);
  const isDateOnly = line => /^(20\d{2}\s*[\/.\-]\s*)?\d{1,2}\s*[\/.\-]\s*\d{1,2}\.?$/.test(line);
  const headers = all.filter(isHeader);
  const hasOpen = headers.some(s => /오픈|입고/.test(s));
  const hasClose = headers.some(s => /마감/.test(s));
  const has17 = headers.some(s => /17\s*시|17:00|오후\s*5\s*시/.test(s));

  if (has17) issues.push('17시 재고 보고는 다루지 않습니다. 오픈·마감 보고만 입력하세요.');
  if (hasOpen && hasClose) issues.push('오픈과 마감이 함께 감지되었습니다. 보고 한 건씩 입력하세요.');
  const detected = hasClose ? 'closing' : hasOpen ? 'opening' : null;
  const type = expectedType;
  const label = type === 'opening' ? '오픈' : '마감';
  if (!detected) warnings.push(`본문에서 "오픈"/"마감" 표시를 찾지 못했습니다. ${label} 보고로 처리합니다.`);
  else if (detected !== type) issues.push(`${label} 보고를 선택했는데 본문은 ${detected === 'opening' ? '오픈' : '마감'} 보고로 보입니다.`);

  const dateLine = headers.find(s => /\d/.test(s)) || all.find(isDateOnly) || all.find(s => !s.includes('/') && /\d.*(월|[.\/-])/.test(s)) || '';
  const { date, usedFallback } = parseReportDate(dateLine, fallbackDate);
  if (!date) issues.push('보고 날짜가 올바르지 않습니다.');
  if (usedFallback) warnings.push(`본문에 날짜가 없어 선택한 날짜(${fallbackDate})로 저장합니다.`);
  else if (date && date !== fallbackDate) warnings.push(`선택 날짜(${fallbackDate})와 본문 날짜(${date})가 다릅니다. 본문 날짜로 저장합니다.`);

  const mentioned = Object.entries(STORE_WORDS).filter(([, words]) => all.some(line => words.some(w => nameKey(w) === nameKey(line)))).map(([code]) => code);
  if (mentioned.length > 1) issues.push('여러 지점의 보고가 감지되었습니다. 한 지점씩 입력하세요.');
  else if (mentioned.length === 1 && mentioned[0] !== storeCode) issues.push(`본문 지점(${mentioned[0] === 'HANAM' ? '하남' : '강동'})과 선택한 지점이 다릅니다. 지점을 바꾸거나 본문을 확인하세요.`);

  const index = buildProductIndex(products);
  const seen = new Set();
  const lines = [];
  all.forEach(rawLine => {
    if (isHeader(rawLine) || isDateOnly(rawLine)) return;
    const match = rawLine.match(/^(.+?)\s*\/\s*(.+)$/);
    if (!match) return;
    const parsedQty = parseQuantity(match[2], type);
    const product = index.get(nameKey(match[1])) || null;
    const line = {
      row: lines.length + 1, rawLine, rawName: match[1].trim(), rawQty: match[2].trim(),
      product: product ? { product_id: product.product_id, name: product.name } : null,
      qty: parsedQty.qty ?? null, notReceived: !!parsedQty.notReceived, label: parsedQty.label ?? null,
      error: parsedQty.error || null, duplicate: false,
    };
    if (product) {
      if (seen.has(product.product_id)) line.duplicate = true;
      seen.add(product.product_id);
    }
    lines.push(line);
  });
  if (!lines.length) issues.push("'상품명 / 20개' 형식의 줄이 없습니다.");
  return { type, date, usedFallback, lines, issues, warnings };
}

export { nameKey, buildProductIndex, parseReportDate, parseQuantity, parseReport };
