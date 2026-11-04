// [학습] React 화면·상태·이벤트 연결. 아래 앞부분은 JavaScript, return 이후는 JSX 화면입니다.
// Babel standalone 진입 파일: import 경로는 index.html을 기준으로 합니다.
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { BRANCHES, ALL, DEFAULT_PRODUCTS } from './frontend/config/catalog.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { normalizeProduct } from './frontend/domain/products.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { isValidDay, localDay } from './frontend/domain/dates.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { fmt, optionalQty } from './frontend/domain/quantity.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { canonicalRecord, safeLegacy, updateReport } from './frontend/domain/inventory.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { summarize } from './frontend/domain/analytics.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { predict } from './frontend/domain/forecasting.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { parseKakao } from './frontend/parsers/kakao.js';
import { inspectReportContext } from './frontend/parsers/reportContext.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { readExcel } from './frontend/parsers/excel.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { loadRecords, loadProducts, addProducts, saveRecord, removeRecord, insertRecordsInBatches } from './frontend/services/inventoryRepository.js';

// [학습] React 객체에서 훅 3개를 꺼냅니다. useState: 상태, useMemo: 계산값 재사용, useEffect: 조회 등 외부 작업 동기화.
const { useState, useMemo, useEffect } = React;

