// [학습] 판매 분석 집계(순수 함수). 입력은 (제안) bq_get_inventory_range의 items 배열입니다.
// [학습] 판매량은 DB가 확정 줄에만 만든 observed_sales_qty만 씁니다. 화면에서 오픈−마감을 다시 계산하지 않습니다.
// [학습] 주말 = 토·일. DB의 공휴일 달력(business_calendar)은 화면에서 읽을 수 없어 반영하지 않습니다(예측 모델과 다를 수 있음).

const isWeekend = ymd => { const d = new Date(`${ymd}T00:00:00`).getDay(); return d === 0 || d === 6; };

function summarizeRange(items) {
  const quality = { rows: items.length, used: 0, pending: 0, rejected: 0, notReceived: 0, excluded: 0 };
  const dates = new Set();
  const map = new Map();
  for (const row of items) {
    dates.add(row.business_date);
    if (row.review_status === 'pending') { quality.pending++; continue; }
    if (row.review_status === 'rejected') { quality.rejected++; continue; }
    if (row.receipt_status === 'not_received') { quality.notReceived++; continue; }
    if (typeof row.observed_sales_qty !== 'number') { quality.excluded++; continue; }
    quality.used++;
    const p = map.get(row.product_id) || { product_id: row.product_id, name: row.name, total: 0, days: 0, wkTotal: 0, wkN: 0, weTotal: 0, weN: 0, stockouts: 0 };
    p.total += row.observed_sales_qty; p.days++;
    if (isWeekend(row.business_date)) { p.weTotal += row.observed_sales_qty; p.weN++; } else { p.wkTotal += row.observed_sales_qty; p.wkN++; }
    if (row.closing_qty === 0) p.stockouts++;
    map.set(row.product_id, p);
  }
  const byProduct = [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ko'));
  return { days: dates.size, quality, byProduct };
}

// [학습] 품절 빈도 순위 (2026-11-24 팀장 결정)
// [학습]   품절 빈도 = 품절일(마감 0) ÷ 판매일. 빈도가 높은 순, 같으면 품절일이 많은 순.
// [학습]   판매일이 minDays(30일) 미만인 상품은 표본이 적어 믿기 어려우므로 순위에서 빼고 뒤쪽 "참고" 목록으로 보냅니다.
// [학습]   품절이 한 번도 없는 상품은 두 목록 모두에서 뺍니다.
const STOCKOUT_MIN_DAYS = 30;
function rankStockouts(byProduct, minDays = STOCKOUT_MIN_DAYS) {
  const rate = p => p.stockouts / p.days;
  const order = (a, b) => (rate(b) - rate(a)) || (b.stockouts - a.stockouts) || (b.days - a.days);
  const withStockouts = byProduct.filter(p => p.stockouts > 0 && p.days > 0);
  return {
    ranked: withStockouts.filter(p => p.days >= minDays).sort(order),
    lowSample: withStockouts.filter(p => p.days < minDays).sort(order),
  };
}

export { summarizeRange, isWeekend, rankStockouts, STOCKOUT_MIN_DAYS };
