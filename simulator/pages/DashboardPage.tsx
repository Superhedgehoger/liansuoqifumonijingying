import React, { useState, useContext } from 'react';
import { StateContext } from '../context';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend
} from 'recharts';

const Dashboard = () => {
  const { state } = useContext(StateContext);
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

export default Dashboard;
