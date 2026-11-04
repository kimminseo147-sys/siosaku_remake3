// [학습] 재고 업무 규칙. DB 없이 입력 객체를 검사·변환하고 새 결과를 반환합니다.
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { validQty } from './quantity.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { normalizeProduct } from './products.js';

// [학습] 상품 재고 item과 날짜별 기록 record를 받아 분석 가능 상태를 판정합니다. 먼저 걸린 조건 하나만 반환합니다.
function stockStatus(item,record){
  // [학습] 상품이 없거나 품질 오류가 기록되어 있으면 정상 분석에서 제외합니다.
  if(!item||item.quality_issue)return "검토 필요";
  // [학습] 오픈 수량이 유효한 정수가 아니면 오픈 누락으로 분류합니다.
  if(!validQty(item.stock))return "오픈 누락";
  // [학습] 마감 수량도 같은 방식으로 확인합니다.
  if(!validQty(item.remaining))return "마감 누락";
  // [학습] 오픈보다 마감이 많으면 기본 판매량 정의를 적용할 수 없습니다.
  if(item.remaining>item.stock)return "마감 > 오픈";
  // [학습] 17시 재고 등 대체 마감은 정상 마감과 구분합니다.
  if(record.is_estimated_close||String(record.remaining_source||"").includes("17시"))return "마감 대체";
  // [학습] 현재 코드는 오픈 0을 미입고/0으로 묶어 정상 판매량 집계에서 제외합니다.
  if(item.stock===0)return "미입고/0";
  // [학습] 위 제외 조건에 해당하지 않아야 정상으로 분류됩니다.
  return "정상";
}
// 관측 판매량의 정의는 오픈재고 - 마감재고. 보정·가상 매출 없음.
// [학습] 정상 재고만 오픈-마감으로 계산합니다. 분석 불가를 뜻하는 null은 실제 판매량 0과 다릅니다.
function observedSales(item,record){return stockStatus(item,record)==="정상"?item.stock-item.remaining:null;}
// [학습] 원본 기록을 DB에 수정하지 않고, 표준 상품명으로 바꾼 분석용 복사본을 만듭니다.
function canonicalRecord(record,products=[]){
  // [학습] items는 변환 결과, originals는 표준 이름별 원문 이름입니다. skipped와 collisions는 누락·충돌 건수입니다.
  const items={},originals={};let skipped=0,collisions=0;
  // [학습] Object.entries로 각 원문 상품명과 재고 객체를 함께 꺼냅니다.
  for(const [raw,item] of Object.entries(record.items||{})){
    // [학습] 상품명 표준화 함수를 호출합니다.
    const found=normalizeProduct(raw,record.branch,products);
    // [학습] 표준화 불가·제외 상품은 결과에서 빼고 건수만 올립니다.
    if(!found.name){skipped++;continue;}
    // [학습] 변환 결과에 이미 같은 상품명이 있으면 별칭 병합 충돌입니다. 상속받은 속성은 검사에서 제외합니다.
    if(Object.prototype.hasOwnProperty.call(items,found.name)){
      // [학습] 충돌 횟수를 하나 증가시킵니다. ++는 1을 더한다는 뜻입니다.
      collisions++;
      // [학습] 두 수량을 임의로 더하지 않고 검토 필요 상태로 남깁니다.
      items[found.name]={stock:null,remaining:null,quality_issue:`표준상품 병합 충돌: ${originals[found.name]}, ${raw}`};
    // [학습] 충돌이 없으면 ...item으로 재고 속성을 복사합니다.
    }else items[found.name]={...item};
    // [학습] 어떤 원문 이름들이 같은 표준 이름으로 모였는지 추적합니다. filter(Boolean)은 빈값을 제거합니다.
    originals[found.name]=[originals[found.name],raw].filter(Boolean).join(", ");
  }
  // [학습] 원래 기록 속성을 복사하되 items를 변환 결과로 덮고 품질 집계를 추가합니다.
  return {...record,items,quality:{skipped,collisions}};
}
// [학습] 기존 자료를 수정해도 되는지 검사합니다. 문제 없으면 null, 문제 있으면 안내문을 반환합니다.
function safeLegacy(record,products=[]){
  // [학습] 신규 날짜라 기존 기록이 없으면 기존 자료 보호 검사가 필요하지 않습니다.
  if(!record)return null;
  // [학습] 현재 표준화 결과와 원래 이름이 다른 상품을 찾습니다.
  const problematic=Object.keys(record.items||{}).filter(raw=>normalizeProduct(raw,record.branch,products).name!==raw);
  // [학습] 문제가 있으면 처음 6개 이름을 담은 수정 중단 안내문을 만듭니다.
  return problematic.length?`기존 기록에 비표준·제외·중복 가능 상품이 있습니다. 원본을 보존하기 위해 이 날짜의 수정은 중단됩니다: ${problematic.slice(0,6).join(", ")}`:null;
}

