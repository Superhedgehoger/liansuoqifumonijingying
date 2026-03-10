import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { initialMockState } from './services/mockData';
import {
  SimulationState,
  Station,
  Store,
  ServiceLine,
  Asset,
  PayrollRole,
  ServiceProject,
  InventoryItem,
  EventTemplate,
  EventScope,
} from './types';
import {
  apiAddAsset,
  apiCloseStore,
  apiCreateStation,
  apiCreateStore,
  apiDeleteAsset,
  apiDeleteEventTemplate,
  apiDeleteReplenishmentRule,
  apiDeleteProject,
  apiDeleteRole,
  apiDeleteServiceLine,
  apiDeleteStation,
  apiGetState,
  apiImportLedgerFile,
  apiImportStateFile,
  apiGetSimulateJobStatus,
  apiInjectEvent,
  apiPurchaseInventory,
  apiRollback,
  apiReset,
  apiStartSimulateAsync,
  apiCancelSimulateJob,
  apiSetEventSeed,
  apiSimulate,
  apiUpsertReplenishmentRule,
  apiUpdateStation,
  apiUpdateStore,
  apiUpsertEventTemplate,
  apiUpsertProject,
  apiUpsertRole,
  apiUpsertStoreBulkTemplate,
  apiUpdateFinance,
  apiDeleteStoreBulkTemplate,
  apiRenameStoreBulkTemplate,
  apiExportStoreBulkTemplates,
  apiImportStoreBulkTemplates,
  apiUpsertStationBulkTemplate,
  apiDeleteStationBulkTemplate,
  apiRenameStationBulkTemplate,
  apiExportStationBulkTemplates,
  apiImportStationBulkTemplates,
  apiUpsertServiceLine
} from './services/api';
import {
  HashRouter as Router,
  Routes,
  Route,
  Link,
  useLocation,
  useParams,
  useNavigate
} from 'react-router-dom';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  Legend
} from 'recharts';
import { StateContext } from './context';

const StrategyPageLazy = lazy(() => import('./pages/StrategyPage'));
const GISPageLazy = lazy(() => import('./pages/GISPage'));
const EventsPageLazy = lazy(() => import('./pages/EventsPage'));
const StoreDetailPageLazy = lazy(() => import('./pages/StoreDetailPage'));

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-64">
    <div className="text-slate-500">加载中...</div>
  </div>
);

// --- Global Context ---
const _StateContext = StateContext;

// --- Components ---

