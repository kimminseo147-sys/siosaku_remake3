// [학습] DB 접근 전담 모듈. App.jsx가 이 함수를 호출하지만 실행 위치는 현재 브라우저입니다.
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { db } from '../config/supabase.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { BRANCHES } from '../config/catalog.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { isValidDay } from '../domain/dates.js';

// 데이터 접근: 운영 DB의 기존 필드·테이블을 유지합니다.
// [학습] 모든 허용 지점의 재고를 조회합니다. 반환 객체의 date는 DB의 record_date를 바꾼 이름입니다.
async function loadRecords(){
  // [학습] 페이지별 조회 결과를 모을 배열입니다.
  const all=[];
  // [학습] 500건씩 반복 조회합니다. 종료 조건은 아래에서 결과 수로 판단합니다.
  for(let start=0;;start+=500){
    // [학습] Supabase 요청 결과에서 data와 error를 꺼냅니다. from은 조회할 테이블을 고릅니다.
    const {data,error}=await db.from("inventory_records")
      // [학습] 가져올 열을 명시합니다. 전체 열을 무조건 가져오지 않습니다.
      .select("record_date,branch,items,remaining_source,remaining_time,is_estimated_close,updated_at")
      // [학습] 허용 지점으로 필터하고 날짜·지점순 정렬 후 범위를 지정합니다. range의 끝 인덱스도 포함됩니다.
      .in("branch",BRANCHES).order("record_date").order("branch").range(start,start+499);
    // [학습] DB 오류를 호출한 함수의 catch에서 처리하도록 전달합니다.
    if(error)throw error;
    // [학습] ...는 배열 요소를 펼쳐 추가합니다. 500건 미만이면 마지막 페이지로 보고 반복을 끝냅니다.
    all.push(...(data||[]));if(!data||data.length<500)break;
  }
  // [학습] DB 필드명을 앱 형식으로 바꿉니다. !!는 값을 boolean으로 변환합니다.
  return all.map(r=>({date:r.record_date,branch:r.branch,items:r.items||{},remaining_source:r.remaining_source,
    // [학습] 마감 메타데이터와 수정 시각도 보존해 반환합니다.
    remaining_time:r.remaining_time,is_estimated_close:!!r.is_estimated_close,updated_at:r.updated_at}));
}
// [학습] 활성 상품의 이름·별칭을 조회합니다. 상품 테이블 구조를 새로 만드는 코드는 아닙니다.
async function loadProducts(){
  // [학습] active=true만 가져와 이름순으로 정렬합니다.
  const {data,error}=await db.from("products").select("name,aliases,active").eq("active",true).order("name");
  // [학습] DB 오류를 호출한 함수의 catch에서 처리하도록 전달합니다.
  if(error)throw error;return data||[];
}
// [학습] 상품명에 들어 있는 단어로 카테고리를 추정하는 기존 간단한 규칙입니다.
const category=name=>name.includes("산도")?"산도":name.includes("러스크")?"러스크":name.includes("쇼쿠판")?"식빵":name.includes("버터떡")?"디저트":"시오빵";
// [학습] 신규 상품 이름을 등록합니다. 기존 상품의 별칭을 덮어쓰지 않도록 조회 후 insert만 합니다.
async function addProducts(names){
  // [학습] 등록할 상품이 없으면 즉시 종료합니다.
  if(!names.length)return;
  // [학습] Set으로 이름 중복을 없애고 DB에 보낼 상품 객체 배열을 만듭니다.
  const rows=[...new Set(names)].map(name=>({name,category:category(name),active:true,aliases:[]}));
  // 업데이트형 upsert는 기존 상품의 별칭을 지울 수 있으므로, 여기서는 신규 등록만 수행.
  // [학습] 상품별로 존재 여부를 확인합니다.
  for(const row of rows){
    // [학습] 같은 이름이 있으면 신규 등록을 생략하기 위한 조회입니다.
    const {data,error}=await db.from("products").select("name").eq("name",row.name).limit(1);
    // [학습] DB 오류를 호출한 함수의 catch에서 처리하도록 전달합니다.
    if(error)throw error;
    // [학습] ?.는 data가 없을 때 오류 없이 접근합니다. 기존 결과가 없을 때 insert하고 중복키 오류 23505는 무시합니다.
    if(!data?.length){const result=await db.from("products").insert(row);if(result.error&&result.error.code!=="23505")throw result.error;}
  }
}
// [학습] 재고 저장. expected는 수정 전 기록이며 없으면 신규 insert, 있으면 조건부 update입니다.
async function saveRecord(record,expected){
  // [학습] 지점·날짜를 확인합니다. 현재 브라우저 검증이며 서버/DB에서의 권한 검사를 대신하지 않습니다.
  if(!BRANCHES.includes(record.branch)||!isValidDay(record.date))throw new Error("지점 또는 날짜가 올바르지 않습니다.");
  // [학습] 저장할 재고·메타데이터·수정 시각을 구성합니다. 시각은 현재 클라이언트에서 생성합니다.
  const payload={items:record.items,remaining_source:record.remaining_source||null,
    // [학습] 마감 시각과 대체 여부를 저장 형식으로 맞춥니다.
    remaining_time:record.remaining_time||null,is_estimated_close:!!record.is_estimated_close,updated_at:new Date().toISOString()};
  // [학습] 기존 기록이 없으면 새 행을 등록합니다.
  if(!expected){
    // [학습] 날짜·지점과 payload 속성을 합쳐 insert합니다.
    const {error}=await db.from("inventory_records").insert({...payload,record_date:record.date,branch:record.branch});
    // [학습] DB 오류를 호출한 함수의 catch에서 처리하도록 전달합니다.
    if(error)throw error;
  }else{
    // [학습] 수정할 행을 날짜와 지점으로 좁힙니다. let은 조건 추가로 request를 다시 대입하기 때문에 사용합니다.
    let request=db.from("inventory_records").update(payload).eq("record_date",record.date).eq("branch",record.branch);
    // [학습] 조회 당시 수정 시각과 같은 행만 갱신하도록 조건을 붙입니다. 다른 사용자의 선행 수정을 감지하려는 장치입니다.
    request=expected.updated_at?request.eq("updated_at",expected.updated_at):request.is("updated_at",null);
    // [학습] 수정·삭제 결과 행을 돌려받아 실제 대상이 있었는지 확인합니다.
    const {data,error}=await request.select("record_date");
    // [학습] DB 오류를 호출한 함수의 catch에서 처리하도록 전달합니다.
    if(error)throw error;
    // [학습] ?.는 data가 없을 때 오류 없이 접근합니다. 기존 결과가 없을 때 insert하고 중복키 오류 23505는 무시합니다.
    if(!data?.length)throw new Error("다른 사용자가 먼저 수정했거나 수정 권한이 없습니다. 새로고침 후 다시 확인하세요.");
  }
}
// [학습] 선택한 날짜·지점의 전체 기록을 삭제합니다. 자동 복구 코드는 없습니다.
async function removeRecord(record){
  // [학습] 수정할 행을 날짜와 지점으로 좁힙니다. let은 조건 추가로 request를 다시 대입하기 때문에 사용합니다.
  let request=db.from("inventory_records").delete().eq("record_date",record.date).eq("branch",record.branch);
  // [학습] 삭제에서도 조회 이후 다른 수정이 있었는지 확인하는 조건을 붙입니다.
  request=record.updated_at?request.eq("updated_at",record.updated_at):request.is("updated_at",null);
  // [학습] 수정·삭제 결과 행을 돌려받아 실제 대상이 있었는지 확인합니다.
  const {data,error}=await request.select("record_date");
  // [학습] DB 오류를 호출한 함수의 catch에서 처리하도록 전달합니다.
  if(error)throw error;
  // [학습] ?.는 data가 없을 때 오류 없이 접근합니다. 기존 결과가 없을 때 insert하고 중복키 오류 23505는 무시합니다.
  if(!data?.length)throw new Error("다른 사용자가 수정했거나 삭제 권한이 없습니다. 새로고침 후 확인하세요.");
}

