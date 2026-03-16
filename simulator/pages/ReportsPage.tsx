import React, { useContext } from 'react';
import { StateContext } from '../context';

const ReportsPage = () => {
  const { state } = useContext(StateContext);

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

export default ReportsPage;
