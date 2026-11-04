// [학습] 상품명 표준화. 카카오톡·Excel·기존 기록 분석에서 공통으로 사용합니다.
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { COMMON_ALIASES, GANGDONG_ALIASES } from '../config/catalog.js';

// [학습] ??는 null·undefined만 빈 문자열로 바꿉니다. String으로 문자열화하고 연속 공백을 하나로 만든 뒤 앞뒤 공백을 없앱니다.
const cleanName=value=>String(value??"").replace(/\s+/g," ").trim();
// [학습] 비교용 이름에서는 모든 공백을 없앱니다. 표시 이름은 유지하면서 띄어쓰기 차이를 무시하려는 처리입니다.
const keyName=value=>cleanName(value).replace(/\s/g,"");
// [학습] Object.entries는 객체를 [키, 값] 배열로 바꿉니다. Map은 공백을 없앤 별칭으로 표준 이름을 빠르게 찾습니다.
const gangdongMap=new Map(Object.entries(GANGDONG_ALIASES).map(([raw,canonical])=>[keyName(raw),canonical]));
// [학습] 공통 별칭도 같은 방식으로 조회용 Map을 만듭니다. 공백 제거 후 같은 키가 되면 뒤의 값이 남습니다.
const commonMap=new Map(Object.entries(COMMON_ALIASES).map(([raw,canonical])=>[keyName(raw),canonical]));
// [학습] 입력: 원문 상품명 raw, 지점 branch, 상품 목록 products. 반환: {name} 또는 실패 사유, 필요하면 newProduct 표시입니다.
function normalizeProduct(raw,branch,products=[]){
  // [학습] 화면에 보이는 이름 대신 비교용 키를 계산합니다.
  const key=keyName(raw);
  // [학습] 상품명이 비어 있으면 표준화할 수 없으므로 이름 대신 null과 사유를 반환합니다.
  if(!key)return {name:null,reason:"상품명 누락"};
  // [학습] 강동점은 전용 사전만 사용하고 아래의 공통·DB 별칭 조회로 넘어가지 않는 기존 규칙입니다.
  if(branch==="강동 본점"){
    // [학습] has는 키 존재 여부입니다. 사전에 없는 이름은 임의로 새 상품으로 확정하지 않습니다.
    if(!gangdongMap.has(key))return {name:null,reason:`표준화 미확정: ${raw}`};
    const name=gangdongMap.get(key);
    // [학습] 삼항 연산자: name이 있으면 {name}, 없으면 제외 사유를 반환합니다. {name}은 {name:name}의 축약입니다.
    return name?{name}:{name:null,reason:"확정 제외 상품"};
  }
  // [학습] 다른 지점에서는 먼저 공통 별칭을 확인합니다.
  if(commonMap.has(key)){
    const name=commonMap.get(key);
    // [학습] some은 조건에 맞는 상품이 하나라도 있는지 확인합니다. !로 뒤집어 기존 목록에 없음을 표시합니다.
    return {name,newProduct:!products.some(p=>p.name===name)};
  }
  // [학습] 공통 별칭에 없으면 DB에서 받은 각 상품의 이름과 별칭을 차례로 비교합니다.
  for(const p of products){
    // [학습] 표준 이름 자체가 입력과 일치하면 해당 상품을 반환합니다.
    if(keyName(p.name)===key)return {name:p.name};
    // [학습] aliases가 없으면 []를 사용합니다. 별칭 중 하나라도 일치하면 그 상품 이름을 반환합니다.
    if((p.aliases||[]).some(alias=>keyName(alias)===key))return {name:p.name};
  }
  // [학습] 어느 규칙에도 없으면 정리한 원문을 신규 상품 후보로 반환합니다. 검증된 정식 상품이라는 뜻은 아닙니다.
  return {name:cleanName(raw),newProduct:true};
}

// [학습] 이 파일의 함수를 외부에서 import할 수 있도록 공개합니다.
export { cleanName, keyName, normalizeProduct };
