-- ============================================================================
-- 시오사쿠 v2 | 쓰기 RPC 2개 "초안" (작성: 팀장 측 / 검토: 팀원 3)
-- 상태: 제안. 팀원 3 검토 전 실행 금지.
--
-- 근거 파일: 01_schema_v3.0_REFERENCE, 16_EWMA_v3.3_PATCH_REFERENCE
--   (03~15번, 17번 SQL이 실제 DB에 실행됐다면 먼저 대조해 주세요)
--
-- 1) bq_apply_closing_report : 오픈 저장 후 들어온 마감 보고를 한 번에 반영 (전부 성공 아니면 전부 취소)
-- 2) bq_reject_inventory     : 잘못 입력된 줄을 반려(rejected) → 판매량·예측에서 제외
--
-- 기존 규칙 그대로: private impl(SECURITY DEFINER) + public 래퍼(SECURITY INVOKER),
--   bq_assert_store_access(...,'editor'), bq.rpc_write / bq.actor_user_id / bq.change_reason 설정으로
--   기존 가드·감사 트리거(bq_guard_daily_inventory, bq_inventory_audit)를 그대로 통과.
--   EXECUTE는 service_role만.
--
-- 팀 결정 (2026-11-04)
--   * 마감 직원이 오픈 txt를 붙여넣고 저장 → 약 1분 뒤 마감 txt를 붙여넣고 저장 (저장 2번)
--   * 마감 "0"·"품절/완판/소진" = 그날 품절 → closing_qty=0 + 원문 라벨
--   * 등록 시 조건이 맞으면 자동 확정(finalize)
--   * 이미 마감이 있는 줄은 덮어쓰지 않음 → 화면이 기존/새 값을 보여주고 bq_correct_inventory로 정정
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) 마감 보고 반영
-- 입력 p_items: [{"raw_line":"오사카 시오빵 / 3개","raw_product_name":"오사카 시오빵",
--                 "closing_qty":3,"raw_quantity_label":null}, ...]
--   closing_qty: 0 이상의 정수. "품절/완판/소진"은 서버가 0으로 바꾸고 raw_quantity_label에 원문을 넣어 보냄.
-- 상품별 처리:
--   applied         오픈 줄이 있고(입고, 오픈 수량 있음) 마감이 비어 있음 → 마감 채움, 조건 맞으면 확정
--   already_closed  이미 마감 있음 → 변경 안 함 (details에 기존/새 값)
--   no_opening      그날 오픈 줄이 없거나 오픈 수량이 없음 → 변경 안 함
--   not_received    미입고 줄 → 변경 안 함 (미입고 줄에는 수량을 넣을 수 없음: CHECK 제약)
--   rejected        반려된 줄 → 변경 안 함
--   unmatched       사전에 없는 상품명 → 원문만 보관
--   invalid_qty     마감 수량이 정수가 아님 → 원문만 보관
-- 반환: 건수 + details(반영되지 않은 상품 목록) + missing_close(오픈은 있는데 마감이 여전히 비어 있는 상품)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.bq_apply_closing_report_impl(
 p_actor_user_id uuid, p_store_code text, p_business_date date,
 p_raw_payload text, p_items jsonb,
 p_source_type text DEFAULT 'kakao', p_source_checksum text DEFAULT NULL, p_finalize boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_store uuid; v_import uuid; v_item jsonb; v_num integer := 0;
 v_name text; v_pid uuid; v_row uuid; v_close integer; v_label text;
 v_inv public.daily_inventory%ROWTYPE; v_reason text; v_status text; v_review text;
 c_applied integer := 0; c_verified integer := 0; c_pending integer := 0; c_unmatched integer := 0;
 c_closed integer := 0; c_noopen integer := 0; c_notrecv integer := 0; c_rejected integer := 0; c_badqty integer := 0;
 v_details jsonb := '[]'::jsonb; v_missing jsonb;
BEGIN
 IF p_business_date IS NULL THEN RAISE EXCEPTION 'business_date required'; END IF;
 IF p_source_type NOT IN ('kakao','excel','manual','other') THEN RAISE EXCEPTION 'Unknown source_type'; END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'items must be a JSON array'; END IF;
 IF NULLIF(pg_catalog.btrim(p_raw_payload),'') IS NULL THEN RAISE EXCEPTION 'Closing report raw_payload required'; END IF;
 SELECT s.store_id INTO v_store FROM public.stores s WHERE s.store_code=p_store_code AND s.is_active;
 IF v_store IS NULL THEN RAISE EXCEPTION 'Unknown or inactive store'; END IF;
 PERFORM public.bq_assert_store_access(p_actor_user_id,v_store,'editor');
 PERFORM pg_catalog.set_config('bq.rpc_write','yes',true);
 PERFORM pg_catalog.set_config('bq.actor_user_id',p_actor_user_id::text,true);
 PERFORM pg_catalog.set_config('bq.change_reason','마감 보고 반영',true);

 INSERT INTO public.data_imports(store_id,business_date,source_type,source_checksum,raw_payload,imported_by)
 VALUES(v_store,p_business_date,p_source_type,p_source_checksum,p_raw_payload,p_actor_user_id)
 RETURNING import_id INTO v_import;

 FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_items) LOOP
   v_num := v_num + 1;
   IF jsonb_typeof(v_item) <> 'object' THEN RAISE EXCEPTION 'Item % is not an object',v_num; END IF;
   v_name  := NULLIF(pg_catalog.btrim(v_item->>'raw_product_name'),'');
   v_pid   := public.bq_resolve_product(v_name);
   v_label := NULLIF(pg_catalog.btrim(v_item->>'raw_quantity_label'),'');
   v_close := CASE WHEN (v_item->>'closing_qty') ~ '^[0-9]+$' THEN (v_item->>'closing_qty')::integer ELSE NULL END;

   INSERT INTO public.data_import_rows(import_id,source_row_number,raw_line,raw_product_name,
     candidate_product_id,match_status,raw_quantity_label,parse_notes)
   VALUES(v_import,v_num,COALESCE(v_item->>'raw_line',v_item::text),v_name,v_pid,
     CASE WHEN v_pid IS NULL THEN 'unmatched' ELSE 'matched' END,v_label,'마감 보고')
   RETURNING source_row_id INTO v_row;

   v_status := NULL; v_reason := NULL; v_inv := NULL;
   IF v_pid IS NULL THEN
     v_status := 'unmatched'; v_reason := '사전에 없는 상품명';
   ELSIF v_close IS NULL THEN
     v_status := 'invalid_qty'; v_reason := '마감 수량이 0 이상의 정수가 아님';
   ELSE
     SELECT * INTO v_inv FROM public.daily_inventory
      WHERE store_id=v_store AND business_date=p_business_date AND product_id=v_pid FOR UPDATE;
     IF NOT FOUND THEN v_status := 'no_opening'; v_reason := '그날 오픈 기록 없음';
     ELSIF v_inv.review_status = 'rejected' THEN v_status := 'rejected'; v_reason := '반려된 기록';
     ELSIF v_inv.receipt_status = 'not_received' THEN v_status := 'not_received'; v_reason := '오픈 보고에 없던 상품(미입고)';
     ELSIF v_inv.closing_qty IS NOT NULL THEN v_status := 'already_closed'; v_reason := '이미 마감 있음';
     ELSIF v_inv.opening_qty IS NULL THEN v_status := 'no_opening'; v_reason := '오픈 수량 없음';
     END IF;
   END IF;

   IF v_status IS NOT NULL THEN
     UPDATE public.data_import_rows
        SET match_status = CASE WHEN v_status='unmatched' THEN 'unmatched'
                                WHEN v_status='invalid_qty' THEN 'ignored' ELSE 'conflict' END,
            parse_notes = '마감 보고: '||v_reason
      WHERE source_row_id=v_row;
     v_details := v_details || jsonb_build_object(
       'row',v_num,'raw_product_name',v_name,'status',v_status,'reason',v_reason,
       'inventory_id',v_inv.inventory_id,'inventory_version',v_inv.inventory_version,
       'existing_closing_qty',v_inv.closing_qty,'new_closing_qty',v_close);
     CASE v_status
       WHEN 'unmatched' THEN c_unmatched := c_unmatched+1;
       WHEN 'invalid_qty' THEN c_badqty := c_badqty+1;
       WHEN 'no_opening' THEN c_noopen := c_noopen+1;
       WHEN 'rejected' THEN c_rejected := c_rejected+1;
       WHEN 'not_received' THEN c_notrecv := c_notrecv+1;
       ELSE c_closed := c_closed+1;
     END CASE;
     CONTINUE;
   END IF;

   -- 반영: 확정 조건(입고·이동 없음·오픈≥마감)이 맞으면 자동 확정, 아니면 검토 대기
   v_review := CASE WHEN p_finalize AND v_inv.receipt_status='received' AND v_inv.movement_status='none'
                         AND v_inv.opening_qty >= v_close THEN 'verified' ELSE 'pending' END;
   UPDATE public.daily_inventory
      SET closing_qty = v_close,
          raw_quantity_label = COALESCE(v_label, raw_quantity_label),
          review_status = v_review
    WHERE inventory_id = v_inv.inventory_id;
   c_applied := c_applied+1;
   IF v_review='verified' THEN c_verified := c_verified+1; ELSE c_pending := c_pending+1; END IF;
 END LOOP;

 -- 오픈은 있는데 마감이 여전히 비어 있는 상품 (직원 기재 누락 확인용)
 SELECT COALESCE(jsonb_agg(p.canonical_name ORDER BY p.product_code),'[]'::jsonb) INTO v_missing
 FROM public.daily_inventory i JOIN public.products p ON p.product_id=i.product_id
 WHERE i.store_id=v_store AND i.business_date=p_business_date
   AND i.receipt_status='received' AND i.closing_qty IS NULL AND i.review_status<>'rejected';

 RETURN jsonb_build_object('import_id',v_import,'rows',v_num,'applied',c_applied,
   'verified',c_verified,'pending',c_pending,'already_closed',c_closed,'no_opening',c_noopen,
   'not_received',c_notrecv,'rejected',c_rejected,'unmatched',c_unmatched,'invalid_qty',c_badqty,
   'details',v_details,'missing_close',v_missing);
