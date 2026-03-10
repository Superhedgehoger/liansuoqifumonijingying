import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { StateContext } from '../context';

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
  const [center, setCenter] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [search, setSearch] = useState<string>('');

  const stations = state.stations;

  const unique = (arr: string[]) => Array.from(new Set(arr.filter(Boolean))).sort();
  const typeOptions = unique(stations.map(s => s.station_type || ''));
  const cityOptions = unique(stations.map(s => s.city || ''));
  const districtOptions = unique(stations.map(s => s.district || ''));
  const providerOptions = unique(stations.map(s => s.provider || ''));

  const stationPos = (s: any) => {
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
      <nav className="w-20 flex-none flex flex-col items-center py-6 gap-6 bg-[#101923] border-r border-[#21344a] z-20">
        <div className="bg-blue-600 rounded-full size-10 flex items-center justify-center shrink-0 mb-4 ring-2 ring-blue-500/50 font-bold text-white">AS</div>
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
          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-30" xmlns="http://www.w3.org/2000/svg">
            <path d="M-100,500 C200,450 400,600 600,300 S900,100 1200,200" fill="none" stroke="#1e293b" strokeWidth="20"></path>
            <path d="M200,800 C400,700 500,500 800,600 S1300,400 1500,500" fill="none" stroke="#1e293b" strokeWidth="15"></path>
            <path d="M500,0 C550,200 600,400 550,600 S400,900 450,1200" fill="none" stroke="#334155" strokeWidth="8"></path>
          </svg>
          <div className="absolute top-1/3 left-1/3 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-[100px] mix-blend-screen pointer-events-none"></div>
          <div className="absolute bottom-1/4 right-1/3 w-[400px] h-[400px] bg-blue-600/20 rounded-full blur-[80px] mix-blend-screen pointer-events-none"></div>
        </div>

        <div className="absolute top-6 right-6 z-10 flex flex-col gap-3 items-end">
          <div className="bg-[#101923]/90 backdrop-blur-md border border-[#21344a] p-1.5 rounded-lg flex shadow-2xl">
            <button onClick={() => setViewMode('markers')} className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium shadow-sm transition-all ${viewMode==='markers'?'bg-blue-600 text-white':'text-slate-400 hover:text-white'}`}>
              <span className="material-symbols-outlined text-[18px]">push_pin</span>标记
            </button>
            <button onClick={() => setViewMode('heat')} className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-all ${viewMode==='heat'?'bg-blue-600 text-white':'text-slate-400 hover:text-white'}`}>
              <span className="material-symbols-outlined text-[18px]">blur_on</span>热力图
            </button>
            <button onClick={() => setViewMode('sat')} className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-all ${viewMode==='sat'?'bg-blue-600 text-white':'text-slate-400 hover:text-white'}`}>
              <span className="material-symbols-outlined text-[18px]">satellite_alt</span>卫星图
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

        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${50 - center.x}%, ${50 - center.y}%)`,
            transition: 'transform 220ms ease'
          }}
        >
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
                      <button className="text-slate-400 hover:text-white" onClick={() => setSelectedStationId('')} title="关闭">
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
                    <button className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2 rounded mt-3 transition-colors" onClick={() => navigate(`/stations/${selectedStation.station_id}`)}>查看详情</button>
                  </div>
                  <div className="flex justify-center">
                    <div className="w-3 h-3 rotate-45 bg-[#101923] border-r border-b border-blue-500/40" />
                  </div>
                </div>
              );
            })()
          )}
        </div>

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
              <button className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold py-2 rounded" onClick={() => setCenter(stationPos(selectedStation))}>在地图中居中定位</button>
            </div>
          </div>
        )}

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
};

export default GISPage;