const Sidebar = () => {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`);

  // Hide main sidebar on GIS page to allow full screen immersion
  if (location.pathname === '/gis') return null;

  const navItems = [
    { name: '总览看板', path: '/', icon: 'dashboard' },
    { name: '站点管理', path: '/stations', icon: 'local_gas_station' },
    { name: '门店运营', path: '/stores', icon: 'storefront' },
    { name: '事件管理', path: '/events', icon: 'bolt' },
    { name: '策略实验', path: '/strategy', icon: 'experiment' },
    { name: '财务报表', path: '/reports', icon: 'analytics' },
    { name: '地图分析', path: '/gis', icon: 'map' },
    { name: '数据导入', path: '/data', icon: 'upload_file' },
  ];

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col h-full shrink-0 transition-all duration-300">
      <div className="p-6 flex items-center gap-3 border-b border-slate-800">
        <div className="bg-blue-600 p-2 rounded-lg text-white">
          <span className="material-symbols-outlined text-xl">directions_car</span>
        </div>
        <h1 className="font-bold text-white tracking-tight">汽服经营模拟</h1>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              isActive(item.path)
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
            <span className="text-sm font-medium">{item.name}</span>
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-800">
        <div className="bg-slate-800/50 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase mb-2">后端状态</p>
          <div className="flex items-center gap-2 text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-bold">在线 (Simulated)</span>
          </div>
        </div>
      </div>
    </aside>
  );
};

const ImportDataModal = ({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => Promise<void>;
}) => {
  const [stateFile, setStateFile] = useState<File | null>(null);
  const [ledgerFile, setLedgerFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const stateInputRef = React.useRef<HTMLInputElement | null>(null);
  const ledgerInputRef = React.useRef<HTMLInputElement | null>(null);

  const clearPickedFiles = () => {
    setStateFile(null);
    setLedgerFile(null);
    if (stateInputRef.current) stateInputRef.current.value = '';
    if (ledgerInputRef.current) ledgerInputRef.current.value = '';
  };

  const doImport = async () => {
    if (loading) return;
    if (!stateFile && !ledgerFile) {
      setMsg('请至少选择一个文件');
      return;
    }
    setLoading(true);
    setMsg('');
    try {
      if (stateFile) await apiImportStateFile(stateFile);
      if (ledgerFile) await apiImportLedgerFile(ledgerFile);
      await Promise.race([
        onImported(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('刷新状态超时，请手动刷新页面')), 15000)),
      ]);
      setMsg('导入成功');
      clearPickedFiles();
      setTimeout(() => onClose(), 300);
    } catch (e: any) {
      const message = String(e?.name === 'AbortError' ? '导入超时，请重试' : (e?.message || e || '导入失败'));
      setMsg(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold text-slate-900">导入数据</div>
            <div className="text-xs text-slate-500 mt-1">可上传 `state.json` 与 `ledger.csv`，立即覆盖当前数据。</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase mb-1">state.json</div>
            <input
              ref={stateInputRef}
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                setStateFile(e.target.files?.[0] || null);
                setMsg('');
              }}
              className="block w-full text-sm"
            />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase mb-1">ledger.csv</div>
            <input
              ref={ledgerInputRef}
              type="file"
              accept="text/csv,.csv"
              onChange={(e) => {
                setLedgerFile(e.target.files?.[0] || null);
                setMsg('');
              }}
              className="block w-full text-sm"
            />
          </div>
          <div className="text-xs text-slate-500">生成与导入后的文件都在：`data/state.json`、`data/ledger.csv`、`data/snapshots/`（项目根目录）。</div>
          {msg && <div className="text-sm text-slate-700 bg-slate-100 rounded-lg px-3 py-2">{msg}</div>}
        </div>

        <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-slate-300 bg-white text-slate-700 font-semibold">关闭</button>
          <button onClick={doImport} disabled={loading} className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-60">
            {loading ? '导入中...' : '开始导入'}
          </button>
        </div>
      </div>
    </div>
  );
};

const TemplateCenterModal = ({ onClose }: { onClose: () => void }) => {
  const { state, dispatch } = React.useContext(StateContext);
  const [tab, setTab] = useState<'store' | 'station'>('store');
  const [storeName, setStoreName] = useState('');
  const [stationName, setStationName] = useState('');

  const storeTemplates = state.bulk_templates?.store_ops || [];
  const stationTemplates = state.bulk_templates?.station_ops || [];

  const exportStore = async () => {
    const data = await apiExportStoreBulkTemplates();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `store-bulk-templates-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportStation = async () => {
    const data = await apiExportStationBulkTemplates();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `station-bulk-templates-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAllTemplatesCsv = () => {
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const rows: string[] = [];
    rows.push(['template_type', 'name', 'status', 'inv', 'asset', 'fuel_factor', 'visitor_factor'].join(','));

    for (const t of storeTemplates) {
      rows.push([
        esc('store_ops'),
        esc(t.name),
        esc(t.status),
        esc(t.inv),
        esc(t.asset),
        esc(''),
        esc(''),
      ].join(','));
    }

    for (const t of stationTemplates) {
      rows.push([
        esc('station_ops'),
        esc(t.name),
        esc(''),
        esc(''),
        esc(''),
        esc(t.fuel_factor),
        esc(t.visitor_factor),
      ].join(','));
    }

    const csv = `\uFEFF${rows.join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all-bulk-templates-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold text-slate-900">模板中心</div>
            <div className="text-xs text-slate-500 mt-1">统一管理门店/站点批量模板（重命名、删除、导入导出）。</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900"><span className="material-symbols-outlined">close</span></button>
        </div>

        <div className="px-6 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="bg-slate-100 p-1 rounded-lg inline-flex">
              <button onClick={() => setTab('store')} className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === 'store' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>门店模板</button>
              <button onClick={() => setTab('station')} className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === 'station' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>站点模板</button>
            </div>
            <button onClick={exportAllTemplatesCsv} className="h-9 px-3 rounded-lg border border-blue-300 text-blue-700 bg-blue-50 text-sm font-semibold hover:bg-blue-100">导出全部CSV</button>
          </div>
        </div>

        <div className="p-6 space-y-3 max-h-[70vh] overflow-auto">
          {tab === 'store' && (
            <>
              <div className="flex gap-2">
                <input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="输入模板名后可重命名/删除" className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm" />
                <button onClick={exportStore} className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-semibold">导出JSON</button>
                <label className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-semibold inline-flex items-center cursor-pointer">导入合并
                  <input type="file" className="hidden" accept="application/json,.json" onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    const text = await f.text(); const parsed = JSON.parse(text);
                    const next = await apiImportStoreBulkTemplates({ templates: Array.isArray(parsed?.templates) ? parsed.templates : [], mode: 'merge' });
                    await dispatch({ type: 'SET_STATE', payload: next } as any); e.currentTarget.value = '';
                  }} />
                </label>
                <label className="h-10 px-3 rounded-lg border border-amber-300 text-amber-700 text-sm font-semibold inline-flex items-center cursor-pointer">导入覆盖
                  <input type="file" className="hidden" accept="application/json,.json" onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    if (!window.confirm('覆盖导入会替换现有模板，确认继续？')) { e.currentTarget.value=''; return; }
                    const text = await f.text(); const parsed = JSON.parse(text);
                    const next = await apiImportStoreBulkTemplates({ templates: Array.isArray(parsed?.templates) ? parsed.templates : [], mode: 'replace' });
                    await dispatch({ type: 'SET_STATE', payload: next } as any); e.currentTarget.value='';
                  }} />
                </label>
              </div>
              <div className="space-y-2">
                {storeTemplates.map((t) => (
                  <div key={t.name} className="border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-2">
                    <div className="text-sm"><div className="font-semibold text-slate-900">{t.name}</div><div className="text-xs text-slate-500">{t.status} | inv={t.inv} | asset={t.asset}</div></div>
                    <div className="flex gap-1">
                      <button onClick={() => setStoreName(t.name)} className="px-2 py-1 text-xs rounded border border-slate-300">选中</button>
                      <button onClick={async () => {
                        const n = window.prompt('新模板名', t.name)?.trim();
                        if (!n || n === t.name) return;
                        const next = await apiRenameStoreBulkTemplate(t.name, n);
                        await dispatch({ type: 'SET_STATE', payload: next } as any);
                      }} className="px-2 py-1 text-xs rounded border border-slate-300">重命名</button>
                      <button onClick={async () => {
                        const next = await apiDeleteStoreBulkTemplate(t.name);
                        await dispatch({ type: 'SET_STATE', payload: next } as any);
                      }} className="px-2 py-1 text-xs rounded border border-rose-300 text-rose-600">删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'station' && (
            <>
              <div className="flex gap-2">
                <input value={stationName} onChange={(e) => setStationName(e.target.value)} placeholder="输入模板名后可重命名/删除" className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm" />
                <button onClick={exportStation} className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-semibold">导出JSON</button>
                <label className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-semibold inline-flex items-center cursor-pointer">导入合并
                  <input type="file" className="hidden" accept="application/json,.json" onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    const text = await f.text(); const parsed = JSON.parse(text);
                    const next = await apiImportStationBulkTemplates({ templates: Array.isArray(parsed?.templates) ? parsed.templates : [], mode: 'merge' });
                    await dispatch({ type: 'SET_STATE', payload: next } as any); e.currentTarget.value='';
                  }} />
                </label>
                <label className="h-10 px-3 rounded-lg border border-amber-300 text-amber-700 text-sm font-semibold inline-flex items-center cursor-pointer">导入覆盖
                  <input type="file" className="hidden" accept="application/json,.json" onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    if (!window.confirm('覆盖导入会替换现有模板，确认继续？')) { e.currentTarget.value=''; return; }
                    const text = await f.text(); const parsed = JSON.parse(text);
                    const next = await apiImportStationBulkTemplates({ templates: Array.isArray(parsed?.templates) ? parsed.templates : [], mode: 'replace' });
                    await dispatch({ type: 'SET_STATE', payload: next } as any); e.currentTarget.value='';
                  }} />
                </label>
              </div>
              <div className="space-y-2">
                {stationTemplates.map((t) => (
                  <div key={t.name} className="border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-2">
                    <div className="text-sm"><div className="font-semibold text-slate-900">{t.name}</div><div className="text-xs text-slate-500">fuel={t.fuel_factor} | visitor={t.visitor_factor}</div></div>
                    <div className="flex gap-1">
                      <button onClick={() => setStationName(t.name)} className="px-2 py-1 text-xs rounded border border-slate-300">选中</button>
                      <button onClick={async () => {
                        const n = window.prompt('新模板名', t.name)?.trim();
                        if (!n || n === t.name) return;
                        const next = await apiRenameStationBulkTemplate(t.name, n);
                        await dispatch({ type: 'SET_STATE', payload: next } as any);
                      }} className="px-2 py-1 text-xs rounded border border-slate-300">重命名</button>
                      <button onClick={async () => {
                        const next = await apiDeleteStationBulkTemplate(t.name);
                        await dispatch({ type: 'SET_STATE', payload: next } as any);
                      }} className="px-2 py-1 text-xs rounded border border-rose-300 text-rose-600">删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const Header = () => {
  const { state, dispatch } = React.useContext(StateContext);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatingHint, setSimulatingHint] = useState('');
  const [simProgress, setSimProgress] = useState(0);
  const [simJobId, setSimJobId] = useState('');
  const [simCancelable, setSimCancelable] = useState(false);
  const [daysInput, setDaysInput] = useState<number>(7);
  const [importOpen, setImportOpen] = useState(false);
  const [templateCenterOpen, setTemplateCenterOpen] = useState(false);
  const location = useLocation();

  // Hide main header on GIS page
  if (location.pathname === '/gis') return null;

  const handleSimulate = async (days: number) => {
    const n = Math.max(1, Math.min(3650, Number(days) || 1));
    setSimulatingHint(`正在创建模拟任务（${n} 天）...`);
    setSimProgress(0);
    setSimJobId('');
    setSimCancelable(false);
    setIsSimulating(true);
    try {
      const created = await apiStartSimulateAsync(n);
      if (!created?.job_id || created?.error || created?.code === 'simulation_busy') {
        throw new Error(created?.error || '已有模拟任务在执行，请稍后再试');
      }
      const jobId = String(created.job_id);
      setSimJobId(jobId);
      setSimCancelable(true);
      setSimulatingHint(created.message || `正在模拟 0/${n} 天`);
      setSimProgress(Math.max(0, Math.min(1, Number(created.progress) || 0)));

      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const status = await apiGetSimulateJobStatus(jobId);
        const st = String(status?.status || '');
        const progress = Math.max(0, Math.min(1, Number(status?.progress) || 0));
        setSimProgress(progress);
        setSimulatingHint(status?.message || `正在模拟 ${status?.completed_days || 0}/${status?.days || n} 天`);

        if (st === 'pending' || st === 'running') continue;

        if (st === 'succeeded') {
          const next = await apiGetState();
          await dispatch({ type: 'SET_STATE', payload: next } as any);
          break;
        }
        if (st === 'cancelled') {
          window.alert('模拟已取消');
          break;
        }
        throw new Error(status?.error || status?.message || '模拟失败');
      }
    } catch (e: any) {
      const message = String(e?.message || e || '模拟失败');
      window.alert(message);
    } finally {
      setIsSimulating(false);
      setSimulatingHint('');
      setSimProgress(0);
      setSimJobId('');
      setSimCancelable(false);
    }
  };

  const handleCancelSimulate = async () => {
    if (!simJobId || !simCancelable) return;
    setSimCancelable(false);
    setSimulatingHint('已请求取消，正在结束当前步...');
    try {
      await apiCancelSimulateJob(simJobId);
    } catch (e: any) {
      const message = String(e?.message || e || '取消失败');
      window.alert(message);
    }
  };

  const handleRollback = async () => {
    const days = Math.max(1, Math.min(365, Number(daysInput) || 1));
    if (!window.confirm(`确认回退 ${days} 天？`)) return;
    setSimulatingHint(`正在回退 ${days} 天，请稍候...`);
    setSimProgress(0);
    setSimJobId('');
    setSimCancelable(false);
    setIsSimulating(true);
    try {
      await dispatch({ type: 'ROLLBACK_DAYS', payload: days });
    } finally {
      setIsSimulating(false);
      setSimulatingHint('');
    }
  };

  const handleReset = async () => {
    if (!window.confirm('确认重置模拟数据？这会清空 state.json/ledger.csv/snapshots。')) return;
    setSimulatingHint('正在重置模拟数据，请稍候...');
    setSimProgress(0);
    setSimJobId('');
    setSimCancelable(false);
    setIsSimulating(true);
    try {
      const next = await apiReset();
      await dispatch({ type: 'SET_STATE', payload: next } as any);
      window.alert('重置成功');
    } catch (e: any) {
      const message = String(e?.message || e || '重置失败');
      window.alert(message);
    } finally {
      setIsSimulating(false);
      setSimulatingHint('');
    }
  };

  const simulationOptions = [
    { label: '过一天', days: 1, icon: 'play_arrow' },
    { label: '过一周', days: 7, icon: 'fast_forward' },
    { label: '过一月', days: 30, icon: 'calendar_month' },
    { label: '过一季', days: 90, icon: 'date_range' },
    { label: '过半年', days: 180, icon: 'history' },
    { label: '过一年', days: 365, icon: 'rocket_launch' },
  ];

  return (
    <>
    <header className="bg-white border-b border-slate-200 h-16 px-8 flex items-center justify-between sticky top-0 z-10 shadow-sm">
      <div className="flex items-center gap-6">
        <h2 className="text-xl font-bold text-slate-800">第 {state.day} 天</h2>
        <span className="px-3 py-1 bg-slate-100 rounded-full text-xs font-semibold text-slate-500">
          Q{Math.ceil(((state.day % 365) || 1) / 90)} - {new Date().getFullYear() + Math.floor(state.day / 365)}
        </span>
      </div>
      
      <div className="flex items-center gap-4">
        <div className="text-right mr-4 hidden md:block">
          <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">现金余额</p>
          <p className="text-lg font-mono font-bold text-slate-800">
            ¥{state.cash.toLocaleString()}
          </p>
        </div>

        <div className="hidden md:flex items-center gap-2">
          <button
            onClick={() => setTemplateCenterOpen(true)}
            className="h-9 px-3 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-white hover:shadow-sm"
            title="打开模板中心"
          >
            模板中心
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="h-9 px-3 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-white hover:shadow-sm"
            title="打开数据导入弹窗"
          >
            导入/导出
          </button>
        </div>
        
        <div className="flex items-center bg-slate-100 p-1 rounded-lg">
          {simulationOptions.map((opt) => (
             <button 
              key={opt.days}
              onClick={() => handleSimulate(opt.days)}
              disabled={isSimulating}
              title={`模拟 ${opt.days} 天`}
              className={`flex items-center justify-center size-9 rounded-md transition-all active:scale-95 text-slate-600 hover:bg-white hover:text-blue-600 hover:shadow-sm disabled:opacity-50 disabled:cursor-wait`}
            >
              <span className={`material-symbols-outlined text-[20px] ${isSimulating ? 'animate-pulse' : ''}`}>
                {opt.icon}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            value={daysInput}
            onChange={(e) => setDaysInput(Number(e.target.value) || 1)}
            min={1}
            max={365}
            type="number"
            className="w-20 h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-mono"
            title="输入天数(1-365)"
          />
          <button
            onClick={handleRollback}
            disabled={isSimulating}
            className="flex items-center justify-center size-9 rounded-lg bg-slate-100 text-slate-600 hover:bg-white hover:text-blue-600 hover:shadow-sm disabled:opacity-50"
            title="回退(1-365天)"
          >
            <span className="material-symbols-outlined text-[20px]">undo</span>
          </button>
          <button
            onClick={handleReset}
            disabled={isSimulating}
            className="flex items-center justify-center size-9 rounded-lg bg-slate-100 text-slate-600 hover:bg-white hover:text-rose-600 hover:shadow-sm disabled:opacity-50"
            title="重置模拟"
          >
            <span className="material-symbols-outlined text-[20px]">restart_alt</span>
          </button>
        </div>
      </div>
    </header>
    {importOpen && (
      <ImportDataModal
        onClose={() => setImportOpen(false)}
        onImported={async () => {
          const next = await apiGetState();
          await dispatch({ type: 'SET_STATE', payload: next } as any);
        }}
      />
    )}
    {isSimulating && (
      <div className="fixed top-20 right-6 z-50 max-w-sm rounded-lg border border-blue-200 bg-white/95 shadow-lg px-4 py-3">
        <div className="flex items-center gap-2 text-blue-700">
          <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
          <span className="text-sm font-semibold">{simulatingHint || '正在模拟中，请稍候...'}</span>
        </div>
        {simJobId && (
          <>
            <div className="mt-2 h-2 rounded bg-blue-100 overflow-hidden">
              <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${Math.round(simProgress * 100)}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>进度 {Math.round(simProgress * 100)}%</span>
              <button onClick={handleCancelSimulate} disabled={!simCancelable} className="px-2 py-1 rounded border border-slate-300 text-slate-600 disabled:opacity-50">取消</button>
            </div>
          </>
        )}
      </div>
    )}
    {templateCenterOpen && <TemplateCenterModal onClose={() => setTemplateCenterOpen(false)} />}
    </>
  );
};

// --- GIS Page Component (Dark Mode) ---

// --- Dashboard Component (Updated with Tabs & Map) ---

const Dashboard = () => {
  const { state } = React.useContext(StateContext);
  const [activeTab, setActiveTab] = useState<'overview' | 'map'>('overview');

  const stats = [
    { title: '站点总数', value: state.stations.length, icon: 'local_gas_station', color: 'bg-blue-100 text-blue-600' },
    { title: '营业门店', value: state.stores.filter(s => s.status === 'open').length, icon: 'storefront', color: 'bg-emerald-100 text-emerald-600' },
    { title: '现金流', value: `¥${(state.cash / 10000).toFixed(2)}万`, icon: 'payments', color: 'bg-indigo-100 text-indigo-600' },
    { title: '今日交易', value: '1,240', icon: 'receipt_long', color: 'bg-amber-100 text-amber-600' },
  ];

  // Mock chart data derived from ledger
  const chartData = state.ledger.slice(0, 7).reverse().map(l => ({
    name: `Day ${l.day}`,
    revenue: l.amount > 0 ? l.amount : 0,
    cost: l.amount < 0 ? Math.abs(l.amount) : 0
  }));

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <div key={stat.title} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">{stat.title}</p>
              <h3 className="text-2xl font-bold text-slate-800">{stat.value}</h3>
            </div>
            <div className={`p-3 rounded-lg ${stat.color}`}>
              <span className="material-symbols-outlined">{stat.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-8">
          <button 
            onClick={() => setActiveTab('overview')}
            className={`whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium transition-colors ${activeTab === 'overview' ? 'border-blue-600 text-blue-600 font-bold' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}
          >
            看板概览
          </button>
          <button 
            onClick={() => setActiveTab('map')}
            className={`whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'map' ? 'border-blue-600 text-blue-600 font-bold' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}
          >
            <span className="material-symbols-outlined !text-[18px]">map</span>
            地图视图
          </button>
        </nav>
      </div>

      {/* Overview Content */}
      {activeTab === 'overview' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 mb-6">近7日财务表现</h3>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} prefix="¥" />
                  <Tooltip 
                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                    formatter={(value: number) => [`¥${value.toFixed(2)}`, '']}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={3} dot={{r: 4}} activeDot={{r: 6}} name="收入" />
                  <Line type="monotone" dataKey="cost" stroke="#ef4444" strokeWidth={3} dot={{r: 4}} activeDot={{r: 6}} name="支出" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 mb-4">模拟控制台</h3>
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                <p className="text-sm font-medium text-slate-700">下一事件</p>
                <p className="text-xs text-slate-500 mt-1">发薪日还有 5 天</p>
              </div>
               <button 
                onClick={() => { window.location.href = '/download/state'; }}
                 className="w-full py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 font-medium hover:border-slate-400 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
               >
                 <span className="material-symbols-outlined">download</span>
                 导出模拟数据
               </button>
            </div>
          </div>

          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {(state.stores || []).slice(0, 6).map((s) => (
              <div key={s.store_id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-bold text-slate-800">{s.name}</div>
                  <div className="text-xs font-mono text-slate-400">{s.store_id}</div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-slate-500">BEQ(单/日)</div>
                    <div className="font-mono font-bold">{(s.beq_orders_per_day || 0).toFixed(1)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">回本(天,30D)</div>
                    <div className="font-mono font-bold">{(s.payback_days_30d || 0).toFixed(0)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">今日营收</div>
                    <div className="font-mono font-bold">¥{((s.today?.revenue || 0)).toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">今日净盈亏</div>
                    <div className={`font-mono font-bold ${(s.today?.operating_profit || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      ¥{((s.today?.operating_profit || 0)).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Map Content */}
      {activeTab === 'map' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col animate-in fade-in zoom-in duration-300">
           <div className="px-6 py-4 border-b border-slate-200 flex flex-col md:flex-row justify-between md:items-center gap-4">
              <div>
                 <h3 className="text-slate-900 text-lg font-bold flex items-center gap-2">
                    <span className="material-symbols-outlined text-blue-600">public</span>
                    区域运营地图
                 </h3>
                 <p className="text-slate-500 text-sm">上海都会区站点位置 • 实时状态</p>
              </div>
              <div className="flex items-center gap-3">
                 <div className="text-xs font-medium uppercase text-slate-500 tracking-wider hidden sm:block">查看模式:</div>
                 <div className="bg-slate-100 p-1 rounded-lg flex items-center">
                    <button className="px-3 py-1.5 rounded-md text-xs font-medium bg-white shadow-sm text-blue-600 transition-all">标记</button>
                    <button className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-500 hover:text-slate-900 transition-all">热力图</button>
                 </div>
              </div>
           </div>
           <div className="relative w-full h-[600px] bg-[#e6e8ec] overflow-hidden group">
              <div className="absolute inset-0 bg-[#f2efe9]">
                 <svg className="absolute w-full h-full opacity-60" preserveAspectRatio="none">
                    <path d="M-10 400 C 150 420, 300 350, 450 380 S 700 450, 900 420 S 1200 300, 1500 350" fill="none" stroke="#aad3df" strokeWidth="60"></path>
                    <path d="M600 0 C 620 100, 580 200, 650 300 S 800 500, 850 800" fill="none" stroke="#aad3df" strokeWidth="45"></path>
                 </svg>
                 <svg className="absolute w-full h-full opacity-40">
                    <path d="M0 100 L 1500 150" fill="none" stroke="#ffffff" strokeWidth="12"></path>
                    <path d="M0 500 L 1500 450" fill="none" stroke="#ffffff" strokeWidth="12"></path>
                    <path d="M300 0 L 350 800" fill="none" stroke="#ffffff" strokeWidth="12"></path>
                    <path d="M900 0 L 850 800" fill="none" stroke="#ffffff" strokeWidth="12"></path>
                 </svg>
                 <div className="absolute inset-0 opacity-10" style={{backgroundImage: 'linear-gradient(#94a3b8 1px, transparent 1px), linear-gradient(90deg, #94a3b8 1px, transparent 1px)', backgroundSize: '80px 80px'}}></div>
              </div>

              {/* Map Controls */}
              <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm p-3 rounded-lg shadow-lg border border-slate-200 z-20 w-56">
                 <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">地图图层</h4>
                 <div className="space-y-3">
                    <div className="flex items-center justify-between">
                       <span className="text-sm text-slate-600">显示站点</span>
                       <div className="relative inline-flex h-5 w-9 items-center rounded-full bg-blue-600 cursor-pointer">
                          <span className="translate-x-4 inline-block h-3.5 w-3.5 transform rounded-full bg-white transition"></span>
                       </div>
                    </div>
                    <div className="flex items-center justify-between opacity-50">
                       <span className="text-sm text-slate-600">显示竞争对手</span>
                       <div className="relative inline-flex h-5 w-9 items-center rounded-full bg-slate-300 cursor-pointer">
                          <span className="translate-x-1 inline-block h-3.5 w-3.5 transform rounded-full bg-white transition"></span>
                       </div>
                    </div>
                    <div className="h-px bg-slate-200 my-2"></div>
                    <div>
                       <span className="text-xs font-medium text-slate-500 mb-2 block">热力图权重</span>
                       <div className="flex bg-slate-100 rounded p-0.5">
                          <button className="flex-1 py-1 text-[10px] font-bold text-center rounded bg-white shadow text-slate-900">日营收</button>
                          <button className="flex-1 py-1 text-[10px] font-medium text-center text-slate-500">车流量</button>
                       </div>
                    </div>
                 </div>
              </div>

              {/* Map Markers */}
              <div className="absolute top-[30%] left-[20%] transform -translate-x-1/2 -translate-y-full cursor-pointer hover:scale-110 transition-transform z-10">
                 <span className="material-symbols-outlined text-red-600 !text-[36px] drop-shadow-md">location_on</span>
              </div>
              <div className="absolute top-[60%] left-[70%] transform -translate-x-1/2 -translate-y-full cursor-pointer hover:scale-110 transition-transform z-10">
                 <span className="material-symbols-outlined text-blue-600 !text-[36px] drop-shadow-md">location_on</span>
              </div>
              <div className="absolute top-[45%] left-[40%] transform -translate-x-1/2 -translate-y-full cursor-pointer z-30">
                 <div className="relative">
                    <span className="material-symbols-outlined text-emerald-600 !text-[48px] drop-shadow-xl animate-bounce">location_on</span>
                    <div className="absolute top-8 left-1/2 -translate-x-1/2 w-8 h-3 bg-black/20 rounded-[100%] blur-sm"></div>
                 </div>
              </div>
              {/* Map Popup */}
              <div className="absolute top-[45%] left-[40%] transform -translate-x-1/2 -translate-y-[130%] z-40 w-64">
                 <div className="bg-white rounded-lg shadow-xl border border-slate-200 p-0 overflow-hidden animate-in fade-in zoom-in duration-200">
                    <div className="bg-blue-600 px-4 py-2 flex justify-between items-start">
                       <div>
                          <h5 className="text-white font-bold text-sm">站点 #04 - 静安</h5>
                          <p className="text-blue-100 text-[10px]">ID: SH-CN-8821</p>
                       </div>
                       <button className="text-white/80 hover:text-white">
                          <span className="material-symbols-outlined !text-[16px]">close</span>
                       </button>
                    </div>
                    <div className="p-4 space-y-3">
                       <div className="grid grid-cols-2 gap-2">
                          <div>
                             <p className="text-[10px] uppercase text-slate-500 font-semibold">今日营收</p>
                             <p className="text-sm font-bold text-slate-900">¥4,250</p>
                          </div>
                          <div>
                             <p className="text-[10px] uppercase text-slate-500 font-semibold">净盈亏</p>
                             <p className="text-sm font-bold text-emerald-600 flex items-center gap-1">
                                +¥320 <span className="material-symbols-outlined !text-[14px]">trending_up</span>
                             </p>
                          </div>
                       </div>
                       <div className="h-px bg-slate-100"></div>
                       <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">状态</span>
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium">运营中</span>
                       </div>
                       <button className="w-full mt-1 bg-slate-50 hover:bg-slate-100 text-blue-600 text-xs py-1.5 rounded font-medium border border-slate-200 transition-colors">
                          查看详情
                       </button>
                    </div>
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 rotate-45 w-3 h-3 bg-white border-r border-b border-slate-200"></div>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

const StationsPage = () => {
  const { state, dispatch } = React.useContext(StateContext);
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

const StationDetailPage = () => {
   const { id } = useParams();
   const navigate = useNavigate();
   const { state, dispatch } = React.useContext(StateContext);
   const station = state.stations.find(s => s.station_id === id);

   if (!station) return <div className="p-8">站点不存在</div>;

   const handleUpdate = (e: React.FormEvent) => {
      e.preventDefault();
      const formData = new FormData(e.target as HTMLFormElement);
      dispatch({
        type: 'UPDATE_STATION',
        payload: {
          station_id: station.station_id,
          patch: {
            name: String(formData.get('name') || ''),
            station_type: String(formData.get('station_type') || ''),
            city: String(formData.get('city') || ''),
            district: String(formData.get('district') || ''),
            provider: String(formData.get('provider') || ''),
            fuel_vehicles_per_day: Number(formData.get('fuel_vehicles_per_day') || 0),
            visitor_vehicles_per_day: Number(formData.get('visitor_vehicles_per_day') || 0),
            traffic_volatility: Number(formData.get('traffic_volatility') || 0)
          }
        }
      });
      alert('站点更新已提交');
   }

   return (
      <div className="p-8 max-w-3xl mx-auto">
         <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
            <Link to="/stations" className="hover:text-blue-600">站点网络</Link>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            <span>{station.name}</span>
         </div>

         <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
               <h1 className="text-xl font-bold text-slate-900">编辑站点: {station.name}</h1>
               <button 
                  onClick={() => {
                     if(window.confirm("确定删除该站点？这将导致关联门店变成孤立状态。")) {
                        dispatch({type: 'DELETE_STATION', payload: station.station_id});
                        navigate('/stations');
                     }
                  }}
                  className="text-red-600 hover:bg-red-50 px-3 py-1.5 rounded text-sm font-medium border border-transparent hover:border-red-100"
               >
                  删除站点
               </button>
            </div>
            <form onSubmit={handleUpdate} className="p-8 space-y-6">
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                     <label className="block text-sm font-medium text-slate-700 mb-1">站点名称</label>
                     <input name="name" defaultValue={station.name} className="w-full rounded-lg border-slate-300" />
                  </div>
                  <div>
                     <label className="block text-sm font-medium text-slate-700 mb-1">站点类型</label>
                     <input name="station_type" defaultValue={station.station_type || ''} className="w-full rounded-lg border-slate-300" />
                  </div>
                  <div>
                     <label className="block text-sm font-medium text-slate-700 mb-1">地市</label>
                     <input name="city" defaultValue={station.city || ''} className="w-full rounded-lg border-slate-300" />
                  </div>
                  <div>
                     <label className="block text-sm font-medium text-slate-700 mb-1">片区</label>
                     <input name="district" defaultValue={station.district || ''} className="w-full rounded-lg border-slate-300" />
                  </div>
                  <div>
                     <label className="block text-sm font-medium text-slate-700 mb-1">服务商</label>
                     <input name="provider" defaultValue={station.provider || ''} className="w-full rounded-lg border-slate-300" />
                  </div>
                  <div>
                     <label className="block text-sm font-medium text-slate-700 mb-1">加油车流 (辆/天)</label>
                     <input name="fuel_vehicles_per_day" type="number" defaultValue={station.fuel_vehicles_per_day} className="w-full rounded-lg border-slate-300" />
                  </div>
                  <div>
                     <label className="block text-sm font-medium text-slate-700 mb-1">非加油访客 (辆/天)</label>
                     <input name="visitor_vehicles_per_day" type="number" defaultValue={station.visitor_vehicles_per_day} className="w-full rounded-lg border-slate-300" />
                  </div>
                  <div>
                     <label className="block text-sm font-medium text-slate-700 mb-1">流量波动率 (0-1)</label>
                     <input name="traffic_volatility" type="number" step="0.01" defaultValue={station.traffic_volatility} className="w-full rounded-lg border-slate-300" />
                  </div>
               </div>
               <div className="pt-4 flex justify-end">
                  <button type="submit" className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-700">保存更改</button>
               </div>
            </form>
         </div>
      </div>
   )
}

const StoresPage = () => {
  const { state, dispatch } = React.useContext(StateContext);
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


const ReportsPage = () => {
  const { state } = React.useContext(StateContext);

  return (
    <div className="p-8 max-w-7xl mx-auto h-full flex flex-col">
       <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-slate-900">财务报表</h1>
        <div className="flex gap-2">
           <input type="number" placeholder="按天数筛选" className="bg-white border border-slate-300 rounded-lg text-sm py-2 px-3 w-32" />
           <select className="bg-white border border-slate-300 rounded-lg text-sm py-2 px-3">
              <option value="">所有门店</option>
              {state.stores.map(s => <option key={s.store_id} value={s.store_id}>{s.name}</option>)}
           </select>
           <button 
                onClick={() => { window.location.href = '/download/ledger'; }}
                className="flex items-center gap-2 px-4 py-2 border border-slate-300 bg-white rounded-lg text-sm font-medium hover:bg-slate-50"
             >
               <span className="material-symbols-outlined text-[18px]">download</span>
               导出 CSV
            </button>
            <button 
                onClick={() => { window.location.href = '/download/payroll'; }}
                className="flex items-center gap-2 px-4 py-2 border border-slate-300 bg-white rounded-lg text-sm font-medium hover:bg-slate-50"
             >
               <span className="material-symbols-outlined text-[18px]">receipt_long</span>
               导出工资单
            </button>
         </div>
       </div>
      
      <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
         <div className="overflow-auto flex-1">
            <table className="w-full text-sm text-left">
               <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
                  <tr>
                     <th className="px-6 py-3">天数</th>
                     <th className="px-6 py-3">门店 ID</th>
                     <th className="px-6 py-3">描述</th>
                     <th className="px-6 py-3">分类</th>
                     <th className="px-6 py-3 text-right">金额</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-100">
                  {state.ledger.map((entry, idx) => (
                     <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-6 py-3">{entry.day}</td>
                        <td className="px-6 py-3 text-slate-500 font-mono text-xs">{entry.store_id}</td>
                        <td className="px-6 py-3">{entry.description}</td>
                        <td className="px-6 py-3">
                           <span className={`px-2 py-0.5 rounded text-xs font-medium ${entry.amount > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                              {entry.category}
                           </span>
                        </td>
                        <td className={`px-6 py-3 text-right font-mono font-medium ${entry.amount > 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
                           {entry.amount > 0 ? '+' : ''}{entry.amount.toFixed(2)}
                        </td>
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>
         <div className="p-4 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 text-center">
            显示最近 {state.ledger.length} 条记录。下载 CSV 查看完整历史。
         </div>
      </div>
    </div>
  );
};

const DataOpsPage = () => {
  const { dispatch } = React.useContext(StateContext);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkCloseOpen, setBulkCloseOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkInvSalvage, setBulkInvSalvage] = useState(0.2);
  const [bulkAssetSalvage, setBulkAssetSalvage] = useState(0.1);
  const [bulkBusy, setBulkBusy] = useState(false);
  const runBulkClose = async () => {};
  const [bulkResultOpen, setBulkResultOpen] = useState(false);
  const [bulkResults, setBulkResults] = useState<{store_id: string; ok: boolean; message: string}[]>([]);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">数据导入导出</h1>
        <p className="text-slate-500 mt-1">已支持前端弹窗导入；也保留后端运维页入口。</p>
      </div>

      {bulkCloseOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-slate-800">批量关店参数</h3>
              <button onClick={() => setBulkCloseOpen(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="text-sm text-slate-600">将对已选 {selectedIds.length} 家门店执行关店处置。</div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">库存残值率 (0~1)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  value={bulkInvSalvage}
                  onChange={(e) => setBulkInvSalvage(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">资产残值率 (0~1)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  value={bulkAssetSalvage}
                  onChange={(e) => setBulkAssetSalvage(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
              <button onClick={() => setBulkCloseOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium">取消</button>
              <button onClick={runBulkClose} disabled={bulkBusy} className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium disabled:opacity-50">确认关店</button>
            </div>
          </div>
        </div>
      )}

      {bulkResultOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-slate-800">批量执行结果</h3>
              <button onClick={() => setBulkResultOpen(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-4 max-h-[420px] overflow-auto space-y-2">
              {bulkResults.map((r) => (
                <div key={`${r.store_id}-${r.message}`} className={`text-sm rounded-lg px-3 py-2 border ${r.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                  [{r.store_id}] {r.message}
                </div>
              ))}
              {bulkResults.length === 0 && <div className="text-sm text-slate-500">无结果</div>}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
        <div className="text-sm text-slate-700">你可以上传或替换：</div>
        <ul className="list-disc pl-6 text-sm text-slate-600 space-y-1">
          <li>`state.json`（全量模拟状态）</li>
          <li>`ledger.csv`（流水明细）</li>
        </ul>
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            onClick={() => setImportOpen(true)}
            className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center"
          >
            前端弹窗导入
          </button>
          <a
            href="http://127.0.0.1:8000/ops"
            target="_blank"
            rel="noreferrer"
            className="h-10 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold inline-flex items-center"
          >
            打开后端 /ops
          </a>
          <a
            href="/download/state"
            target="_blank"
            rel="noreferrer"
            className="h-10 px-4 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold inline-flex items-center hover:bg-slate-50"
          >
            下载 state.json
          </a>
          <a
            href="/download/ledger"
            target="_blank"
            rel="noreferrer"
            className="h-10 px-4 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold inline-flex items-center hover:bg-slate-50"
          >
            下载 ledger.csv
          </a>
        </div>
      </div>

      {importOpen && (
        <ImportDataModal
          onClose={() => setImportOpen(false)}
          onImported={async () => {
            const next = await apiGetState();
            await dispatch({ type: 'SET_STATE', payload: next } as any);
          }}
        />
      )}
    </div>
  );
};



// --- Main App Component ---

export default function App() {
  const [state, setState] = useState<SimulationState>(initialMockState);

  useEffect(() => {
    apiGetState()
      .then(setState)
      .catch((e) => {
        console.warn('后端不可用，继续使用本地模拟数据：', e);
      });
  }, []);

  // Dispatch actions to backend API; falls back to local state if backend is unavailable.
  const dispatch = async (action: { type: string; payload?: any }) => {
    try {
      switch (action.type) {
        case 'SET_STATE': {
          setState(action.payload as SimulationState);
          return;
        }
        case 'SIMULATE_DAY': {
          const days = action.payload || 1;
          const next = await apiSimulate(days);
          setState(next);
          return;
        }
        case 'ROLLBACK_DAYS': {
          const days = action.payload || 1;
          const next = await apiRollback(days);
          setState(next);
          return;
        }
        case 'RESET_SIM': {
          const next = await apiReset();
          setState(next);
          return;
        }
        case 'ADD_STATION': {
          const next = await apiCreateStation(action.payload as Station);
          setState(next);
          return;
        }
        case 'UPDATE_STATION': {
          const { station_id, patch } = action.payload as { station_id: string; patch: Partial<Station> };
          const next = await apiUpdateStation(station_id, patch);
          setState(next);
          return;
        }
        case 'DELETE_STATION': {
          const next = await apiDeleteStation(action.payload as string);
          setState(next);
          return;
        }
        case 'ADD_STORE': {
          const next = await apiCreateStore(action.payload as Partial<Store>);
          setState(next);
          return;
        }
        case 'UPDATE_STORE': {
          const { store_id, patch } = action.payload as { store_id: string; patch: Partial<Store> };
          const next = await apiUpdateStore(store_id, patch);
          setState(next);
          return;
        }
        case 'CLOSE_STORE': {
          const { store_id, inventory_salvage_rate, asset_salvage_rate } = action.payload as any;
          const next = await apiCloseStore(store_id, inventory_salvage_rate, asset_salvage_rate);
          setState(next);
          return;
        }
        case 'PURCHASE_INVENTORY': {
          const { store_id, payload } = action.payload as any;
          const next = await apiPurchaseInventory(store_id, payload);
          setState(next);
          return;
        }
        case 'UPSERT_REPL_RULE': {
          const { store_id, payload } = action.payload as any;
          const next = await apiUpsertReplenishmentRule(store_id, payload);
          setState(next);
          return;
        }
        case 'DELETE_REPL_RULE': {
          const { store_id, sku } = action.payload as any;
          const next = await apiDeleteReplenishmentRule(store_id, sku);
          setState(next);
          return;
        }
        case 'UPDATE_FINANCE': {
          const next = await apiUpdateFinance(action.payload || {});
          setState(next);
          return;
        }
        case 'UPSERT_STORE_BULK_TEMPLATE': {
          const next = await apiUpsertStoreBulkTemplate(action.payload);
          setState(next);
          return;
        }
        case 'DELETE_STORE_BULK_TEMPLATE': {
          const { name } = action.payload as { name: string };
          const next = await apiDeleteStoreBulkTemplate(name);
          setState(next);
          return;
        }
        case 'UPSERT_SERVICE': {
          const { store_id, payload } = action.payload as any;
          const next = await apiUpsertServiceLine(store_id, payload);
          setState(next);
          return;
        }
        case 'DELETE_SERVICE': {
          const { store_id, service_id } = action.payload as any;
          const next = await apiDeleteServiceLine(store_id, service_id);
          setState(next);
          return;
        }
        case 'UPSERT_PROJECT': {
          const { store_id, payload } = action.payload as any;
          const next = await apiUpsertProject(store_id, payload);
          setState(next);
          return;
        }
        case 'DELETE_PROJECT': {
          const { store_id, project_id } = action.payload as any;
          const next = await apiDeleteProject(store_id, project_id);
          setState(next);
          return;
        }
        case 'ADD_ASSET': {
          const { store_id, payload } = action.payload as any;
          const next = await apiAddAsset(store_id, payload);
          setState(next);
          return;
        }
        case 'DELETE_ASSET': {
          const { store_id, index } = action.payload as any;
          const next = await apiDeleteAsset(store_id, index);
          setState(next);
          return;
        }
        case 'UPSERT_ROLE': {
          const { store_id, payload } = action.payload as any;
          const next = await apiUpsertRole(store_id, payload);
          setState(next);
          return;
        }
        case 'DELETE_ROLE': {
          const { store_id, role } = action.payload as any;
          const next = await apiDeleteRole(store_id, role);
          setState(next);
          return;
        }
        case 'UPSERT_EVENT_TEMPLATE': {
          const next = await apiUpsertEventTemplate(action.payload);
          setState(next);
          return;
        }
        case 'DELETE_EVENT_TEMPLATE': {
          const { template_id } = action.payload as { template_id: string };
          const next = await apiDeleteEventTemplate(template_id);
          setState(next);
          return;
        }
        case 'INJECT_EVENT': {
          const next = await apiInjectEvent(action.payload);
          setState(next);
          return;
        }
        case 'SET_EVENT_SEED': {
          const { seed } = action.payload as { seed: number };
          const next = await apiSetEventSeed(seed);
          setState(next);
          return;
        }
        default:
          return;
      }
    } catch (e) {
      console.warn('后端操作失败，未更新：', e);
    }
  };

  const contextValue = useMemo(() => ({ state, dispatch }), [state]);

  return (
    <StateContext.Provider value={contextValue}>
      <Router>
        <div className="flex h-screen w-full bg-slate-50 text-slate-900 font-sans overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <Header />
            <main className="flex-1 overflow-auto bg-slate-50/50">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/stations" element={<StationsPage />} />
                <Route path="/stations/:id" element={<StationDetailPage />} />
                <Route path="/stores" element={<StoresPage />} />
                <Route path="/stores/:id" element={<Suspense fallback={<LoadingFallback />}><StoreDetailPageLazy /></Suspense>} />
                <Route path="/data" element={<DataOpsPage />} />
                <Route path="/events" element={<Suspense fallback={<LoadingFallback />}><EventsPageLazy /></Suspense>} />
                <Route path="/strategy" element={<Suspense fallback={<LoadingFallback />}><StrategyPageLazy /></Suspense>} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/gis" element={<Suspense fallback={<LoadingFallback />}><GISPageLazy /></Suspense>} />
              </Routes>
            </main>
          </div>
        </div>
      </Router>
    </StateContext.Provider>
  );
}
