import type { SimulationState, Station, Store } from '../types';

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
