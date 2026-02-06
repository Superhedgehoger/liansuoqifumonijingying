import type { ScenarioCompareResult, SimulationState, SiteRecommendation, Station, Store } from '../types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export function apiGetState(): Promise<SimulationState> {
  return requestJson<SimulationState>('/api/state');
}

export function apiSimulate(days: number): Promise<SimulationState> {
  return requestJson<SimulationState>('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days })
  });
}

export function apiRollback(days: number): Promise<SimulationState> {
  return requestJson<SimulationState>('/api/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days })
  });
}

export function apiReset(): Promise<SimulationState> {
  return requestJson<SimulationState>('/api/reset', {
    method: 'POST'
  });
}

export function apiCreateStation(station: Station): Promise<SimulationState> {
  return requestJson<SimulationState>('/api/stations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(station)
  });
}

export function apiUpdateStation(station_id: string, patch: Partial<Station>): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/stations/${encodeURIComponent(station_id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
}

export function apiDeleteStation(station_id: string): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/stations/${encodeURIComponent(station_id)}`, {
    method: 'DELETE'
  });
}

export function apiCreateStore(store: Partial<Store>): Promise<SimulationState> {
  // Backend expects build_days/capex_total etc.
  const payload = {
    store_id: store.store_id,
    name: store.name,
    station_id: store.station_id,
    build_days: store.build_days ?? 0,
    capex_total: store.capex_total ?? 0,
    capex_useful_life_days: store.capex_useful_life_days ?? 3650,
    fixed_overhead_per_day: store.fixed_overhead_per_day ?? 200,
    strict_parts: store.strict_parts ?? true,
    operation_start_day: store.operation_start_day,
    traffic_conversion_rate: store.traffic_conversion_rate,
    city: store.city,
    district: store.district,
    provider: store.provider
  };
  return requestJson<SimulationState>('/api/stores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function apiUpdateStore(store_id: string, patch: Partial<Store>): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/stores/${encodeURIComponent(store_id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
}

export function apiCloseStore(store_id: string, inventory_salvage_rate = 0.3, asset_salvage_rate = 0.1): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/stores/${encodeURIComponent(store_id)}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventory_salvage_rate, asset_salvage_rate })
  });
}

export function apiPurchaseInventory(store_id: string, payload: { sku: string; name?: string; unit_cost: number; qty: number }): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/stores/${encodeURIComponent(store_id)}/inventory/purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function apiUpsertReplenishmentRule(
  store_id: string,
  payload: {
    sku: string;
    name?: string;
    enabled?: boolean;
    reorder_point?: number;
    safety_stock?: number;
    target_stock?: number;
    lead_time_days?: number;
    unit_cost?: number;
  }
): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/stores/${encodeURIComponent(store_id)}/replenishment/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function apiDeleteReplenishmentRule(store_id: string, sku: string): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/stores/${encodeURIComponent(store_id)}/replenishment/rules/${encodeURIComponent(sku)}`, {
    method: 'DELETE'
  });
}

async function uploadFile(url: string, file: File): Promise<void> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(url, {
    method: 'POST',
    body: fd,
    credentials: 'same-origin'
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '上传失败');
    throw new Error(text || `HTTP ${res.status}`);
  }
}

export function apiImportStateFile(file: File): Promise<void> {
  return uploadFile('/ops/import/state', file);
}

export function apiImportLedgerFile(file: File): Promise<void> {
  return uploadFile('/ops/import/ledger', file);
}

export function apiUpdateFinance(payload: {
  hq_credit_limit?: number;
  hq_daily_interest_rate?: number;
  hq_auto_finance?: boolean;
  budget_monthly_revenue_target?: number;
  budget_monthly_profit_target?: number;
  budget_monthly_cashflow_target?: number;
  manual_repay?: number;
}): Promise<SimulationState> {
  return requestJson<SimulationState>('/api/finance', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function apiUpsertStoreBulkTemplate(payload: {
  name: string;
  status: 'planning' | 'constructing' | 'open' | 'closed';
  inv: number;
  asset: number;
}): Promise<SimulationState> {
  return requestJson<SimulationState>('/api/bulk-templates/store-ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function apiDeleteStoreBulkTemplate(name: string): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/bulk-templates/store-ops/${encodeURIComponent(name)}`, {
    method: 'DELETE'
  });
}

export function apiRenameStoreBulkTemplate(oldName: string, newName: string): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/bulk-templates/store-ops/${encodeURIComponent(oldName)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_name: newName })
  });
}

export function apiExportStoreBulkTemplates(): Promise<{ templates: Array<{ name: string; status: 'planning' | 'constructing' | 'open' | 'closed'; inv: number; asset: number }> }> {
  return requestJson<{ templates: Array<{ name: string; status: 'planning' | 'constructing' | 'open' | 'closed'; inv: number; asset: number }> }>('/api/bulk-templates/store-ops/export');
}

