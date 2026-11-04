-- ============================================================================
-- 시오사쿠 v2 | 읽기 전용 RPC 3개 "초안" (작성: 팀장 측 / 검토: 팀원 3)
-- 상태: 제안. 팀원 3 검토 전 실행 금지.
--
-- 근거 파일: 01_schema_v3.0_REFERENCE, 16_EWMA_v3.3_PATCH_REFERENCE
--   * 위 두 파일 이외의 SQL(03~15번, 17번 등)이 실제 DB에 실행됐다면 테이블·칼럼이 달라졌을 수 있으니
--     먼저 대조해 주세요.
--
-- 기존 함수와 같은 규칙을 따릅니다.
--   * 실제 구현은 private 스키마(SECURITY DEFINER), 공개 이름은 public 래퍼(SECURITY INVOKER)
--   * 모든 함수가 p_actor_user_id + public.bq_assert_store_access(...,'viewer')로 권한 확인
--   * EXECUTE 권한은 service_role에만. anon/authenticated는 실행 불가
--   * 테이블 직접 SELECT 권한은 새로 주지 않음
--
-- 서버 연결 주소 (backend/routes.mjs)
--   GET /api/me                                   → bq_list_my_stores
--   GET /api/stores/:code/inventory-range?from&to → bq_get_inventory_range
--   GET /api/stores/:code/forecasts?date          → bq_get_forecast_results
--
-- 팀원 3이 정해 주셔야 할 것 (초안의 임시 선택)
--   [A] bq_get_forecast_results: 같은 예측일에 실행이 여러 번 있으면 "가장 최근 operational 실행 1건"을 반환
--       (05_개발팀_조회전용_점검.sql 3번 쿼리와 같은 기준: created_at DESC, run_id DESC)
--   [B] bq_get_inventory_range: 한 번에 최대 400일. rejected 기록도 포함해 반환(화면에서 품질 집계에 사용)
--   [C] bq_list_my_stores: is_active=true 지점만 반환
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- G3. 내가 접근할 수 있는 지점 목록
-- 반환: [{store_code, display_name, access_role}]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.bq_list_my_stores_impl(p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF p_actor_user_id IS NULL THEN RAISE EXCEPTION 'Authenticated user id required'; END IF;
 RETURN COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
            'store_code',s.store_code,'display_name',s.display_name,'access_role',a.access_role)
          ORDER BY s.store_code)
   FROM public.user_store_access a
   JOIN public.stores s ON s.store_id=a.store_id
   WHERE a.user_id=p_actor_user_id AND s.is_active), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.bq_list_my_stores(p_actor_user_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT private.bq_list_my_stores_impl($1);
$$;

-- ---------------------------------------------------------------------------
-- G2. 기간 재고 (판매 분석용). bq_get_inventory_items와 같은 칼럼 + business_date, product_code
-- 반환: {store_code, from, to, items:[...]}
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.bq_get_inventory_range_impl(
 p_actor_user_id uuid, p_store_code text, p_from date, p_to date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_store public.stores%ROWTYPE; v_items jsonb;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Valid date range required'; END IF;
 IF p_to - p_from > 400 THEN RAISE EXCEPTION 'Range too long (max 400 days)'; END IF;   -- [B]
 SELECT * INTO v_store FROM public.stores WHERE store_code=p_store_code;
 IF NOT FOUND THEN RAISE EXCEPTION 'Store not found'; END IF;
 PERFORM public.bq_assert_store_access(p_actor_user_id,v_store.store_id,'viewer');
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'business_date',i.business_date,'inventory_id',i.inventory_id,
      'inventory_version',i.inventory_version,'product_id',p.product_id,
      'product_code',p.product_code,'name',p.canonical_name,
      'opening_qty',i.opening_qty,'closing_qty',i.closing_qty,
      'receipt_status',i.receipt_status,'movement_status',i.movement_status,
      'review_status',i.review_status,'observed_sales_qty',i.observed_sales_qty)
      ORDER BY i.business_date,p.product_code),'[]'::jsonb)
 INTO v_items
 FROM public.daily_inventory i
 JOIN public.products p ON p.product_id=i.product_id
 WHERE i.store_id=v_store.store_id AND i.business_date BETWEEN p_from AND p_to;
 RETURN jsonb_build_object('store_code',v_store.store_code,'from',p_from,'to',p_to,'items',v_items);
