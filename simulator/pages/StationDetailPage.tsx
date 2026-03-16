import React, { useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { StateContext } from '../context';

const StationDetailPage = () => {
   const { id } = useParams();
   const navigate = useNavigate();
   const { state, dispatch } = useContext(StateContext);
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

export default StationDetailPage;
