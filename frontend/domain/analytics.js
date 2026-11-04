// [학습] 정상 관측을 집계하는 분석 함수입니다. 판매 수량을 계산하며 가격 기반 매출은 계산하지 않습니다.
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { weekend } from './dates.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { canonicalRecord, stockStatus, observedSales } from './inventory.js';

// [학습] 여러 재고 기록을 상품별·지점별 판매량과 데이터 품질 통계로 바꿉니다. DB 조회는 하지 않습니다.
function summarize(records,products=[]){
  // [학습] 상품·지점별 누적값은 Map에, 품질별 건수는 quality 객체에 보관합니다.
  const byProduct=new Map(),byBranch=new Map(),quality={normal:0,missingOpen:0,missingClose:0,invalid:0,estimated:0,noDelivery:0,unmapped:0,collisions:0};
  // [학습] 날짜·지점별 기록을 하나씩 순회합니다.
  for(const raw of records){
    // [학습] 이름 표준화와 충돌 처리를 적용한 분석용 기록을 만듭니다.
    const r=canonicalRecord(raw,products);
    // [학습] 표준화 제외 건수와 상품명 충돌 건수를 전체 통계에 더합니다.
    quality.unmapped+=r.quality.skipped;quality.collisions+=r.quality.collisions;
    // [학습] 처음 본 지점이면 누적값을 준비합니다. Set은 같은 날짜를 중복 집계하지 않습니다.
    if(!byBranch.has(r.branch))byBranch.set(r.branch,{days:new Set(),sales:0,remaining:0,valid:0});
    // [학습] 현재 지점의 누적 객체를 가져와 보고 날짜를 추가합니다.
    const bs=byBranch.get(r.branch);bs.days.add(r.date);
    // [학습] 기록 안의 각 상품을 확인합니다.
    for(const [name,item] of Object.entries(r.items)){
      // [학습] 수량·대체 마감 등 분석 제외 조건을 판정합니다.
      const status=stockStatus(item,r);
      // [학습] 아래 if/else는 한 상품·일을 상태 하나에만 분류합니다.
      if(status==="오픈 누락")quality.missingOpen++;
      else if(status==="마감 누락")quality.missingClose++;
      else if(status==="미입고/0")quality.noDelivery++;
      else if(status==="마감 대체")quality.estimated++;
      else if(status!=="정상")quality.invalid++;
      else quality.normal++;
      // [학습] 판매량 계산이 불가능하면 continue로 다음 상품으로 넘어갑니다.
      const sold=observedSales(item,r);if(sold===null)continue;
      // [학습] 정상 관측만 지점 판매·잔여 수량·유효 관측 수에 누적합니다. 잔여 수량을 폐기량으로 확정하지 않습니다.
      bs.sales+=sold;bs.remaining+=item.remaining;bs.valid++;
      // [학습] 처음 본 상품의 전체·평일·주말 누적값과 마감 0 횟수를 초기화합니다.
      if(!byProduct.has(name))byProduct.set(name,{name,total:0,days:0,wkTotal:0,wkN:0,weTotal:0,weN:0,stockouts:0});
      // [학습] 상품의 판매량과 유효 상품·일 수를 올립니다. 전체 지점에서는 같은 날짜도 지점별로 별도 관측입니다.
      const p=byProduct.get(name);p.total+=sold;p.days++;
      // [학습] 토·일인지에 따라 평일/주말 합계와 표본 수를 각각 누적합니다.
      if(weekend(r.date)){p.weTotal+=sold;p.weN++;}else{p.wkTotal+=sold;p.wkN++;}
      // [학습] 정상 관측 중 마감 0인 횟수를 셉니다.
      if(item.remaining===0)p.stockouts++;
    }
  }
  // [학습] Map을 화면용 배열로 바꾸고 상품은 총판매량 내림차순으로 정렬합니다. 지점의 날짜 수는 Set.size로 구합니다.
  return {byProduct:[...byProduct.values()].sort((a,b)=>b.total-a.total),byBranch:[...byBranch.entries()].map(([name,b])=>({name,days:b.days.size,sales:b.sales,remaining:b.remaining,valid:b.valid})),quality};
}

// [학습] 이 파일의 함수를 외부에서 import할 수 있도록 공개합니다.
export { summarize };
