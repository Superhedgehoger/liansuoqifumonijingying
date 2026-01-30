import React, { useEffect, useMemo, useState } from 'react';
import { initialMockState } from './services/mockData';
import { SimulationState, Station, Store, ServiceLine, Asset, PayrollRole, ServiceProject, InventoryItem } from './types';
import {
  apiAddAsset,
  apiCloseStore,
  apiCreateStation,
  apiCreateStore,
  apiDeleteAsset,
  apiDeleteProject,
  apiDeleteRole,
  apiDeleteServiceLine,
  apiDeleteStation,
  apiGetState,
  apiPurchaseInventory,
  apiRollback,
  apiReset,
  apiSimulate,
  apiUpdateStation,
  apiUpdateStore,
  apiUpsertProject,
  apiUpsertRole,
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

// --- Global Context ---
const StateContext = React.createContext<{
  state: SimulationState;
  dispatch: (action: any) => void;
}>({ state: initialMockState, dispatch: () => {} });

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
    { name: '财务报表', path: '/reports', icon: 'analytics' },
    { name: '地图分析', path: '/gis', icon: 'map' },
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

const Header = () => {
  const { state, dispatch } = React.useContext(StateContext);
  const [isSimulating, setIsSimulating] = useState(false);
  const [daysInput, setDaysInput] = useState<number>(7);
  const location = useLocation();

  // Hide main header on GIS page
  if (location.pathname === '/gis') return null;

  const handleSimulate = async (days: number) => {
    setIsSimulating(true);
    try {
      await dispatch({ type: 'SIMULATE_DAY', payload: days });
    } finally {
      setIsSimulating(false);
    }
  };

  const handleRollback = async () => {
    const days = Math.max(1, Math.min(365, Number(daysInput) || 1));
    if (!window.confirm(`确认回退 ${days} 天？`)) return;
    setIsSimulating(true);
    try {
      await dispatch({ type: 'ROLLBACK_DAYS', payload: days });
    } finally {
      setIsSimulating(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('确认重置模拟数据？这会清空 state.json/ledger.csv/snapshots。')) return;
    setIsSimulating(true);
    try {
      await dispatch({ type: 'RESET_SIM' });
    } finally {
      setIsSimulating(false);
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
  );
};

// --- GIS Page Component (Dark Mode) ---
const GISPage = () => {
  const { state } = React.useContext(StateContext);
  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState<'markers' | 'heat' | 'sat'>('markers');
  const [groupBy, setGroupBy] = useState<'station_type' | 'city' | 'district' | 'provider'>('city');
  const [filterType, setFilterType] = useState<string>('');
  const [filterCity, setFilterCity] = useState<string>('');
  const [filterDistrict, setFilterDistrict] = useState<string>('');
  const [filterProvider, setFilterProvider] = useState<string>('');
  const [selectedStationId, setSelectedStationId] = useState<string>('');
  const [center, setCenter] = useState<{ x: number; y: number }>({ x: 50, y: 50 }); // percent
  const [search, setSearch] = useState<string>('');

  const stations = state.stations;

  const unique = (arr: string[]) => Array.from(new Set(arr.filter(Boolean))).sort();
  const typeOptions = unique(stations.map(s => s.station_type || ''));
  const cityOptions = unique(stations.map(s => s.city || ''));
  const districtOptions = unique(stations.map(s => s.district || ''));
  const providerOptions = unique(stations.map(s => s.provider || ''));

  const stationPos = (s: any) => {
    // Use backend-provided map_x/map_y when available (0 means unset).
    const x = (s.map_x && s.map_x > 0) ? s.map_x : (20 + (Math.abs(hashCode(s.station_id)) % 60));
    const y = (s.map_y && s.map_y > 0) ? s.map_y : (20 + (Math.abs(hashCode(s.station_id + 'y')) % 60));
    return { x, y };
  };

  function hashCode(str: string) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return h;
  }

  const filteredStations = stations.filter(s => {
    if (filterType && (s.station_type || '') !== filterType) return false;
    if (filterCity && (s.city || '') !== filterCity) return false;
    if (filterDistrict && (s.district || '') !== filterDistrict) return false;
    if (filterProvider && (s.provider || '') !== filterProvider) return false;

    const q = search.trim().toLowerCase();
    if (q) {
      const hay = `${s.station_id} ${s.name} ${s.station_type || ''} ${s.city || ''} ${s.district || ''} ${s.provider || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const grouped = useMemo(() => {
    const m = new Map<string, typeof stations>();
    for (const s of filteredStations) {
      const key = String((s as any)[groupBy] || '(未分组)');
      const list = m.get(key) || [];
      list.push(s);
      m.set(key, list);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredStations, groupBy]);

  const selectedStation = stations.find(s => s.station_id === selectedStationId);

  // Default selection: last selected -> first visible -> first overall
  useEffect(() => {
    if (!stations.length) return;
    if (selectedStationId) return;

    const last = window.localStorage.getItem('gis.selectedStationId') || '';
    const lastExists = last && stations.some(s => s.station_id === last);
    const fallback = (filteredStations[0]?.station_id || stations[0].station_id);
    const pick = lastExists ? last : fallback;
    centerOnStation(pick);
  }, [stations.length, selectedStationId, search, filterType, filterCity, filterDistrict, filterProvider]);

  useEffect(() => {
    if (selectedStationId) {
      window.localStorage.setItem('gis.selectedStationId', selectedStationId);
    }
  }, [selectedStationId]);

  const stationStores = useMemo(() => {
    if (!selectedStation) return [];
    return state.stores.filter(st => st.station_id === selectedStation.station_id);
  }, [state.stores, selectedStationId]);

  const stationStatus = useMemo(() => {
    if (!stationStores.length) return '无门店';
    if (stationStores.some(s => s.status === 'open')) return '运营中';
    if (stationStores.some(s => s.status === 'constructing')) return '建设中';
    if (stationStores.some(s => s.status === 'planning')) return '筹备中';
    return '已关闭';
  }, [stationStores]);

  const stationToday = useMemo(() => {
    if (!selectedStation) return { day: 0, revenue: 0, pnl: 0 };
    const storeIds = new Set(stationStores.map(s => s.store_id));
    const days = state.ledger.map(e => e.day);
    const day = days.length ? Math.max(...days) : Math.max(0, state.day - 1);
    const todays = state.ledger.filter(e => e.day === day && storeIds.has(e.store_id));
    const revenue = todays.reduce((acc, e) => acc + (e.revenue ?? 0), 0);
    const pnl = todays.reduce((acc, e) => acc + (e.operating_profit ?? e.amount ?? 0), 0);
    return { day, revenue, pnl };
  }, [state.ledger, state.day, selectedStationId, stationStores]);

  const centerOnStation = (sid: string) => {
    const s = stations.find(x => x.station_id === sid);
    if (!s) return;
    setSelectedStationId(sid);
    setCenter(stationPos(s));
  };

  return (
    <div className="dark bg-[#0f1823] text-white h-screen w-full flex font-sans overflow-hidden">
      {/* GIS Sidebar Navigation */}
      <nav className="w-20 flex-none flex flex-col items-center py-6 gap-6 bg-[#101923] border-r border-[#21344a] z-20">
        <div className="bg-blue-600 rounded-full size-10 flex items-center justify-center shrink-0 mb-4 ring-2 ring-blue-500/50 font-bold text-white">
           AS
        </div>
        <button onClick={() => navigate('/')} className="p-3 rounded-xl text-slate-400 hover:text-white hover:bg-[#21344a] transition-colors" title="返回仪表盘">
          <span className="material-symbols-outlined text-2xl">dashboard</span>
        </button>
        <button className="p-3 rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/40" title="地图分析">
          <span className="material-symbols-outlined text-2xl">map</span>
        </button>
        <div className="mt-auto flex flex-col gap-4">
          <button className="p-3 rounded-xl text-slate-400 hover:text-white hover:bg-[#21344a] transition-colors" title="设置">
            <span className="material-symbols-outlined text-2xl">settings</span>
          </button>
        </div>
      </nav>

      {/* GIS Content List */}
      <aside className="w-80 md:w-96 flex-none flex flex-col bg-[#101923] border-r border-[#21344a] z-10 shadow-xl">
        <div className="p-6 pb-2">
          <h1 className="text-white tracking-tight text-2xl font-bold leading-tight">站点网络</h1>
          <p className="text-slate-400 text-sm mt-1">{state.stations.length} 个活跃站点</p>
        </div>
        <div className="px-6 py-4">
          <div className="flex w-full items-stretch rounded-lg h-12 bg-[#21344a]/50 ring-1 ring-white/5 focus-within:ring-blue-500 transition-all">
            <div className="text-slate-400 flex items-center justify-center pl-4 pr-2">
              <span className="material-symbols-outlined">search</span>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent border-none text-white focus:ring-0 placeholder:text-slate-500 text-sm font-medium focus:outline-none"
              placeholder="按 ID、类型、地市、片区、服务商搜索"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
          {grouped.length === 0 && (
            <div className="text-slate-500 text-sm px-2 py-6 text-center">无匹配站点</div>
          )}
          {grouped.map(([key, list]) => (
            <div key={key} className="mb-3">
              <div className="px-2 pb-2 text-[11px] font-bold text-slate-500 uppercase tracking-wider">{key}</div>
              <div className="space-y-2">
                {list.map((s) => {
                  const active = s.station_id === selectedStationId;
                  return (
                    <button
                      key={s.station_id}
                      onClick={() => centerOnStation(s.station_id)}
                      className={`w-full text-left group flex items-center justify-between gap-3 rounded-xl p-4 border transition-all ${active ? 'bg-blue-600/20 border-blue-600/30' : 'bg-[#21344a]/25 border-transparent hover:bg-[#21344a]/45 hover:border-white/5'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${active ? 'bg-blue-600/20 text-blue-400' : 'bg-[#21344a] text-slate-300'}`}>
                          <span className="material-symbols-outlined text-[20px]">local_gas_station</span>
                        </div>
                        <div>
                          <div className="text-white text-sm font-semibold">{s.name}</div>
                          <div className="text-slate-400 text-xs mt-0.5">
                            {s.station_id} · {s.station_type || '未设置类型'} · {s.city || '-'} / {s.district || '-'} · {s.provider || '-'}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-slate-200 text-sm font-semibold tabular-nums">{(s.fuel_vehicles_per_day || 0).toLocaleString()}</div>
                        <div className="text-slate-500 text-[11px]">加油车/日</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Main Map Area */}
      <main className="flex-1 relative flex flex-col bg-[#0f1823] overflow-hidden group/map">
        <div className="absolute inset-0 z-0 bg-[#0f1823]">
          <div className="absolute inset-0 bg-[#0f1823]"></div>
           <div
             className="absolute inset-0 opacity-20"
             style={{
               backgroundImage: viewMode === 'sat'
                 ? 'radial-gradient(#2a3b52 1px, transparent 1px)'
                 : 'radial-gradient(#334155 1px, transparent 1px)',
               backgroundSize: viewMode === 'sat' ? '18px 18px' : '30px 30px'
             }}
           ></div>
          {/* Abstract Map SVG */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-30" xmlns="http://www.w3.org/2000/svg">
            <path d="M-100,500 C200,450 400,600 600,300 S900,100 1200,200" fill="none" stroke="#1e293b" strokeWidth="20"></path>
            <path d="M200,800 C400,700 500,500 800,600 S1300,400 1500,500" fill="none" stroke="#1e293b" strokeWidth="15"></path>
            <path d="M500,0 C550,200 600,400 550,600 S400,900 450,1200" fill="none" stroke="#334155" strokeWidth="8"></path>
          </svg>
          <div className="absolute top-1/3 left-1/3 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-[100px] mix-blend-screen pointer-events-none"></div>
          <div className="absolute bottom-1/4 right-1/3 w-[400px] h-[400px] bg-blue-600/20 rounded-full blur-[80px] mix-blend-screen pointer-events-none"></div>
        </div>

        {/* Map Controls */}
         <div className="absolute top-6 right-6 z-10 flex flex-col gap-3 items-end">
           <div className="bg-[#101923]/90 backdrop-blur-md border border-[#21344a] p-1.5 rounded-lg flex shadow-2xl">
             <button onClick={() => setViewMode('markers')} className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium shadow-sm transition-all ${viewMode==='markers'?'bg-blue-600 text-white':'text-slate-400 hover:text-white'}`}>
               <span className="material-symbols-outlined text-[18px]">push_pin</span>
               标记
             </button>
             <button onClick={() => setViewMode('heat')} className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-all ${viewMode==='heat'?'bg-blue-600 text-white':'text-slate-400 hover:text-white'}`}>
               <span className="material-symbols-outlined text-[18px]">blur_on</span>
               热力图
             </button>
             <button onClick={() => setViewMode('sat')} className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-all ${viewMode==='sat'?'bg-blue-600 text-white':'text-slate-400 hover:text-white'}`}>
               <span className="material-symbols-outlined text-[18px]">satellite_alt</span>
               卫星图
             </button>
           </div>
           <div className="bg-[#101923]/90 backdrop-blur-md border border-[#21344a] rounded-lg shadow-2xl overflow-hidden min-w-[260px]">
             <div className="px-3 py-2 border-b border-[#21344a]">
               <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">分组与筛选</span>
             </div>
             <div className="p-3 space-y-3">
               <div>
                 <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">分组字段</div>
                 <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)} className="w-full bg-[#21344a]/50 border border-white/10 text-white rounded px-2 py-1.5 text-xs">
                   <option value="station_type">类型</option>
                   <option value="city">地市</option>
                   <option value="district">片区</option>
                   <option value="provider">服务商</option>
                 </select>
               </div>
               <div className="grid grid-cols-2 gap-2">
                 <div>
                   <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">类型</div>
                   <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full bg-[#21344a]/50 border border-white/10 text-white rounded px-2 py-1.5 text-xs">
                     <option value="">全部</option>
                     {typeOptions.map(v => <option key={v} value={v}>{v}</option>)}
                   </select>
                 </div>
                 <div>
                   <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">地市</div>
                   <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)} className="w-full bg-[#21344a]/50 border border-white/10 text-white rounded px-2 py-1.5 text-xs">
                     <option value="">全部</option>
                     {cityOptions.map(v => <option key={v} value={v}>{v}</option>)}
                   </select>
                 </div>
                 <div>
                   <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">片区</div>
                   <select value={filterDistrict} onChange={(e) => setFilterDistrict(e.target.value)} className="w-full bg-[#21344a]/50 border border-white/10 text-white rounded px-2 py-1.5 text-xs">
                     <option value="">全部</option>
                     {districtOptions.map(v => <option key={v} value={v}>{v}</option>)}
                   </select>
                 </div>
                 <div>
                   <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">服务商</div>
                   <select value={filterProvider} onChange={(e) => setFilterProvider(e.target.value)} className="w-full bg-[#21344a]/50 border border-white/10 text-white rounded px-2 py-1.5 text-xs">
                     <option value="">全部</option>
                     {providerOptions.map(v => <option key={v} value={v}>{v}</option>)}
                   </select>
                 </div>
               </div>
             </div>
           </div>
         </div>

        {/* Overlay that can be centered */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${50 - center.x}%, ${50 - center.y}%)`,
            transition: 'transform 220ms ease'
          }}
        >
          {/* Heatmap */}
          {viewMode === 'heat' && filteredStations.map((s) => {
            const { x, y } = stationPos(s);
            const w = Math.min(1, (s.fuel_vehicles_per_day || 0) / 3000);
            const size = 140 + w * 220;
            return (
              <div
                key={`heat-${s.station_id}`}
                className="absolute rounded-full blur-[40px]"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  width: `${size}px`,
                  height: `${size}px`,
                  transform: 'translate(-50%, -50%)',
                  background: `rgba(59,130,246,${0.12 + w * 0.20})`
                }}
              />
            );
          })}

          {/* Markers */}
          {filteredStations.map((s) => {
            const { x, y } = stationPos(s);
            const active = selectedStationId === s.station_id;
            return (
              <div
                key={s.station_id}
                className={`absolute z-10 cursor-pointer transition-transform ${active ? 'scale-110' : 'hover:scale-110'}`}
                style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -100%)' }}
                onClick={() => centerOnStation(s.station_id)}
                title={`${s.station_id} ${s.name}`}
              >
                <span className={`material-symbols-outlined drop-shadow-xl ${active ? 'text-blue-500' : 'text-slate-300'} !text-[44px]`}>location_on</span>
              </div>
            );
          })}

          {/* Popup card (anchored to selected station marker) */}
          {selectedStation && (
            (() => {
              const pos = stationPos(selectedStation);
              const positive = stationToday.pnl >= 0;
              return (
                <div
                  className="absolute z-30"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -120%)' }}
                >
                  <div className="mb-2 bg-[#101923]/95 backdrop-blur border border-blue-500/40 shadow-2xl rounded-xl p-4 w-72 animate-in fade-in slide-in-from-bottom-4 duration-200">
                    <div className="flex justify-between items-start gap-3">
                      <div>
                        <div className="text-white font-bold text-sm">站点 #{selectedStation.station_id} - {selectedStation.name}</div>
                        <div className="text-slate-400 text-xs mt-1">ID: {selectedStation.station_id} · {stationStatus}</div>
                      </div>
                      <button
                        className="text-slate-400 hover:text-white"
                        onClick={() => setSelectedStationId('')}
                        title="关闭"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs mt-3">
                      <div className="flex flex-col">
                        <span className="text-slate-400">今日营收</span>
                        <span className="text-white font-medium tabular-nums">¥{stationToday.revenue.toFixed(2)}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-slate-400">净盈亏</span>
                        <span className={`font-medium tabular-nums ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>¥{stationToday.pnl.toFixed(2)}</span>
                      </div>
                    </div>

                    <button
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2 rounded mt-3 transition-colors"
                      onClick={() => navigate(`/stations/${selectedStation.station_id}`)}
                    >
                      查看详情
                    </button>
                  </div>

                  <div className="flex justify-center">
                    <div className="w-3 h-3 rotate-45 bg-[#101923] border-r border-b border-blue-500/40" />
                  </div>
                </div>
              );
            })()
          )}
        </div>

        {/* Detail panel */}
        {selectedStation && (
          <div className="absolute left-6 top-6 z-20 w-[360px] bg-[#101923]/95 border border-[#21344a] rounded-xl shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[#21344a] flex items-start justify-between">
              <div>
                <div className="text-white font-bold">{selectedStation.name}</div>
                <div className="text-slate-400 text-xs mt-1">{selectedStation.station_id} · {selectedStation.station_type || '未设置类型'} · {selectedStation.city || '-'} / {selectedStation.district || '-'}</div>
              </div>
              <button className="text-slate-400 hover:text-white" onClick={() => setSelectedStationId('')}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#21344a]/40 rounded-lg p-3">
                  <div className="text-slate-400 text-xs">加油车流/日</div>
                  <div className="text-white font-semibold tabular-nums">{selectedStation.fuel_vehicles_per_day}</div>
                </div>
                <div className="bg-[#21344a]/40 rounded-lg p-3">
                  <div className="text-slate-400 text-xs">访客/日</div>
                  <div className="text-white font-semibold tabular-nums">{selectedStation.visitor_vehicles_per_day}</div>
                </div>
              </div>
              <button
                className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold py-2 rounded"
                onClick={() => {
                  // "居中定位"：把站点坐标作为中心点
                  setCenter(stationPos(selectedStation));
                }}
              >
                在地图中居中定位
              </button>
            </div>
          </div>
        )}

        {/* Footer status */}
        <div className="absolute bottom-0 left-0 right-0 bg-[#101923]/95 border-t border-[#21344a] px-4 py-2 flex items-center justify-between text-xs text-slate-400 z-20">
          <div className="flex items-center gap-2">
            <span className="flex size-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full size-2 bg-emerald-500"></span>
            </span>
            <span>系统就绪。模拟数据已本地保存。</span>
          </div>
          <div className="flex gap-4 font-mono">
            <span>Lat: 31.2304</span>
            <span>Lng: 121.4737</span>
            <span>Zoom: 12z</span>
          </div>
        </div>
      </main>
    </div>
  );
}

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
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 shadow-sm"
        >
          <span className="material-symbols-outlined">add_location</span>
          新增站点
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {state.stations.map((station) => (
          <div key={station.station_id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden group">
            <div className="h-32 bg-slate-100 relative">
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
        {state.stores.map((store) => (
          <div key={store.store_id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-6 flex-1">
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

const StoreDetailPage = () => {
  const { id } = useParams();
  const { state, dispatch } = React.useContext(StateContext);
  const [activeTab, setActiveTab] = useState<'overview' | 'services' | 'projects' | 'assets' | 'payroll' | 'inventory'>('overview');
  const [modalType, setModalType] = useState<string | null>(null); // 'service', 'project', 'asset', 'role', 'purchase'
  
  const store = state.stores.find(s => s.store_id === id);

  if (!store) return <div className="p-8 text-center text-slate-500">门店不存在</div>;

  const tabs = [
    { id: 'overview', label: '概览配置' },
    { id: 'services', label: '服务线' },
    { id: 'projects', label: '项目目录' },
    { id: 'inventory', label: '库存管理' },
    { id: 'assets', label: '固定资产' },
    { id: 'payroll', label: '薪酬体系' },
  ];

  const handleUpdateStore = (e: React.FormEvent) => {
      e.preventDefault();
      const formData = new FormData(e.target as HTMLFormElement);
      dispatch({
        type: 'UPDATE_STORE',
        payload: {
          store_id: store.store_id,
           patch: {
            name: String(formData.get('name') || store.name),
            status: String(formData.get('status') || store.status),
            fixed_overhead_per_day: Number(formData.get('fixed_overhead_per_day') || 0),
            construction_days_remaining: Number(formData.get('construction_days_remaining') || 0),
            capex_spend_per_day: Number(formData.get('capex_spend_per_day') || 0),
            strict_parts: formData.get('strict_parts') === 'on',
            capex_total: Number(formData.get('capex_total') || store.capex_total),
            capex_useful_life_days: Number(formData.get('capex_useful_life_days') || store.capex_useful_life_days),
            operation_start_day: Number(formData.get('operation_start_day') || 1),
             traffic_conversion_rate: Number(formData.get('traffic_conversion_rate') || 1.0),
             labor_hour_price: Number(formData.get('labor_hour_price') || store.labor_hour_price || 120),
             city: String(formData.get('city') || ''),
             district: String(formData.get('district') || ''),
             provider: String(formData.get('provider') || ''),
           }
         }
       });
       alert('门店配置已提交');
   }

  const handleCloseStore = () => {
     if (confirm("确定要关闭该门店并处置资产吗？")) {
        dispatch({
          type: 'CLOSE_STORE',
          payload: { store_id: store.store_id, inventory_salvage_rate: 0.3, asset_salvage_rate: 0.1 }
        });
        alert('关店请求已提交');
     }
   }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6 shadow-sm">
         <div className="max-w-7xl mx-auto">
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
              <Link to="/stores" className="hover:text-blue-600">门店列表</Link>
              <span className="material-symbols-outlined text-[14px]">chevron_right</span>
              <span>{store.name}</span>
            </div>
            <div className="flex justify-between items-start">
               <div>
                  <h1 className="text-3xl font-bold text-slate-900 mb-2">{store.name}</h1>
                  <div className="flex items-center gap-4 text-sm">
                     <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 font-mono">ID: {store.store_id}</span>
                     <span className="flex items-center gap-1 text-slate-500">
                        <span className="material-symbols-outlined text-[16px]">schedule</span>
                        {store.status === 'constructing' ? `建设剩余 ${store.construction_days_remaining} 天` : '正常营业'}
                     </span>
                  </div>
               </div>
               <button 
                  onClick={handleCloseStore}
                  className="bg-white border border-red-200 text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
               >
                  <span className="material-symbols-outlined text-[18px]">block</span>
                  关店处置
               </button>
            </div>
         </div>
      </div>

      <div className="bg-white border-b border-slate-200 px-8 sticky top-16 z-10">
        <div className="max-w-7xl mx-auto flex gap-6 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id 
                  ? 'border-blue-600 text-blue-600' 
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="text-lg font-bold text-slate-800 mb-4">基本属性配置</h3>
                <form className="grid grid-cols-1 md:grid-cols-2 gap-6" onSubmit={handleUpdateStore}>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">门店名称</label>
                    <input name="name" defaultValue={store.name} className="w-full rounded-lg border-slate-300" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">门店状态</label>
                    <select name="status" defaultValue={store.status} className="w-full rounded-lg border-slate-300">
                       <option value="planning">筹备中</option>
                       <option value="constructing">建设中</option>
                       <option value="open">营业中</option>
                       <option value="closed">已关闭</option>
                     </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">地市</label>
                    <input name="city" defaultValue={store.city || ''} className="w-full rounded-lg border-slate-300" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">片区</label>
                    <input name="district" defaultValue={store.district || ''} className="w-full rounded-lg border-slate-300" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">服务商</label>
                    <input name="provider" defaultValue={store.provider || ''} className="w-full rounded-lg border-slate-300" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">每日固定开销 (¥)</label>
                    <input name="fixed_overhead_per_day" type="number" defaultValue={store.fixed_overhead_per_day} className="w-full rounded-lg border-slate-300" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">剩余建设天数</label>
                    <input name="construction_days_remaining" type="number" defaultValue={store.construction_days_remaining} className="w-full rounded-lg border-slate-300" />
                  </div>
                    <div>
                     <label className="block text-sm font-medium text-slate-700 mb-1">每日建设支出 (¥)</label>
                     <input name="capex_spend_per_day" type="number" defaultValue={store.capex_spend_per_day || 0} className="w-full rounded-lg border-slate-300" />
                    </div>
                    <div>
                     <label className="block text-sm font-medium text-slate-700 mb-1">CAPEX总额 (¥)</label>
                     <input name="capex_total" type="number" defaultValue={store.capex_total} className="w-full rounded-lg border-slate-300" />
                   </div>
                   <div>
                     <label className="block text-sm font-medium text-slate-700 mb-1">折旧天数</label>
                     <input name="capex_useful_life_days" type="number" defaultValue={store.capex_useful_life_days} className="w-full rounded-lg border-slate-300" />
                   </div>
                   <div>
                     <label className="block text-sm font-medium text-slate-700 mb-1">开始运营时间（第N天）</label>
                     <input name="operation_start_day" type="number" defaultValue={store.operation_start_day || 1} className="w-full rounded-lg border-slate-300" />
                   </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">客流转化倍率（1=100%）</label>
                    <input name="traffic_conversion_rate" type="number" step="0.01" defaultValue={store.traffic_conversion_rate || 1.0} className="w-full rounded-lg border-slate-300" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">工时单价 (¥/小时)</label>
                    <input name="labor_hour_price" type="number" step="1" defaultValue={store.labor_hour_price ?? 120} className="w-full rounded-lg border-slate-300" />
                  </div>
                  <div className="flex items-center gap-3">
                    <input name="strict_parts" type="checkbox" id="strict" defaultChecked={store.strict_parts} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                    <label htmlFor="strict" className="text-sm font-medium text-slate-700">严格配件库存 (缺货时无法接单)</label>
                  </div>
                  <div className="md:col-span-2 flex justify-end">
                    <button className="bg-slate-900 text-white px-6 py-2 rounded-lg text-sm font-medium">保存配置</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'services' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-slate-800">服务线配置</h3>
                <button onClick={() => setModalType('service')} className="bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
                  + 新增服务线
                </button>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3">服务名称</th>
                      <th className="px-6 py-3">定价</th>
                      <th className="px-6 py-3">日产能</th>
                      <th className="px-6 py-3">转化率 (加油/访客)</th>
                      <th className="px-6 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {store.services?.map(service => (
                      <tr key={service.service_id} className="hover:bg-slate-50">
                        <td className="px-6 py-4 font-medium text-slate-900">{service.name}</td>
                        <td className="px-6 py-4">¥{service.price}</td>
                        <td className="px-6 py-4">{service.capacity_per_day}</td>
                        <td className="px-6 py-4">{(service.conversion_from_fuel * 100).toFixed(0)}% / {(service.conversion_from_visitor * 100).toFixed(0)}%</td>
                         <td className="px-6 py-4">
                            <button
                              onClick={() => setModalType(`service:${service.service_id}`)}
                              className="text-slate-400 hover:text-blue-600 mr-2"
                            >
                              <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm('删除该服务线？')) {
                                  dispatch({ type: 'DELETE_SERVICE', payload: { store_id: store.store_id, service_id: service.service_id } });
                                }
                              }}
                              className="text-slate-400 hover:text-red-600"
                            >
                              <span className="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                         </td>
                      </tr>
                    ))}
                    {(!store.services || store.services.length === 0) && (
                      <tr><td colSpan={5} className="p-6 text-center text-slate-400">暂无服务线。</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'projects' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-slate-800">具体作业项目</h3>
                <button onClick={() => setModalType('project')} className="bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
                  + 新增项目
                </button>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3">项目ID</th>
                      <th className="px-6 py-3">项目名称</th>
                      <th className="px-6 py-3">定价</th>
                      <th className="px-6 py-3">标准工时</th>
                      <th className="px-6 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {store.projects?.map(project => (
                      <tr key={project.project_id} className="hover:bg-slate-50">
                        <td className="px-6 py-4 font-mono text-xs text-slate-500">{project.project_id}</td>
                        <td className="px-6 py-4 font-medium text-slate-900">{project.name}</td>
                        <td className="px-6 py-4">¥{project.price}</td>
                        <td className="px-6 py-4">{project.labor_hours} 小时</td>
                        <td className="px-6 py-4">
                            <button
                              onClick={() => {
                                if (window.confirm('删除该项目？')) {
                                  dispatch({ type: 'DELETE_PROJECT', payload: { store_id: store.store_id, project_id: project.project_id } });
                                }
                              }}
                              className="text-slate-400 hover:text-red-600"
                            >
                              <span className="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                        </td>
                      </tr>
                    ))}
                    {(!store.projects || store.projects.length === 0) && (
                      <tr><td colSpan={5} className="p-6 text-center text-slate-400">暂无具体项目。</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'inventory' && (
             <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-slate-800">当前库存</h3>
                <button onClick={() => setModalType('purchase')} className="bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
                  采购入库
                </button>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3">SKU</th>
                      <th className="px-6 py-3">品名</th>
                      <th className="px-6 py-3">数量</th>
                      <th className="px-6 py-3">单项成本</th>
                      <th className="px-6 py-3">库存货值</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {store.inventory?.map(item => (
                      <tr key={item.sku} className="hover:bg-slate-50">
                        <td className="px-6 py-4 font-mono text-xs text-slate-500">{item.sku}</td>
                        <td className="px-6 py-4 font-medium text-slate-900">{item.name}</td>
                        <td className="px-6 py-4">{item.qty}</td>
                        <td className="px-6 py-4">¥{item.unit_cost.toFixed(2)}</td>
                        <td className="px-6 py-4 font-medium">¥{(item.qty * item.unit_cost).toFixed(2)}</td>
                      </tr>
                    ))}
                     {(!store.inventory || store.inventory.length === 0) && (
                      <tr><td colSpan={5} className="p-6 text-center text-slate-400">暂无库存。</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'assets' && (
             <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-slate-800">固定资产</h3>
                <button onClick={() => setModalType('asset')} className="bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
                  + 新增资产
                </button>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3">资产名称</th>
                      <th className="px-6 py-3">原值 (CapEx)</th>
                      <th className="px-6 py-3">折旧年限</th>
                      <th className="px-6 py-3">已服役天数</th>
                      <th className="px-6 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {store.assets?.map(asset => (
                      <tr key={asset.index} className="hover:bg-slate-50">
                        <td className="px-6 py-4 font-medium text-slate-900">{asset.asset_name}</td>
                        <td className="px-6 py-4">¥{asset.capex.toLocaleString()}</td>
                        <td className="px-6 py-4">{(asset.useful_life_days / 365).toFixed(1)} 年</td>
                        <td className="px-6 py-4">{asset.in_service_day} 天</td>
                        <td className="px-6 py-4">
                            <button
                              onClick={() => {
                                if (window.confirm('删除该资产？')) {
                                  dispatch({ type: 'DELETE_ASSET', payload: { store_id: store.store_id, index: asset.index } });
                                }
                              }}
                              className="text-slate-400 hover:text-red-600"
                            >
                              <span className="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                        </td>
                      </tr>
                    ))}
                     {(!store.assets || store.assets.length === 0) && (
                      <tr><td colSpan={5} className="p-6 text-center text-slate-400">暂无固定资产。</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

           {activeTab === 'payroll' && (
             <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-slate-800">复杂薪酬体系</h3>
                <button onClick={() => setModalType('role')} className="bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
                  + 定义新职位
                </button>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 whitespace-nowrap">
                      <tr>
                        <th className="px-6 py-3">角色 / 职级</th>
                        <th className="px-6 py-3">编制</th>
                        <th className="px-6 py-3">固定薪资 (月)</th>
                        <th className="px-6 py-3">福利 (社保/公积金)</th>
                        <th className="px-6 py-3">绩效提成 (Variable)</th>
                        <th className="px-6 py-3">单人预估成本</th>
                        <th className="px-6 py-3">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {store.roles?.map((role, idx) => {
                         const fixedPay = role.base_monthly + role.position_allowance;
                         const benefits = fixedPay * (role.social_security_rate + role.housing_fund_rate);
                         const estCommission = 1500; // Mock estimation for display
                         const totalEst = fixedPay + benefits + estCommission;

                         return (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="px-6 py-4">
                              <div className="font-bold text-slate-900">{role.role}</div>
                              <div className="text-xs text-slate-500 bg-slate-100 inline-block px-1.5 py-0.5 rounded mt-1">Level: {role.level}</div>
                            </td>
                            <td className="px-6 py-4 font-mono">{role.headcount} 人</td>
                            <td className="px-6 py-4">
                              <div className="font-medium">¥{fixedPay.toLocaleString()}</div>
                              <div className="text-xs text-slate-400">底薪: {role.base_monthly} + 津贴: {role.position_allowance}</div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="text-slate-700">{(role.social_security_rate * 100)}% 社保</div>
                              <div className="text-slate-700">{(role.housing_fund_rate * 100)}% 公积金</div>
                            </td>
                            <td className="px-6 py-4 text-xs space-y-1">
                              {role.labor_commission_rate > 0 && <div className="text-blue-600">工时提成: {(role.labor_commission_rate * 100)}%</div>}
                              {role.parts_commission_rate > 0 && <div className="text-indigo-600">配件提成: {(role.parts_commission_rate * 100)}%</div>}
                              {role.sales_commission_rate > 0 && <div className="text-emerald-600">销售提成: {(role.sales_commission_rate * 100)}%</div>}
                              {role.wash_commission_rate && role.wash_commission_rate > 0 ? <div className="text-cyan-600">洗车提成: {(role.wash_commission_rate * 100)}%</div> : null}
                              {role.maintenance_commission_rate && role.maintenance_commission_rate > 0 ? <div className="text-sky-600">维保提成: {(role.maintenance_commission_rate * 100)}%</div> : null}
                              {role.detailing_commission_rate && role.detailing_commission_rate > 0 ? <div className="text-violet-600">洗美提成: {(role.detailing_commission_rate * 100)}%</div> : null}
                              {role.profit_share_rate ? <div className="text-amber-600 font-bold">利润分红: {(role.profit_share_rate * 100)}%</div> : null}
                            </td>
                            <td className="px-6 py-4">
                              <div className="font-bold text-slate-900">~¥{totalEst.toLocaleString()}</div>
                              <div className="text-xs text-slate-400">含预估绩效</div>
                            </td>
                             <td className="px-6 py-4">
                               <button
                                 onClick={() => {
                                   if (window.confirm('删除该人员/岗位？')) {
                                     dispatch({ type: 'DELETE_ROLE', payload: { store_id: store.store_id, role: role.role } });
                                   }
                                 }}
                                 className="text-slate-400 hover:text-red-600"
                               >
                                 <span className="material-symbols-outlined text-[18px]">delete</span>
                               </button>
                             </td>
                          </tr>
                        );
                      })}
                      {(!store.roles || store.roles.length === 0) && (
                        <tr><td colSpan={7} className="p-6 text-center text-slate-400">暂无薪酬角色。</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Generic Modal Shell - In a real app, separate these */}
       {modalType && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
           <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
               <h3 className="font-bold text-slate-800">
                 {(modalType === 'service' || modalType.startsWith('service:')) && (modalType.startsWith('service:') ? '编辑服务线' : '新增服务线')}
                 {modalType === 'project' && '新增作业项目'}
                 {modalType === 'asset' && '新增固定资产'}
                 {modalType === 'role' && '配置复杂薪酬角色'}
                 {modalType === 'purchase' && '采购库存'}
               </h3>
               <button onClick={() => setModalType(null)} className="text-slate-400 hover:text-slate-600">
                 <span className="material-symbols-outlined">close</span>
               </button>
             </div>
             <div className="p-6 overflow-y-auto max-h-[70vh]">
               {(() => {
                 const isEditService = modalType.startsWith('service:');
                 const editServiceId = isEditService ? modalType.split(':', 2)[1] : '';
                 const editingService = isEditService ? (store.services || []).find(s => s.service_id === editServiceId) : undefined;

                 if (modalType === 'service' || isEditService) {
                   return (
                     <form
                       onSubmit={(e) => {
                         e.preventDefault();
                         const fd = new FormData(e.target as HTMLFormElement);
                         const payload = {
                            service_id: String(fd.get('service_id') || ''),
                            name: String(fd.get('name') || ''),
                            category: String(fd.get('category') || 'other'),
                            price: Number(fd.get('price') || 0),
                           conversion_from_fuel: Number(fd.get('conversion_from_fuel') || 0) / 100,
                           conversion_from_visitor: Number(fd.get('conversion_from_visitor') || 0) / 100,
                           capacity_per_day: Number(fd.get('capacity_per_day') || 0),
                           variable_cost_per_order: Number(fd.get('variable_cost_per_order') || 0),
                           parts_cost_ratio: Number(fd.get('parts_cost_ratio') || 0),
                           variable_labor_per_order: Number(fd.get('variable_labor_per_order') || 0),
                           labor_role: String(fd.get('labor_role') || ''),
                           labor_hours_per_order: Number(fd.get('labor_hours_per_order') || 0),
                           consumable_sku: String(fd.get('consumable_sku') || ''),
                           consumable_units_per_order: Number(fd.get('consumable_units_per_order') || 0),
                           project_mix_json: String(fd.get('project_mix_json') || '[]')
                         };
                         dispatch({ type: 'UPSERT_SERVICE', payload: { store_id: store.store_id, payload } });
                         setModalType(null);
                       }}
                       className="space-y-4"
                     >
                       <div className="grid grid-cols-2 gap-4">
                         <div>
                           <label className="block text-xs font-bold text-slate-500 uppercase mb-1">服务线ID</label>
                           <input name="service_id" defaultValue={editingService?.service_id || ''} className="w-full rounded border-slate-300" required disabled={isEditService} />
                         </div>
                         <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">名称</label>
                            <input name="name" defaultValue={editingService?.name || ''} className="w-full rounded border-slate-300" required />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">业态分类</label>
                          <select name="category" defaultValue={editingService?.category || 'other'} className="w-full rounded border-slate-300">
                            <option value="wash">洗车</option>
                            <option value="maintenance">维保</option>
                            <option value="detailing">洗美</option>
                            <option value="other">其他</option>
                          </select>
                        </div>
                       <div className="grid grid-cols-3 gap-3">
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">价格</label>
                           <input name="price" type="number" step="0.01" defaultValue={editingService?.price ?? 0} className="w-full rounded border-slate-300" />
                         </div>
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">日产能</label>
                           <input name="capacity_per_day" type="number" defaultValue={editingService?.capacity_per_day ?? 0} className="w-full rounded border-slate-300" />
                         </div>
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">单笔变动成本</label>
                           <input name="variable_cost_per_order" type="number" step="0.01" defaultValue={editingService?.variable_cost_per_order ?? 0} className="w-full rounded border-slate-300" />
                         </div>
                       </div>
                       <div className="grid grid-cols-2 gap-3">
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">加油转化率(%)</label>
                           <input name="conversion_from_fuel" type="number" step="0.01" defaultValue={((editingService?.conversion_from_fuel ?? 0) * 100).toFixed(2)} className="w-full rounded border-slate-300" />
                         </div>
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">访客转化率(%)</label>
                           <input name="conversion_from_visitor" type="number" step="0.01" defaultValue={((editingService?.conversion_from_visitor ?? 0) * 100).toFixed(2)} className="w-full rounded border-slate-300" />
                         </div>
                       </div>
                       <div className="grid grid-cols-3 gap-3">
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">材料成本率(0-1)</label>
                           <input name="parts_cost_ratio" type="number" step="0.01" defaultValue={editingService?.parts_cost_ratio ?? 0} className="w-full rounded border-slate-300" />
                         </div>
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">人工变动成本</label>
                           <input name="variable_labor_per_order" type="number" step="0.01" defaultValue={editingService?.variable_labor_per_order ?? 0} className="w-full rounded border-slate-300" />
                         </div>
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">耗材SKU(可空)</label>
                           <input name="consumable_sku" defaultValue={editingService?.consumable_sku || ''} className="w-full rounded border-slate-300" />
                         </div>
                       </div>
                       <div className="grid grid-cols-2 gap-3">
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">每单耗材用量</label>
                           <input name="consumable_units_per_order" type="number" step="0.01" defaultValue={editingService?.consumable_units_per_order ?? 0} className="w-full rounded border-slate-300" />
                         </div>
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">产能角色(可空)</label>
                           <input name="labor_role" defaultValue={editingService?.labor_role || ''} className="w-full rounded border-slate-300" />
                         </div>
                       </div>
                       <div>
                         <label className="block text-xs font-medium text-slate-600 mb-1">每单工时(小时)</label>
                         <input name="labor_hours_per_order" type="number" step="0.01" defaultValue={editingService?.labor_hours_per_order ?? 0} className="w-full rounded border-slate-300" />
                       </div>
                       <div>
                         <label className="block text-xs font-medium text-slate-600 mb-1">项目组合JSON(可空)</label>
                         <textarea name="project_mix_json" className="w-full rounded border-slate-300 h-24" defaultValue={editingService?.project_mix_json || '[]'} />
                       </div>
                       <div className="pt-4 flex justify-end gap-3">
                         <button type="button" onClick={() => setModalType(null)} className="px-4 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50">取消</button>
                         <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存</button>
                       </div>
                     </form>
                   );
                 }

                 if (modalType === 'project') {
                   return (
                     <form
                       onSubmit={(e) => {
                         e.preventDefault();
                         const fd = new FormData(e.target as HTMLFormElement);
                         const payload = {
                           project_id: String(fd.get('project_id') || ''),
                           name: String(fd.get('name') || ''),
                           price: Number(fd.get('price') || 0),
                           labor_hours: Number(fd.get('labor_hours') || 0),
                           variable_cost: Number(fd.get('variable_cost') || 0),
                           parts_json: String(fd.get('parts_json') || '{}')
                         };
                         dispatch({ type: 'UPSERT_PROJECT', payload: { store_id: store.store_id, payload } });
                         setModalType(null);
                       }}
                       className="space-y-4"
                     >
                       <div className="grid grid-cols-2 gap-4">
                         <div>
                           <label className="block text-xs font-bold text-slate-500 uppercase mb-1">项目ID</label>
                           <input name="project_id" className="w-full rounded border-slate-300" required />
                         </div>
                         <div>
                           <label className="block text-xs font-bold text-slate-500 uppercase mb-1">名称</label>
                           <input name="name" className="w-full rounded border-slate-300" required />
                         </div>
                       </div>
                       <div className="grid grid-cols-3 gap-3">
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">价格</label>
                           <input name="price" type="number" step="0.01" className="w-full rounded border-slate-300" />
                         </div>
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">工时(小时)</label>
                           <input name="labor_hours" type="number" step="0.01" className="w-full rounded border-slate-300" />
                         </div>
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">非库存成本</label>
                           <input name="variable_cost" type="number" step="0.01" className="w-full rounded border-slate-300" />
                         </div>
                       </div>
                       <div>
                         <label className="block text-xs font-medium text-slate-600 mb-1">配件JSON</label>
                         <textarea name="parts_json" className="w-full rounded border-slate-300 h-24" defaultValue="{}" />
                       </div>
                       <div className="pt-4 flex justify-end gap-3">
                         <button type="button" onClick={() => setModalType(null)} className="px-4 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50">取消</button>
                         <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存</button>
                       </div>
                     </form>
                   );
                 }

                 if (modalType === 'purchase') {
                   return (
                     <form
                       onSubmit={(e) => {
                         e.preventDefault();
                         const fd = new FormData(e.target as HTMLFormElement);
                         const payload = {
                           sku: String(fd.get('sku') || ''),
                           name: String(fd.get('name') || ''),
                           unit_cost: Number(fd.get('unit_cost') || 0),
                           qty: Number(fd.get('qty') || 0)
                         };
                         dispatch({ type: 'PURCHASE_INVENTORY', payload: { store_id: store.store_id, payload } });
                         setModalType(null);
                       }}
                       className="space-y-3"
                     >
                       <input name="sku" className="w-full rounded border-slate-300" placeholder="SKU" required />
                       <input name="name" className="w-full rounded border-slate-300" placeholder="品名" />
                       <div className="grid grid-cols-2 gap-3">
                         <input name="unit_cost" className="w-full rounded border-slate-300" type="number" step="0.01" placeholder="单价" required />
                         <input name="qty" className="w-full rounded border-slate-300" type="number" step="0.01" placeholder="数量" required />
                       </div>
                       <div className="pt-4 flex justify-end gap-3">
                         <button type="button" onClick={() => setModalType(null)} className="px-4 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50">取消</button>
                         <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">入库</button>
                       </div>
                     </form>
                   );
                 }

                 if (modalType === 'asset') {
                   return (
                     <form
                       onSubmit={(e) => {
                         e.preventDefault();
                         const fd = new FormData(e.target as HTMLFormElement);
                         const payload = {
                           asset_name: String(fd.get('asset_name') || ''),
                           capex: Number(fd.get('capex') || 0),
                           useful_life_days: Number(fd.get('useful_life_days') || 3650),
                           in_service_day: Number(fd.get('in_service_day') || state.day)
                         };
                         dispatch({ type: 'ADD_ASSET', payload: { store_id: store.store_id, payload } });
                         setModalType(null);
                       }}
                       className="space-y-3"
                     >
                       <input name="asset_name" className="w-full rounded border-slate-300" placeholder="资产名称" required />
                       <div className="grid grid-cols-2 gap-3">
                         <input name="capex" className="w-full rounded border-slate-300" type="number" step="0.01" placeholder="CAPEX" required />
                         <input name="useful_life_days" className="w-full rounded border-slate-300" type="number" defaultValue="3650" placeholder="折旧天数" required />
                       </div>
                       <input name="in_service_day" className="w-full rounded border-slate-300" type="number" defaultValue={state.day} placeholder="投产日" required />
                       <div className="pt-4 flex justify-end gap-3">
                         <button type="button" onClick={() => setModalType(null)} className="px-4 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50">取消</button>
                         <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">新增</button>
                       </div>
                     </form>
                   );
                 }

                  if (modalType === 'role') {
                    return (
                      <form
                       onSubmit={(e) => {
                         e.preventDefault();
                         const fd = new FormData(e.target as HTMLFormElement);
                           const payload = {
                             role: String(fd.get('role') || ''),
                             level: String(fd.get('level') || ''),
                             headcount: Number(fd.get('headcount') || 0),
                             base_monthly: Number(fd.get('base_monthly') || 0),
                             position_allowance: Number(fd.get('position_allowance') || 0),
                             social_security_rate: Number(fd.get('social_security_rate') || 0),
                             housing_fund_rate: Number(fd.get('housing_fund_rate') || 0),
                             labor_commission_rate: Number(fd.get('labor_commission_rate') || 0),
                             parts_commission_rate: Number(fd.get('parts_commission_rate') || 0),
                             parts_commission_base: String(fd.get('parts_commission_base') || 'revenue'),
                             sales_commission_rate: Number(fd.get('sales_commission_rate') || 0),
                             wash_commission_base: String(fd.get('wash_commission_base') || 'revenue'),
                             wash_commission_rate: Number(fd.get('wash_commission_rate') || 0),
                             maintenance_commission_base: String(fd.get('maintenance_commission_base') || 'revenue'),
                             maintenance_commission_rate: Number(fd.get('maintenance_commission_rate') || 0),
                             detailing_commission_base: String(fd.get('detailing_commission_base') || 'revenue'),
                             detailing_commission_rate: Number(fd.get('detailing_commission_rate') || 0),
                             profit_share_rate: Number(fd.get('profit_share_rate') || 0),
                             min_monthly_orders_threshold: Number(fd.get('min_monthly_orders_threshold') || 0),
                             overtime_pay_rate: Number(fd.get('overtime_pay_rate') || 0)
                           };
                          dispatch({ type: 'UPSERT_ROLE', payload: { store_id: store.store_id, payload } });
                          setModalType(null);
                        }}
                        className="space-y-4"
                      >
                       <div className="grid grid-cols-2 gap-4">
                         <div>
                           <label className="block text-xs font-bold text-slate-500 uppercase mb-1">职位名称</label>
                           <input name="role" className="w-full rounded border-slate-300" required />
                         </div>
                         <div>
                           <label className="block text-xs font-bold text-slate-500 uppercase mb-1">职级</label>
                           <input name="level" className="w-full rounded border-slate-300" placeholder="例如 T3/M2" />
                         </div>
                       </div>
                       <div className="grid grid-cols-3 gap-3">
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">编制</label>
                           <input name="headcount" type="number" className="w-full rounded border-slate-300" defaultValue="1" />
                         </div>
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">底薪/月</label>
                           <input name="base_monthly" type="number" className="w-full rounded border-slate-300" defaultValue="0" />
                         </div>
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">岗位津贴/月</label>
                           <input name="position_allowance" type="number" className="w-full rounded border-slate-300" defaultValue="0" />
                         </div>
                       </div>
                       <div className="grid grid-cols-3 gap-3">
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">社保率(0-1)</label>
                           <input name="social_security_rate" type="number" step="0.01" className="w-full rounded border-slate-300" defaultValue="0.30" />
                         </div>
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">公积金率(0-1)</label>
                           <input name="housing_fund_rate" type="number" step="0.01" className="w-full rounded border-slate-300" defaultValue="0.12" />
                         </div>
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">利润分红率(0-1)</label>
                           <input name="profit_share_rate" type="number" step="0.01" className="w-full rounded border-slate-300" defaultValue="0" />
                         </div>
                       </div>
                         <div className="grid grid-cols-3 gap-3">
                           <div>
                             <label className="block text-xs font-medium text-slate-600 mb-1">工时提成率</label>
                             <input name="labor_commission_rate" type="number" step="0.01" className="w-full rounded border-slate-300" defaultValue="0" />
                           </div>
                           <div>
                             <label className="block text-xs font-medium text-slate-600 mb-1">配件提成率</label>
                             <input name="parts_commission_rate" type="number" step="0.01" className="w-full rounded border-slate-300" defaultValue="0" />
                           </div>
                           <div>
                             <label className="block text-xs font-medium text-slate-600 mb-1">销售提成率</label>
                             <input name="sales_commission_rate" type="number" step="0.01" className="w-full rounded border-slate-300" defaultValue="0" />
                           </div>
                         </div>
                         <div className="grid grid-cols-2 gap-3">
                           <div>
                             <label className="block text-xs font-medium text-slate-600 mb-1">配件提成口径</label>
                             <select name="parts_commission_base" defaultValue="revenue" className="w-full rounded border-slate-300">
                               <option value="revenue">按配件收入</option>
                               <option value="gross_profit">按配件毛利</option>
                             </select>
                           </div>
                           <div>
                             <label className="block text-xs font-medium text-slate-600 mb-1">洗车提成口径</label>
                             <select name="wash_commission_base" defaultValue="revenue" className="w-full rounded border-slate-300">
                               <option value="revenue">按收入</option>
                               <option value="gross_profit">按毛利</option>
                             </select>
                           </div>
                         </div>
                         <div className="grid grid-cols-2 gap-3">
                           <div>
                             <label className="block text-xs font-medium text-slate-600 mb-1">维保提成口径</label>
                             <select name="maintenance_commission_base" defaultValue="revenue" className="w-full rounded border-slate-300">
                               <option value="revenue">按收入</option>
                               <option value="gross_profit">按毛利</option>
                             </select>
                           </div>
                           <div>
                             <label className="block text-xs font-medium text-slate-600 mb-1">洗美提成口径</label>
                             <select name="detailing_commission_base" defaultValue="revenue" className="w-full rounded border-slate-300">
                               <option value="revenue">按收入</option>
                               <option value="gross_profit">按毛利</option>
                             </select>
                           </div>
                         </div>
                         <div className="grid grid-cols-3 gap-3">
                           <div>
                             <label className="block text-xs font-medium text-slate-600 mb-1">洗车提成率</label>
                             <input name="wash_commission_rate" type="number" step="0.01" className="w-full rounded border-slate-300" defaultValue="0" />
                           </div>
                           <div>
                             <label className="block text-xs font-medium text-slate-600 mb-1">维保提成率</label>
                             <input name="maintenance_commission_rate" type="number" step="0.01" className="w-full rounded border-slate-300" defaultValue="0" />
                           </div>
                           <div>
                             <label className="block text-xs font-medium text-slate-600 mb-1">洗美提成率</label>
                             <input name="detailing_commission_rate" type="number" step="0.01" className="w-full rounded border-slate-300" defaultValue="0" />
                           </div>
                         </div>
                       <div className="grid grid-cols-2 gap-3">
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">保底单量</label>
                           <input name="min_monthly_orders_threshold" type="number" className="w-full rounded border-slate-300" defaultValue="0" />
                         </div>
                         <div>
                           <label className="block text-xs font-medium text-slate-600 mb-1">加班费率</label>
                           <input name="overtime_pay_rate" type="number" step="0.01" className="w-full rounded border-slate-300" defaultValue="0" />
                         </div>
                       </div>
                       <div className="pt-4 flex justify-end gap-3">
                         <button type="button" onClick={() => setModalType(null)} className="px-4 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50">取消</button>
                         <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存</button>
                       </div>
                     </form>
                   );
                 }

                 return null;
               })()}
             </div>
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
                <Route path="/stores/:id" element={<StoreDetailPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/gis" element={<GISPage />} />
              </Routes>
            </main>
          </div>
        </div>
      </Router>
    </StateContext.Provider>
  );
}
