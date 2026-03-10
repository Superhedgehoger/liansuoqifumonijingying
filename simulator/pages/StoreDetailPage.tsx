import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { StateContext } from '../context';

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


export default StoreDetailPage;