// [학습] 앱의 최상위 컴포넌트입니다. 상태가 갱신되면 함수가 다시 실행되어 새 화면을 계산합니다.
function App(){
  // [학습] [현재값, 변경함수]가 useState 반환 형태입니다. records는 재고 배열, products는 상품 배열, loading은 최초 조회 중 여부입니다.
  const [records,setRecords]=useState([]),[products,setProducts]=useState([]),[loading,setLoading]=useState(true);
  // [학습] 선택 지점과 현재 탭입니다. setBranch/setTab 호출은 다음 렌더링의 값을 바꿉니다.
  const [branch,setBranch]=useState("하남 신세계"),[tab,setTab]=useState("record");
  // [학습] 재고 입력일과 추천 대상일입니다. 초기 추천일은 현재 시각에 24시간을 더한 현지 날짜입니다.
  const [date,setDate]=useState(localDay(new Date())),[recDate,setRecDate]=useState(localDay(new Date(Date.now()+86400000)));
  // [학습] inputs는 상품별 편집값, search는 검색창 문자열입니다. DB 조회 원본과 편집 상태를 분리합니다.
  const [inputs,setInputs]=useState({}),[search,setSearch]=useState("");
  // [학습] 카카오톡 원문·파싱 결과·전체 교체 선택 상태입니다. null은 아직 결과가 없다는 뜻입니다.
  const [paste,setPaste]=useState(""),[parsed,setParsed]=useState(null),[replaceType,setReplaceType]=useState(true);
  // [학습] Excel 등록 지점과 마지막 허용 날짜입니다. 현재 화면의 지점과 별도로 선택할 수 있습니다.
  const [excelBranch,setExcelBranch]=useState("하남 신세계"),[cutoff,setCutoff]=useState(localDay(new Date()));
  // [학습] Excel 미리보기, 열린 입력 모드(kakao/excel/null), 저장 처리 중 여부입니다.
  const [preview,setPreview]=useState(null),[mode,setMode]=useState(null),[busy,setBusy]=useState(false);
  // [학습] 화면에 표시할 오류와 성공 안내문을 저장합니다.
  const [error,setError]=useState(""),[message,setMessage]=useState("");
  // [학습] 선택 날짜·지점과 일치하는 기존 기록을 찾습니다. find는 첫 일치 항목을 반환하며 없으면 null로 둡니다.
  const selected=records.find(r=>r.date===date&&r.branch===branch)||null;
  // [학습] 기존 기록을 표준 상품명으로 바꾼 화면용 복사본입니다. 원본 DB를 자동 수정하지 않습니다.
  const canonicalSelected=selected?canonicalRecord(selected,products):null;
  // [학습] 전체 지점이면 모두, 아니면 선택 지점 기록만 사용합니다. 의존 배열의 branch/records가 바뀌면 재계산합니다.
  const scoped=useMemo(()=>branch===ALL?records:records.filter(r=>r.branch===branch),[branch,records]);
  // [학습] 기본 상품·활성 상품·과거 기록의 상품을 합쳐 입력 표에 사용할 이름 목록을 만듭니다.
  const names=useMemo(()=>{
    // [학습] Set은 같은 이름을 한 번만 보관합니다.
    const result=new Set();
    // [학습] 기본 목록도 현재 지점의 표준화 규칙을 거칩니다.
    for(const name of DEFAULT_PRODUCTS){const mapped=normalizeProduct(name,branch,products);if(mapped.name)result.add(mapped.name);}
    // [학습] DB 상품 목록에서 표준화 가능한 이름을 더합니다.
    for(const p of products){const mapped=normalizeProduct(p.name,branch,products);if(mapped.name)result.add(mapped.name);}
    // [학습] 과거 기록에만 있는 상품도 화면 목록에 포함합니다.
    for(const row of scoped){const c=canonicalRecord(row,products);Object.keys(c.items).forEach(x=>result.add(x));}
    // [학습] Set을 배열로 펼친 뒤 한국어 비교 기준으로 정렬합니다.
    return [...result].sort((a,b)=>a.localeCompare(b,"ko"));
  },[branch,products,scoped]);
  // [학습] 검색어 앞뒤 공백을 제거하고 이름에 포함된 상품만 표에 표시합니다.
  const shownNames=useMemo(()=>names.filter(name=>name.includes(search.trim())),[names,search]);
  // [학습] 선택 범위의 판매·품질 집계를 계산합니다.
  const report=useMemo(()=>summarize(scoped,products),[scoped,products]);
  // [학습] 서로 다른 날짜 수입니다. 전체 지점일 때 같은 날짜를 지점 수만큼 중복 세지 않습니다.
  const dayCount=new Set(scoped.map(r=>r.date)).size;
  // [학습] 지점별로 기존 임시 예측 함수를 호출합니다. 전체 지점에서도 지점별 예측을 먼저 계산합니다.
  const predictions=useMemo(()=>{
    // [학습] 전체 지점 선택이면 모든 실제 지점, 아니면 선택 지점 하나만 대상으로 합니다.
    const targets=branch===ALL?BRANCHES:[branch];
    // [학습] 지점별 기록을 분리해 추천 결과를 만듭니다.
    return targets.map(b=>({branch:b,values:predict(records.filter(r=>r.branch===b),recDate,names,products)}));
  },[records,branch,recDate,names,products]);
  // [학습] 화면에 보여줄 최종 추천값입니다. 개별 지점 결과 또는 지점별 결과의 합입니다.
  const forecast=useMemo(()=>{
    // [학습] 개별 지점이면 첫 번째 지점 결과를 그대로 사용합니다.
    if(branch!==ALL)return predictions[0]?.values||[];
    // [학습] 전체 지점에서는 같은 상품의 각 지점 추천값을 모읍니다.
    return names.map(name=>{
      // [학습] 추천량이 null·undefined인 지점은 미반영으로 제외합니다.
      const items=predictions.map(p=>p.values.find(v=>v.name===name)).filter(v=>v?.qty!==null&&v?.qty!==undefined);
      // [학습] 반영 지점이 있을 때만 합산합니다. 자료 없음은 0이 아니라 null입니다.
      return {name,qty:items.length?items.reduce((s,v)=>s+v.qty,0):null,
        // [학습] 표시용 average도 지점별 값을 합산합니다. 전체 지점의 단일 평균이라는 뜻은 아닙니다.
        average:items.length?items.reduce((s,v)=>s+v.average,0):null,
        // [학습] 전체 모드의 count는 표본 수가 아닌 반영 지점 수입니다. 어느 지점이든 마감 0 빈도가 높으면 태그를 켭니다.
        count:items.length,frequentStockout:items.some(v=>v.frequentStockout)};
    });
  },[branch,predictions,names]);
  // [학습] 저장 후 재고와 상품을 다시 조회해 화면 상태를 최신 DB 결과로 맞춥니다.
  const reload=async()=>{
    // [학습] Promise.all로 독립적인 두 조회를 함께 기다리고 결과를 순서대로 r,p에 받습니다.
    const [r,p]=await Promise.all([loadRecords(),loadProducts()]);setRecords(r);setProducts(p);return r;
  };
  // [학습] 첫 화면 표시 후 데이터를 조회합니다. 빈 의존 배열 []이므로 마운트마다 실행됩니다.
  useEffect(()=>{let mounted=true;
    // [학습] 컴포넌트가 아직 표시 중일 때만 조회 결과를 상태에 반영합니다.
    Promise.all([loadRecords(),loadProducts()]).then(([r,p])=>{if(mounted){setRecords(r);setProducts(p);}})
      // [학습] 초기 조회 실패를 오류 안내로 표시합니다.
      .catch(e=>{if(mounted)setError("DB 로딩 실패: "+e.message);})
      // [학습] 성공·실패와 관계없이 최초 로딩 상태를 끝냅니다.
      .finally(()=>{if(mounted)setLoading(false);});
    // [학습] 화면에서 제거될 때 실행되는 정리 함수입니다. 요청 자체를 취소하지 않고 늦게 온 결과 반영을 막습니다.
    return()=>{mounted=false;};
  },[]);
  // [학습] 선택 날짜·지점·조회 데이터가 바뀌면 입력칸을 기존 기록으로 채웁니다.
  useEffect(()=>{
    // [학습] 새 입력 상태를 구성할 객체입니다.
    const editable={};
    // [학습] ?.는 없는 값 접근을 안전하게 처리합니다. ??는 null·undefined만 빈칸으로 바꾸므로 숫자 0은 유지합니다.
    for(const name of names){const item=canonicalSelected?.items?.[name];editable[name]={stock:item?.stock??"",remaining:item?.remaining??""};}
    // [학습] 새 편집 상태로 화면 입력칸을 갱신합니다.
    setInputs(editable);
  },[date,branch,records,products]);
  // [학습] 저장·삭제 공통 실행 래퍼입니다. 이름과 달리 여러 DB 요청을 원자적으로 묶는 트랜잭션은 아닙니다.
  async function transact(action,success){
    // [학습] 중복 조작을 줄이기 위해 처리 중 상태를 켜고 기존 메시지를 비웁니다.
    setBusy(true);setError("");setMessage("");
    // [학습] 전달받은 작업을 실행하고 재조회한 뒤 성공 메시지를 표시합니다.
    try{await action();await reload();setMessage(success);}
    // [학습] 오류를 표시하고 가능한 한 DB 상태를 다시 읽습니다. 현재 코드는 오류를 다시 throw하지 않는다는 점도 읽어두세요.
    catch(e){setError(e.message||String(e));try{await reload();}catch(_){/* 원래 오류 유지 */}}
    // [학습] 성공·실패 모두 처리 중 상태를 해제합니다.
    finally{setBusy(false);}
  }
  // [학습] 수동 입력 저장 버튼의 처리 함수입니다. 화면 입력값을 검증해 재고 객체로 만든 뒤 저장합니다.
  async function saveManual(){
    try{
      // [학습] 전체 지점에서는 입력·저장하지 않습니다. 개별 지점을 선택해야 합니다.
      if(branch===ALL)throw new Error("지점을 선택하세요.");
      // [학습] 입력 날짜가 실제 날짜인지 확인합니다.
      if(!isValidDay(date))throw new Error("날짜가 올바르지 않습니다.");
      // [학습] 비표준 기존 기록의 원본 보존을 위해 수정 가능 여부를 확인합니다.
      const legacy=safeLegacy(selected,products);if(legacy)throw new Error(legacy);
      // [학습] 깊은 복사로 기존 조회 데이터를 직접 변경하지 않습니다.
      const items=structuredClone(selected?.items||{});
      // [학습] ?.는 없는 값 접근을 안전하게 처리합니다. ??는 null·undefined만 빈칸으로 바꾸므로 숫자 0은 유지합니다.
      for(const name of names){
        // [학습] 현재 상품의 입력값이 없으면 공란 두 개로 취급합니다.
        const entry=inputs[name]||{stock:"",remaining:""};
        // [학습] 문자열 입력을 정수 또는 null로 바꿉니다. 형식 오류면 throw되어 catch로 이동합니다.
        const stock=optionalQty(entry.stock),remaining=optionalQty(entry.remaining);
        // [학습] 양쪽 공란인 상품은 저장 대상에서 제거합니다. 수량 0과는 구분합니다.
        if(stock===null&&remaining===null){delete items[name];continue;}
        // [학습] 기존 상품 속성을 복사하고 이번 오픈·마감 수량으로 덮어씁니다.
        items[name]={...(items[name]||{}),stock,remaining,
          // [학습] 현재 수량으로 미입고·마감 0 상태를 추정합니다.
          no_delivery:stock===0,stockout:stock!==null&&stock>0&&remaining===0,
          // [학습] 오픈·마감이 null인지에 따라 누락 상태를 붙입니다.
          missing_open:stock===null,missing_close:remaining===null};
      }
      // [학습] 저장할 날짜·지점·재고·기존 마감 메타데이터를 구성합니다.
      const changed={date,branch,items,remaining_source:selected?.remaining_source||"직접 입력",
        // [학습] 기존 대체 마감 정보는 수동 입력에서도 유지합니다.
        remaining_time:selected?.remaining_time||null,is_estimated_close:!!selected?.is_estimated_close};
      // [학습] 브라우저 확인창입니다. 취소하면 현재 함수에서 즉시 돌아갑니다.
      if(!window.confirm("이 날짜의 재고 입력값을 저장할까요? 기존 기록의 다른 보고 유형은 유지됩니다."))return;
      // [학습] 함수 자체를 래퍼에 넘겨 나중에 실행하도록 합니다. selected가 있으면 수정, 없으면 신규 저장입니다.
      await transact(()=>saveRecord(changed,selected),"재고 기록이 저장되었습니다.");
    // [학습] 수량 검증 등에서 생긴 예외를 화면 오류 상태에 기록합니다.
    }catch(e){setError(e.message);}
  }
  // [학습] 미리보기에서 확인한 카카오톡 보고를 실제 DB에 반영합니다.
  async function submitKakao(){
    // [학습] 결과가 없거나 검토 오류가 있으면 저장을 시작하지 않습니다.
    if(!parsed||parsed.issues.length)return;
    try{
      // [학습] 전체 지점에서는 입력·저장하지 않습니다. 개별 지점을 선택해야 합니다.
      if(branch===ALL)throw new Error("지점을 먼저 선택하세요.");
      if(parsed.context.selectedBranch!==branch||parsed.context.selectedDate!==date)throw new Error("선택 지점·날짜가 바뀌었습니다. 보고 내용을 다시 확인하세요.");
      // [학습] 파싱한 보고 날짜와 현재 선택 지점의 기존 기록을 찾습니다.
      const existing=records.find(r=>r.date===parsed.date&&r.branch===branch)||null;
      // [학습] 비표준 기존 기록의 원본 보존을 위해 수정 가능 여부를 확인합니다.
      const legacy=safeLegacy(existing,products);if(legacy)throw new Error(legacy);
      // [학습] 전체 교체/부분 반영 방식에 맞는 확인 문구를 만듭니다.
      const note=replaceType?"같은 유형의 이전 수량을 비우고 이번 보고로 대체합니다.":"이번 보고에 포함된 상품만 수정합니다.";
      // [학습] 브라우저 확인창입니다. 취소하면 현재 함수에서 즉시 돌아갑니다.
      if(!window.confirm(`${parsed.context.warnings.join("\n")}\n${parsed.date} ${branch} ${parsed.type==="stock"?"오픈":"마감"} 보고를 저장할까요?\n${note}\n(기존 다른 유형의 재고는 유지)`))return;
      // [학습] 보고 결과에 branch를 추가하고 기존 재고와 합칩니다. 계산 단계에서는 아직 DB 저장을 하지 않습니다.
      const changed=updateReport(existing,{...parsed,branch},replaceType);
      // [학습] 새 상품 후보를 먼저 등록한 뒤 재고를 저장합니다. 두 요청은 하나의 원자적 작업이 아닙니다.
      await transact(async()=>{await addProducts(parsed.newProducts);await saveRecord(changed,existing);},"카카오톡 보고가 반영되었습니다.");
      // [학습] 처리 후 미리보기·원문을 비우고 보고 날짜로 화면을 이동합니다.
      setParsed(null);setPaste("");setDate(changed.date);setMode(null);
    // [학습] 수량 검증 등에서 생긴 예외를 화면 오류 상태에 기록합니다.
    }catch(e){setError(e.message);}
  }
  // [학습] Excel 미리보기의 신규 날짜만 실제 등록합니다.
  async function importExcel(){
    // [학습] 미리보기가 없으면 종료합니다.
    if(!preview)return;
    try{
      // [학습] 미리보기 생성 후 지점·종료일이 바뀌었으면 재검증을 요구합니다.
      if(preview.branch!==excelBranch||preview.cutoff!==cutoff)throw new Error("지점·기간이 바뀌었습니다. 파일을 다시 확인하세요.");
      // [학습] 등록할 후보 날짜가 없으면 중단합니다.
      if(!preview.newRecords.length)throw new Error("등록할 신규 날짜가 없습니다.");
      // [학습] 브라우저 확인창입니다. 취소하면 현재 함수에서 즉시 돌아갑니다.
      if(!window.confirm(`${preview.newRecords.length}일치 등록. 중복 날짜 ${preview.skipped.length}일, 검토 제외 날짜 ${preview.blocked.length}일.\n기존 자료는 절대 덮어쓰지 않습니다. 계속할까요?`))return;
      // [학습] 실제 등록 절차를 공통 래퍼 안에서 수행합니다.
      await transact(async()=>{
        // [학습] 등록 직전에 DB를 다시 읽어 이미 생긴 날짜를 한 번 더 걸러냅니다. 동시 요청을 완전히 막는 DB 제약을 대신하지는 않습니다.
        const fresh=await loadRecords();const keys=new Set(fresh.map(r=>`${r.date}|${r.branch}`));
        // [학습] 최신 DB에 없는 날짜·지점만 저장 후보로 남깁니다.
        const toInsert=preview.newRecords.filter(r=>!keys.has(`${r.date}|${r.branch}`));
        // [학습] 현재 상품 상태에 없는 상품명을 골라 신규 등록합니다.
        const freshNames=preview.productNames.filter(n=>!products.some(p=>p.name===n));
        // [학습] 상품을 먼저 등록합니다.
        await addProducts(freshNames);
        // [학습] DB 모듈에서 최대 30개씩 순차 저장합니다. 화면 파일에는 DB 호출문을 직접 두지 않습니다.
        await insertRecordsInBatches(toInsert);
      },"엑셀 신규 기록을 등록했습니다. 기존 날짜는 보존했습니다.");
      // [학습] 미리보기와 업로드 패널을 닫습니다.
      setPreview(null);setMode(null);
    // [학습] 수량 검증 등에서 생긴 예외를 화면 오류 상태에 기록합니다.
    }catch(e){setError(e.message);}
  }
  // [학습] 현재 선택 기록을 사용자 확인 후 삭제합니다.
  async function deleteCurrent(){
    // [학습] 기록이 없거나 삭제 확인을 취소하면 종료합니다.
    if(!selected||!window.confirm(`${date} ${branch} 기록 전체를 정말 삭제할까요? 복구 기능은 없습니다.`))return;
    // [학습] 기존 수정 시각 조건을 포함한 삭제 요청 후 화면을 재조회합니다.
    await transact(()=>removeRecord(selected),"기록이 삭제되었습니다.");
  }
  // [학습] JSX는 화면 구조를 표현합니다. 로딩 중이면 아래 전체 화면 대신 로딩 안내만 반환합니다.
  if(loading)return <div className="wrap"><div className="panel">DB를 불러오는 중입니다…</div></div>;
  // [학습] <>...</>는 Fragment입니다. 불필요한 HTML 요소를 추가하지 않고 여러 요소를 묶습니다.
  return <>
    {/* [학습] 상단 제목·지점 선택입니다. JSX에서는 class 대신 className, 스타일은 style={{속성:값}} 객체를 씁니다. */}
    <header className="hero">
      <h1>🍞 시오사쿠 재고관리</h1>
      <div className="muted-hero">오픈재고 − 마감재고 기반 관측 판매량 · DB {records.length}건 · 선택 {branch===ALL?"전체 지점":branch}</div>
      <div className="row" style={{marginTop:11}}>
        {/* [학습] value=branch는 현재 선택값, onChange는 변경 이벤트입니다. e.target.value를 상태에 저장하고 이전 업로드 결과를 초기화합니다. */}
        <select className="control grow" value={branch} disabled={busy} onChange={e=>{setBranch(e.target.value);setMode(null);setPreview(null);setParsed(null);setError("");setExcelBranch(e.target.value===ALL?"하남 신세계":e.target.value);}}>
          {BRANCHES.map(b=><option key={b}>{b}</option>)}<option>{ALL}</option>
        </select>
        <button className="btn secondary small" onClick={()=>transact(async()=>{},"최신 DB를 불러왔습니다.")} disabled={busy}>⟳ 새로고침</button>
      </div>
    </header>
    {/* [학습] 탭 배열을 map으로 버튼 목록으로 만듭니다. key는 각 버튼을 구분하는 React 식별자입니다. */}
    <nav className="nav">
      {[["record","📋 재고 기록"],["stats","📊 판매 분석"],["forecast","🧮 입고 추천"]].map(([k,label])=><button key={k} className={tab===k?"active":""} onClick={()=>{setTab(k);setError("");}}>{label}</button>)}
    </nav>
    {/* [학습] 조건 && 요소는 조건이 참일 때만 표시합니다. 조건 ? A : B는 둘 중 하나를 표시합니다. */}
    <main className="wrap">
      {error&&<div className="notice error">⚠️ {error}</div>}
      {message&&<div className="notice good">✅ {message}</div>}
      {/* [학습] 재고 탭에서 개별 지점을 골랐을 때 입력 화면을 표시합니다. 전체 지점이면 안내만 보여줍니다. */}
      {tab==="record"&&(branch===ALL?<section className="panel"><h2>지점을 선택해 주세요.</h2>전체 지점 화면은 통계와 예측 조회 전용입니다.</section>:<>
        <section className="panel">
          <h2>날짜별 재고 입력</h2>
          <div className="row" style={{marginBottom:10}}>
            <input className="control" type="date" value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/>
            <button className="btn secondary small" onClick={()=>{setMode(mode==="kakao"?null:"kakao");setParsed(null);}}>💬 카카오톡 붙여넣기</button>
            <button className="btn secondary small" onClick={()=>{setMode(mode==="excel"?null:"excel");setPreview(null);}}>📗 엑셀 등록</button>
            {selected&&<button className="btn red small" disabled={busy} onClick={deleteCurrent}>기록 삭제</button>}
          </div>
          <div className="subtle">수정 전 원본은 자동 마이그레이션하지 않습니다. 강동점 기존 자료에 비표준 상품명이 있으면 수정을 중단하고 검토를 요청합니다.</div>
          {selected?.is_estimated_close&&<div className="notice" style={{marginTop:10}}>17시 재고를 마감 대체자료로 저장한 날짜입니다. 판매량 통계와 입고 추천 학습에서 제외됩니다.</div>}
          {canonicalSelected&&(canonicalSelected.quality.skipped||canonicalSelected.quality.collisions)>0&&
            <div className="notice">기존 데이터에 검토 필요 항목이 있습니다: 미확정/제외 {canonicalSelected.quality.skipped}개 · 별칭 충돌 {canonicalSelected.quality.collisions}개. DB의 원본 수량은 자동 변경하지 않습니다.</div>}
          <div className="row" style={{margin:"12px 0 10px"}}>
            <input className="control grow" placeholder="상품명 검색" value={search} onChange={e=>setSearch(e.target.value)}/>
            <span className="subtle">{shownNames.length}개 상품</span>
          </div>
          {/* [학습] 상품 목록을 map으로 행으로 만듭니다. 입력칸 value와 onChange를 상태에 연결하므로 편집값이 React에 보관됩니다. */}
          <div className="tablebox"><table className="data"><thead><tr><th>상품명</th><th>오픈</th><th>마감</th><th>판매량</th></tr></thead><tbody>
            {shownNames.map(name=>{
              const s=inputs[name]?.stock??"",r=inputs[name]?.remaining??"";
              let sold="–";
              try{const ss=optionalQty(s),rr=optionalQty(r);if(ss!==null&&rr!==null&&rr<=ss&&ss>0)sold=ss-rr;}catch(e){/* 입력값 검증은 저장 시 노출 */}
              return <tr key={name}><td>{name}</td>
                {/* [학습] setInputs(prev=>...)는 직전 상태를 받습니다. ...prev는 다른 상품을, ...prev[name]은 같은 상품의 다른 수량을 보존하며 [field]만 바꿉니다. */}
                {[["stock",s],["remaining",r]].map(([field,val])=><td key={field}><input type="number" min="0" step="1" value={val} disabled={busy} placeholder="–" onChange={e=>setInputs(prev=>({...prev,[name]:{...prev[name],[field]:e.target.value}}))}/></td>)}
                <td className="num">{sold}</td></tr>;
            })}
          </tbody></table></div>
          {/* [학습] onClick에는 saveManual 함수를 전달합니다. disabled=busy이면 처리 중 클릭이 막힙니다. 중괄호 안에는 JS 표현식을 넣습니다. */}
          <button className="btn full" style={{marginTop:12}} onClick={saveManual} disabled={busy}>{busy?"처리 중…":"💾 이 날짜 재고 저장"}</button>
          <p className="smallprint">공란은 미기록이며 0과 다릅니다. 오픈 0(미입고), 마감 누락, 마감 &gt; 오픈은 판매량 분석에서 제외합니다. 잔여재고를 폐기량으로 간주하지 않습니다.</p>
        </section>
        {/* [학습] 카카오톡 원문 입력→보고 내용 확인→오류/미리보기→저장 순서입니다. 원문을 바꾸면 이전 파싱 결과를 지웁니다. */}
        {mode==="kakao"&&<section className="panel">
          <h2>💬 카카오톡 재고 보고 파싱</h2>
          <p className="subtle">한 번에 오픈 또는 마감 보고 하나만 입력해 주세요. 날짜가 없으면 위에서 선택한 날짜를 사용하되 확인을 요청합니다.</p>
          {/* [학습] 입력한 원문은 paste 상태에 저장합니다. 원문을 수정하면 이전 파싱 결과 parsed를 null로 초기화합니다. */}
          <textarea className="control" style={{width:"100%",minHeight:138}} value={paste} onChange={e=>{setPaste(e.target.value);setParsed(null);}} placeholder={"10월 15일 오픈\n오사카 시오빵 / 40+20개\n두바이 시오빵 / 15개"}/>
          {/* [학습] 버튼을 누르면 parseKakao 결과를 상태에 저장합니다. 빈 원문이거나 처리 중이면 버튼을 비활성화합니다. */}
          <button className="btn full" style={{marginTop:8}} onClick={()=>{const result=parseKakao(paste,branch,products,date);const context=inspectReportContext(paste,branch,date,result.date);setParsed({...result,context,issues:[...result.issues,...context.issues]});setError("");}} disabled={!paste.trim()||busy}>보고 내용 확인</button>
          {/* [학습] 해석 결과가 존재할 때 날짜·보고 유형·품목 수와 검토 내용을 표시합니다. */}
          {parsed&&<div style={{marginTop:12}}>
            <div className="subtle">저장 지점: {parsed.context.selectedBranch}</div>
            {parsed.context.warnings.length>0&&<div className="notice">{parsed.context.warnings.join("\n")} 선택값 또는 본문을 수정하거나, 저장 확인창에서 이 내용을 확인하세요.</div>}
            <div className="tags"><span className="tag">{parsed.date||"날짜 오류"}</span><span className="tag">{parsed.type==="stock"?"오픈":parsed.type==="remaining"?"마감":"유형 오류"}</span><span className="tag">{Object.keys(parsed.items).length}개 품목</span></div>
            {parsed.usedFallback&&<div className="notice" style={{marginTop:10}}>⚠️ 메시지에 날짜가 없어 선택 날짜({parsed.date})를 사용했습니다. 맞는지 확인하세요.</div>}
            {parsed.estimated&&<div className="notice">17시 중간 재고입니다. 정상 마감과 구분하며 판매량/예측에서는 제외합니다.</div>}
            {/* [학습] 오류가 있으면 안내만, 없으면 확인 목록과 저장 버튼을 표시합니다. join은 배열 문구를 줄바꿈으로 연결합니다. */}
            {parsed.issues.length>0?<div className="notice error" style={{marginTop:10}}>{parsed.issues.join("\n")}</div>:<>
              <div style={{marginTop:10}}>{Object.entries(parsed.items).map(([name,qty])=><div key={name} className="summaryline"><span>{name}</span><b>{qty}개</b></div>)}</div>
              {/* [학습] 체크박스는 value 대신 checked로 선택 상태를 연결합니다. e.target.checked는 true/false입니다. */}
              <label style={{display:"block",marginTop:10}}><input type="checkbox" checked={replaceType} onChange={e=>setReplaceType(e.target.checked)}/> <b>전체 보고를 최신판으로 교체</b></label>
              <p className="smallprint">체크: 이번 보고에 없는 상품의 같은 유형 재고값은 공란으로 변경. 해제: 입력된 상품 수량만 수정. 오픈과 마감은 서로 덮어쓰지 않음.</p>
              <button className="btn green full" disabled={busy} onClick={submitKakao}>확인한 보고 DB에 반영</button>
            </>}
          </div>}
        </section>}
        {/* [학습] Excel 파일 선택 후 readExcel로 미리보기를 만듭니다. 지점·종료일 변경 시 미리보기를 초기화합니다. */}
        {mode==="excel"&&<section className="panel">
          <h2>📗 엑셀 일괄 등록</h2>
          <div className="grid-fields">
            <div className="field"><label>등록 지점</label><select className="control" value={excelBranch} onChange={e=>{setExcelBranch(e.target.value);setPreview(null);}}>{BRANCHES.map(x=><option key={x}>{x}</option>)}</select></div>
            <div className="field"><label>마지막 등록 날짜</label><input type="date" className="control" value={cutoff} onChange={e=>{setCutoff(e.target.value);setPreview(null);}}/></div>
          </div>
          <p className="subtle">필수 열: 날짜 · 상품명 · 오픈재고 · 잔여재고. 날짜는 연도가 포함되어야 합니다. 기존 날짜는 덮어쓰지 않습니다.</p>
          {/* [학습] label을 클릭하면 내부 파일 입력창이 열립니다. accept는 파일 선택 힌트이며 보안 검증은 아닙니다. */}
          <label className="fileinput">엑셀 파일 선택 (.xlsx, .xls)
            <input hidden type="file" accept=".xlsx,.xls" disabled={busy} onChange={async e=>{
              const file=e.target.files?.[0];if(!file)return;
              setPreview(null);setError("");
              try{setPreview(await readExcel(file,excelBranch,cutoff,records,products));}
              catch(err){setError("엑셀 검증 실패: "+err.message);}finally{e.target.value="";}
            }}/>
          </label>
          {/* [학습] 파일 분석 결과가 있을 때만 미리보기와 신규 등록 버튼을 표시합니다. 미리보기 단계는 아직 저장 전입니다. */}
          {preview&&<div style={{marginTop:14}}>
            <h3>등록 전 검증 · {preview.filename}</h3>
            <div className="metrics"><div className="metric"><strong>{preview.newRecords.length}</strong><span>신규 등록 날짜</span></div><div className="metric"><strong>{preview.skipped.length}</strong><span>기존 날짜 건너뜀</span></div><div className="metric"><strong>{preview.blocked.length}</strong><span>품질 문제로 격리한 날짜</span></div><div className="metric"><strong>{preview.counts.duplicates}</strong><span>중복 상품 행</span></div></div>
            <div className="subtle" style={{marginTop:9}}>오픈 공란 {preview.counts.missingOpen} · 마감 공란 {preview.counts.missingClose} · 오픈 0 {preview.counts.zeroOpen} · 확정 제외 품목 {preview.counts.excludedItems} · 범위 외 {preview.counts.outside} · 수량 오류 {preview.counts.badStock}</div>
            {preview.warnings.length>0&&<div className="notice" style={{marginTop:10}}>검토 내용 ({preview.warnings.length}건)\n{preview.warnings.slice(0,10).join("\n")}{preview.warnings.length>10?"\n…추가 내용 생략":""}</div>}
            <button className="btn green full" style={{marginTop:10}} disabled={busy||!preview.newRecords.length} onClick={importExcel}>기존 날짜 보존 · 신규 {preview.newRecords.length}일 DB 등록</button>
          </div>}
        </section>}
      </>)}
      {/* [학습] 판매 분석 화면입니다. report 집계 결과를 지표·지점 비교·상품 순위·평일/주말 평균·마감 0 비율로 표시합니다. */}
      {tab==="stats"&&<>
        <section className="panel">
          <h2>📊 판매 분석 · 데이터 품질</h2>
          <p className="subtle">판매량 = 오픈재고 − 마감재고. 두 수량이 정상적으로 보고된 상품·일만 집계했습니다. 공휴일 별도 분류는 적용되지 않았습니다.</p>
          <div className="metrics">
            <div className="metric"><strong>{dayCount}</strong><span>보고 날짜 (지점별 날짜 합산 아님)</span></div>
            <div className="metric"><strong>{fmt(report.quality.normal)}</strong><span>유효 상품·일</span></div>
            <div className="metric"><strong>{fmt(report.quality.missingOpen+report.quality.missingClose)}</strong><span>오픈·마감 누락</span></div>
            <div className="metric"><strong>{fmt(report.quality.invalid+report.quality.estimated+report.quality.collisions)}</strong><span>이상·대체·충돌</span></div>
          </div>
          <div className="subtle" style={{marginTop:8}}>오픈 0/미입고 {report.quality.noDelivery} · 매핑 미확정/제외 {report.quality.unmapped} · 상품명 충돌 {report.quality.collisions}. 유효 여부는 상품·일 단위로 판단합니다.</div>
        </section>
        {branch===ALL&&<section className="panel"><h2>🏬 지점별 관측 실적</h2><p className="subtle">지점마다 보고 기간과 입고 품목이 다르므로 누적 수량만으로 성과를 비교하지 마세요.</p>
          {BRANCHES.map(b=>{const v=report.byBranch.find(x=>x.name===b);return <div className="summaryline" key={b}><b>{b}</b><span>{v?`${v.days}일 · 판매 ${fmt(v.sales)}개 · 유효 상품·일 ${v.valid}`:"자료 없음"}</span></div>;})}</section>}
        <section className="panel"><h2>🥇 상품별 관측 판매량</h2>
          {report.byProduct.length===0?<p>정상적인 오픈·마감 기록이 부족합니다.</p>:report.byProduct.slice(0,30).map((p,i)=><div key={p.name} style={{marginBottom:11}}>
            <div className="summaryline" style={{border:0,padding:"2px 0"}}><span>{i+1}. {p.name}</span><b>{fmt(p.total)}개 <span className="subtle">/ 유효 {p.days}일</span></b></div>
            <div className="bar"><i style={{width:`${100*p.total/(report.byProduct[0]?.total||1)}%`}}/></div></div>)}
        </section>
        <section className="panel"><h2>📅 평일·주말 평균 관측 판매량</h2>
          <p className="subtle">각 상품의 오픈재고 &gt; 0이고 마감재고가 정상인 관측일만 분모에 포함합니다. 토·일만 주말로 분류합니다.</p>
          {/* [학습] 상품 목록을 map으로 행으로 만듭니다. 입력칸 value와 onChange를 상태에 연결하므로 편집값이 React에 보관됩니다. */}
          <div className="tablebox"><table className="data"><thead><tr><th>상품</th><th>평일 평균</th><th>주말 평균</th><th>평일 표본</th><th>주말 표본</th></tr></thead><tbody>
            {report.byProduct.map(p=><tr key={p.name}><td>{p.name}</td><td>{p.wkN?(p.wkTotal/p.wkN).toFixed(1):"–"}</td><td>{p.weN?(p.weTotal/p.weN).toFixed(1):"–"}</td><td>{p.wkN}</td><td>{p.weN}</td></tr>)}
          </tbody></table></div>
        </section>
        <section className="panel"><h2>⚠️ 품절 이력 (관측)</h2><p className="subtle">마감 0은 품절 의심 기록입니다. 품절 시각·실제 미충족 수요는 알 수 없습니다.</p>
          {report.byProduct.filter(p=>p.stockouts>0).sort((a,b)=>b.stockouts/b.days-a.stockouts/a.days).slice(0,15).map(p=><div className="summaryline" key={p.name}><span>{p.name}</span><b>{p.stockouts}/{p.days}일 ({(p.stockouts/p.days*100).toFixed(0)}%)</b></div>)}
        </section>
      </>}
      {/* [학습] 추천 화면입니다. 추천 날짜를 바꾸면 관련 useMemo가 다시 계산하며 자료 없는 상품은 목록에서 제외합니다. */}
      {tab==="forecast"&&<section className="panel">
        <h2>🧮 동일 요일 기반 입고 추천 (참고용)</h2>
        <div className="row"><label>추천 대상 날짜 <input type="date" className="control" value={recDate} onChange={e=>setRecDate(e.target.value)}/></label></div>
        <div className="notice" style={{marginTop:12}}>예측 입력값은 관측 판매량(오픈 − 마감)입니다. 상품별 최근 같은 요일의 유효 관측치를 최대 8개 사용하고, 최근 4개에 가중치 2를 적용합니다. 평일 +10%, 주말 +15% 여유분 및 최근 표본의 마감 0 비율이 50% 이상이면 추가 +10%를 적용합니다. 이는 임시 운영 규칙이며 검증된 최적 발주량이 아닙니다.</div>
        {branch===ALL&&<p className="subtle">전체 지점은 지점별 추천량을 단순 합산합니다. 자료가 없는 지점은 0이 아니라 미반영으로 처리합니다.</p>}
        {forecast.filter(p=>p.qty!==null).length===0?<p>해당 요일에 사용할 수 있는 과거 재고 자료가 없습니다.</p>:<>
          {forecast.filter(p=>p.qty!==null).sort((a,b)=>b.qty-a.qty).map(p=><div className="summaryline" key={p.name}><div><b>{p.name}</b>{p.frequentStockout&&<span className="tag" style={{marginLeft:7}}>마감 0 잦음</span>}{branch!==ALL&&p.count<3&&<span className="tag" style={{marginLeft:5}}>표본 적음</span>}<div className="subtle">가중평균 판매 {p.average?.toFixed(1)}개 · {branch===ALL?`${p.count}/${BRANCHES.length}지점 반영`:`표본 ${p.count}개`}</div></div><strong style={{fontSize:18,color:"#783e20"}}>{p.qty}개</strong></div>)}
        </>}
        <p className="smallprint">입고 추천은 수요 확정치가 아닙니다. 영업 중 추가 입고·폐기·이동 정보가 없으므로 관측 판매량의 한계를 함께 고려해야 합니다.</p>
      </section>}
      <div className="smallprint" style={{textAlign:"center",marginTop:22}}>시오사쿠 재고관리 v2 · 강동점 표준화 · 데이터 품질 검증 · 기존 Supabase 스키마 호환<br/>운영 배포 전 데이터 백업, 계정 권한, RLS 정책 및 실제 지점 테스트가 필요합니다.</div>
    </main>
  </>;
}

// [학습] HTML의 root 요소를 찾아 App 컴포넌트를 표시하며 앱을 시작합니다.
ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