export function apiImportStoreBulkTemplates(payload: {
  templates: Array<{ name: string; status: 'planning' | 'constructing' | 'open' | 'closed'; inv: number; asset: number }>;
  mode?: 'merge' | 'replace';
}): Promise<SimulationState> {
  return requestJson<SimulationState>('/api/bulk-templates/store-ops/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function apiUpsertStationBulkTemplate(payload: {
  name: string;
  fuel_factor: number;
  visitor_factor: number;
}): Promise<SimulationState> {
  return requestJson<SimulationState>('/api/bulk-templates/station-ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function apiDeleteStationBulkTemplate(name: string): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/bulk-templates/station-ops/${encodeURIComponent(name)}`, {
    method: 'DELETE'
  });
}

export function apiRenameStationBulkTemplate(oldName: string, newName: string): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/bulk-templates/station-ops/${encodeURIComponent(oldName)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_name: newName })
  });
}

export function apiExportStationBulkTemplates(): Promise<{ templates: Array<{ name: string; fuel_factor: number; visitor_factor: number }> }> {
  return requestJson<{ templates: Array<{ name: string; fuel_factor: number; visitor_factor: number }> }>('/api/bulk-templates/station-ops/export');
}

export function apiImportStationBulkTemplates(payload: {
  templates: Array<{ name: string; fuel_factor: number; visitor_factor: number }>;
  mode?: 'merge' | 'replace';
}): Promise<SimulationState> {
  return requestJson<SimulationState>('/api/bulk-templates/station-ops/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function apiUpsertServiceLine(store_id: string, payload: any): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/stores/${encodeURIComponent(store_id)}/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function apiDeleteServiceLine(store_id: string, service_id: string): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/stores/${encodeURIComponent(store_id)}/services/${encodeURIComponent(service_id)}`, {
    method: 'DELETE'
  });
}

export function apiUpsertProject(store_id: string, payload: any): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/stores/${encodeURIComponent(store_id)}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function apiDeleteProject(store_id: string, project_id: string): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/stores/${encodeURIComponent(store_id)}/projects/${encodeURIComponent(project_id)}`, {
    method: 'DELETE'
  });
}

export function apiAddAsset(store_id: string, payload: any): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/stores/${encodeURIComponent(store_id)}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function apiDeleteAsset(store_id: string, index: number): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/stores/${encodeURIComponent(store_id)}/assets/${index}`, {
    method: 'DELETE'
  });
}

export function apiUpsertRole(store_id: string, payload: any): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/stores/${encodeURIComponent(store_id)}/roles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function apiDeleteRole(store_id: string, role: string): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/stores/${encodeURIComponent(store_id)}/roles/${encodeURIComponent(role)}`, {
    method: 'DELETE'
  });
}

export function apiUpsertEventTemplate(payload: any): Promise<SimulationState> {
  return requestJson<SimulationState>('/api/event-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function apiDeleteEventTemplate(template_id: string): Promise<SimulationState> {
  return requestJson<SimulationState>(`/api/event-templates/${encodeURIComponent(template_id)}`, {
    method: 'DELETE'
  });
}

export function apiInjectEvent(payload: any): Promise<SimulationState> {
  return requestJson<SimulationState>('/api/events/inject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function apiSetEventSeed(seed: number): Promise<SimulationState> {
  return requestJson<SimulationState>('/api/events/seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed })
  });
}

export function apiGetSiteRecommendations(
  top_k = 10,
  radius = 15,
  distance_mode: 'euclidean' | 'road_proxy' | 'road_graph' = 'road_proxy',
  graph_k_neighbors = 3
): Promise<{ top_k: number; radius: number; distance_mode: string; graph_k_neighbors: number; recommendations: SiteRecommendation[] }> {
  return requestJson<{ top_k: number; radius: number; distance_mode: string; graph_k_neighbors: number; recommendations: SiteRecommendation[] }>(
    `/api/site-recommendations?top_k=${encodeURIComponent(top_k)}&radius=${encodeURIComponent(radius)}&distance_mode=${encodeURIComponent(distance_mode)}&graph_k_neighbors=${encodeURIComponent(graph_k_neighbors)}`
  );
}

export function apiCompareScenarios(payload: {
  days: number;
  seed?: number;
  scenarios: Array<{
    name: string;
    station_patches?: Array<Record<string, any>>;
    store_patches?: Array<Record<string, any>>;
  }>;
}): Promise<ScenarioCompareResult> {
  return requestJson<ScenarioCompareResult>('/api/scenarios/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