END $$;

CREATE OR REPLACE FUNCTION public.bq_get_inventory_range(
 p_actor_user_id uuid, p_store_code text, p_from date, p_to date
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT private.bq_get_inventory_range_impl($1,$2,$3,$4);
$$;

-- ---------------------------------------------------------------------------
-- G1. 예측일의 최근 operational 실행 결과
-- 반환: {run: {...} | null, items:[{product_id, product_code, product_name, day_type, alpha_used,
--        history_count, closing_zero_observations, predicted_demand_qty, forecast_status}]}
-- closing_zero_observations: v3.3 패치의 forecast_observations.closing_qty_zero_at_run=true 개수
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.bq_get_forecast_results_impl(
 p_actor_user_id uuid, p_store_code text, p_forecast_date date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_store uuid; v_run public.forecast_runs%ROWTYPE; v_items jsonb;
BEGIN
 IF p_forecast_date IS NULL THEN RAISE EXCEPTION 'forecast_date required'; END IF;
 SELECT store_id INTO v_store FROM public.stores WHERE store_code=p_store_code;
 IF v_store IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
 PERFORM public.bq_assert_store_access(p_actor_user_id,v_store,'viewer');

 SELECT * INTO v_run FROM public.forecast_runs r
 WHERE r.store_id=v_store AND r.forecast_date=p_forecast_date AND r.model_profile='operational'
 ORDER BY r.created_at DESC, r.run_id DESC LIMIT 1;                                         -- [A]
 IF NOT FOUND THEN
   RETURN jsonb_build_object('store_code',p_store_code,'forecast_date',p_forecast_date,'run',NULL,'items','[]'::jsonb);
 END IF;

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
     'product_id',p.product_id,'product_code',p.product_code,'product_name',p.canonical_name,
     'day_type',df.day_type,'alpha_used',df.alpha_used,'history_count',df.history_count,
     'closing_zero_observations',(SELECT count(*) FROM public.forecast_observations o
         WHERE o.run_id=df.run_id AND o.product_id=df.product_id AND o.closing_qty_zero_at_run),
     'predicted_demand_qty',df.predicted_demand_qty,'forecast_status',df.forecast_status)
   ORDER BY p.product_code),'[]'::jsonb)
 INTO v_items
 FROM public.demand_forecasts df JOIN public.products p ON p.product_id=df.product_id
 WHERE df.run_id=v_run.run_id;

 RETURN jsonb_build_object('store_code',p_store_code,'forecast_date',p_forecast_date,
   'run',jsonb_build_object('run_id',v_run.run_id,'model_version',v_run.model_version,
     'model_profile',v_run.model_profile,'day_type',v_run.forecast_day_type,
     'min_history',v_run.min_history,'data_cutoff_at',v_run.data_cutoff_at,'created_at',v_run.created_at),
   'items',v_items);
END $$;

CREATE OR REPLACE FUNCTION public.bq_get_forecast_results(
 p_actor_user_id uuid, p_store_code text, p_forecast_date date
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT private.bq_get_forecast_results_impl($1,$2,$3);
$$;

-- ---------------------------------------------------------------------------
-- 권한: 기존 v3.0 방식과 동일 (service_role만 실행)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION private.bq_list_my_stores_impl(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.bq_get_inventory_range_impl(uuid,text,date,date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.bq_get_forecast_results_impl(uuid,text,date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.bq_list_my_stores(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.bq_get_inventory_range(uuid,text,date,date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.bq_get_forecast_results(uuid,text,date) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION private.bq_list_my_stores_impl(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.bq_get_inventory_range_impl(uuid,text,date,date) TO service_role;
GRANT EXECUTE ON FUNCTION private.bq_get_forecast_results_impl(uuid,text,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.bq_list_my_stores(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bq_get_inventory_range(uuid,text,date,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.bq_get_forecast_results(uuid,text,date) TO service_role;

-- PostgREST가 새 함수를 인식하도록 스키마 캐시 새로고침
NOTIFY pgrst, 'reload schema';
COMMIT;
