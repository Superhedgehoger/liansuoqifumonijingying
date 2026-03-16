import React, { useState, useContext } from 'react';
import { StateContext } from '../context';
import { apiGetState } from '../services/api';
import { ImportDataModal } from './ImportDataModal';

const DataOpsPage = () => {
  const { dispatch } = useContext(StateContext);
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

export default DataOpsPage;
