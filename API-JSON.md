# JSON API（给 simulator/ 前端用）

后端实现：`src/simgame/webapp.py`

Base URL（本机默认）：`http://127.0.0.1:8000`

特点：所有写操作返回 **全量 SimulationState**（方便前端 `setState(next)`）。

---

## 1) State

### GET `/api/state`

- 返回：`SimulationState`
- 说明：包含 `stations[]`、`stores[]`、`ledger[]`（最近 200 条）

---

## 2) 模拟/回退/重置

### POST `/api/simulate`

- Body：`{ "days": 1..3650 }`
- 返回：全量 `SimulationState`
- 副作用：
  - 追加 `data/ledger.csv`
  - 写入 `data/state.json`
  - 写入每日快照 `data/snapshots/state_day_*.json`

### POST `/api/rollback`

- Body：`{ "days": 1..365 }`
- 返回：全量 `SimulationState`
- 副作用：
  - 回滚到目标日快照（`state_day_xxxxxx.json`）
  - 截断 `data/ledger.csv`（保留 day < target_day）

### POST `/api/reset`

- Body：无
- 返回：全量 `SimulationState`
- 副作用：清空 `data/state.json`、`data/ledger.csv`、`data/snapshots/*`，并重建默认初始状态

---

## 3) 站点

### POST `/api/stations`

- Body：
```json
{
  "station_id": "S1",
  "name": "xxx",
  "station_type": "城市站",
  "city": "上海",
  "district": "静安",
  "provider": "服务商A",
  "map_x": 45,
  "map_y": 42,
  "fuel_vehicles_per_day": 1200,
  "visitor_vehicles_per_day": 10,
  "traffic_volatility": 0.1
}
```

### PUT `/api/stations/{station_id}`

- Body：Station 的 patch（部分字段即可）

### DELETE `/api/stations/{station_id}`

- Body：无

---

## 4) 门店

### POST `/api/stores`

- Body（最小）：
```json
{
  "store_id": "M1",
  "name": "门店",
  "station_id": "S1",
  "build_days": 30,
  "capex_total": 150000,
  "capex_useful_life_days": 3650,
  "fixed_overhead_per_day": 200,
  "strict_parts": true,
  "operation_start_day": 1,
  "traffic_conversion_rate": 1.0,
  "city": "上海",
  "district": "静安",
  "provider": "服务商A"
}
```

### PUT `/api/stores/{store_id}`

- Body：Store 的 patch（部分字段即可）

### POST `/api/stores/{store_id}/close`

- Body：`{ "inventory_salvage_rate": 0.3, "asset_salvage_rate": 0.1 }`

### POST `/api/stores/{store_id}/inventory/purchase`

- Body：`{ "sku":"...", "name":"...", "unit_cost":12.3, "qty":10 }`

### POST `/api/stores/{store_id}/assets`

- Body：`{ "asset_name":"...", "capex":5000, "useful_life_days":3650, "in_service_day":1 }`

### DELETE `/api/stores/{store_id}/assets/{index}`

---

## 5) 服务线/项目/薪酬角色

### POST `/api/stores/{store_id}/services`

- Body：包含 `service_id/name/category/price/转化率/产能/...`

### DELETE `/api/stores/{store_id}/services/{service_id}`

### POST `/api/stores/{store_id}/projects`

- Body：包含 `project_id/name/price/labor_hours/variable_cost/parts_json`

### DELETE `/api/stores/{store_id}/projects/{project_id}`

### POST `/api/stores/{store_id}/roles`

- Body：包含岗位基础信息 + 提成字段：
  - `wash_commission_rate`
  - `maintenance_commission_rate`
  - `detailing_commission_rate`

### DELETE `/api/stores/{store_id}/roles/{role}`

---

## 6) 下载

- GET `/download/state`：`data/state.json`
- GET `/download/ledger`：`data/ledger.csv`
- GET `/download/payroll`：导出工资单 CSV（可选 query：`?day=xx`）
