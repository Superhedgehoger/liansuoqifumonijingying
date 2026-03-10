import React, { useState, useEffect, useMemo } from 'react';
import { StateContext } from '../context';
import { ScenarioCompareResult, SiteRecommendation } from '../types';
import {
  apiGetSiteRecommendations,
  apiCompareScenarios,
  apiSuggestBiActions,
  apiBacktestBiActions,
  apiApplyBiActions,
  apiPreviewRollbackBiActions,
  apiRollbackBiActions,
} from '../services/api';

const StrategyPage = () => {
  const { state, dispatch } = React.useContext(StateContext);
  const [topK, setTopK] = useState(10);
  const [radius, setRadius] = useState(15);
  const [distanceMode, setDistanceMode] = useState<'euclidean' | 'road_proxy' | 'road_graph'>('road_proxy');
  const [graphNeighbors, setGraphNeighbors] = useState(3);
  const [loadingRec, setLoadingRec] = useState(false);
  const [recRows, setRecRows] = useState<SiteRecommendation[]>([]);

  const stores = useMemo(() => (state.stores || []).filter((s) => s.status === 'open'), [state.stores]);
  const defaultStore = stores[0]?.store_id || '';

  const [selectedStoreId, setSelectedStoreId] = useState(defaultStore);
  const selectedStore = useMemo(() => stores.find((s) => s.store_id === selectedStoreId), [stores, selectedStoreId]);
  const [days, setDays] = useState(30);
  const [seed, setSeed] = useState<number>(state.events?.rng_seed ?? 20260101);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareResult, setCompareResult] = useState<ScenarioCompareResult | null>(null);

  const [scenarioAComp, setScenarioAComp] = useState(0.4);
  const [scenarioAAttr, setScenarioAAttr] = useState(1.0);
  const [scenarioAConv, setScenarioAConv] = useState(1.0);
  const [scenarioBComp, setScenarioBComp] = useState(0.2);
  const [scenarioBAttr, setScenarioBAttr] = useState(1.1);
  const [scenarioBConv, setScenarioBConv] = useState(1.05);

  const [mitigationDraft, setMitigationDraft] = useState<any>({});
  const [autoReplenEnabled, setAutoReplenEnabled] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<any>({ sku: '', reorder_point: 50, safety_stock: 80, target_stock: 150, lead_time_days: 2, unit_cost: 0 });
  const [workforceDraft, setWorkforceDraft] = useState<any>({});
  const [financeDraft, setFinanceDraft] = useState<any>({});
  const [biRegionQuery, setBiRegionQuery] = useState('');
  const [biCategoryQuery, setBiCategoryQuery] = useState('');
  const [biRoleQuery, setBiRoleQuery] = useState('');
  const [biTrendWindow, setBiTrendWindow] = useState(30);
  const [biSuggestedActions, setBiSuggestedActions] = useState<any[]>([]);
  const [biSuggestLoading, setBiSuggestLoading] = useState(false);
  const [biBacktestResult, setBiBacktestResult] = useState<any | null>(null);
  const [biBacktestLoading, setBiBacktestLoading] = useState(false);
  const [biSelectedActions, setBiSelectedActions] = useState<Set<string>>(new Set());
  const [biCheckpointId, setBiCheckpointId] = useState('');
  const [biRollbackPreview, setBiRollbackPreview] = useState<any | null>(null);
  const [biRollbackLoading, setBiRollbackLoading] = useState(false);

  const filteredBi = useMemo(() => {
    const byRegion = (state.insights?.productivity?.by_region || []).filter((r: any) => String(r.region || '').includes(biRegionQuery));
    const byCategory = (state.insights?.productivity?.by_category || []).filter((r: any) => String(r.category || '').includes(biCategoryQuery));
    const byRole = (state.insights?.productivity?.by_role || []).filter((r: any) => String(r.role || '').includes(biRoleQuery));
    const trend = (state.insights?.productivity?.trend_daily || []).slice(-Math.max(7, Math.min(90, Number(biTrendWindow) || 30)));
    return { byRegion, byCategory, byRole, trend };
  }, [state.insights?.productivity, biRegionQuery, biCategoryQuery, biRoleQuery, biTrendWindow]);

  const workforceBreakdown = useMemo(() => {
    const shifts = Math.max(1, Number(workforceDraft.shifts_per_day ?? 2) || 1);
    const perShift = Math.max(1, Number(workforceDraft.staffing_per_shift ?? 3) || 1);
    const current = Math.max(0, Number(workforceDraft.current_headcount ?? 0) || 0);
    const required = shifts * perShift;
    const baseCoverage = required > 0 ? current / required : 1;
    const overtimeEnabled = Boolean(workforceDraft.overtime_shift_enabled);
    const overtimeExtra = Math.max(0, Number(workforceDraft.overtime_shift_extra_capacity ?? 0) || 0);
    const finalCoverage = Math.min(1.2, Math.max(0, baseCoverage + (overtimeEnabled ? overtimeExtra : 0)));

    const catSkill = workforceDraft.skill_by_category || {};
    const catAlloc = workforceDraft.shift_allocation_by_category || {};
    const roleSkill = workforceDraft.skill_by_role || {};
    const roleAlloc = workforceDraft.shift_allocation_by_role || {};

    const catRows = ['wash', 'maintenance', 'detailing', 'other'].map((k) => {
      const s = Math.max(0, Number(catSkill[k] ?? 1) || 0);
      const a = Math.max(0, Number(catAlloc[k] ?? 1) || 0);
      return { key: k, factor: s * a };
    });
    const roleRows = ['技师', '店长', '销售', '客服'].map((k) => {
      const s = Math.max(0, Number(roleSkill[k] ?? 1) || 0);
      const a = Math.max(0, Number(roleAlloc[k] ?? 1) || 0);
      return { key: k, factor: s * a };
    });

    return {
      required,
      current,
      baseCoverage,
      finalCoverage,
      catRows,
      roleRows,
    };
  }, [workforceDraft]);

  useEffect(() => {
    if (!selectedStoreId && defaultStore) setSelectedStoreId(defaultStore);
  }, [defaultStore, selectedStoreId]);

  useEffect(() => {
    if (!selectedStore) return;
    setMitigationDraft({ ...(selectedStore.mitigation || {}) });
    setAutoReplenEnabled(Boolean(selectedStore.auto_replenishment_enabled));
    setWorkforceDraft({ ...(selectedStore.workforce || {}) });
  }, [selectedStore]);

  useEffect(() => {
    setFinanceDraft({ ...(state.finance || {}) });
  }, [state.finance]);

  const loadRecommendations = async () => {
    setLoadingRec(true);
    try {
      const r = await apiGetSiteRecommendations(topK, radius, distanceMode, graphNeighbors);
      setRecRows(r.recommendations || []);
    } finally {
      setLoadingRec(false);
    }
  };

  const runCompare = async () => {
    if (!selectedStoreId) return;
    setCompareLoading(true);
    try {
      const res = await apiCompareScenarios({
        days,
        seed,
        scenarios: [
          {
            name: 'A-高竞争',
            store_patches: [
              {
                store_id: selectedStoreId,
                local_competition_intensity: scenarioAComp,
                attractiveness_index: scenarioAAttr,
                traffic_conversion_rate: scenarioAConv,
              },
            ],
          },
          {
            name: 'B-优化应对',
            store_patches: [
              {
                store_id: selectedStoreId,
                local_competition_intensity: scenarioBComp,
                attractiveness_index: scenarioBAttr,
                traffic_conversion_rate: scenarioBConv,
              },
            ],
          },
        ],
      });
      setCompareResult(res);
    } finally {
      setCompareLoading(false);
    }
  };

  const applyScenarioToLive = async (which: 'A' | 'B') => {
    if (!selectedStoreId) return;
    if (which === 'A') {
      await dispatch({
        type: 'UPDATE_STORE',
        payload: {
          store_id: selectedStoreId,
          patch: {
            local_competition_intensity: scenarioAComp,
            attractiveness_index: scenarioAAttr,
            traffic_conversion_rate: scenarioAConv,
          },
        },
      });
      return;
    }
    await dispatch({
      type: 'UPDATE_STORE',
      payload: {
        store_id: selectedStoreId,
        patch: {
          local_competition_intensity: scenarioBComp,
          attractiveness_index: scenarioBAttr,
          traffic_conversion_rate: scenarioBConv,
        },
      },
    });
  };

  const saveMitigation = async () => {
    if (!selectedStoreId) return;
    await dispatch({
      type: 'UPDATE_STORE',
      payload: {
        store_id: selectedStoreId,
        patch: {
          auto_replenishment_enabled: autoReplenEnabled,
          mitigation: mitigationDraft,
          workforce: workforceDraft,
        },
      },
    });
  };

  const saveFinance = async () => {
    await dispatch({ type: 'UPDATE_FINANCE', payload: financeDraft });
  };

  const upsertRule = async () => {
    if (!selectedStoreId || !ruleDraft.sku) return;
    await dispatch({ type: 'UPSERT_REPL_RULE', payload: { store_id: selectedStoreId, payload: ruleDraft } });
    setRuleDraft({ sku: '', reorder_point: 50, safety_stock: 80, target_stock: 150, lead_time_days: 2, unit_cost: 0 });
  };

  const deleteRule = async (sku: string) => {
    if (!selectedStoreId) return;
    await dispatch({ type: 'DELETE_REPL_RULE', payload: { store_id: selectedStoreId, sku } });
  };

  const loadBiSuggestions = async () => {
    setBiSuggestLoading(true);
    try {
      const res = await apiSuggestBiActions(20);
      setBiSuggestedActions(res.actions || []);
    } finally {
      setBiSuggestLoading(false);
    }
  };

  const runBiBacktest = async () => {
    const selected = biSuggestedActions.filter(a => biSelectedActions.has(a.action_id));
    if (selected.length === 0) return;
    setBiBacktestLoading(true);
    try {
      const res = await apiBacktestBiActions(30, selected);
      setBiBacktestResult(res);
    } finally {
      setBiBacktestLoading(false);
    }
  };

  const applyBiActions = async () => {
    const selected = biSuggestedActions.filter(a => biSelectedActions.has(a.action_id));
    if (selected.length === 0) return;
    await apiApplyBiActions(selected, 'bi_apply_' + new Date().toISOString().slice(0, 10));
    setBiSelectedActions(new Set());
    setBiBacktestResult(null);
  };

  const previewRollback = async () => {
    setBiRollbackLoading(true);
    try {
      const res = await apiPreviewRollbackBiActions(biCheckpointId);
      setBiRollbackPreview(res);
    } finally {
      setBiRollbackLoading(false);
    }
  };

  const executeRollback = async () => {
    if (!biRollbackPreview) return;
    await apiRollbackBiActions(biCheckpointId);
    setBiRollbackPreview(null);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">策略实验（P1/P2）</h1>
        <p className="text-slate-500">包含选址推荐、竞争分流、A/B 场景、事件对冲与自动补货。</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-end gap-3 justify-between">
          <div>
            <div className="font-bold text-slate-900">选址推荐</div>
            <div className="text-xs text-slate-500 mt-1">按未覆盖需求 + 与现有开店距离做启发式评分。</div>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <div className="text-xs text-slate-500">TopK</div>
              <input type="number" value={topK} min={1} max={100} onChange={(e) => setTopK(Number(e.target.value) || 10)} className="w-20 h-9 rounded-lg border border-slate-200 px-2 text-sm font-mono" />
            </div>
            <div>
              <div className="text-xs text-slate-500">半径</div>
              <input type="number" value={radius} min={1} onChange={(e) => setRadius(Number(e.target.value) || 15)} className="w-24 h-9 rounded-lg border border-slate-200 px-2 text-sm font-mono" />
            </div>
            <div>
              <div className="text-xs text-slate-500">距离模式</div>
              <select value={distanceMode} onChange={(e) => setDistanceMode(e.target.value as any)} className="w-36 h-9 rounded-lg border border-slate-200 px-2 text-sm">
                <option value="road_proxy">road_proxy</option>
                <option value="road_graph">road_graph</option>
                <option value="euclidean">euclidean</option>
              </select>
            </div>
            {distanceMode === 'road_graph' && (
              <div>
                <div className="text-xs text-slate-500">图邻居K</div>
                <input type="number" value={graphNeighbors} min={1} max={10} onChange={(e) => setGraphNeighbors(Number(e.target.value) || 3)} className="w-24 h-9 rounded-lg border border-slate-200 px-2 text-sm font-mono" />
              </div>
            )}
            <button onClick={loadRecommendations} disabled={loadingRec} className="h-9 px-3 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-60">
              {loadingRec ? '加载中...' : '刷新推荐'}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3 text-left">站点</th>
                <th className="px-6 py-3 text-center">需求指数</th>
                <th className="px-6 py-3 text-center">最近开店距离</th>
                <th className="px-6 py-3 text-center">未覆盖需求</th>
                <th className="px-6 py-3 text-center">评分</th>
                <th className="px-6 py-3 text-center">置信度</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recRows.map((r) => (
                <tr key={r.station_id} className="hover:bg-slate-50">
                  <td className="px-6 py-3">
                    <div className="font-semibold text-slate-900">{r.station_name}</div>
                    <div className="text-xs text-slate-500 font-mono">{r.station_id} · {r.city || '-'} / {r.district || '-'}</div>
                  </td>
                  <td className="px-6 py-3 text-center font-mono">{r.demand_index.toFixed(1)}</td>
                  <td className="px-6 py-3 text-center font-mono">{r.nearest_open_distance.toFixed(2)}</td>
                  <td className="px-6 py-3 text-center font-mono">{r.uncovered_demand.toFixed(1)}</td>
                  <td className="px-6 py-3 text-center font-mono font-bold text-blue-700">{r.recommendation_score.toFixed(1)}</td>
                  <td className="px-6 py-3 text-center font-mono">{((r.distance_confidence ?? 1) * 100).toFixed(0)}%</td>
                </tr>
              ))}
              {recRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-slate-500">点击"刷新推荐"获取结果</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <div className="font-bold text-slate-900">P2 运营动作：事件对冲 + 自动补货</div>
          <div className="text-xs text-slate-500 mt-1">配置后会在日模拟中自动生效，并写入账本审计字段。</div>
        </div>
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="font-semibold text-slate-800">事件对冲（Mitigation）</div>
            {!selectedStore && <div className="text-sm text-slate-500">请先在上方选择目标门店。</div>}
            {selectedStore && (
              <>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(mitigationDraft.use_emergency_power)} onChange={(e)=>setMitigationDraft((p:any)=>({...p,use_emergency_power:e.target.checked}))}/>应急供电（停业转降级营业）</label>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <label>应急产能<input type="number" step="0.05" value={Number(mitigationDraft.emergency_capacity_multiplier ?? 0.6)} onChange={(e)=>setMitigationDraft((p:any)=>({...p,emergency_capacity_multiplier:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                  <label>应急成本倍率<input type="number" step="0.05" value={Number(mitigationDraft.emergency_variable_cost_multiplier ?? 1.15)} onChange={(e)=>setMitigationDraft((p:any)=>({...p,emergency_variable_cost_multiplier:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                  <label>应急日成本<input type="number" value={Number(mitigationDraft.emergency_daily_cost ?? 120)} onChange={(e)=>setMitigationDraft((p:any)=>({...p,emergency_daily_cost:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                </div>

                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(mitigationDraft.use_promo_boost)} onChange={(e)=>setMitigationDraft((p:any)=>({...p,use_promo_boost:e.target.checked}))}/>临时促销（客流/转化补偿）</label>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <label>客流boost<input type="number" step="0.05" value={Number(mitigationDraft.promo_traffic_boost ?? 1.05)} onChange={(e)=>setMitigationDraft((p:any)=>({...p,promo_traffic_boost:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                  <label>转化boost<input type="number" step="0.05" value={Number(mitigationDraft.promo_conversion_boost ?? 1.08)} onChange={(e)=>setMitigationDraft((p:any)=>({...p,promo_conversion_boost:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                  <label>促销日成本<input type="number" value={Number(mitigationDraft.promo_daily_cost ?? 80)} onChange={(e)=>setMitigationDraft((p:any)=>({...p,promo_daily_cost:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                </div>

                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(mitigationDraft.use_overtime_capacity)} onChange={(e)=>setMitigationDraft((p:any)=>({...p,use_overtime_capacity:e.target.checked}))}/>加班扩容</label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label>扩容倍率<input type="number" step="0.05" value={Number(mitigationDraft.overtime_capacity_boost ?? 1.2)} onChange={(e)=>setMitigationDraft((p:any)=>({...p,overtime_capacity_boost:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                  <label>加班日成本<input type="number" value={Number(mitigationDraft.overtime_daily_cost ?? 100)} onChange={(e)=>setMitigationDraft((p:any)=>({...p,overtime_daily_cost:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                </div>

                <div className="pt-3 border-t border-slate-200 mt-2">
                  <div className="font-semibold text-slate-800 mb-2">P3 人力生命周期</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <label>编制<input type="number" value={Number(workforceDraft.planned_headcount ?? 6)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,planned_headcount:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>当前人数<input type="number" value={Number(workforceDraft.current_headcount ?? 6)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,current_headcount:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>培训水平<input type="number" step="0.05" min={0} max={1} value={Number(workforceDraft.training_level ?? 0.5)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,training_level:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>流失率/日<input type="number" step="0.001" min={0} max={1} value={Number(workforceDraft.daily_turnover_rate ?? 0.002)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,daily_turnover_rate:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label className="col-span-2 flex items-center gap-2 mt-6"><input type="checkbox" checked={Boolean(workforceDraft.recruiting_enabled)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,recruiting_enabled:e.target.checked}))}/>启用招聘</label>
                    <label>招聘预算/日<input type="number" value={Number(workforceDraft.recruiting_daily_budget ?? 0)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,recruiting_daily_budget:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>招聘提前期<input type="number" value={Number(workforceDraft.recruiting_lead_days ?? 7)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,recruiting_lead_days:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>转化率/100元<input type="number" step="0.01" value={Number(workforceDraft.recruiting_hire_rate_per_100_budget ?? 0.2)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,recruiting_hire_rate_per_100_budget:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>计划请假率<input type="number" step="0.001" min={0} max={1} value={Number(workforceDraft.planned_leave_rate ?? 0)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,planned_leave_rate:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>临时缺勤率<input type="number" step="0.001" min={0} max={1} value={Number(workforceDraft.unplanned_absence_rate ?? 0)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,unplanned_absence_rate:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>早班计划请假率<input type="number" step="0.001" min={0} max={1} value={Number(workforceDraft.planned_leave_rate_day ?? 0)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,planned_leave_rate_day:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>晚班计划请假率<input type="number" step="0.001" min={0} max={1} value={Number(workforceDraft.planned_leave_rate_night ?? 0)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,planned_leave_rate_night:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>早班病假率<input type="number" step="0.001" min={0} max={1} value={Number(workforceDraft.sick_leave_rate_day ?? 0)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,sick_leave_rate_day:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>晚班病假率<input type="number" step="0.001" min={0} max={1} value={Number(workforceDraft.sick_leave_rate_night ?? 0)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,sick_leave_rate_night:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>班次数/日<input type="number" min={1} value={Number(workforceDraft.shifts_per_day ?? 2)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,shifts_per_day:Number(e.target.value)||1}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>每班配置<input type="number" min={1} value={Number(workforceDraft.staffing_per_shift ?? 3)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,staffing_per_shift:Number(e.target.value)||1}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>班次时长<input type="number" min={1} value={Number(workforceDraft.shift_hours ?? 8)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,shift_hours:Number(e.target.value)||1}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label className="col-span-2 flex items-center gap-2 mt-1"><input type="checkbox" checked={Boolean(workforceDraft.overtime_shift_enabled)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,overtime_shift_enabled:e.target.checked}))}/>启用加班班次</label>
                    <label>加班产能补偿<input type="number" step="0.01" min={0} value={Number(workforceDraft.overtime_shift_extra_capacity ?? 0.15)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,overtime_shift_extra_capacity:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>加班成本/日<input type="number" min={0} value={Number(workforceDraft.overtime_shift_daily_cost ?? 0)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,overtime_shift_daily_cost:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <div className="col-span-3 mt-2 text-[11px] font-bold text-slate-500 uppercase">技能矩阵（按业态）</div>
                    <label>洗车技能<input type="number" step="0.05" min={0} value={Number(workforceDraft.skill_by_category?.wash ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,skill_by_category:{...(p.skill_by_category||{}),wash:Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>维保技能<input type="number" step="0.05" min={0} value={Number(workforceDraft.skill_by_category?.maintenance ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,skill_by_category:{...(p.skill_by_category||{}),maintenance:Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>洗美技能<input type="number" step="0.05" min={0} value={Number(workforceDraft.skill_by_category?.detailing ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,skill_by_category:{...(p.skill_by_category||{}),detailing:Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>其他技能<input type="number" step="0.05" min={0} value={Number(workforceDraft.skill_by_category?.other ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,skill_by_category:{...(p.skill_by_category||{}),other:Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <div className="col-span-3 mt-2 text-[11px] font-bold text-slate-500 uppercase">班次分配（按业态）</div>
                    <label>洗车分配<input type="number" step="0.05" min={0} value={Number(workforceDraft.shift_allocation_by_category?.wash ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,shift_allocation_by_category:{...(p.shift_allocation_by_category||{}),wash:Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>维保分配<input type="number" step="0.05" min={0} value={Number(workforceDraft.shift_allocation_by_category?.maintenance ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,shift_allocation_by_category:{...(p.shift_allocation_by_category||{}),maintenance:Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>洗美分配<input type="number" step="0.05" min={0} value={Number(workforceDraft.shift_allocation_by_category?.detailing ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,shift_allocation_by_category:{...(p.shift_allocation_by_category||{}),detailing:Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>其他分配<input type="number" step="0.05" min={0} value={Number(workforceDraft.shift_allocation_by_category?.other ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,shift_allocation_by_category:{...(p.shift_allocation_by_category||{}),other:Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <div className="col-span-3 mt-2 text-[11px] font-bold text-slate-500 uppercase">岗位技能（按 labor_role）</div>
                    <label>技师技能<input type="number" step="0.05" min={0} value={Number(workforceDraft.skill_by_role?.['技师'] ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,skill_by_role:{...(p.skill_by_role||{}),'技师':Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>店长技能<input type="number" step="0.05" min={0} value={Number(workforceDraft.skill_by_role?.['店长'] ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,skill_by_role:{...(p.skill_by_role||{}),'店长':Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>销售技能<input type="number" step="0.05" min={0} value={Number(workforceDraft.skill_by_role?.['销售'] ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,skill_by_role:{...(p.skill_by_role||{}),'销售':Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>客服技能<input type="number" step="0.05" min={0} value={Number(workforceDraft.skill_by_role?.['客服'] ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,skill_by_role:{...(p.skill_by_role||{}),'客服':Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <div className="col-span-3 mt-2 text-[11px] font-bold text-slate-500 uppercase">岗位班次分配（按 labor_role）</div>
                    <label>技师分配<input type="number" step="0.05" min={0} value={Number(workforceDraft.shift_allocation_by_role?.['技师'] ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,shift_allocation_by_role:{...(p.shift_allocation_by_role||{}),'技师':Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>店长分配<input type="number" step="0.05" min={0} value={Number(workforceDraft.shift_allocation_by_role?.['店长'] ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,shift_allocation_by_role:{...(p.shift_allocation_by_role||{}),'店长':Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>销售分配<input type="number" step="0.05" min={0} value={Number(workforceDraft.shift_allocation_by_role?.['销售'] ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,shift_allocation_by_role:{...(p.shift_allocation_by_role||{}),'销售':Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                    <label>客服分配<input type="number" step="0.05" min={0} value={Number(workforceDraft.shift_allocation_by_role?.['客服'] ?? 1)} onChange={(e)=>setWorkforceDraft((p:any)=>({...p,shift_allocation_by_role:{...(p.shift_allocation_by_role||{}),'客服':Number(e.target.value)||0}}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="space-y-3">
            <div className="font-semibold text-slate-800">自动补货（Safety Stock + Lead Time）</div>
            {selectedStore && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoReplenEnabled} onChange={(e)=>setAutoReplenEnabled(e.target.checked)}/>启用自动补货</label>}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <label>SKU<input value={ruleDraft.sku || ''} onChange={(e)=>setRuleDraft((p:any)=>({...p,sku:e.target.value}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
              <label>名称<input value={ruleDraft.name || ''} onChange={(e)=>setRuleDraft((p:any)=>({...p,name:e.target.value}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2"/></label>
              <label>单价<input type="number" value={Number(ruleDraft.unit_cost ?? 0)} onChange={(e)=>setRuleDraft((p:any)=>({...p,unit_cost:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
              <label>触发点<input type="number" value={Number(ruleDraft.reorder_point ?? 50)} onChange={(e)=>setRuleDraft((p:any)=>({...p,reorder_point:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
              <label>安全库存<input type="number" value={Number(ruleDraft.safety_stock ?? 80)} onChange={(e)=>setRuleDraft((p:any)=>({...p,safety_stock:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
              <label>目标库存<input type="number" value={Number(ruleDraft.target_stock ?? 150)} onChange={(e)=>setRuleDraft((p:any)=>({...p,target_stock:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
              <label>提前期(天)<input type="number" value={Number(ruleDraft.lead_time_days ?? 2)} onChange={(e)=>setRuleDraft((p:any)=>({...p,lead_time_days:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
            </div>
            <div className="flex gap-2">
              <button onClick={upsertRule} disabled={!selectedStoreId || !ruleDraft.sku} className="h-9 px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-60">新增/更新规则</button>
              <button onClick={saveMitigation} disabled={!selectedStoreId} className="h-9 px-3 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-60">保存对冲与补货开关</button>
            </div>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-2 text-left">SKU</th><th className="px-2 py-2">触发</th><th className="px-2 py-2">安全</th><th className="px-2 py-2">目标</th><th className="px-2 py-2">提前期</th><th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedStore?.replenishment_rules || []).map((r:any) => (
                    <tr key={r.sku} className="border-t border-slate-100">
                      <td className="px-2 py-2 font-mono">{r.sku}</td>
                      <td className="px-2 py-2 text-center font-mono">{r.reorder_point}</td>
                      <td className="px-2 py-2 text-center font-mono">{r.safety_stock}</td>
                      <td className="px-2 py-2 text-center font-mono">{r.target_stock}</td>
                      <td className="px-2 py-2 text-center font-mono">{r.lead_time_days}</td>
                      <td className="px-2 py-2 text-right"><button onClick={()=>deleteRule(r.sku)} className="text-rose-600">删除</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <div className="font-bold text-slate-900">P3 总部融资与预警</div>
          <div className="text-xs text-slate-500 mt-1">授信额度、日利率、自动融资和风险提示。</div>
        </div>
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label>授信额度<input type="number" value={Number(financeDraft.hq_credit_limit ?? 0)} onChange={(e)=>setFinanceDraft((p:any)=>({...p,hq_credit_limit:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
            <label>日利率<input type="number" step="0.0001" value={Number(financeDraft.hq_daily_interest_rate ?? 0.0005)} onChange={(e)=>setFinanceDraft((p:any)=>({...p,hq_daily_interest_rate:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
            <label>月营收预算<input type="number" value={Number(financeDraft.budget_monthly_revenue_target ?? 0)} onChange={(e)=>setFinanceDraft((p:any)=>({...p,budget_monthly_revenue_target:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
            <label>月利润预算<input type="number" value={Number(financeDraft.budget_monthly_profit_target ?? 0)} onChange={(e)=>setFinanceDraft((p:any)=>({...p,budget_monthly_profit_target:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
            <label className="col-span-2">月现金流预算<input type="number" value={Number(financeDraft.budget_monthly_cashflow_target ?? 0)} onChange={(e)=>setFinanceDraft((p:any)=>({...p,budget_monthly_cashflow_target:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
            <label>CAPEX现金支付比例<input type="number" step="0.05" min={0} max={1} value={Number(financeDraft.capex_cash_payment_ratio ?? 1)} onChange={(e)=>setFinanceDraft((p:any)=>({...p,capex_cash_payment_ratio:Number(e.target.value)||0}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
            <label>滚动预算窗口(天)<input type="number" min={7} max={180} value={Number(financeDraft.rolling_budget_window_days ?? 30)} onChange={(e)=>setFinanceDraft((p:any)=>({...p,rolling_budget_window_days:Number(e.target.value)||30}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
            <label>融资成本归集方式
              <select value={String(financeDraft.finance_cost_allocation_method ?? 'revenue')} onChange={(e)=>setFinanceDraft((p:any)=>({...p,finance_cost_allocation_method:e.target.value}))} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 text-sm">
                <option value="revenue">按营收分摊</option>
                <option value="credit_usage">按融资占用分摊</option>
              </select>
            </label>
            <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={Boolean(financeDraft.hq_auto_finance)} onChange={(e)=>setFinanceDraft((p:any)=>({...p,hq_auto_finance:e.target.checked}))}/>自动融资（现金为负时自动提额）</label>
            <button onClick={saveFinance} className="h-9 px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold w-fit">保存融资策略</button>
            <div className="col-span-2 text-sm text-slate-600">当前授信占用：{Number(state.finance?.hq_credit_used ?? 0).toFixed(2)} / {Number(state.finance?.hq_credit_limit ?? 0).toFixed(2)}</div>
            <div className="col-span-2 text-sm text-slate-600">
              本月进度：{((Number(state.finance?.budget_mtd?.progress ?? 0) * 100)).toFixed(1)}% ｜
              营收 {Number(state.finance?.budget_mtd?.revenue ?? 0).toFixed(0)} ｜
              利润 {Number(state.finance?.budget_mtd?.profit ?? 0).toFixed(0)} ｜
              现金流 {Number(state.finance?.budget_mtd?.cashflow ?? 0).toFixed(0)}
            </div>
            <div className="col-span-2 text-sm text-slate-600">
              融资成本(MTD) {Number(state.finance?.budget_mtd?.finance_interest ?? 0).toFixed(2)} ｜
              融资CAPEX(MTD) {Number(state.finance?.budget_mtd?.financed_capex ?? 0).toFixed(2)}
            </div>
          </div>
          <div>
            <div className="font-semibold text-slate-800 mb-2">风险预警</div>
            <div className="space-y-2 max-h-48 overflow-auto">
              {(state.insights?.alerts || []).map((a, idx) => (
                <div key={`${a.code}-${idx}`} className={`text-xs rounded-lg px-3 py-2 border ${a.level === 'high' ? 'bg-rose-50 border-rose-200 text-rose-700' : a.level === 'medium' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                  [{a.code}] {a.message}
                </div>
              ))}
              {(state.insights?.alerts || []).length === 0 && <div className="text-sm text-slate-500">暂无预警</div>}
            </div>
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-bold text-slate-500 uppercase mb-1">滚动预算趋势</div>
              <div className="text-xs text-slate-600 space-y-1">
                <div>窗口：最近 {Number(state.finance?.rolling_budget?.window_days ?? 0)} 天</div>
                <div>日均营收：{Number(state.finance?.rolling_budget?.avg_daily_revenue ?? 0).toFixed(2)}</div>
                <div>日均利润：{Number(state.finance?.rolling_budget?.avg_daily_profit ?? 0).toFixed(2)}</div>
                <div>日均现金流：{Number(state.finance?.rolling_budget?.avg_daily_cashflow ?? 0).toFixed(2)}</div>
                <div>营收动量：{(Number(state.finance?.rolling_budget?.revenue_momentum_vs_prev_window ?? 0) * 100).toFixed(2)}%</div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6">
          <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
            <div className="font-semibold text-slate-800 mb-2">人力产能分解（预览）</div>
            <div className="text-xs text-slate-600 mb-3">
              需求编制 {workforceBreakdown.required} 人 / 当前 {workforceBreakdown.current} 人，覆盖率 {Math.max(0, workforceBreakdown.baseCoverage * 100).toFixed(1)}% → 含加班 {Math.max(0, workforceBreakdown.finalCoverage * 100).toFixed(1)}%
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">业态因子</div>
                <div className="space-y-1 text-xs">
                  {workforceBreakdown.catRows.map((r) => (
                    <div key={r.key} className="flex justify-between"><span>{r.key}</span><span className={`font-mono ${r.factor < 1 ? 'text-rose-600' : r.factor > 1 ? 'text-emerald-600' : 'text-slate-700'}`}>{r.factor.toFixed(3)}</span></div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">岗位因子</div>
                <div className="space-y-1 text-xs">
                  {workforceBreakdown.roleRows.map((r) => (
                    <div key={r.key} className="flex justify-between"><span>{r.key}</span><span className={`font-mono ${r.factor < 1 ? 'text-rose-600' : r.factor > 1 ? 'text-emerald-600' : 'text-slate-700'}`}>{r.factor.toFixed(3)}</span></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 p-4 bg-slate-50 mt-4">
            <div className="font-semibold text-slate-800 mb-2">BI 人效钻取（区域/业态/角色）</div>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-2 mb-3 text-xs">
              <input value={biRegionQuery} onChange={(e)=>setBiRegionQuery(e.target.value)} placeholder="筛选区域" className="h-8 rounded border border-slate-200 px-2" />
              <input value={biCategoryQuery} onChange={(e)=>setBiCategoryQuery(e.target.value)} placeholder="筛选业态" className="h-8 rounded border border-slate-200 px-2" />
              <input value={biRoleQuery} onChange={(e)=>setBiRoleQuery(e.target.value)} placeholder="筛选角色" className="h-8 rounded border border-slate-200 px-2" />
              <select value={biTrendWindow} onChange={(e)=>setBiTrendWindow(Number(e.target.value) || 30)} className="h-8 rounded border border-slate-200 px-2">
                <option value={7}>趋势窗口 7 天</option>
                <option value={14}>趋势窗口 14 天</option>
                <option value={30}>趋势窗口 30 天</option>
                <option value={60}>趋势窗口 60 天</option>
                <option value={90}>趋势窗口 90 天</option>
              </select>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">区域</div>
                <div className="space-y-1 text-xs max-h-40 overflow-auto">
                  {(filteredBi.byRegion || []).slice(0, 8).map((r: any) => (
                    <div key={r.region} className="flex justify-between gap-2"><span className="truncate">{r.region}</span><span className="font-mono">{Number(r.revenue_per_headcount || 0).toFixed(1)}</span></div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">业态</div>
                <div className="space-y-1 text-xs max-h-40 overflow-auto">
                  {(filteredBi.byCategory || []).slice(0, 8).map((r: any) => (
                    <div key={r.category} className="flex justify-between gap-2"><span>{r.category}</span><span className="font-mono">{Number(r.revenue_per_headcount || 0).toFixed(1)}</span></div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">角色</div>
                <div className="space-y-1 text-xs max-h-40 overflow-auto">
                  {(filteredBi.byRole || []).slice(0, 8).map((r: any) => (
                    <div key={r.role} className="flex justify-between gap-2"><span>{r.role}</span><span className="font-mono">{Number(r.revenue_per_headcount || 0).toFixed(1)}</span></div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-xs font-bold text-slate-500 uppercase mb-1">近{Math.max(7, Math.min(90, Number(biTrendWindow) || 30))}天人效趋势（营收/人）</div>
              <div className="flex items-end gap-1 h-16">
                {(filteredBi.trend || []).map((p: any) => {
                  const v = Number(p.revenue_per_headcount || 0);
                  const h = Math.max(4, Math.min(60, v / 20));
                  return <div key={String(p.day)} title={`D${p.day}: ${v.toFixed(2)}`} className="w-2 bg-blue-400/80 rounded-sm" style={{ height: `${h}px` }} />;
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <div className="font-bold text-slate-900">A/B 场景对比</div>
          <div className="text-xs text-slate-500 mt-1">对同一初始状态进行并行仿真，不写入真实存档。</div>
        </div>
        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-slate-500 mb-1">目标门店</div>
            <select value={selectedStoreId} onChange={(e) => setSelectedStoreId(e.target.value)} className="w-full h-10 rounded-lg border border-slate-200 px-2 text-sm">
              <option value="">(请选择)</option>
              {stores.map((s) => <option key={s.store_id} value={s.store_id}>{s.store_id} - {s.name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">模拟天数</div>
            <input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value) || 30)} className="w-full h-10 rounded-lg border border-slate-200 px-2 text-sm font-mono" />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Seed</div>
            <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} className="w-full h-10 rounded-lg border border-slate-200 px-2 text-sm font-mono" />
          </div>

          <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
              <div className="font-semibold text-slate-800 mb-3">场景 A（高竞争）</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <label>竞争强度<input type="number" step="0.05" min={0} max={1} value={scenarioAComp} onChange={(e) => setScenarioAComp(Number(e.target.value) || 0)} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                <label>吸引力<input type="number" step="0.05" min={0.5} max={1.5} value={scenarioAAttr} onChange={(e) => setScenarioAAttr(Number(e.target.value) || 1)} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                <label>转化倍率<input type="number" step="0.05" min={0} value={scenarioAConv} onChange={(e) => setScenarioAConv(Number(e.target.value) || 1)} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
              </div>
              <button onClick={() => applyScenarioToLive('A')} className="mt-3 h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-white">应用到当前真实状态</button>
            </div>
            <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
              <div className="font-semibold text-slate-800 mb-3">场景 B（优化应对）</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <label>竞争强度<input type="number" step="0.05" min={0} max={1} value={scenarioBComp} onChange={(e) => setScenarioBComp(Number(e.target.value) || 0)} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                <label>吸引力<input type="number" step="0.05" min={0.5} max={1.5} value={scenarioBAttr} onChange={(e) => setScenarioBAttr(Number(e.target.value) || 1)} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
                <label>转化倍率<input type="number" step="0.05" min={0} value={scenarioBConv} onChange={(e) => setScenarioBConv(Number(e.target.value) || 1)} className="mt-1 w-full h-9 rounded border border-slate-200 px-2 font-mono"/></label>
              </div>
              <button onClick={() => applyScenarioToLive('B')} className="mt-3 h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-white">应用到当前真实状态</button>
            </div>
          </div>

          <div className="lg:col-span-3 flex justify-end">
            <button onClick={runCompare} disabled={!selectedStoreId || compareLoading} className="h-10 px-4 rounded-lg bg-blue-600 text-white font-semibold disabled:opacity-60">
              {compareLoading ? '仿真中...' : '运行 A/B 对比'}
            </button>
          </div>
        </div>

        {compareResult && (
          <div className="px-6 pb-6">
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">方案</th>
                    <th className="px-4 py-3 text-right">营收Δ</th>
                    <th className="px-4 py-3 text-right">经营利润Δ</th>
                    <th className="px-4 py-3 text-right">净现金流Δ</th>
                    <th className="px-4 py-3 text-right">日均订单Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {compareResult.scenarios.map((s) => (
                    <tr key={s.name}>
                      <td className="px-4 py-3 font-semibold text-slate-900">{s.name}</td>
                      <td className={`px-4 py-3 text-right font-mono ${s.delta_vs_baseline.total_revenue >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{s.delta_vs_baseline.total_revenue.toFixed(2)}</td>
                      <td className={`px-4 py-3 text-right font-mono ${s.delta_vs_baseline.total_operating_profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{s.delta_vs_baseline.total_operating_profit.toFixed(2)}</td>
                      <td className={`px-4 py-3 text-right font-mono ${s.delta_vs_baseline.total_net_cashflow >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{s.delta_vs_baseline.total_net_cashflow.toFixed(2)}</td>
                      <td className={`px-4 py-3 text-right font-mono ${s.delta_vs_baseline.avg_daily_orders >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{s.delta_vs_baseline.avg_daily_orders.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="font-bold text-slate-900">BI 决策闭环（P3-Final）</div>
            <div className="text-xs text-slate-500 mt-1">从钻取指标一键生成策略动作，支持回测与回滚。</div>
          </div>
          <div className="flex gap-2">
            <button onClick={loadBiSuggestions} disabled={biSuggestLoading} className="h-9 px-3 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-60">
              {biSuggestLoading ? '加载中...' : '生成建议'}
            </button>
          </div>
        </div>

        {biSuggestedActions.length > 0 && (
          <div className="p-6 space-y-4">
            <div className="text-sm font-semibold text-slate-700">建议动作（点击选择）</div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {biSuggestedActions.map(a => (
                <div
                  key={a.action_id}
                  onClick={() => {
                    const next = new Set(biSelectedActions);
                    if (next.has(a.action_id)) next.delete(a.action_id);
                    else next.add(a.action_id);
                    setBiSelectedActions(next);
                  }}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${biSelectedActions.has(a.action_id) ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-slate-900">{a.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${a.priority === 'high' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{a.priority}</span>
                  </div>
                  <div className="text-xs text-slate-500">{a.reason}</div>
                  {a.store_id && <div className="text-[10px] text-slate-400 mt-1">门店: {a.store_id}</div>}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={runBiBacktest} disabled={biSelectedActions.size === 0 || biBacktestLoading} className="h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold disabled:opacity-60">
                {biBacktestLoading ? '回测中...' : '回测选中动作'}
              </button>
              <button onClick={applyBiActions} disabled={biSelectedActions.size === 0} className="h-9 px-3 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-60">
                应用选中动作
              </button>
            </div>
          </div>
        )}

        {biBacktestResult && (
          <div className="px-6 pb-6">
            <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
              <div className="text-sm font-semibold text-slate-700 mb-3">回测结果（{biBacktestResult.days} 天）</div>
              <div className="grid grid-cols-4 gap-4 text-center">
                <div>
                  <div className="text-xs text-slate-500">营收Δ</div>
                  <div className={`text-lg font-bold font-mono ${biBacktestResult.delta?.revenue >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {biBacktestResult.delta?.revenue?.toFixed(2) || '0.00'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">利润Δ</div>
                  <div className={`text-lg font-bold font-mono ${biBacktestResult.delta?.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {biBacktestResult.delta?.profit?.toFixed(2) || '0.00'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">现金流Δ</div>
                  <div className={`text-lg font-bold font-mono ${biBacktestResult.delta?.cashflow >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {biBacktestResult.delta?.cashflow?.toFixed(2) || '0.00'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">订单Δ</div>
                  <div className={`text-lg font-bold font-mono ${biBacktestResult.delta?.orders >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {biBacktestResult.delta?.orders || 0}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="px-6 py-4 border-t border-slate-200">
          <div className="text-sm font-semibold text-slate-700 mb-3">回滚预览</div>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <div className="text-xs text-slate-500 mb-1">检查点 ID（留空使用最新）</div>
              <input
                type="text"
                value={biCheckpointId}
                onChange={(e) => setBiCheckpointId(e.target.value)}
                placeholder="可选：输入 checkpoint_id"
                className="w-full h-9 rounded-lg border border-slate-200 px-3 text-sm"
              />
            </div>
            <button onClick={previewRollback} disabled={biRollbackLoading} className="h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold disabled:opacity-60">
              {biRollbackLoading ? '加载中...' : '预览差异'}
            </button>
          </div>
        </div>

        {biRollbackPreview && !biRollbackPreview.error && (
          <div className="px-6 pb-6">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-semibold text-amber-800 mb-3">回滚差异预览</div>
              <div className="grid grid-cols-5 gap-2 text-xs">
                <div className="font-semibold text-slate-600">指标</div>
                <div className="font-semibold text-slate-600 text-right">当前</div>
                <div className="font-semibold text-slate-600 text-right">回滚后</div>
                <div className="font-semibold text-slate-600 text-right">增量</div>
                <div></div>
                {['day', 'cash', 'hq_credit_used', 'store_count', 'total_headcount'].map(key => (
                  <React.Fragment key={key}>
                    <div className="text-slate-600">{{day:'天数',cash:'现金',hq_credit_used:'授信占用',store_count:'营业门店',total_headcount:'总人数'}[key]}</div>
                    <div className="text-right font-mono text-slate-500">{biRollbackPreview.current?.[key]?.toLocaleString() || 0}</div>
                    <div className="text-right font-mono text-slate-900 font-bold">{biRollbackPreview.target?.[key]?.toLocaleString() || 0}</div>
                    <div className={`text-right font-mono font-bold ${biRollbackPreview.delta?.[key] >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {biRollbackPreview.delta?.[key] >= 0 ? '+' : ''}{biRollbackPreview.delta?.[key]?.toLocaleString() || 0}
                    </div>
                    <div></div>
                  </React.Fragment>
                ))}
              </div>
              <button onClick={executeRollback} className="mt-4 h-9 px-4 rounded-lg bg-rose-600 text-white text-sm font-semibold">
                确认回滚
              </button>
              <button onClick={() => setBiRollbackPreview(null)} className="mt-4 ml-2 h-9 px-4 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold">
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StrategyPage;
