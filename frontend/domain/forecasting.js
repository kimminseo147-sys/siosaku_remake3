// [학습] 기존 임시 생산량 추천식. 코드 이해 단계이므로 계수와 수식을 변경하지 않았습니다.
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { dayIndex, weekend } from './dates.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { canonicalRecord, observedSales } from './inventory.js';

// [학습] 원본의 임시 추천 규칙을 보존한 함수입니다. 팀원이 확정한 예측식이나 Newsvendor 모델이 아닙니다.
function predict(records,targetDate,names,products=[]){
  // [학습] 대상 요일과 여유 배수(평일 1.10, 주말 1.15)를 준비합니다.
  const wd=dayIndex(targetDate),buf=weekend(targetDate)?1.15:1.10;
  // [학습] 대상일보다 과거이면서 같은 요일인 기록만 남깁니다.
  const history=records.filter(r=>r.date<targetDate&&dayIndex(r.date)===wd)
    // [학습] 최신 날짜가 먼저 오도록 정렬하고 상품명을 표준화합니다.
    .sort((a,b)=>b.date.localeCompare(a.date)).map(r=>canonicalRecord(r,products));
  // [학습] 상품 이름마다 추천 결과 객체 하나를 만듭니다.
  return names.map(name=>{
    // [학습] 해당 상품의 유효 판매량 표본을 담을 배열입니다.
    const obs=[];
    // [학습] 최근 같은 요일의 기록부터 확인합니다.
    for(const r of history){
      // [학습] 이번 날짜에 해당 상품의 재고를 찾습니다.
      const item=r.items[name];
      // [학습] 정상 재고의 관측 판매량만 얻습니다.
      const s=observedSales(item,r);
      // [학습] 판매량 0도 유효 표본입니다. 정상 표본을 최대 8개 모으면 반복을 끝냅니다.
      if(s!==null){obs.push({sold:s,stockout:item.remaining===0});if(obs.length===8)break;}
    }
    // [학습] 자료가 없으면 추천량 null을 반환합니다. 0개 생산 추천과 구분합니다.
    if(!obs.length)return {name,qty:null,average:null,count:0,frequentStockout:false};
    // [학습] 최근 4개 표본은 가중치 2, 나머지는 1로 가중평균을 계산합니다. 분모도 실제 가중치 합입니다.
    const weighted=obs.reduce((acc,o,i)=>acc+o.sold*(i<4?2:1),0)/obs.reduce((acc,o,i)=>acc+(i<4?2:1),0);
    // [학습] 최근 최대 4개 중 마감 0 비율이 절반 이상인지 확인합니다.
    const recent=obs.slice(0,4),frequentStockout=recent.filter(o=>o.stockout).length/recent.length>=.5;
    // [학습] 가중평균에 여유 배수와 조건부 1.10을 곱하고 ceil로 올림합니다. average는 표시용 소수 첫째 자리 반올림입니다.
    return {name,qty:Math.ceil(weighted*buf*(frequentStockout?1.10:1)),average:Math.round(weighted*10)/10,count:obs.length,frequentStockout};
  });
}

// [학습] 이 파일의 함수를 외부에서 import할 수 있도록 공개합니다.
export { predict };
