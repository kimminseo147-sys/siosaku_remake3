// [학습] Excel 업로드 → 행 배열 → 날짜별 등록 후보를 생성합니다.
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { GANGDONG_MIN_DATE } from '../config/catalog.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { isValidDay, localDay } from '../domain/dates.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { cleanName, normalizeProduct } from '../domain/products.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { validQty, parseQty } from '../domain/quantity.js';

// [학습] Excel 날짜를 YYYY-MM-DD로 통일합니다. 입력은 날짜 일련번호·Date 객체·문자열일 수 있습니다.
function excelDate(value){
  // [학습] Excel 숫자 날짜는 SheetJS로 연·월·일로 해석합니다. 숫자 경로는 아래 문자열 경로와 검증 방식이 다릅니다.
  if(typeof value==="number"&&Number.isFinite(value)){
    // [학습] Excel 날짜 해석 도구를 호출합니다. window는 브라우저의 전역 객체입니다.
    const d=window.XLSX.SSF.parse_date_code(value);
    // [학습] 해석 실패는 null, 성공은 0을 채운 월·일 문자열로 반환합니다.
    if(!d)return null;return `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;
  }
  // [학습] Date 객체면 공통 localDay 함수를 사용합니다.
  if(value instanceof Date)return localDay(value);
  // [학습] 문자열 입력을 준비합니다. null·undefined는 빈 문자열로 바꿉니다.
  const str=String(value??"").trim();
  // [학습] 연도를 포함하는 날짜 형식을 찾습니다.
  const m=str.match(/^(20\d{2})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})/);
  // [학습] 날짜 형식이 아니면 null로 표시합니다.
  if(!m)return null;
  // [학습] 정규식이 추출한 연·월·일을 표준 문자열로 조합합니다.
  const d=`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  // [학습] 문자열 경로에서는 실제 달력 날짜인지도 검사합니다.
  return isValidDay(d)?d:null;
}
// [학습] 빈 셀은 null, 잘못된 수량은 undefined, 정상 수량은 숫자로 반환하는 현재 계약입니다.
function excelQty(value,type){
  // [학습] 빈 셀과 숫자 0을 구분합니다.
  if(value===null||value===undefined||String(value).trim()==="")return null;
  // [학습] 마감 품절 문구는 0, 오픈의 품절 문구는 오류(undefined)입니다.
  if(typeof value==="string"&&/^(품절|소진|완판)$/.test(value.trim()))return type==="remaining"?0:undefined;
  // [학습] Excel 숫자 날짜는 SheetJS로 연·월·일로 해석합니다. 숫자 경로는 아래 문자열 경로와 검증 방식이 다릅니다.
  if(typeof value==="number")return validQty(value)?value:undefined;
  // [학습] 문자열 수량의 천 단위 쉼표를 제거합니다.
  const text=String(value).trim().replace(/,/g,"");
  // [학습] 공통 수량 파서로 개 단위·합산 등의 표현을 처리합니다.
  const parsed=parseQty(text,type);
  // [학습] 공통 파서의 실패 null을 Excel 처리의 오류 값 undefined로 맞춥니다.
  return parsed===null?undefined:parsed;
}
// 날짜 중 하나라도 중복·알 수 없는 상품·잘못된 수량이 있으면 그 날짜 전체를 격리하여 부분 등록 방지.
// [학습] 행 배열, 등록 지점·종료일, 기존 기록·상품 목록을 받아 등록 후보와 검토 결과를 만듭니다. DB에는 쓰지 않습니다.
function analyzeExcelRows(rows,branch,cutoff,existing,products){
  // [학습] 날짜·상품명 셀이 포함된 첫 행을 헤더로 찾습니다. 배열 인덱스는 0부터 시작합니다.
  const headerIndex=rows.findIndex(row=>Array.isArray(row)&&row.includes("날짜")&&row.includes("상품명"));
  // [학습] findIndex 결과 -1은 헤더를 못 찾았다는 뜻입니다.
  if(headerIndex<0)throw new Error("'날짜', '상품명', '오픈재고', '잔여재고' 열을 확인하세요.");
  // [학습] 헤더 셀의 앞뒤 공백을 제거합니다.
  const h=rows[headerIndex].map(x=>String(x??"").trim());
  // [학습] 필수 열 이름이 실제 몇 번째 열에 있는지 기록합니다. 열 순서가 바뀌어도 찾을 수 있습니다.
  const idx=["날짜","상품명","오픈재고","잔여재고"].map(v=>h.indexOf(v));
  // [학습] 필수 열 중 하나라도 없으면 분석을 중단합니다.
  if(idx.some(i=>i<0))throw new Error("필수 열이 누락됐습니다: 날짜/상품명/오픈재고/잔여재고");
  // [학습] days는 날짜별 상품 Map, blocked는 등록 제외 날짜 Set, warnings는 사용자 검토 문구입니다.
  const days=new Map(),blocked=new Set(),warnings=[];
  // [학습] 미기록·중복·범위 밖·수량 오류 등의 처리 건수를 누적합니다. 최종 등록 건수와 같지는 않습니다.
  const counts={source:0,missingOpen:0,missingClose:0,zeroOpen:0,stockout:0,invalid:0,duplicates:0,excludedItems:0,outside:0,badStock:0};

  // [학습] 오류 문구와 건수를 기록하고 날짜를 알 수 있을 때 해당 날짜 전체를 제외합니다. 날짜 자체가 잘못되면 특정 날짜를 격리할 수 없습니다.
  const note=(day,msg)=>{warnings.push(msg);counts.invalid++;if(day)blocked.add(day);};
  // [학습] 헤더 다음 행부터 검사합니다. forEach 콜백의 return은 해당 행만 건너뜁니다.
  rows.slice(headerIndex+1).forEach((row,i)=>{
    // [학습] 사용자에게 보여줄 Excel 행 번호는 1부터 세므로 인덱스를 보정합니다.
    const rowNo=headerIndex+2+i;
    // [학습] 빈 행은 처리하지 않습니다. every는 모든 셀이 빈값인지 검사합니다.
    if(!Array.isArray(row)||row.every(v=>v===null||v===undefined||v===""))return;
    // [학습] 날짜와 상품명을 각각 해석합니다.
    const day=excelDate(row[idx[0]]),raw=cleanName(row[idx[1]]);
    // [학습] 날짜·상품명 오류는 검토 목록에 남깁니다.
    if(!day||!raw){note(day,`${rowNo}행: 날짜/상품명 오류`);return;}
    // [학습] 종료일 이후와 강동점 시작일 이전은 범위 밖으로 건너뜁니다. 표준 날짜 문자열은 사전순으로 날짜 비교가 가능합니다.
    if(day>cutoff||(branch==="강동 본점"&&day<GANGDONG_MIN_DATE)){counts.outside++;return;}
    // [학습] 상품명을 지점별 규칙으로 표준화합니다.
    const mapped=normalizeProduct(raw,branch,products);
    // [학습] 표준화 불가와 확정 제외를 나눠 처리합니다.
    if(!mapped.name){
      // [학습] 확정 제외 상품은 행만 빼고 날짜 전체는 막지 않습니다.
      if(mapped.reason==="확정 제외 상품"){counts.excludedItems++;return;}
      // [학습] 미확정 상품은 날짜 전체를 막고 다음 행으로 넘어갑니다.
      note(day,`${rowNo}행: ${mapped.reason}`);return;
    }
    // [학습] 오픈·마감 수량을 각각 해석합니다.
    const stock=excelQty(row[idx[2]],"stock"),remaining=excelQty(row[idx[3]],"remaining");
    // [학습] 잘못된 수량이면 날짜 전체를 격리합니다. 공란 null은 여기서 오류로 취급하지 않습니다.
    if(stock===undefined||remaining===undefined){counts.badStock++;note(day,`${rowNo}행: 수량 형식 오류 (${raw})`);return;}
    // [학습] 처음 본 날짜면 해당 날짜의 상품 Map을 만듭니다.
    if(!days.has(day))days.set(day,new Map());
    // [학습] 현재 날짜에 모은 상품 목록을 가져옵니다.
    const items=days.get(day);
    // [학습] 같은 날짜에 표준 이름이 중복되면 합산하지 않고 날짜를 격리합니다.
    if(items.has(mapped.name)){counts.duplicates++;note(day,`${rowNo}행: ${mapped.name} 상품명이 중복 표준화됨`);return;}
    // [학습] 정상 형식의 재고와 파생 상태를 날짜별 Map에 추가합니다.
    items.set(mapped.name,{stock,remaining,no_delivery:stock===0,stockout:validQty(stock)&&stock>0&&remaining===0,missing_open:stock===null,missing_close:remaining===null});
    // [학습] 처리된 수량 및 누락 건수를 올립니다. 이후 날짜가 격리되면 이 값과 실제 등록 결과는 다를 수 있습니다.
    counts.source++;if(stock===null)counts.missingOpen++;if(remaining===null)counts.missingClose++;
    // [학습] 오픈 0·마감 0 관측의 건수를 셉니다.
    if(stock===0)counts.zeroOpen++;if(stock>0&&remaining===0)counts.stockout++;
    // [학습] 마감>오픈은 경고를 남기지만 현재 코드는 등록을 막지 않습니다. 집계 단계에서 제외합니다.
    if(stock!==null&&remaining!==null&&remaining>stock)warnings.push(`${rowNo}행: ${mapped.name} 마감 > 오픈 (분석 제외)`);

  });
  // [학습] 날짜와 지점을 합쳐 기존 기록을 찾는 키를 만듭니다. Set으로 중복 날짜 등록을 판별합니다.
  const existingKeys=new Set(existing.map(r=>`${r.date}|||${r.branch}`));
  // [학습] 신규 기록과 기존이라 건너뛴 날짜를 나눠 담습니다.
  const newRecords=[],skipped=[];
  // [학습] 날짜순으로 정렬해 등록 후보를 구성합니다.
  for(const [day,items] of [...days.entries()].sort(([a],[b])=>a.localeCompare(b))){
    // [학습] 품질 오류로 막힌 날짜는 등록 후보에 넣지 않습니다.
    if(blocked.has(day))continue;
    // [학습] Map을 일반 객체로 바꾸고 Excel 출처·마감 관련 메타데이터를 붙입니다.
    const row={date:day,branch,items:Object.fromEntries(items),remaining_source:"엑셀 일괄등록",remaining_time:null,is_estimated_close:false};
    // [학습] 같은 지점·날짜가 있으면 덮어쓰지 않습니다.
    if(existingKeys.has(`${day}|||${branch}`))skipped.push(day);else newRecords.push(row);
  }
  // [학습] 신규 기록 안의 상품명을 펼치고 Set으로 중복을 제거합니다.
  const productNames=[...new Set(newRecords.flatMap(record=>Object.keys(record.items)))];
  // [학습] 화면 미리보기와 실제 등록에 필요한 후보·경고·집계를 반환합니다.
  return {newRecords,skipped,blocked:[...blocked],counts,warnings,productNames};
}

// [학습] 파일 읽기는 시간이 걸리므로 async/await를 씁니다. 이 함수도 실제 DB 저장은 하지 않습니다.
async function readExcel(file,branch,cutoff,records,products){
  // [학습] CDN 라이브러리가 로드되지 않은 상황을 오류로 알립니다.
  if(!window.XLSX)throw new Error("엑셀 라이브러리를 불러오지 못했습니다.");
  // [학습] 사용자가 선택한 파일을 바이너리 데이터 ArrayBuffer로 읽습니다. await는 완료까지 이 함수의 다음 처리를 기다립니다.
  const buffer=await file.arrayBuffer();
  // [학습] SheetJS로 Excel 문서를 해석합니다. cellDates:false이므로 날짜를 주로 숫자로 받습니다.
  const workbook=window.XLSX.read(buffer,{type:"array",cellDates:false});
  // [학습] 재고 데이터 이름의 시트를 우선 사용하고 없으면 첫 시트를 사용합니다.
  const sheet=workbook.Sheets["재고 데이터"]||workbook.Sheets[workbook.SheetNames[0]];
  // [학습] 사용할 시트가 없으면 오류를 발생시킵니다.
  if(!sheet)throw new Error("엑셀 시트가 없습니다.");
  // [학습] header:1은 행 배열, defval:null은 빈 셀 표현, raw:true는 원시값 사용입니다.
  const rows=window.XLSX.utils.sheet_to_json(sheet,{header:1,defval:null,raw:true});
  // [학습] 행 분석 결과에 파일명·등록 조건을 추가합니다. 나중에 조건이 바뀌었는지 확인할 때 사용합니다.
  return {...analyzeExcelRows(rows,branch,cutoff,records,products),filename:file.name,branch,cutoff};
}

// [학습] 이 파일의 함수를 외부에서 import할 수 있도록 공개합니다.
export { excelDate, excelQty, analyzeExcelRows, readExcel };
