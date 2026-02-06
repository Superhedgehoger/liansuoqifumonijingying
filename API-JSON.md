# JSON API（给 simulator/ 前端用）

后端实现：`src/simgame/webapp.py`

Base URL（本机默认）：`http://127.0.0.1:8000`

特点：所有写操作返回 **全量 SimulationState**（方便前端 `setState(next)`）。

---

## 1) State

### GET `/api/state`

- 返回：`SimulationState`
- 说明：包含 `stations[]`、`stores[]`、`ledger[]`（最近 200 条），以及 `events`（事件系统）

`events` 结构：

```json
{
  "events": {
    "rng_seed": 20260101,
    "templates": ["..."],
    "active": ["..."],
    "history": ["..."]
  }
}
```

---

## 1.1) 事件系统

### GET `/api/events`

- 返回：仅事件字段（等价于 `state.events`）

### POST `/api/events/seed`

- Body：`{ "seed": 20260101 }`
- 返回：全量 `SimulationState`
- 说明：设置 `rng_seed` 并清空 `rng_state`，用于复现随机

### POST `/api/event-templates`

- Body：事件模板（可部分字段；留空 `template_id` 会自动生成）
- 返回：全量 `SimulationState`

### DELETE `/api/event-templates/{template_id}`

- 返回：全量 `SimulationState`

### POST `/api/events/inject`

- Body：
```json
{
  "template_id": "power_outage",
  "scope": "store",
  "target_id": "M1",
  "start_day": 12,
  "duration_days": 2,
  "intensity": 0.9
}
```

- 返回：全量 `SimulationState`
- 说明：用于联调/演示，强制把某模板事件注入到指定范围目标

---

## 1.2) 策略实验（P1）

### GET `/api/site-recommendations`

- Query：
  - `top_k`（默认 10，最大 100）
  - `radius`（默认 15）
  - `distance_mode`（`road_proxy`/`road_graph`/`euclidean`，默认 `road_proxy`）
  - `graph_k_neighbors`（仅 `road_graph` 生效，默认 3）
- 返回：推荐站点列表（未覆盖需求、最近开店距离、评分、距离置信度、评分分解）

### POST `/api/scenarios/compare`

- Body：
```json
{
  "days": 30,
  "seed": 20260101,
  "scenarios": [
    {
      "name": "A-高竞争",
      "store_patches": [
        {
          "store_id": "M1",
          "local_competition_intensity": 0.4,
          "attractiveness_index": 1.0,
          "traffic_conversion_rate": 1.0
        }
      ]
    }
  ]
}
```

- 返回：`baseline` 与 `scenarios[]` 指标及 `delta_vs_baseline`
- 说明：只在内存并行仿真，不改写真实 `state.json` 与 `ledger.csv`

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
- 新增（P2）：支持 `mitigation`（事件对冲配置）与 `auto_replenishment_enabled`

### POST `/api/stores/{store_id}/close`

- Body：`{ "inventory_salvage_rate": 0.3, "asset_salvage_rate": 0.1 }`

### POST `/api/stores/{store_id}/inventory/purchase`

- Body：`{ "sku":"...", "name":"...", "unit_cost":12.3, "qty":10 }`

### POST `/api/stores/{store_id}/replenishment/rules`

- Body：
```json
{
  "sku": "CHEM",
  "name": "洗车液",
  "enabled": true,
  "reorder_point": 50,
  "safety_stock": 80,
  "target_stock": 150,
  "lead_time_days": 2,
  "unit_cost": 20
}
```

### DELETE `/api/stores/{store_id}/replenishment/rules/{sku}`

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