// [학습] 기존 기록 existing에 파싱한 report를 반영해 새 객체를 만듭니다. 여기서는 DB 저장을 하지 않습니다.
function updateReport(existing,report,replaceType){
  // [학습] 오픈 보고면 stock, 나머지는 remaining을 선택합니다. 유효한 보고 유형인지 호출 전에 확인해야 하는 현재 구조입니다.
  const field=report.type==="stock"?"stock":"remaining";
  // [학습] 깊은 복사로 기존 화면·DB 조회 결과 객체가 함께 바뀌는 것을 방지합니다.
  const items=structuredClone(existing?.items||{});
  // [학습] 전체 교체 모드라면 이번 유형의 기존 수량만 null로 비웁니다. 반대 유형 수량은 유지합니다.
  if(replaceType)for(const item of Object.values(items))item[field]=null;
  // [학습] 보고에 들어 있는 상품과 수량만 반영합니다.
  for(const [name,qty] of Object.entries(report.items)){
    // [학습] 해당 상품이 없을 때만 기본 재고 객체를 만듭니다. ??=는 null·undefined일 때만 대입합니다.
    items[name]??={stock:null,remaining:null};
    // [학습] field 변수의 값에 따라 stock 또는 remaining 속성을 갱신합니다.
    items[name][field]=qty;
  }
  // [학습] 보고 반영 후 모든 상품의 파생 상태를 다시 계산합니다.
  for(const item of Object.values(items)){
    // [학습] 현재는 오픈 0을 미입고로 추정합니다. 확정된 원문 상태와 같다고 보장되지는 않습니다.
    item.no_delivery=item.stock===0;
    // [학습] 오픈이 양수이고 마감이 0인 관측을 표시합니다. 실제 품절 시각이나 미충족 수요는 알 수 없습니다.
    item.stockout=validQty(item.stock)&&item.stock>0&&item.remaining===0;
    // [학습] 오픈 수량이 null이면 누락 표시를 켭니다.
    item.missing_open=item.stock===null;
    // [학습] 마감 수량이 null이면 누락 표시를 켭니다.
    item.missing_close=item.remaining===null;
  }
  return {
    // [학습] 영업 날짜·지점·갱신한 상품별 재고를 반환합니다.
    date:report.date,branch:report.branch,items,
    // [학습] 마감 보고를 처리할 때만 출처를 갱신하고, 오픈 보고라면 기존 마감 출처를 유지합니다.
    remaining_source:report.type==="remaining"?(report.estimated?"17시 재고":"정상 마감"):(existing?.remaining_source||null),
    // [학습] 대체 마감이면 17:00을 기록합니다. 정상 마감의 실제 시각을 수집하는 코드는 아닙니다.
    remaining_time:report.type==="remaining"?(report.estimated?"17:00":null):(existing?.remaining_time||null),
    // [학습] 마감 보고의 대체 여부를 반영하거나 기존 값을 유지합니다.
    is_estimated_close:report.type==="remaining"?report.estimated:Boolean(existing?.is_estimated_close)
  };
}

// [학습] 이 파일의 함수를 외부에서 import할 수 있도록 공개합니다.
export { stockStatus, observedSales, canonicalRecord, safeLegacy, updateReport };