// [학습] Excel 등록 후보를 30개씩 묶어 순차 저장합니다. 여러 묶음 전체가 하나의 DB 트랜잭션인 것은 아닙니다.
async function insertRecordsInBatches(toInsert){
        // [학습] 0,30,60... 인덱스에서 다음 최대 30개를 처리합니다.
        for(let i=0;i<toInsert.length;i+=30){
          // [학습] 앱의 date를 DB의 record_date로 바꾸고 등록 메타데이터를 붙입니다.
          const chunk=toInsert.slice(i,i+30).map(r=>({record_date:r.date,branch:r.branch,items:r.items,
            // [학습] Excel 등록의 마감 메타데이터와 새 수정 시각을 설정합니다.
            remaining_source:r.remaining_source,remaining_time:null,is_estimated_close:false,updated_at:new Date().toISOString()}));
          // [학습] 날짜·지점과 payload 속성을 합쳐 insert합니다.
          const {error}=await db.from("inventory_records").insert(chunk);if(error)throw new Error(`일괄등록 일부 실패: ${error.message}. 현재 DB를 새로고침하고 중복 여부를 확인하세요.`);
        }
}

// [학습] 이 파일의 함수를 외부에서 import할 수 있도록 공개합니다.
export { loadRecords, loadProducts, addProducts, saveRecord, removeRecord, insertRecordsInBatches };