END $$;

CREATE OR REPLACE FUNCTION public.bq_apply_closing_report(
 p_actor_user_id uuid, p_store_code text, p_business_date date,
 p_raw_payload text, p_items jsonb,
 p_source_type text DEFAULT 'kakao', p_source_checksum text DEFAULT NULL, p_finalize boolean DEFAULT true
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT private.bq_apply_closing_report_impl($1,$2,$3,$4,$5,$6,$7,$8);
$$;

-- ---------------------------------------------------------------------------
-- 2) 반려
-- 정정(bq_correct_inventory)으로 바꿀 수 없는 실수(날짜·지점·상품 오입력)를 판매량·예측에서 빼기 위함.
-- 반려된 줄은 verified가 아니므로 observed_sales_qty=NULL → EWMA 학습에서 자동 제외.
-- 이력(inventory_revisions)에 revision_type='rejected' + 사유로 남음 (기존 감사 트리거).
-- 참고: 반려된 줄을 bq_correct_inventory로 정정하면 pending으로 돌아감(= 반려 해제). 막아야 하면 알려 주세요.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.bq_reject_inventory_impl(
 p_actor_user_id uuid, p_inventory_id uuid, p_expected_version integer, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_inv public.daily_inventory%ROWTYPE;
BEGIN
 IF p_reason IS NULL OR pg_catalog.btrim(p_reason)='' THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
 SELECT * INTO v_inv FROM public.daily_inventory WHERE inventory_id=p_inventory_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Inventory not found'; END IF;
 PERFORM public.bq_assert_store_access(p_actor_user_id,v_inv.store_id,'editor');
 IF p_expected_version IS NULL OR v_inv.inventory_version <> p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT expected %, actual %',p_expected_version,v_inv.inventory_version
      USING ERRCODE='40001';
 END IF;
 IF v_inv.review_status='rejected' THEN RAISE EXCEPTION 'Already rejected'; END IF;
 PERFORM pg_catalog.set_config('bq.rpc_write','yes',true);
 PERFORM pg_catalog.set_config('bq.actor_user_id',p_actor_user_id::text,true);
 PERFORM pg_catalog.set_config('bq.change_reason','반려: '||pg_catalog.btrim(p_reason),true);
 UPDATE public.daily_inventory SET review_status='rejected'
  WHERE inventory_id=p_inventory_id RETURNING * INTO v_inv;
 RETURN jsonb_build_object('inventory_id',v_inv.inventory_id,'inventory_version',v_inv.inventory_version,
   'review_status',v_inv.review_status,'observed_sales_qty',v_inv.observed_sales_qty);
END $$;

CREATE OR REPLACE FUNCTION public.bq_reject_inventory(
 p_actor_user_id uuid, p_inventory_id uuid, p_expected_version integer, p_reason text
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT private.bq_reject_inventory_impl($1,$2,$3,$4);
$$;

-- ---------------------------------------------------------------------------
-- 권한: 기존 v3.0 방식과 동일 (service_role만 실행)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION private.bq_apply_closing_report_impl(uuid,text,date,text,jsonb,text,text,boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.bq_reject_inventory_impl(uuid,uuid,integer,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.bq_apply_closing_report(uuid,text,date,text,jsonb,text,text,boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.bq_reject_inventory(uuid,uuid,integer,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.bq_apply_closing_report_impl(uuid,text,date,text,jsonb,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION private.bq_reject_inventory_impl(uuid,uuid,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bq_apply_closing_report(uuid,text,date,text,jsonb,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.bq_reject_inventory(uuid,uuid,integer,text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
