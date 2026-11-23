// [학습] 엑셀 일괄 등록 해석기 (v2). 순수 함수: SheetJS가 읽은 행 배열 → 날짜별 저장 후보.
// [학습] v1(excel.js)에서 유지한 것: 필수 열 4개(날짜·상품명·오픈재고·잔여재고), 한 행이라도 문제가 있으면 그 날짜 전체를 격리,
// [학습]   이미 등록된 날짜는 덮어쓰지 않음(서버가 확인), 품절·완판·소진 = 0.
// [학습] v2에서 바뀐 것: 상품 사전 = DB 사전 / 사전에 없는 이름은 이름마다 한 번 골라 주면 그 이름의 모든 행에 적용 /
// [학습]   팀 결정 수량 규칙(오픈 0 = 미입고) / 오픈 공란 = 입고 여부 미확인 / 오픈 0인데 마감 있음 = 확인 필요(날짜는 막지 않음) /
// [학습]   강동 시작일 고정값 대신 기간을 직접 선택.
import { isValidDay, localDay } from '../domain/dates.js';
import { nameKey, buildProductIndex } from './kakaoReport.js';

const REQUIRED = ['날짜', '상품명', '오픈재고', '잔여재고'];

// [학습] 엑셀 날짜: 숫자(엑셀 일련번호), Date 객체, "2026-10-26"·"2026.10.26"·"2026년 10월 26일" 문자열
function excelDate(value, parseDateCode) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = parseDateCode ? parseDateCode(value) : null;
    return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null;
  }
  if (value instanceof Date) return localDay(value);
  const m = String(value ?? '').trim().match(/^(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (!m) return null;
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return isValidDay(d) ? d : null;
}

// [학습] 수량 칸: 공란 → null, 숫자 → 정수만, "품절/완판/소진"(마감만) → 0 + 라벨, 그 밖 → 오류(undefined)
function excelQty(value, type) {
  if (value === null || value === undefined || String(value).trim() === '') return { qty: null, label: null };
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? { qty: value, label: null } : { error: true };
  const text = String(value).trim().replace(/,/g, '');
  if (type === 'closing' && /^(품절|소진|완판)$/.test(text)) return { qty: 0, label: text };
  if (type === 'opening' && /^(미입고|입고없음)$/.test(text)) return { qty: 0, label: text };
  if (/^\d+(?:개)?(?:\+\d+(?:개)?)*$/.test(text)) return { qty: text.replace(/개/g, '').split('+').map(Number).reduce((a, b) => a + b, 0), label: null };
  return { error: true };
}

// [학습] 한 행 → DB 저장 형식. 반환 { receipt_status, opening_qty, closing_qty } 또는 { skip } / { error }
function toInventoryRow(open, close) {
  if (open.qty === null && close.qty === null) return { skip: '오픈·마감 모두 공란' };
  if (open.qty === 0) {
    // [학습] 오픈 0 = 그날 미입고(팀 결정). 그런데 마감 수량이 있으면 앞뒤가 맞지 않음 →
    // [학습] "확인 필요"로 저장(팀 결정 2026-11-04): 입고 여부 미확인, 마감 수량만 보존, 판매량·예측 제외. 날짜는 막지 않음.
    if (close.qty !== null && close.qty > 0) return { receipt_status: 'unknown', opening_qty: null, closing_qty: close.qty, review: `확인 필요: 오픈 0·마감 ${close.qty}` };
    return { receipt_status: 'not_received', opening_qty: null, closing_qty: null };
  }
  // [학습] 오픈 공란 = 입고 여부를 모름 → 'unknown' (판매량 계산·확정 불가, 나중에 정정 가능)
  if (open.qty === null) return { receipt_status: 'unknown', opening_qty: null, closing_qty: close.qty };
  return { receipt_status: 'received', opening_qty: open.qty, closing_qty: close.qty };
}

// [학습] 입력: rows(시트 전체 행 배열), { products, from, to, parseDateCode, nameChoices }
// [학습]   nameChoices: { "사전에 없는 원본 이름": "선택한 표준명" | "__skip__" }
// [학습] 반환: { days:[{date, items}], blocked:[{date, reasons}], unmatchedNames:[{name, rows}], counts, warnings }
function analyzeExcelRows(rows, { products, from = '', to = '', parseDateCode, nameChoices = {} }) {
  const headerIndex = rows.findIndex(row => Array.isArray(row) && REQUIRED.every(h => row.map(x => String(x ?? '').trim()).includes(h)));
  if (headerIndex < 0) throw new Error("'날짜', '상품명', '오픈재고', '잔여재고' 열이 있는 머리행을 찾지 못했습니다.");
  const header = rows[headerIndex].map(x => String(x ?? '').trim());
  const [iDate, iName, iOpen, iClose] = REQUIRED.map(h => header.indexOf(h));
  const index = buildProductIndex(products);
  const byName = new Map(products.map(p => [p.name, p]));

  const days = new Map(), reasons = new Map(), unmatched = new Map(), warnings = [];
  const counts = { needsReview: 0, rows: 0, outside: 0, empty: 0, skippedByChoice: 0, notReceived: 0, missingOpen: 0, missingClose: 0, closeOverOpen: 0, stockout: 0 };
  const block = (date, text) => { if (!reasons.has(date)) reasons.set(date, []); reasons.get(date).push(text); };

  rows.slice(headerIndex + 1).forEach((row, i) => {
    const rowNo = headerIndex + 2 + i;
    if (!Array.isArray(row) || row.every(v => v === null || v === undefined || String(v).trim() === '')) return;
    const date = excelDate(row[iDate], parseDateCode);
    const rawName = String(row[iName] ?? '').replace(/\s+/g, ' ').trim();
    if (!date || !rawName) { warnings.push(`${rowNo}행: 날짜 또는 상품명 오류`); if (date) block(date, `${rowNo}행 날짜/상품명 오류`); return; }
    if ((from && date < from) || (to && date > to)) { counts.outside++; return; }

    let product = index.get(nameKey(rawName));
    if (!product) {
      const choice = nameChoices[rawName];
      if (choice === '__skip__') { counts.skippedByChoice++; return; }
      product = choice ? byName.get(choice) : null;
      if (!product) {
        unmatched.set(rawName, (unmatched.get(rawName) || 0) + 1);
        block(date, `사전에 없는 상품명: ${rawName}`); return;
      }
    }
    const open = excelQty(row[iOpen], 'opening'), close = excelQty(row[iClose], 'closing');
    if (open.error || close.error) { block(date, `${rowNo}행 ${rawName}: 수량 형식 오류`); warnings.push(`${rowNo}행: ${rawName} 수량 형식 오류`); return; }
    const inv = toInventoryRow(open, close);
    if (inv.skip) { counts.empty++; return; }
    if (inv.error) { block(date, `${rowNo}행 ${product.name}: ${inv.error}`); warnings.push(`${rowNo}행: ${product.name} ${inv.error}`); return; }

    if (!days.has(date)) days.set(date, new Map());
    const items = days.get(date);
    if (items.has(product.name)) { block(date, `${rowNo}행: ${product.name} 중복`); warnings.push(`${rowNo}행: ${product.name}이(가) 같은 날짜에 두 번 있습니다 (표준명 기준)`); return; }
    const { review, ...invRow } = inv;
    items.set(product.name, { rawLine: `${rawName} / 오픈 ${row[iOpen] ?? ''} / 마감 ${row[iClose] ?? ''}`, productName: product.name, ...invRow, label: review || open.label || close.label });
    counts.rows++;
    if (review) { counts.needsReview++; warnings.push(`${rowNo}행: ${product.name} ${review} → 확인 필요로 저장`); }
    if (inv.receipt_status === 'not_received') counts.notReceived++;
    if (inv.receipt_status === 'unknown' && !review) counts.missingOpen++;
    if (inv.receipt_status === 'received' && inv.closing_qty === null) counts.missingClose++;
    if (inv.receipt_status === 'received' && inv.closing_qty === 0) counts.stockout++;
    if (inv.opening_qty !== null && inv.closing_qty !== null && inv.closing_qty > inv.opening_qty) { counts.closeOverOpen++; warnings.push(`${rowNo}행: ${product.name} 마감 > 오픈 (검토 대기로 저장)`); }
  });

  const blocked = [...reasons.entries()].map(([date, list]) => ({ date, reasons: list })).sort((a, b) => a.date.localeCompare(b.date));
  const ready = [...days.entries()].filter(([date]) => !reasons.has(date))
    .map(([date, items]) => ({ date, items: [...items.values()] })).sort((a, b) => a.date.localeCompare(b.date));
  return { days: ready, blocked, unmatchedNames: [...unmatched.entries()].map(([name, rows]) => ({ name, rows })), counts, warnings };
}

export { excelDate, excelQty, toInventoryRow, analyzeExcelRows };
