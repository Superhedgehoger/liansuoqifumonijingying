import React, { useState, useMemo, useContext } from 'react';
import { Link } from 'react-router-dom';
import { StateContext } from '../context';
import { Station } from '../types';
import { apiUpsertStationBulkTemplate, apiDeleteStationBulkTemplate, apiRenameStationBulkTemplate, apiExportStationBulkTemplates, apiImportStationBulkTemplates } from '../services/api';

const StationsPage = () => {
  const { state, dispatch } = useContext(StateContext);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [search, setSearch] = useState('');
  const [selectedStationIds, setSelectedStationIds] = useState<string[]>([]);
  const [bulkFuelFactor, setBulkFuelFactor] = useState(1);
  const [bulkVisitorFactor, setBulkVisitorFactor] = useState(1);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [stationTemplateName, setStationTemplateName] = useState('站点默认');
  const stationTemplates = useMemo(() => state.bulk_templates?.station_ops || [], [state.bulk_templates]);

  const filteredStations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return state.stations;
    return state.stations.filter((s) => {
      const hay = `${s.station_id} ${s.name} ${s.station_type || ''} ${s.city || ''} ${s.district || ''} ${s.provider || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [state.stations, search]);

  const toggleSelectStation = (id: string) => {
    setSelectedStationIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const filteredIds = filteredStations.map((s) => s.station_id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedStationIds.includes(id));
  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedStationIds((prev) => prev.filter((id) => !filteredIds.includes(id)));
      return;
    }
    setSelectedStationIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
  };

  const runBulkAdjustTraffic = async () => {
    if (selectedStationIds.length === 0) return;
    setBulkBusy(true);
    try {
      for (const id of selectedStationIds) {
        const st = state.stations.find((x) => x.station_id === id);
        if (!st) continue;
        await dispatch({
          type: 'UPDATE_STATION',
          payload: {
            station_id: id,
            patch: {
              fuel_vehicles_per_day: Math.max(0, Math.round(Number(st.fuel_vehicles_per_day || 0) * Number(bulkFuelFactor || 1))),
              visitor_vehicles_per_day: Math.max(0, Math.round(Number(st.visitor_vehicles_per_day || 0) * Number(bulkVisitorFactor || 1))),
            },
          },
        });
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const runBulkDeleteStations = async () => {
    if (selectedStationIds.length === 0) return;
    if (!window.confirm(`确认批量删除 ${selectedStationIds.length} 个站点？可能导致关联门店孤立。`)) return;
    setBulkBusy(true);
    try {
      for (const id of selectedStationIds) {
        await dispatch({ type: 'DELETE_STATION', payload: id });
      }
      setSelectedStationIds([]);
    } finally {
      setBulkBusy(false);
    }
  };

  const saveStationTemplate = async () => {
    const name = stationTemplateName.trim();
    if (!name) return;
    const next = await apiUpsertStationBulkTemplate({
      name,
      fuel_factor: Math.max(0, Number(bulkFuelFactor) || 0),
      visitor_factor: Math.max(0, Number(bulkVisitorFactor) || 0),
    });
    await dispatch({ type: 'SET_STATE', payload: next } as any);
  };

  const applyStationTemplate = (name: string) => {
    const t = stationTemplates.find((x) => x.name === name);
    if (!t) return;
    setStationTemplateName(t.name);
    setBulkFuelFactor(Number(t.fuel_factor || 1));
    setBulkVisitorFactor(Number(t.visitor_factor || 1));
  };

  const deleteStationTemplate = async (name: string) => {
    const next = await apiDeleteStationBulkTemplate(name);
    await dispatch({ type: 'SET_STATE', payload: next } as any);
  };

  const renameStationTemplate = async () => {
    const oldName = stationTemplateName;
    if (!stationTemplates.some((x) => x.name === oldName)) {
      alert('请先输入已存在模板名');
      return;
    }
    const newName = window.prompt('请输入新模板名', oldName)?.trim();
    if (!newName || newName === oldName) return;
    const next = await apiRenameStationBulkTemplate(oldName, newName);
    await dispatch({ type: 'SET_STATE', payload: next } as any);
    setStationTemplateName(newName);
  };

  const exportStationTemplates = async () => {
    const data = await apiExportStationBulkTemplates();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `station-bulk-templates-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importStationTemplates = async (file: File, mode: 'merge' | 'replace') => {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const templates = Array.isArray(parsed?.templates) ? parsed.templates : [];
    const next = await apiImportStationBulkTemplates({ templates, mode });
    await dispatch({ type: 'SET_STATE', payload: next } as any);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const newStation: Station = {
      station_id: formData.get('station_id') as string,
      name: formData.get('name') as string,
      station_type: (formData.get('station_type') as string) || '',
      city: (formData.get('city') as string) || '',
      district: (formData.get('district') as string) || '',
      provider: (formData.get('provider') as string) || '',
      fuel_vehicles_per_day: Number(formData.get('fuel_vehicles_per_day')),
      visitor_vehicles_per_day: Number(formData.get('visitor_vehicles_per_day')) || 10,
      traffic_volatility: Number(formData.get('traffic_volatility')) || 0.1,
    };
    dispatch({ type: 'ADD_STATION', payload: newStation });
    setIsModalOpen(false);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">站点网络</h1>
          <p className="text-slate-500">管理您的物理站点位置及车流参数。</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-slate-100 p-1 rounded-lg flex items-center">
            <button onClick={() => setViewMode('cards')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${viewMode === 'cards' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>卡片</button>
            <button onClick={() => setViewMode('list')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>列表</button>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 shadow-sm"
          >
            <span className="material-symbols-outlined">add_location</span>
            新增站点
          </button>
        </div>
      </div>

      <div className="mb-5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="按ID/名称/地市/片区/服务商搜索"
          className="w-full md:w-96 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="text-xs text-slate-500 mt-1">共 {filteredStations.length} 个站点</div>
      </div>

      <div className="mb-5 bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAllFiltered} />
          全选当前筛选
        </label>
        <div className="text-sm text-slate-500">已选 {selectedStationIds.length} 个</div>
        <div className="h-5 w-px bg-slate-200" />
        <label className="text-xs text-slate-500">加油车流倍率</label>
        <input type="number" step="0.05" value={bulkFuelFactor} onChange={(e) => setBulkFuelFactor(Number(e.target.value) || 1)} className="h-9 w-24 rounded-lg border border-slate-300 px-2 text-sm font-mono" />
        <label className="text-xs text-slate-500">访客倍率</label>
        <input type="number" step="0.05" value={bulkVisitorFactor} onChange={(e) => setBulkVisitorFactor(Number(e.target.value) || 1)} className="h-9 w-24 rounded-lg border border-slate-300 px-2 text-sm font-mono" />
        <button onClick={runBulkAdjustTraffic} disabled={bulkBusy || selectedStationIds.length === 0} className="h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold disabled:opacity-50">批量调流量</button>
        <button onClick={runBulkDeleteStations} disabled={bulkBusy || selectedStationIds.length === 0} className="h-9 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold disabled:opacity-50">批量删除</button>
        <div className="h-5 w-px bg-slate-200" />
        <input value={stationTemplateName} onChange={(e) => setStationTemplateName(e.target.value)} placeholder="模板名" className="h-9 w-28 rounded-lg border border-slate-300 px-2 text-xs" />
        <button onClick={saveStationTemplate} className="h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold">保存模板</button>
        <button onClick={renameStationTemplate} className="h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold">重命名</button>
        <button onClick={() => deleteStationTemplate(stationTemplateName)} disabled={!stationTemplates.some((t) => t.name === stationTemplateName)} className="h-9 px-3 rounded-lg border border-rose-300 text-rose-600 text-sm font-semibold disabled:opacity-50">删除模板</button>
        <select onChange={(e) => applyStationTemplate(e.target.value)} defaultValue="" className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
          <option value="">套用模板...</option>
          {stationTemplates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
        <button onClick={exportStationTemplates} className="h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold">导出JSON</button>
        <label className="h-9 px-3 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold inline-flex items-center cursor-pointer">
          导入(合并)
          <input type="file" accept="application/json,.json" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try { await importStationTemplates(f, 'merge'); } catch (err: any) { alert(String(err?.message || err || '导入失败')); }
            e.currentTarget.value = '';
          }} />
        </label>
        <label className="h-9 px-3 rounded-lg border border-amber-300 text-amber-700 text-sm font-semibold inline-flex items-center cursor-pointer">
          导入(覆盖)
          <input type="file" accept="application/json,.json" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (!window.confirm('覆盖导入会替换现有站点模板，确认继续？')) { e.currentTarget.value = ''; return; }
            try { await importStationTemplates(f, 'replace'); } catch (err: any) { alert(String(err?.message || err || '导入失败')); }
            e.currentTarget.value = '';
          }} />
        </label>
      </div>

      {viewMode === 'cards' && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredStations.map((station) => (
          <div key={station.station_id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden group">
            <div className="h-32 bg-slate-100 relative">
              <label className="absolute top-3 left-3 z-10 bg-white/90 rounded px-1.5 py-1">
                <input type="checkbox" checked={selectedStationIds.includes(station.station_id)} onChange={() => toggleSelectStation(station.station_id)} />
              </label>
              <img 
                src={`https://picsum.photos/seed/${station.station_id}/400/200`} 
                alt="Station map" 
                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
              />
              <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-2 py-1 rounded text-xs font-bold text-slate-700">
                ID: {station.station_id}
              </div>
            </div>
            <div className="p-5">
              <h3 className="font-bold text-lg text-slate-800 mb-1">{station.name}</h3>
              <div className="flex items-center gap-2 text-slate-500 text-sm mb-4">
                <span className="material-symbols-outlined text-[18px]">traffic</span>
                {station.fuel_vehicles_per_day.toLocaleString()} 车/天
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-xs text-slate-500 py-3 border-t border-slate-100">
                <div>
                  <span className="block text-slate-400">其他访客</span>
                  <span className="font-semibold text-slate-700">{station.visitor_vehicles_per_day}/天</span>
                </div>
                <div>
                  <span className="block text-slate-400">流量波动率</span>
                  <span className="font-semibold text-slate-700">{(station.traffic_volatility * 100).toFixed(0)}%</span>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <Link to={`/stations/${station.station_id}`} className="flex-1 text-center py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded border border-slate-200 text-sm font-medium transition-colors">
                  管理详情
                </Link>
                <button 
                  onClick={() => {
                     if(window.confirm('确定要删除该站点吗？')) dispatch({type: 'DELETE_STATION', payload: station.station_id});
                  }}
                  className="px-3 py-2 text-red-600 hover:bg-red-50 rounded border border-transparent hover:border-red-100 transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]">delete</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      )}

      {viewMode === 'list' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-center">选择</th>
                  <th className="px-4 py-3 text-left">ID</th>
                  <th className="px-4 py-3 text-left">名称</th>
                  <th className="px-4 py-3 text-center">地市/片区</th>
                  <th className="px-4 py-3 text-center">车流(加油/访客)</th>
                  <th className="px-4 py-3 text-center">波动率</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStations.map((station) => (
                  <tr key={station.station_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-center"><input type="checkbox" checked={selectedStationIds.includes(station.station_id)} onChange={() => toggleSelectStation(station.station_id)} /></td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{station.station_id}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{station.name}</div>
                      <div className="text-xs text-slate-500">{station.station_type || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-slate-600">{station.city || '-'} / {station.district || '-'}</td>
                    <td className="px-4 py-3 text-center font-mono">{station.fuel_vehicles_per_day}/{station.visitor_vehicles_per_day}</td>
                    <td className="px-4 py-3 text-center font-mono">{(station.traffic_volatility * 100).toFixed(0)}%</td>
                    <td className="px-4 py-3 text-right">
                      <Link to={`/stations/${station.station_id}`} className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50">详情</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800">新增站点</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">站点 ID</label>
                <input required name="station_id" type="text" className="w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500" placeholder="例如: S-101" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">站点名称</label>
                <input required name="name" type="text" className="w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500" placeholder="例如: 北区枢纽" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">站点类型</label>
                <input name="station_type" type="text" className="w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500" placeholder="例如: 城市站/高速站" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">地市</label>
                  <input name="city" type="text" className="w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500" placeholder="例如: 上海" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">片区</label>
                  <input name="district" type="text" className="w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500" placeholder="例如: 静安" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">服务商</label>
                  <input name="provider" type="text" className="w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500" placeholder="例如: 服务商A" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">加油车流 (辆/天)</label>
                  <input required name="fuel_vehicles_per_day" type="number" className="w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500" placeholder="1000" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">流量波动率 (0-1)</label>
                  <input required name="traffic_volatility" step="0.01" max="1" min="0" type="number" defaultValue="0.1" className="w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500" />
                </div>
              </div>
               <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">非加油访客 (辆/天)</label>
                  <input required name="visitor_vehicles_per_day" type="number" defaultValue="10" className="w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500" />
               </div>
              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2.5 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50">取消</button>
                <button type="submit" className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">创建站点</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default StationsPage;
