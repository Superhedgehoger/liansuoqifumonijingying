import React, { useState, useRef } from 'react';
import { apiImportLedgerFile, apiImportStateFile, apiGetState } from '../services/api';

export const ImportDataModal = ({
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
  const stateInputRef = useRef<HTMLInputElement | null>(null);
  const ledgerInputRef = useRef<HTMLInputElement | null>(null);

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
