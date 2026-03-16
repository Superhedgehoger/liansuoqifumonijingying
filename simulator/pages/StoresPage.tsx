import React, { useState, useMemo, useContext } from 'react';
import { Link } from 'react-router-dom';
import { StateContext } from '../context';
import { Store } from '../types';
import { apiRenameStoreBulkTemplate, apiExportStoreBulkTemplates, apiImportStoreBulkTemplates } from '../services/api';

const StoresPage = () => {
  const { state, dispatch } = useContext(StateContext);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<'planning' | 'constructing' | 'open' | 'closed'>('open');
  const [bulkCloseOpen, setBulkCloseOpen] = useState(false);
  const [bulkInvSalvage, setBulkInvSalvage] = useState(0.3);
  const [bulkAssetSalvage, setBulkAssetSalvage] = useState(0.1);
  const [bulkResultOpen, setBulkResultOpen] = useState(false);
  const [bulkResults, setBulkResults] = useState<Array<{ store_id: string; ok: boolean; message: string }>>([]);
  const [templateName, setTemplateName] = useState('默认模板');
  const savedTemplates = useMemo(
    () => (state.bulk_templates?.store_ops || []),
    [state.bulk_templates]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const allSelected = state.stores.length > 0 && selectedIds.length === state.stores.length;
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(state.stores.map((s) => s.store_id));
    }
  };

  const runBulkClose = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`确认批量关店 ${selectedIds.length} 家？`)) return;
    setBulkBusy(true);
    const res: Array<{ store_id: string; ok: boolean; message: string }> = [];
    try {
      for (const id of selectedIds) {
        try {
          await dispatch({
            type: 'CLOSE_STORE',
            payload: {
              store_id: id,
              inventory_salvage_rate: Math.max(0, Math.min(1, Number(bulkInvSalvage) || 0)),
              asset_salvage_rate: Math.max(0, Math.min(1, Number(bulkAssetSalvage) || 0)),
            },
          });
          res.push({ store_id: id, ok: true, message: '关店成功' });
        } catch (e: any) {
          res.push({ store_id: id, ok: false, message: String(e?.message || e || '关店失败') });
        }
      }
      setSelectedIds([]);
      setBulkCloseOpen(false);
      setBulkResults(res);
      setBulkResultOpen(true);
    } finally {
      setBulkBusy(false);
    }
  };

  const runBulkStatus = async () => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    const res: Array<{ store_id: string; ok: boolean; message: string }> = [];
    try {
      for (const id of selectedIds) {
        try {
          await dispatch({ type: 'UPDATE_STORE', payload: { store_id: id, patch: { status: bulkStatus } } });
          res.push({ store_id: id, ok: true, message: `状态已改为 ${bulkStatus}` });
        } catch (e: any) {
          res.push({ store_id: id, ok: false, message: String(e?.message || e || '状态修改失败') });
        }
      }
      setSelectedIds([]);
      setBulkResults(res);
      setBulkResultOpen(true);
    } finally {
      setBulkBusy(false);
    }
  };

  const saveTemplate = async () => {
    const name = templateName.trim();
    if (!name) return;
    await dispatch({
      type: 'UPSERT_STORE_BULK_TEMPLATE',
      payload: {
      name,
      status: bulkStatus,
      inv: Math.max(0, Math.min(1, Number(bulkInvSalvage) || 0)),
      asset: Math.max(0, Math.min(1, Number(bulkAssetSalvage) || 0)),
      },
    });
  };

  const deleteTemplate = async (name: string) => {
    await dispatch({ type: 'DELETE_STORE_BULK_TEMPLATE', payload: { name } });
  };

  const renameTemplate = async () => {
    const oldName = templateName;
    const exists = savedTemplates.find((t) => t.name === oldName);
    if (!exists) {
      alert('请先输入已存在的模板名');
      return;
    }
    const newName = window.prompt('请输入新模板名', oldName)?.trim();
    if (!newName || newName === oldName) return;
    const next = await apiRenameStoreBulkTemplate(oldName, newName);
    await dispatch({ type: 'SET_STATE', payload: next } as any);
    setTemplateName(newName);
  };

  const exportTemplates = async () => {
    const data = await apiExportStoreBulkTemplates();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `store-bulk-templates-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importTemplates = async (file: File, mode: 'merge' | 'replace') => {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const templates = Array.isArray(parsed?.templates) ? parsed.templates : [];
    const next = await apiImportStoreBulkTemplates({ templates, mode });
    await dispatch({ type: 'SET_STATE', payload: next } as any);
  };

  const applyTemplate = (name: string) => {
    const t = savedTemplates.find((x) => x.name === name);
    if (!t) return;
    setBulkStatus(t.status);
    setBulkInvSalvage(t.inv);
    setBulkAssetSalvage(t.asset);
    setTemplateName(t.name);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const newStore: Partial<Store> = {
      store_id: formData.get('store_id') as string,
      name: formData.get('name') as string,
      station_id: formData.get('station_id') as string,
      build_days: Number(formData.get('build_days') || 30),
      capex_total: Number(formData.get('capex_total') || 150000),
      capex_useful_life_days: Number(formData.get('capex_useful_life_days') || 3650),
      operation_start_day: Number(formData.get('operation_start_day') || 1),
      traffic_conversion_rate: Number(formData.get('traffic_conversion_rate') || 1.0),
      city: (formData.get('city') as string) || '',
      district: (formData.get('district') as string) || '',
      provider: (formData.get('provider') as string) || '',
      status: 'planning'
    };
    dispatch({ type: 'ADD_STORE', payload: newStore });
    setIsModalOpen(false);
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'open': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'constructing': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'closed': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getStatusText = (status: string) => {
    switch(status) {
      case 'open': return '营业中';
      case 'constructing': return '建设中';
      case 'planning': return '筹备中';
      case 'closed': return '已关闭';
      default: return status;
    }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">门店运营</h1>
          <p className="text-slate-500">依托于站点的服务运营单元管理。</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 shadow-sm"
        >
          <span className="material-symbols-outlined">add_business</span>
          新建门店项目
        </button>
      </div>

      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            全选
          </label>
          <div className="text-sm text-slate-500">已选 {selectedIds.length} 家</div>
          <div className="h-5 w-px bg-slate-200" />
          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as any)} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
            <option value="planning">筹备中</option>
            <option value="constructing">建设中</option>
            <option value="open">营业中</option>
            <option value="closed">已关闭</option>
          </select>
          <button onClick={runBulkStatus} disabled={bulkBusy || selectedIds.length === 0} className="h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold disabled:opacity-50">批量改状态</button>
          <button onClick={() => setBulkCloseOpen(true)} disabled={bulkBusy || selectedIds.length === 0} className="h-9 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold disabled:opacity-50">批量关店</button>
          <div className="h-5 w-px bg-slate-200" />
          <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="模板名" className="h-9 w-28 rounded-lg border border-slate-300 px-2 text-xs" />
          <button onClick={saveTemplate} className="h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold">保存模板</button>
          <button onClick={renameTemplate} className="h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold">重命名</button>
          <button onClick={() => deleteTemplate(templateName)} disabled={!savedTemplates.some((t) => t.name === templateName)} className="h-9 px-3 rounded-lg border border-rose-300 text-rose-600 text-sm font-semibold disabled:opacity-50">删除模板</button>
          <select onChange={(e) => applyTemplate(e.target.value)} defaultValue="" className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
            <option value="">套用模板...</option>
            {savedTemplates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
          <button onClick={exportTemplates} className="h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold">导出JSON</button>
          <label className="h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold inline-flex items-center cursor-pointer">
            导入(合并)
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  await importTemplates(f, 'merge');
                } catch (err: any) {
                  alert(String(err?.message || err || '导入失败'));
                }
                e.currentTarget.value = '';
              }}
            />
          </label>
          <label className="h-9 px-3 rounded-lg border border-amber-300 text-amber-700 text-sm font-semibold inline-flex items-center cursor-pointer">
            导入(覆盖)
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (!window.confirm('覆盖导入会替换现有模板，确认继续？')) {
                  e.currentTarget.value = '';
                  return;
                }
                try {
                  await importTemplates(f, 'replace');
                } catch (err: any) {
                  alert(String(err?.message || err || '导入失败'));
                }
                e.currentTarget.value = '';
              }}
            />
          </label>
        </div>

        {state.stores.map((store) => (
          <div key={store.store_id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-6 flex-1">
              <label className="self-start md:self-center">
                <input type="checkbox" checked={selectedIds.includes(store.store_id)} onChange={() => toggleSelect(store.store_id)} />
              </label>
              <div className="h-16 w-16 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-3xl">storefront</span>
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-bold text-lg text-slate-900">{store.name}</h3>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border tracking-wide ${getStatusColor(store.status)}`}>
                    {getStatusText(store.status)}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-500">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">location_on</span>
                    {state.stations.find(s => s.station_id === store.station_id)?.name || store.station_id}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">account_balance_wallet</span>
                    余额: ¥{store.cash_balance?.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
            
               <div className="flex items-center gap-8 w-full md:w-auto border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6">
                <div className="text-center">
                  <span className="block text-xl font-bold text-slate-800">{store.services?.length || 0}</span>
                  <span className="text-xs text-slate-500 font-semibold">服务线</span>
                </div>
                <div className="text-center">
                  <span className="block text-xl font-bold text-slate-800">{store.roles?.reduce((acc, r) => acc + r.headcount, 0) || 0}</span>
                  <span className="text-xs text-slate-500 font-semibold">员工数</span>
                </div>
                <Link 
                  to={`/stores/${store.store_id}`}
                  className="px-6 py-2 bg-white border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-50 hover:border-slate-400 transition-colors"
                >
                  进入管理
                </Link>
              </div>
          </div>
        ))}
      </div>

       {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
             <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-slate-800">新建门店项目</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">门店 ID</label>
                <input required name="store_id" type="text" className="w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">门店名称</label>
                <input required name="name" type="text" className="w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">所属站点</label>
                <select required name="station_id" className="w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500">
                  <option value="">选择站点...</option>
                  {state.stations.map(s => (
                    <option key={s.station_id} value={s.station_id}>{s.name} ({s.station_id})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">地市</label>
                  <input name="city" type="text" className="w-full rounded-lg border-slate-300" placeholder="例如: 上海" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">片区</label>
                  <input name="district" type="text" className="w-full rounded-lg border-slate-300" placeholder="例如: 静安" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">服务商</label>
                  <input name="provider" type="text" className="w-full rounded-lg border-slate-300" placeholder="例如: 服务商A" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">建设周期 (天)</label>
                    <input name="build_days" type="number" defaultValue="30" className="w-full rounded-lg border-slate-300" />
                 </div>
                  <div>
                     <label className="block text-sm font-medium text-slate-700 mb-1">初始投资 (¥)</label>
                     <input name="capex_total" type="number" defaultValue="150000" className="w-full rounded-lg border-slate-300" />
                 </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">折旧天数</label>
                  <input name="capex_useful_life_days" type="number" defaultValue="3650" className="w-full rounded-lg border-slate-300" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">开始运营(第N天)</label>
                  <input name="operation_start_day" type="number" defaultValue="1" className="w-full rounded-lg border-slate-300" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">客流转化倍率(1=100%)</label>
                  <input name="traffic_conversion_rate" type="number" step="0.01" defaultValue="1.0" className="w-full rounded-lg border-slate-300" />
                </div>
              </div>
              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2.5 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50">取消</button>
                <button type="submit" className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">启动项目</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default StoresPage;
