import React, { useState, useEffect, useMemo } from 'react';
import { StateContext } from '../context';
import { EventTemplate, EventScope } from '../types';

const EventsPage = () => {
  const { state, dispatch } = React.useContext(StateContext);
  const events = state.events;

  const templates = useMemo(() => {
    const list = (events?.templates || []).slice();
    list.sort((a, b) => (a.template_id || '').localeCompare(b.template_id || ''));
    return list;
  }, [events?.templates]);

  const active = useMemo(() => {
    const list = (events?.active || []).slice();
    list.sort((a, b) => (b.start_day || 0) - (a.start_day || 0));
    return list;
  }, [events?.active]);

  const history = useMemo(() => {
    const list = (events?.history || []).slice();
    list.sort((a, b) => (b.created_day || 0) - (a.created_day || 0));
    return list;
  }, [events?.history]);

  const stations = useMemo(() => (state.stations || []).slice().sort((a, b) => a.station_id.localeCompare(b.station_id)), [state.stations]);
  const stores = useMemo(() => (state.stores || []).slice().sort((a, b) => a.store_id.localeCompare(b.store_id)), [state.stores]);

  const [seedInput, setSeedInput] = useState<number>(events?.rng_seed ?? 20260101);

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateDraft, setTemplateDraft] = useState<Partial<EventTemplate>>({});

  const openCreateTemplate = () => {
    setTemplateDraft({
      enabled: true,
      daily_probability: 0.01,
      duration_days_min: 1,
      duration_days_max: 2,
      cooldown_days: 7,
      intensity_min: 0.3,
      intensity_max: 1.0,
      scope: 'store',
      target_strategy: 'random_one',
      store_closed: false,
      traffic_multiplier_min: 1.0,
      traffic_multiplier_max: 1.0,
      conversion_multiplier_min: 1.0,
      conversion_multiplier_max: 1.0,
      capacity_multiplier_min: 1.0,
      capacity_multiplier_max: 1.0,
      variable_cost_multiplier_min: 1.0,
      variable_cost_multiplier_max: 1.0,
      event_type: 'other',
      name: '新事件',
    });
    setTemplateModalOpen(true);
  };

  const openEditTemplate = (t: EventTemplate) => {
    setTemplateDraft({ ...t });
    setTemplateModalOpen(true);
  };

  const normalizeTemplateDraft = (d: Partial<EventTemplate>): any => {
    const num = (v: any, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const int = (v: any, fallback: number) => {
      const n = Math.trunc(Number(v));
      return Number.isFinite(n) ? n : fallback;
    };

    const duration_min = Math.max(1, int(d.duration_days_min, 1));
    const duration_max = Math.max(duration_min, int(d.duration_days_max, duration_min));
    const intensity_min = num(d.intensity_min, 0.3);
    const intensity_max = num(d.intensity_max, Math.max(intensity_min, 1.0));

    return {
      template_id: String(d.template_id || '').trim() || undefined,
      name: String(d.name || '').trim() || '未命名事件',
      event_type: String((d as any).event_type || 'other'),
      enabled: Boolean(d.enabled),
      daily_probability: Math.max(0, Math.min(1, num(d.daily_probability, 0.0))),
      duration_days_min: duration_min,
      duration_days_max: duration_max,
      cooldown_days: Math.max(0, int(d.cooldown_days, 0)),
      intensity_min,
      intensity_max,
      scope: String((d as any).scope || 'store'),
      target_strategy: String((d as any).target_strategy || 'random_one'),
      store_closed: Boolean((d as any).store_closed),
      traffic_multiplier_min: num((d as any).traffic_multiplier_min, 1.0),
      traffic_multiplier_max: num((d as any).traffic_multiplier_max, 1.0),
      conversion_multiplier_min: num((d as any).conversion_multiplier_min, 1.0),
      conversion_multiplier_max: num((d as any).conversion_multiplier_max, 1.0),
      capacity_multiplier_min: num((d as any).capacity_multiplier_min, 1.0),
      capacity_multiplier_max: num((d as any).capacity_multiplier_max, 1.0),
      variable_cost_multiplier_min: num((d as any).variable_cost_multiplier_min, 1.0),
      variable_cost_multiplier_max: num((d as any).variable_cost_multiplier_max, 1.0),
    };
  };

  const saveTemplate = async () => {
    const payload = normalizeTemplateDraft(templateDraft);
    await dispatch({ type: 'UPSERT_EVENT_TEMPLATE', payload });
    setTemplateModalOpen(false);
  };

  const toggleTemplateEnabled = async (t: EventTemplate) => {
    await dispatch({ type: 'UPSERT_EVENT_TEMPLATE', payload: { ...t, enabled: !t.enabled } });
  };

  const deleteTemplate = async (template_id: string) => {
    if (!window.confirm(`确认删除事件模板 ${template_id}？`)) return;
    await dispatch({ type: 'DELETE_EVENT_TEMPLATE', payload: { template_id } });
  };

  const [injectDraft, setInjectDraft] = useState<{
    template_id: string;
    scope: EventScope;
    target_id: string;
    start_day: number;
    duration_days: number;
    intensity: string;
  }>(() => {
    const first = (events?.templates || [])[0];
    const scope = (first?.scope as EventScope) || 'store';
    return {
      template_id: first?.template_id || '',
      scope,
      target_id: '',
      start_day: state.day,
      duration_days: 1,
      intensity: '',
    };
  });

  useEffect(() => {
    setSeedInput(events?.rng_seed ?? 20260101);
  }, [events?.rng_seed]);

  useEffect(() => {
    setInjectDraft((prev) => ({ ...prev, start_day: state.day }));
  }, [state.day]);

  const injectTargetOptions = useMemo(() => {
    if (injectDraft.scope === 'station') return stations.map((s) => ({ value: s.station_id, label: `${s.station_id} - ${s.name}` }));
    if (injectDraft.scope === 'store') return stores.map((s) => ({ value: s.store_id, label: `${s.store_id} - ${s.name}` }));
    return [];
  }, [injectDraft.scope, stations, stores]);

  const runInject = async () => {
    const intensity = injectDraft.intensity.trim();
    const payload: any = {
      template_id: injectDraft.template_id,
      scope: injectDraft.scope,
      target_id: injectDraft.scope === 'global' ? '' : injectDraft.target_id,
      start_day: Number(injectDraft.start_day) || state.day,
      duration_days: Math.max(1, Number(injectDraft.duration_days) || 1),
    };
    if (intensity !== '') payload.intensity = Number(intensity);
    await dispatch({ type: 'INJECT_EVENT', payload });
  };

  const setSeed = async () => {
    const seed = Math.trunc(Number(seedInput) || 0);
    await dispatch({ type: 'SET_EVENT_SEED', payload: { seed } });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">事件管理</h1>
          <p className="text-slate-500">配置随机事件模板、注入事件、查看生效与历史。</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3 shadow-sm">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">RNG Seed</div>
            <input
              value={seedInput}
              onChange={(e) => setSeedInput(Number(e.target.value) || 0)}
              type="number"
              className="w-36 h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-mono"
            />
            <button
              onClick={setSeed}
              className="h-9 px-3 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
              title="设置 seed 并清空 rng_state（后续模拟可复现）"
            >
              应用
            </button>
          </div>
          <button
            onClick={openCreateTemplate}
            className="h-11 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm flex items-center gap-2"
          >
            <span className="material-symbols-outlined">add</span>
            新建模板
          </button>
        </div>
      </div>

      {/* Templates */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="font-bold text-slate-900">模板列表</div>
            <div className="text-xs text-slate-500 mt-1">每日概率按模板独立触发；作用范围按 scope/target_strategy 决定。</div>
          </div>
          <div className="text-xs text-slate-500">共 {templates.length} 个</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3 text-left">ID</th>
                <th className="px-6 py-3 text-left">名称</th>
                <th className="px-6 py-3">启用</th>
                <th className="px-6 py-3">概率/日</th>
                <th className="px-6 py-3">持续(天)</th>
                <th className="px-6 py-3">冷却(天)</th>
                <th className="px-6 py-3">范围</th>
                <th className="px-6 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {templates.map((t) => (
                <tr key={t.template_id} className="hover:bg-slate-50">
                  <td className="px-6 py-3 font-mono text-xs text-slate-600">{t.template_id}</td>
                  <td className="px-6 py-3">
                    <div className="font-semibold text-slate-900">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.event_type}</div>
                  </td>
                  <td className="px-6 py-3 text-center">
                    <button
                      onClick={() => toggleTemplateEnabled(t)}
                      className={`inline-flex items-center h-6 px-2 rounded-full text-xs font-bold border ${t.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}
                      title="点击切换"
                    >
                      {t.enabled ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td className="px-6 py-3 text-center font-mono">{(t.daily_probability ?? 0).toFixed(4)}</td>
                  <td className="px-6 py-3 text-center font-mono">{t.duration_days_min}~{t.duration_days_max}</td>
                  <td className="px-6 py-3 text-center font-mono">{t.cooldown_days}</td>
                  <td className="px-6 py-3 text-center">
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-semibold">{t.scope}/{t.target_strategy}</span>
                    {t.store_closed && <span className="ml-2 px-2 py-0.5 rounded bg-rose-100 text-rose-700 text-xs font-semibold">停业</span>}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <button
                      onClick={() => openEditTemplate(t)}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => deleteTemplate(t.template_id)}
                      className="ml-2 px-3 py-1.5 rounded-lg bg-white text-rose-600 text-xs font-semibold border border-rose-200 hover:bg-rose-50"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-slate-500">后端未返回模板；请先启动后端或检查 /api/state.events。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inject */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <div className="font-bold text-slate-900">手动注入</div>
            <div className="text-xs text-slate-500 mt-1">用于联调/演示：指定模板、范围、目标、起始日与持续时间。</div>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase mb-1">模板</div>
              <select
                value={injectDraft.template_id}
                onChange={(e) => {
                  const tid = e.target.value;
                  const t = templates.find((x) => x.template_id === tid);
                  setInjectDraft((prev) => ({
                    ...prev,
                    template_id: tid,
                    scope: ((t?.scope as EventScope) || prev.scope),
                    target_id: '',
                  }));
                }}
                className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"
              >
                <option value="">(请选择)</option>
                {templates.map((t) => (
                  <option key={t.template_id} value={t.template_id}>{t.template_id} - {t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase mb-1">范围</div>
              <select
                value={injectDraft.scope}
                onChange={(e) => setInjectDraft((prev) => ({ ...prev, scope: e.target.value as EventScope, target_id: '' }))}
                className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"
              >
                <option value="global">global</option>
                <option value="station">station</option>
                <option value="store">store</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <div className="text-xs font-bold text-slate-500 uppercase mb-1">目标</div>
              {injectDraft.scope === 'global' ? (
                <div className="h-10 flex items-center px-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-sm">global 无需目标</div>
              ) : (
                <select
                  value={injectDraft.target_id}
                  onChange={(e) => setInjectDraft((prev) => ({ ...prev, target_id: e.target.value }))}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                >
                  <option value="">(请选择)</option>
                  {injectTargetOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase mb-1">起始日</div>
              <input
                value={injectDraft.start_day}
                onChange={(e) => setInjectDraft((prev) => ({ ...prev, start_day: Number(e.target.value) || state.day }))}
                type="number"
                className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm font-mono"
              />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase mb-1">持续(天)</div>
              <input
                value={injectDraft.duration_days}
                onChange={(e) => setInjectDraft((prev) => ({ ...prev, duration_days: Number(e.target.value) || 1 }))}
                type="number"
                min={1}
                className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm font-mono"
              />
            </div>
            <div className="md:col-span-2">
              <div className="text-xs font-bold text-slate-500 uppercase mb-1">强度(可选)</div>
              <input
                value={injectDraft.intensity}
                onChange={(e) => setInjectDraft((prev) => ({ ...prev, intensity: e.target.value }))}
                placeholder="留空=按模板随机；填 0~1 更直观"
                className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm font-mono"
              />
            </div>
            <div className="md:col-span-2 flex justify-end">
              <button
                onClick={runInject}
                disabled={!injectDraft.template_id || (injectDraft.scope !== 'global' && !injectDraft.target_id)}
                className="h-11 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold"
              >
                注入事件
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <div className="font-bold text-slate-900">当前生效</div>
            <div className="text-xs text-slate-500 mt-1">active_events（按 start_day 倒序）。</div>
          </div>
          <div className="p-4 space-y-3 max-h-[420px] overflow-auto">
            {active.map((e) => (
              <div key={e.event_id} className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-900 text-sm">{e.name}</div>
                    <div className="text-xs text-slate-500 font-mono mt-1">{e.event_id}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-semibold text-slate-700">D{e.start_day}~D{e.end_day}</div>
                    {e.store_closed && <div className="mt-1 inline-flex px-2 py-0.5 rounded bg-rose-100 text-rose-700 text-xs font-bold">停业</div>}
                  </div>
                </div>
                <div className="mt-3 text-xs text-slate-600 grid grid-cols-2 gap-2 font-mono">
                  <div>scope: {e.scope}</div>
                  <div>target: {e.target_id || '-'}</div>
                  <div>traffic: {e.traffic_multiplier.toFixed(3)}</div>
                  <div>conv: {e.conversion_multiplier.toFixed(3)}</div>
                  <div>cap: {e.capacity_multiplier.toFixed(3)}</div>
                  <div>var: {e.variable_cost_multiplier.toFixed(3)}</div>
                </div>
              </div>
            ))}
            {active.length === 0 && <div className="text-sm text-slate-500 text-center py-10">暂无生效事件</div>}
          </div>
        </div>
      </div>

      {/* History */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="font-bold text-slate-900">历史（最近 500）</div>
            <div className="text-xs text-slate-500 mt-1">仅展示 state.json 中保存的 event_history（不是从 ledger 反推）。</div>
          </div>
          <div className="text-xs text-slate-500">显示 {history.length} 条</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3 text-left">created</th>
                <th className="px-6 py-3 text-left">name</th>
                <th className="px-6 py-3">scope</th>
                <th className="px-6 py-3">target</th>
                <th className="px-6 py-3">range</th>
                <th className="px-6 py-3">closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((h) => (
                <tr key={h.event_id} className="hover:bg-slate-50">
                  <td className="px-6 py-3 font-mono text-xs text-slate-600">D{h.created_day}</td>
                  <td className="px-6 py-3">
                    <div className="font-semibold text-slate-900">{h.name}</div>
                    <div className="text-xs text-slate-500 font-mono">{h.template_id}</div>
                  </td>
                  <td className="px-6 py-3 text-center font-mono">{h.scope}</td>
                  <td className="px-6 py-3 text-center font-mono">{h.target_id || '-'}</td>
                  <td className="px-6 py-3 text-center font-mono">D{h.start_day}~D{h.end_day}</td>
                  <td className="px-6 py-3 text-center">
                    {h.store_closed ? <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-700 text-xs font-bold">YES</span> : <span className="text-slate-400 text-xs font-bold">NO</span>}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-slate-500">暂无历史事件</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Template Modal */}
      {templateModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-slate-900">{templateDraft.template_id ? '编辑模板' : '新建模板'}</div>
                <div className="text-xs text-slate-500 mt-1">保存会写入后端 state.json；模拟时按模板触发。</div>
              </div>
              <button className="text-slate-500 hover:text-slate-900" onClick={() => setTemplateModalOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">模板ID</div>
                <input
                  value={templateDraft.template_id || ''}
                  onChange={(e) => setTemplateDraft((prev) => ({ ...prev, template_id: e.target.value }))}
                  placeholder="留空=自动生成"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm font-mono"
                />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">启用</div>
                <select
                  value={String(Boolean(templateDraft.enabled))}
                  onChange={(e) => setTemplateDraft((prev) => ({ ...prev, enabled: e.target.value === 'true' }))}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                >
                  <option value="true">启用</option>
                  <option value="false">禁用</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">名称</div>
                <input
                  value={templateDraft.name || ''}
                  onChange={(e) => setTemplateDraft((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">类型</div>
                <select
                  value={(templateDraft as any).event_type || 'other'}
                  onChange={(e) => setTemplateDraft((prev) => ({ ...prev, event_type: e.target.value as any }))}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                >
                  <option value="weather">weather</option>
                  <option value="complaint">complaint</option>
                  <option value="outage">outage</option>
                  <option value="other">other</option>
                </select>
              </div>

              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">概率/日 (0~1)</div>
                <input
                  value={Number(templateDraft.daily_probability ?? 0)}
                  onChange={(e) => setTemplateDraft((prev) => ({ ...prev, daily_probability: Number(e.target.value) }))}
                  type="number"
                  step="0.001"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm font-mono"
                />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">持续最短(天)</div>
                <input
                  value={Number(templateDraft.duration_days_min ?? 1)}
                  onChange={(e) => setTemplateDraft((prev) => ({ ...prev, duration_days_min: Number(e.target.value) }))}
                  type="number"
                  min={1}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm font-mono"
                />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">持续最长(天)</div>
                <input
                  value={Number(templateDraft.duration_days_max ?? 1)}
                  onChange={(e) => setTemplateDraft((prev) => ({ ...prev, duration_days_max: Number(e.target.value) }))}
                  type="number"
                  min={1}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm font-mono"
                />
              </div>

              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">冷却(天)</div>
                <input
                  value={Number(templateDraft.cooldown_days ?? 0)}
                  onChange={(e) => setTemplateDraft((prev) => ({ ...prev, cooldown_days: Number(e.target.value) }))}
                  type="number"
                  min={0}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm font-mono"
                />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">强度最小</div>
                <input
                  value={Number(templateDraft.intensity_min ?? 0.3)}
                  onChange={(e) => setTemplateDraft((prev) => ({ ...prev, intensity_min: Number(e.target.value) }))}
                  type="number"
                  step="0.05"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm font-mono"
                />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">强度最大</div>
                <input
                  value={Number(templateDraft.intensity_max ?? 1.0)}
                  onChange={(e) => setTemplateDraft((prev) => ({ ...prev, intensity_max: Number(e.target.value) }))}
                  type="number"
                  step="0.05"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm font-mono"
                />
              </div>

              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">Scope</div>
                <select
                  value={(templateDraft as any).scope || 'store'}
                  onChange={(e) => setTemplateDraft((prev) => ({ ...prev, scope: e.target.value as any }))}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                >
                  <option value="global">global</option>
                  <option value="station">station</option>
                  <option value="store">store</option>
                </select>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">Target Strategy</div>
                <select
                  value={(templateDraft as any).target_strategy || 'random_one'}
                  onChange={(e) => setTemplateDraft((prev) => ({ ...prev, target_strategy: e.target.value as any }))}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                >
                  <option value="random_one">random_one</option>
                  <option value="all">all</option>
                </select>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase mb-1">停业</div>
                <select
                  value={String(Boolean((templateDraft as any).store_closed))}
                  onChange={(e) => setTemplateDraft((prev) => ({ ...prev, store_closed: e.target.value === 'true' }))}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                >
                  <option value="false">否</option>
                  <option value="true">是</option>
                </select>
              </div>

              <div className="md:col-span-3">
                <div className="text-xs font-bold text-slate-500 uppercase mb-2">倍率范围（min/max）</div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <div className="text-[11px] font-bold text-slate-500 uppercase mb-1">traffic</div>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={Number((templateDraft as any).traffic_multiplier_min ?? 1)} onChange={(e) => setTemplateDraft((p) => ({ ...p, traffic_multiplier_min: Number(e.target.value) as any }))} className="h-10 rounded-lg border border-slate-200 px-2 text-sm font-mono" />
                      <input value={Number((templateDraft as any).traffic_multiplier_max ?? 1)} onChange={(e) => setTemplateDraft((p) => ({ ...p, traffic_multiplier_max: Number(e.target.value) as any }))} className="h-10 rounded-lg border border-slate-200 px-2 text-sm font-mono" />
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-slate-500 uppercase mb-1">conversion</div>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={Number((templateDraft as any).conversion_multiplier_min ?? 1)} onChange={(e) => setTemplateDraft((p) => ({ ...p, conversion_multiplier_min: Number(e.target.value) as any }))} className="h-10 rounded-lg border border-slate-200 px-2 text-sm font-mono" />
                      <input value={Number((templateDraft as any).conversion_multiplier_max ?? 1)} onChange={(e) => setTemplateDraft((p) => ({ ...p, conversion_multiplier_max: Number(e.target.value) as any }))} className="h-10 rounded-lg border border-slate-200 px-2 text-sm font-mono" />
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-slate-500 uppercase mb-1">capacity</div>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={Number((templateDraft as any).capacity_multiplier_min ?? 1)} onChange={(e) => setTemplateDraft((p) => ({ ...p, capacity_multiplier_min: Number(e.target.value) as any }))} className="h-10 rounded-lg border border-slate-200 px-2 text-sm font-mono" />
                      <input value={Number((templateDraft as any).capacity_multiplier_max ?? 1)} onChange={(e) => setTemplateDraft((p) => ({ ...p, capacity_multiplier_max: Number(e.target.value) as any }))} className="h-10 rounded-lg border border-slate-200 px-2 text-sm font-mono" />
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-slate-500 uppercase mb-1">var_cost</div>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={Number((templateDraft as any).variable_cost_multiplier_min ?? 1)} onChange={(e) => setTemplateDraft((p) => ({ ...p, variable_cost_multiplier_min: Number(e.target.value) as any }))} className="h-10 rounded-lg border border-slate-200 px-2 text-sm font-mono" />
                      <input value={Number((templateDraft as any).variable_cost_multiplier_max ?? 1)} onChange={(e) => setTemplateDraft((p) => ({ ...p, variable_cost_multiplier_max: Number(e.target.value) as any }))} className="h-10 rounded-lg border border-slate-200 px-2 text-sm font-mono" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-200 flex justify-end gap-3 bg-slate-50">
              <button onClick={() => setTemplateModalOpen(false)} className="h-10 px-4 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold hover:bg-slate-50">取消</button>
              <button onClick={saveTemplate} className="h-10 px-4 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EventsPage;
