// [학습] 데이터 접근 모듈 (v2: 한 줄씩 저장하는 DB 모델). 브라우저는 서버 /api만 호출합니다.
// [학습] (기존) = 인수인계 DB에 이미 있는 함수 / (제안) = database/proposals 초안. 설치 전에는 RPC_MISSING 오류가 옵니다.
import { apiGet, apiPost } from './apiClient.js';

const enc = encodeURIComponent;

// [학습] 로그인 사용자 + 지점 목록 → { user, stores:[{code,name,role}], accessKnown }
// [학습] accessKnown=false면 (제안) bq_list_my_stores가 아직 없어 내 역할(viewer/editor)을 모르는 상태입니다.
const loadMe = () => apiGet('/api/me');

// [학습] (기존) 상품 목록 → { store_code, products:[{product_id, product_code, name, active, is_forecast_target, lifecycle_status, aliases}] }
const loadCatalog = storeCode => apiGet(`/api/stores/${enc(storeCode)}/catalog`);

// [학습] (기존) 하루치 재고 → { branch, store_code, record_date, items:[{inventory_id, inventory_version, product_id, name,
// [학습]   opening_qty, closing_qty, receipt_status, movement_status, review_status, observed_sales_qty}] }
const loadInventory = (storeCode, date) => apiGet(`/api/stores/${enc(storeCode)}/inventory?date=${enc(date)}`);

// [학습] (제안) 기간 재고 → { store_code, from, to, items:[위 칼럼 + business_date, product_code] }
const loadInventoryRange = (storeCode, from, to) => apiGet(`/api/stores/${enc(storeCode)}/inventory-range?from=${enc(from)}&to=${enc(to)}`);

// [학습] (기존) 확정: pending → verified. expectedVersion은 화면이 들고 있던 inventory_version
const verifyRow = (row, reason) => apiPost(`/api/inventory/${enc(row.inventory_id)}/verify`, { expectedVersion: row.inventory_version, reason });

// [학습] (기존) 정정: changes는 바뀐 항목만. DB가 정정 후 pending으로 되돌리며, reverify=true면 바로 재확정
const correctRow = (row, changes, reason, reverify) =>
  apiPost(`/api/inventory/${enc(row.inventory_id)}/correct`, { expectedVersion: row.inventory_version, changes, reason, reverify });

// [학습] (기존) 예측 실행 → { run_id, day_type, model_version, products_processed, closing_zero_training_observations, ... }
const runForecast = (storeCode, forecastDate) => apiPost(`/api/stores/${enc(storeCode)}/forecasts`, { forecastDate });

// [학습] (제안) 예측일의 최근 실행 결과 → { run:{...}|null, items:[{product_name, predicted_demand_qty, forecast_status, alpha_used, history_count, ...}] }
const loadForecastResults = (storeCode, date) => apiGet(`/api/stores/${enc(storeCode)}/forecasts?date=${enc(date)}`);

// [학습] (기존) 저장값 재현 확인 → [{ product_name, stored_qty, replayed_qty, is_equal }]
const replayForecast = runId => apiGet(`/api/forecasts/${enc(runId)}/replay`);

// [학습] (제안) 반려: 사유 필수. 함수 설치 전에는 RPC_MISSING
const rejectRow = (row, reason) => apiPost(`/api/inventory/${enc(row.inventory_id)}/reject`, { expectedVersion: row.inventory_version, reason });

// [학습] 카톡 오픈 보고 저장 → { register, autoNotReceived, comparisons, unchanged, absentNow }
const saveOpeningReport = (storeCode, payload) => apiPost(`/api/stores/${enc(storeCode)}/reports/opening`, payload);
// [학습] 카톡 마감 보고 저장 → { mode, applied, verified, pending, details, failed, missing_close, supplemented }
const saveClosingReport = (storeCode, payload) => apiPost(`/api/stores/${enc(storeCode)}/reports/closing`, payload);

// [학습] 엑셀 일괄 등록 (최대 31일씩) → { results:[{date, status:'saved'|'skipped'|'failed', message?}] }
const importExcelDays = (storeCode, fileName, days) => apiPost(`/api/stores/${enc(storeCode)}/imports/excel`, { fileName, days });

export { importExcelDays, loadMe, loadCatalog, loadInventory, loadInventoryRange, verifyRow, correctRow, rejectRow, runForecast, loadForecastResults, replayForecast, saveOpeningReport, saveClosingReport };
