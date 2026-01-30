from __future__ import annotations

import threading
from pathlib import Path
from typing import Optional

import json
import math

from fastapi import Body, FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response

from simgame.engine import EngineConfig, close_store, purchase_inventory, simulate_day
from simgame.models import Asset, GameState, RolePlan, ServiceLine, ServiceProject, Station, Store
from simgame.presets import apply_default_store_template
from simgame.storage import (
    append_ledger_csv,
    data_dir,
    ledger_path,
    load_state,
    reset_data_files,
    save_snapshot,
    save_state,
    snapshot_path,
    state_path,
    truncate_ledger_before_day,
)

from simgame.reporting import compute_beq_for_store


_lock = threading.Lock()


def _ensure_state() -> GameState:
    p = state_path()
    if p.exists():
        return load_state(p)
    # fall back to CLI seed via presets
    s = GameState()
    s.stations["S1"] = Station(station_id="S1", name="样例加油站", fuel_vehicles_per_day=700, visitor_vehicles_per_day=10)
    store = Store(store_id="M1", name="样例汽服门店", station_id="S1")
    store.status = "open"
    apply_default_store_template(store)
    # Inventory baseline
    from simgame.models import InventoryItem

    store.inventory["CHEM"] = InventoryItem(sku="CHEM", name="洗车液(升)", unit_cost=20.0, qty=200.0)
    store.inventory["OIL"] = InventoryItem(sku="OIL", name="机油(升)", unit_cost=35.0, qty=200.0)
    store.inventory["FILTER"] = InventoryItem(sku="FILTER", name="机滤(个)", unit_cost=25.0, qty=60.0)
    store.inventory["PATCH"] = InventoryItem(sku="PATCH", name="补胎胶片(个)", unit_cost=3.0, qty=300.0)
    store.inventory["WIPER_BLADE"] = InventoryItem(sku="WIPER_BLADE", name="雨刮条(根)", unit_cost=18.0, qty=120.0)
    s.stores["M1"] = store
    save_state(s)
    save_snapshot(s)
    return s


def create_app() -> FastAPI:
    app = FastAPI(title="Gas Station & Auto Service Simulator API")

    # Allow Vite dev server or other local frontends.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Ensure data dir exists
    data_dir()

    cfg = EngineConfig(month_len_days=30)

    @app.get("/")
    def root():
        return {
            "name": "gas-station-auto-service-simulator",
            "api": "/api/state",
            "downloads": ["/download/state", "/download/ledger", "/download/payroll"],
            "ui": "http://127.0.0.1:3000/",
            "ops": "/ops",
        }

    def _backup_file(p: Path, prefix: str) -> Optional[Path]:
        if not p.exists():
            return None
        ts = __import__("datetime").datetime.now().strftime("%Y%m%d_%H%M%S")
        bak = p.with_name(f"{prefix}_{ts}{p.suffix}")
        try:
            bak.write_bytes(p.read_bytes())
            return bak
        except Exception:
            return None

    @app.get("/ops", response_class=HTMLResponse)
    def ops_home():
        # Minimal form routes for admin/testing (kept intentionally template-free).
        return """<!doctype html>
<html lang=\"zh-CN\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>Simulator Ops</title>
    <style>
      body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;max-width:960px;margin:24px auto;padding:0 16px;line-height:1.5}
      h1{font-size:20px;margin:0 0 12px}
      h2{font-size:16px;margin:18px 0 8px}
      .card{border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:10px 0;background:#fff}
      input,button{font-size:14px}
      .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
      .muted{color:#6b7280;font-size:12px}
      code{background:#f3f4f6;padding:2px 6px;border-radius:6px}
    </style>
  </head>
  <body>
    <h1>运维/导入导出</h1>
    <div class=\"card\">
      <div class=\"row\">
        <a href=\"/download/state\">下载 state.json</a>
        <a href=\"/download/ledger\">下载 ledger.csv</a>
        <a href=\"/download/payroll\">下载 payroll.csv</a>
      </div>
      <div class=\"muted\">提示：新前端在 <code>http://127.0.0.1:3000/</code>，API 在 <code>/api/*</code>。</div>
    </div>

    <h2>导入 state.json</h2>
    <div class=\"card\">
      <form class=\"row\" action=\"/ops/import/state\" method=\"post\" enctype=\"multipart/form-data\">
        <input type=\"file\" name=\"file\" accept=\"application/json,.json\" required />
        <button type=\"submit\">上传并替换</button>
      </form>
      <div class=\"muted\">会自动备份当前 <code>data/state.json</code>，然后覆盖为上传文件。</div>
    </div>

    <h2>导入 ledger.csv</h2>
    <div class=\"card\">
      <form class=\"row\" action=\"/ops/import/ledger\" method=\"post\" enctype=\"multipart/form-data\">
        <input type=\"file\" name=\"file\" accept=\"text/csv,.csv\" required />
        <button type=\"submit\">上传并替换</button>
      </form>
      <div class=\"muted\">会自动备份当前 <code>data/ledger.csv</code>，然后覆盖为上传文件。</div>
    </div>

    <h2>快捷操作</h2>
    <div class=\"card\">
      <form class=\"row\" action=\"/ops/simulate\" method=\"post\">
        <label>模拟天数 <input type=\"number\" name=\"days\" value=\"1\" min=\"1\" max=\"365\" /></label>
        <button type=\"submit\">执行</button>
      </form>
      <form class=\"row\" action=\"/ops/reset\" method=\"post\" onsubmit=\"return confirm('确定重置模拟数据？会删除 data/state.json 和 data/ledger.csv 和 data/snapshots/*');\">
        <button type=\"submit\">重置数据</button>
      </form>
    </div>
  </body>
</html>"""

    @app.post("/ops/import/state")
    async def ops_import_state(file: UploadFile = File(...)):
        p = state_path()
        _backup_file(p, "state_backup")
        raw = await file.read()
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            return HTMLResponse("导入失败：不是合法的 UTF-8 JSON。", status_code=400)

        if not isinstance(payload, dict) or "state" not in payload:
            return HTMLResponse("导入失败：JSON 结构不正确，缺少 state 字段。", status_code=400)

        try:
            p.write_bytes(raw)
        except Exception:
            return HTMLResponse("导入失败：写入 data/state.json 失败。", status_code=500)
        return RedirectResponse(url="/ops", status_code=303)

    @app.post("/ops/import/ledger")
    async def ops_import_ledger(file: UploadFile = File(...)):
        p = ledger_path()
        _backup_file(p, "ledger_backup")
        raw = await file.read()

        # Best-effort validate header contains day/store_id to prevent accidental uploads.
        try:
            text = raw.decode("utf-8")
        except Exception:
            return HTMLResponse("导入失败：CSV 需为 UTF-8 编码。", status_code=400)
        first_line = (text.splitlines()[0] if text else "").strip("\ufeff").strip()
        if "day" not in first_line or "store_id" not in first_line:
            return HTMLResponse("导入失败：CSV 表头缺少 day/store_id。", status_code=400)

        try:
            p.write_bytes(raw)
        except Exception:
            return HTMLResponse("导入失败：写入 data/ledger.csv 失败。", status_code=500)
        return RedirectResponse(url="/ops", status_code=303)

    @app.post("/ops/simulate")
    def ops_simulate(days: int = Form(1)):
        n = max(1, min(365, int(days)))
        with _lock:
            state = _ensure_state()
            for _ in range(n):
                save_snapshot(state)
                dr = simulate_day(state, cfg)
                append_ledger_csv(dr)
                save_state(state)
        return RedirectResponse(url="/ops", status_code=303)

    @app.post("/ops/reset")
    def ops_reset():
        with _lock:
            reset_data_files()
            _ensure_state()
        return RedirectResponse(url="/ops", status_code=303)

    def _read_ledger_rows() -> list[dict]:
        p = ledger_path()
        if not p.exists():
            return []
        try:
            import csv

            with p.open("r", encoding="utf-8", newline="") as f:
                return list(csv.DictReader(f))
        except Exception:
            return []

    def _latest_ledger_day(rows: list[dict], fallback_day: int) -> int:
        best = 0
        for r in rows:
            try:
                best = max(best, int(r.get("day") or 0))
            except Exception:
                continue
        if best > 0:
            return best
        return max(0, fallback_day - 1)

    def _float_from_row(r: dict, key: str) -> float:
        try:
            return float(r.get(key) or 0.0)
        except Exception:
            return 0.0

    def _int_from_row(r: dict, key: str) -> int:
        try:
            return int(r.get(key) or 0)
        except Exception:
            return 0

    def _json_from_row(r: dict, key: str) -> dict:
        try:
            s = r.get(key) or "{}"
            return json.loads(s)
        except Exception:
            return {}

    def _compute_revenue_by_category_from_row(store: Store, r: dict) -> dict:
        # Best-effort reconstruction from orders JSON.
        by_cat = {"wash": 0.0, "maintenance": 0.0, "detailing": 0.0, "other": 0.0}

        orders_by_service = _json_from_row(r, "orders_by_service_json")
        orders_by_project = _json_from_row(r, "orders_by_project_json")

        # Services without project_mix
        for sid, n in orders_by_service.items():
            line = store.service_lines.get(str(sid))
            if not line:
                continue
            # If this service has project_mix, prefer project revenue instead.
            if getattr(line, "project_mix", None):
                continue
            cat = getattr(line, "category", "other") or "other"
            if cat not in by_cat:
                cat = "other"
            try:
                qty = int(n)
            except Exception:
                qty = 0
            by_cat[cat] += float(qty) * float(line.price)

        # Projects: assign to "maintenance" by default (can be refined later)
        for pid, n in orders_by_project.items():
            proj = store.projects.get(str(pid))
            if not proj:
                continue
            try:
                qty = int(n)
            except Exception:
                qty = 0
            by_cat["maintenance"] += float(qty) * float(proj.price)

        return by_cat

    def _daily_bases_from_row(store: Store, r: Optional[dict]) -> tuple[dict, dict, float, float, float]:
        if not r:
            empty = {"wash": 0.0, "maintenance": 0.0, "detailing": 0.0, "other": 0.0}
            return empty, empty, 0.0, 0.0, 0.0

        rev_cat = _json_from_row(r, "revenue_by_category_json")
        if not rev_cat:
            rev_cat = _compute_revenue_by_category_from_row(store, r)
        # Ensure all keys exist
        for k in ("wash", "maintenance", "detailing", "other"):
            rev_cat.setdefault(k, 0.0)

        gp_cat = _json_from_row(r, "gross_profit_by_category_json")
        if not gp_cat:
            gp_cat = {"wash": 0.0, "maintenance": 0.0, "detailing": 0.0, "other": 0.0}
        for k in ("wash", "maintenance", "detailing", "other"):
            gp_cat.setdefault(k, 0.0)

        labor_rev = _float_from_row(r, "labor_revenue")
        parts_rev = _float_from_row(r, "parts_revenue")
        parts_gp = _float_from_row(r, "parts_gross_profit")
        return rev_cat, gp_cat, labor_rev, parts_rev, parts_gp

    def _compute_payroll_breakdown(
        store: Store,
        revenue_by_category: dict,
        gross_profit_by_category: dict,
        labor_revenue: float,
        parts_revenue: float,
        parts_gross_profit: float,
    ) -> list[dict]:
        def _pick_base(base: str, revenue_value: float, gross_profit_value: float) -> float:
            b = (base or "revenue").strip().lower()
            if b == "gross_profit":
                return max(0.0, float(gross_profit_value))
            return max(0.0, float(revenue_value))

        rows = []
        for role in store.payroll.roles.values():
            hc = max(0, int(role.headcount))
            fixed = role.base_daily()

            wash_base = _pick_base(
                getattr(role, "wash_commission_base", "revenue"),
                float(revenue_by_category.get("wash", 0.0)),
                float(gross_profit_by_category.get("wash", 0.0)),
            )
            maint_base = _pick_base(
                getattr(role, "maintenance_commission_base", "revenue"),
                float(revenue_by_category.get("maintenance", 0.0)),
                float(gross_profit_by_category.get("maintenance", 0.0)),
            )
            det_base = _pick_base(
                getattr(role, "detailing_commission_base", "revenue"),
                float(revenue_by_category.get("detailing", 0.0)),
                float(gross_profit_by_category.get("detailing", 0.0)),
            )
            parts_base = _pick_base(
                getattr(role, "parts_commission_base", "revenue"),
                float(parts_revenue),
                float(parts_gross_profit),
            )
            sales_base = (
                float(revenue_by_category.get("wash", 0.0))
                + float(revenue_by_category.get("maintenance", 0.0))
                + float(revenue_by_category.get("detailing", 0.0))
                + float(revenue_by_category.get("other", 0.0))
            )

            wash = wash_base * float(getattr(role, "wash_commission_rate", 0.0) or 0.0)
            maint = maint_base * float(getattr(role, "maintenance_commission_rate", 0.0) or 0.0)
            det = det_base * float(getattr(role, "detailing_commission_rate", 0.0) or 0.0)
            sales = sales_base * float(getattr(role, "sales_commission_rate", 0.0) or 0.0)
            labor = max(0.0, float(labor_revenue)) * float(getattr(role, "labor_commission_rate", 0.0) or 0.0)
            parts = parts_base * float(getattr(role, "parts_commission_rate", 0.0) or 0.0)

            total = float(fixed) + wash + maint + det + sales + labor + parts
            rows.append(
                {
                    "role": role.role,
                    "level": getattr(role, "level", ""),
                    "headcount": hc,
                    "fixed": fixed,
                    "wash_commission": wash,
                    "maintenance_commission": maint,
                    "detailing_commission": det,
                    "sales_commission": sales,
                    "labor_commission": labor,
                    "parts_commission": parts,
                    "total": total,
                }
            )
        return rows

    def _station_to_dto(s: Station) -> dict:
        return {
            "station_id": s.station_id,
            "name": s.name,
            "station_type": getattr(s, "station_type", ""),
            "city": getattr(s, "city", ""),
            "district": getattr(s, "district", ""),
            "provider": getattr(s, "provider", ""),
            "map_x": getattr(s, "map_x", 0.0),
            "map_y": getattr(s, "map_y", 0.0),
            "fuel_vehicles_per_day": s.fuel_vehicles_per_day,
            "visitor_vehicles_per_day": s.visitor_vehicles_per_day,
            "traffic_volatility": s.traffic_volatility,
        }

    def _role_to_dto(r: RolePlan) -> dict:
        return {
            "role": r.role,
            "level": getattr(r, "level", ""),
            "headcount": r.headcount,
            "base_monthly": r.base_monthly,
            "position_allowance": getattr(r, "position_allowance", 0.0),
            "social_security_rate": getattr(r, "social_security_rate", 0.0),
            "housing_fund_rate": getattr(r, "housing_fund_rate", 0.0),
            "labor_commission_rate": getattr(r, "labor_commission_rate", 0.0),
            "parts_commission_rate": getattr(r, "parts_commission_rate", 0.0),
            "parts_commission_base": getattr(r, "parts_commission_base", "revenue"),
            "sales_commission_rate": getattr(r, "sales_commission_rate", 0.0),
            "wash_commission_base": getattr(r, "wash_commission_base", "revenue"),
            "wash_commission_rate": getattr(r, "wash_commission_rate", 0.0),
            "maintenance_commission_base": getattr(r, "maintenance_commission_base", "revenue"),
            "maintenance_commission_rate": getattr(r, "maintenance_commission_rate", 0.0),
            "detailing_commission_base": getattr(r, "detailing_commission_base", "revenue"),
            "detailing_commission_rate": getattr(r, "detailing_commission_rate", 0.0),
            "profit_share_rate": r.profit_share_rate,
            "min_monthly_orders_threshold": getattr(r, "min_monthly_orders_threshold", 0),
            "overtime_pay_rate": getattr(r, "overtime_pay_rate", 0.0),
            "workdays_per_month": getattr(r, "workdays_per_month", 26),
        }

    def _asset_to_dto(a: Asset, index: int) -> dict:
        return {
            "index": index,
            "asset_name": a.name,
            "capex": a.capex,
            "useful_life_days": a.useful_life_days,
            "in_service_day": a.in_service_day,
        }

    def _service_to_dto(l: ServiceLine) -> dict:
        return {
            "service_id": l.service_id,
            "name": l.name,
            "category": getattr(l, "category", "other"),
            "price": l.price,
            "conversion_from_fuel": l.conversion_from_fuel,
            "conversion_from_visitor": l.conversion_from_visitor,
            "capacity_per_day": l.capacity_per_day,
            "variable_cost_per_order": l.variable_cost_per_order,
            "parts_cost_ratio": l.parts_cost_ratio,
            "variable_labor_per_order": l.variable_labor_per_order,
            "labor_role": l.labor_role or "",
            "labor_hours_per_order": l.labor_hours_per_order,
            "consumable_sku": l.consumable_sku or "",
            "consumable_units_per_order": l.consumable_units_per_order,
            "project_mix_json": json.dumps(l.project_mix, ensure_ascii=False),
        }

    def _project_to_dto(p: ServiceProject) -> dict:
        return {
            "project_id": p.project_id,
            "name": p.name,
            "price": p.price,
            "labor_hours": p.labor_hours,
            "variable_cost": p.variable_cost,
            "parts_json": json.dumps(p.parts, ensure_ascii=False),
        }

    def _inventory_to_dto(item) -> dict:
        return {
            "sku": item.sku,
            "name": item.name,
            "unit_cost": item.unit_cost,
            "qty": item.qty,
        }

    def _payback_days(store_rows: list[dict], capex_total: float) -> float:
        # Rolling 30-day average of net cashflow
        if capex_total <= 0:
            return 0.0
        if not store_rows:
            return 0.0
        # Sort by day
        def _d(r: dict) -> int:
            try:
                return int(r.get("day") or 0)
            except Exception:
                return 0

        store_rows_sorted = sorted(store_rows, key=_d)
        last_day = _d(store_rows_sorted[-1])
        window = [r for r in store_rows_sorted if _d(r) > last_day - 30]
        if not window:
            return 0.0
        avg = sum(_float_from_row(r, "net_cashflow") for r in window) / float(len(window))
        if avg <= 0:
            return 0.0
        return float(capex_total) / avg

    def _store_to_dto(st: Store) -> dict:
        # Daily derived metrics from ledger
        rows = _read_ledger_rows()
        store_rows = [r for r in rows if (r.get("store_id") or "") == st.store_id]

        day_used = _latest_ledger_day(store_rows, fallback_day=0) if store_rows else 0
        latest_row = None
        for r in reversed(store_rows):
            try:
                if int(r.get("day") or 0) == day_used:
                    latest_row = r
                    break
            except Exception:
                continue

        today_revenue = _float_from_row(latest_row, "revenue") if latest_row else 0.0
        today_profit = _float_from_row(latest_row, "operating_profit") if latest_row else 0.0
        today_cashflow = _float_from_row(latest_row, "net_cashflow") if latest_row else 0.0
        revenue_by_category, gp_by_category, labor_revenue, parts_revenue, parts_gp = _daily_bases_from_row(st, latest_row)
        payroll_breakdown = _compute_payroll_breakdown(
            st,
            revenue_by_category=revenue_by_category,
            gross_profit_by_category=gp_by_category,
            labor_revenue=labor_revenue,
            parts_revenue=parts_revenue,
            parts_gross_profit=parts_gp,
        )

        # BEQ
        day_depr = 0.0
        for a in st.assets:
            day_depr += a.depreciation_on_day(int(day_used))
        beq_orders, _ = compute_beq_for_store(st, day_depr=day_depr)
        beq_orders = float(beq_orders) if math.isfinite(beq_orders) else 0.0

        payback = _payback_days(store_rows, capex_total=float(getattr(st, "capex_total", 0.0) or 0.0))

        return {
            "store_id": st.store_id,
            "name": st.name,
            "station_id": st.station_id,
            "city": getattr(st, "city", ""),
            "district": getattr(st, "district", ""),
            "provider": getattr(st, "provider", ""),
            "status": st.status,
            "build_days": getattr(st, "build_days_total", 0),
            "operation_start_day": getattr(st, "operation_start_day", 1),
            "traffic_conversion_rate": getattr(st, "traffic_conversion_rate", 1.0),
            "labor_hour_price": float(getattr(st, "labor_hour_price", 120.0) or 0.0),
            "capex_total": st.capex_total,
            "capex_useful_life_days": getattr(st, "capex_useful_life_days", 5 * 365),
            "construction_days_remaining": st.construction_days_remaining,
            "capex_spend_per_day": st.capex_spend_per_day,
            "fixed_overhead_per_day": st.fixed_overhead_per_day,
            "strict_parts": bool(st.strict_parts),
            "cash_balance": float(getattr(st, "cash_balance", 0.0)),
            "inventory": [_inventory_to_dto(x) for x in st.inventory.values()],
            "assets": [_asset_to_dto(a, i) for i, a in enumerate(st.assets)],
            "services": [_service_to_dto(l) for l in st.service_lines.values()],
            "projects": [_project_to_dto(p) for p in st.projects.values()],
            "roles": [_role_to_dto(r) for r in st.payroll.roles.values()],

            # Derived
            "today": {
                "day": int(day_used),
                "revenue": today_revenue,
                "operating_profit": today_profit,
                "net_cashflow": today_cashflow,
                "revenue_by_category": revenue_by_category,
                "status": st.status,
            },
            "payroll_preview": payroll_breakdown,
            "beq_orders_per_day": beq_orders,
            "payback_days_30d": payback,
        }

    def _read_ledger_entries(limit: int = 200) -> list[dict]:
        # Convert ledger.csv row into simplified entries for the React UI.
        p = ledger_path()
        if not p.exists():
            return []
        try:
            import csv

            with p.open("r", encoding="utf-8", newline="") as f:
                rows = list(csv.DictReader(f))
        except Exception:
            return []
        rows = rows[-max(1, int(limit)) :]
        out: list[dict] = []
        for r in reversed(rows):
            try:
                day = int(r.get("day") or 0)
            except Exception:
                day = 0
            store_id = str(r.get("store_id") or "")
            def _f(key: str) -> float:
                try:
                    return float(r.get(key) or 0.0)
                except Exception:
                    return 0.0

            revenue = _f("revenue")
            operating_profit = _f("operating_profit")
            net_cashflow = _f("net_cashflow")
            category = "收入" if net_cashflow >= 0 else "支出"
            desc = (
                f"收入={revenue:.2f} 经营利润={operating_profit:.2f} 净现金流={net_cashflow:.2f}"
            )
            out.append(
                {
                    "day": day,
                    "store_id": store_id,
                    "category": category,
                    "amount": net_cashflow,
                    "description": desc,
                    "revenue": revenue,
                    "operating_profit": operating_profit,
                    "net_cashflow": net_cashflow,
                    "status": str(r.get("status") or ""),
                }
            )
        return out

    # -------------------- JSON API (for the React frontend) --------------------

    @app.get("/api/state")
    def api_state():
        with _lock:
            state = _ensure_state()
            dto = {
                "day": state.day,
                "cash": state.cash,
                "stations": [_station_to_dto(s) for s in state.stations.values()],
                "stores": [_store_to_dto(s) for s in state.stores.values()],
                "ledger": _read_ledger_entries(limit=200),
            }
        return dto

    @app.post("/api/simulate")
    def api_simulate(payload: dict = Body(default={})):  # {days:int}
        days = int(payload.get("days", 1) or 1)
        days = max(1, min(3650, days))
        with _lock:
            state = _ensure_state()
            last = None
            for _ in range(days):
                last = simulate_day(state, cfg)
                append_ledger_csv(last)
                save_snapshot(state)
            save_state(state)
            dto = {
                "day": state.day,
                "cash": state.cash,
                "stations": [_station_to_dto(s) for s in state.stations.values()],
                "stores": [_store_to_dto(s) for s in state.stores.values()],
                "ledger": _read_ledger_entries(limit=200),
            }
        return dto

    @app.post("/api/rollback")
    def api_rollback(payload: dict = Body(default={})):  # {days:int}
        days = int(payload.get("days", 1) or 1)
        days = max(1, min(365, days))
        with _lock:
            state = _ensure_state()
            target_day = max(1, int(state.day) - int(days))
            sp = snapshot_path(target_day)
            if not sp.exists():
                return {"error": f"no snapshot for day {target_day} (try simulate first)"}

            state2 = load_state(sp)
            save_state(state2)
            # Truncate ledger to match target day (keep day < target_day)
            truncate_ledger_before_day(target_day)
            dto = {
                "day": state2.day,
                "cash": state2.cash,
                "stations": [_station_to_dto(s) for s in state2.stations.values()],
                "stores": [_store_to_dto(s) for s in state2.stores.values()],
                "ledger": _read_ledger_entries(limit=200),
            }
        return dto

    @app.post("/api/reset")
    def api_reset():
        with _lock:
            reset_data_files()
            state = _ensure_state()
            dto = {
                "day": state.day,
                "cash": state.cash,
                "stations": [_station_to_dto(s) for s in state.stations.values()],
                "stores": [_store_to_dto(s) for s in state.stores.values()],
                "ledger": _read_ledger_entries(limit=200),
            }
        return dto

    @app.post("/api/stations")
    def api_station_create(payload: dict = Body(...)):
        with _lock:
            state = _ensure_state()
            sid = str(payload.get("station_id") or "").strip()
            if not sid:
                return {"error": "station_id is required"}
            if sid in state.stations:
                return {"error": "station_id exists"}
            state.stations[sid] = Station(
                station_id=sid,
                name=str(payload.get("name") or sid),
                station_type=str(payload.get("station_type") or ""),
                city=str(payload.get("city") or ""),
                district=str(payload.get("district") or ""),
                provider=str(payload.get("provider") or ""),
                map_x=float(payload.get("map_x") or 0.0),
                map_y=float(payload.get("map_y") or 0.0),
                fuel_vehicles_per_day=max(0, int(payload.get("fuel_vehicles_per_day") or 0)),
                visitor_vehicles_per_day=max(0, int(payload.get("visitor_vehicles_per_day") or 0)),
                traffic_volatility=max(0.0, min(1.0, float(payload.get("traffic_volatility") or 0.0))),
            )
            save_state(state)
        return api_state()

    @app.put("/api/stations/{station_id}")
    def api_station_update(station_id: str, payload: dict = Body(...)):
        with _lock:
            state = _ensure_state()
            st = state.stations.get(station_id)
            if not st:
                return {"error": "station not found"}
            st.name = str(payload.get("name") or st.name)
            if "station_type" in payload:
                st.station_type = str(payload.get("station_type") or "")
            if "city" in payload:
                st.city = str(payload.get("city") or "")
            if "district" in payload:
                st.district = str(payload.get("district") or "")
            if "provider" in payload:
                st.provider = str(payload.get("provider") or "")
            if "map_x" in payload:
                st.map_x = float(payload.get("map_x") or 0.0)
            if "map_y" in payload:
                st.map_y = float(payload.get("map_y") or 0.0)
            if "fuel_vehicles_per_day" in payload:
                st.fuel_vehicles_per_day = max(0, int(payload.get("fuel_vehicles_per_day") or 0))
            if "visitor_vehicles_per_day" in payload:
                st.visitor_vehicles_per_day = max(0, int(payload.get("visitor_vehicles_per_day") or 0))
            if "traffic_volatility" in payload:
                st.traffic_volatility = max(0.0, min(1.0, float(payload.get("traffic_volatility") or 0.0)))
            save_state(state)
        return api_state()

    @app.delete("/api/stations/{station_id}")
    def api_station_delete(station_id: str):
        with _lock:
            state = _ensure_state()
            if station_id in state.stations:
                del state.stations[station_id]
                save_state(state)
        return api_state()

    @app.post("/api/stores")
    def api_store_create(payload: dict = Body(...)):
        with _lock:
            state = _ensure_state()
            store_id = str(payload.get("store_id") or "").strip()
            if not store_id:
                return {"error": "store_id is required"}
            if store_id in state.stores:
                return {"error": "store_id exists"}
            station_id = str(payload.get("station_id") or "").strip()
            if station_id not in state.stations:
                return {"error": "station_id not found"}

            st = Store(store_id=store_id, name=str(payload.get("name") or store_id), station_id=station_id)
            st.city = str(payload.get("city") or "")
            st.district = str(payload.get("district") or "")
            st.provider = str(payload.get("provider") or "")
            apply_default_store_template(st)
            st.fixed_overhead_per_day = float(payload.get("fixed_overhead_per_day") or 200.0)
            st.strict_parts = bool(payload.get("strict_parts") if "strict_parts" in payload else True)
            if "labor_hour_price" in payload:
                st.labor_hour_price = max(0.0, float(payload.get("labor_hour_price") or 0.0))

            build_days = max(0, int(payload.get("build_days") or 0))
            capex_total = float(payload.get("capex_total") or 0.0)
            capex_life = max(1, int(payload.get("capex_useful_life_days") or 5 * 365))
            st.build_days_total = build_days
            st.operation_start_day = max(1, int(payload.get("operation_start_day") or state.day))
            st.traffic_conversion_rate = float(payload.get("traffic_conversion_rate") or 1.0)
            st.capex_total = capex_total
            st.capex_useful_life_days = capex_life

            if build_days > 0:
                st.status = "constructing"
                st.construction_days_remaining = build_days
                st.capex_spend_per_day = capex_total / float(max(1, build_days))
            else:
                st.status = "open"
                st.assets.append(Asset(name=f"{st.name}-CAPEX", capex=capex_total, useful_life_days=capex_life, in_service_day=state.day))

            # baseline inventory (optional)
            from simgame.models import InventoryItem

            st.inventory.setdefault("CHEM", InventoryItem(sku="CHEM", name="洗车液(升)", unit_cost=20.0, qty=200.0))

            state.stores[store_id] = st
            save_state(state)
        return api_state()

    @app.put("/api/stores/{store_id}")
    def api_store_update(store_id: str, payload: dict = Body(...)):
        with _lock:
            state = _ensure_state()
            st = state.stores.get(store_id)
            if not st:
                return {"error": "store not found"}

            if "name" in payload:
                st.name = str(payload.get("name") or st.name)
            if "station_id" in payload:
                sid = str(payload.get("station_id") or "").strip()
                if sid in state.stations:
                    st.station_id = sid
            if "status" in payload:
                s = str(payload.get("status") or "")
                if s in {"planning", "constructing", "open", "closed"}:
                    st.status = s
            if "fixed_overhead_per_day" in payload:
                st.fixed_overhead_per_day = float(payload.get("fixed_overhead_per_day") or 0.0)
            if "strict_parts" in payload:
                st.strict_parts = bool(payload.get("strict_parts"))
            if "labor_hour_price" in payload:
                st.labor_hour_price = max(0.0, float(payload.get("labor_hour_price") or 0.0))

            if "build_days" in payload:
                st.build_days_total = max(0, int(payload.get("build_days") or 0))
            if "operation_start_day" in payload:
                st.operation_start_day = max(1, int(payload.get("operation_start_day") or 1))
            if "traffic_conversion_rate" in payload:
                st.traffic_conversion_rate = max(0.0, float(payload.get("traffic_conversion_rate") or 0.0))

            if "capex_total" in payload:
                st.capex_total = float(payload.get("capex_total") or 0.0)
            if "capex_useful_life_days" in payload:
                st.capex_useful_life_days = max(1, int(payload.get("capex_useful_life_days") or 1))
            if "construction_days_remaining" in payload:
                st.construction_days_remaining = max(0, int(payload.get("construction_days_remaining") or 0))
            if "capex_spend_per_day" in payload:
                st.capex_spend_per_day = max(0.0, float(payload.get("capex_spend_per_day") or 0.0))

            if "city" in payload:
                st.city = str(payload.get("city") or "")
            if "district" in payload:
                st.district = str(payload.get("district") or "")
            if "provider" in payload:
                st.provider = str(payload.get("provider") or "")

            save_state(state)
        return api_state()

    @app.post("/api/stores/{store_id}/close")
    def api_store_close(store_id: str, payload: dict = Body(default={})):
        inv_rate = float(payload.get("inventory_salvage_rate", 0.3))
        asset_rate = float(payload.get("asset_salvage_rate", 0.1))
        with _lock:
            state = _ensure_state()
            if store_id in state.stores:
                close_store(state, store_id=store_id, inventory_salvage_rate=inv_rate, asset_salvage_rate=asset_rate)
                save_state(state)
        return api_state()

    @app.post("/api/stores/{store_id}/inventory/purchase")
    def api_store_purchase(store_id: str, payload: dict = Body(...)):
        with _lock:
            state = _ensure_state()
            if store_id not in state.stores:
                return {"error": "store not found"}
            purchase_inventory(
                state,
                store_id=store_id,
                sku=str(payload.get("sku") or "").strip(),
                name=str(payload.get("name") or "").strip(),
                unit_cost=float(payload.get("unit_cost") or 0.0),
                qty=float(payload.get("qty") or 0.0),
            )
            save_state(state)
        return api_state()

    @app.post("/api/stores/{store_id}/assets")
    def api_store_asset_add(store_id: str, payload: dict = Body(...)):
        with _lock:
            state = _ensure_state()
            st = state.stores.get(store_id)
            if not st:
                return {"error": "store not found"}
            st.assets.append(
                Asset(
                    name=str(payload.get("asset_name") or payload.get("name") or "asset"),
                    capex=float(payload.get("capex") or 0.0),
                    useful_life_days=max(1, int(payload.get("useful_life_days") or 1)),
                    in_service_day=max(1, int(payload.get("in_service_day") or state.day)),
                )
            )
            save_state(state)
        return api_state()

    @app.delete("/api/stores/{store_id}/assets/{index}")
    def api_store_asset_delete(store_id: str, index: int):
        with _lock:
            state = _ensure_state()
            st = state.stores.get(store_id)
            if st:
                i = int(index)
                if 0 <= i < len(st.assets):
                    st.assets.pop(i)
                    save_state(state)
        return api_state()

    @app.post("/api/stores/{store_id}/services")
    def api_store_service_upsert(store_id: str, payload: dict = Body(...)):
        with _lock:
            state = _ensure_state()
            st = state.stores.get(store_id)
            if not st:
                return {"error": "store not found"}
            sid = str(payload.get("service_id") or "").strip()
            if not sid:
                return {"error": "service_id is required"}
            mix = []
            pm = payload.get("project_mix_json")
            if pm:
                try:
                    raw = json.loads(pm) if isinstance(pm, str) else pm
                    if isinstance(raw, list):
                        for pair in raw:
                            if isinstance(pair, list) and len(pair) == 2:
                                mix.append((str(pair[0]), float(pair[1])))
                except Exception:
                    mix = []

            st.service_lines[sid] = ServiceLine(
                service_id=sid,
                name=str(payload.get("name") or sid),
                category=str(payload.get("category") or "other"),
                price=float(payload.get("price") or 0.0),
                conversion_from_fuel=max(0.0, min(1.0, float(payload.get("conversion_from_fuel") or 0.0))),
                conversion_from_visitor=max(0.0, min(1.0, float(payload.get("conversion_from_visitor") or 0.0))),
                capacity_per_day=max(0, int(payload.get("capacity_per_day") or 0)),
                variable_cost_per_order=max(0.0, float(payload.get("variable_cost_per_order") or 0.0)),
                parts_cost_ratio=max(0.0, min(1.0, float(payload.get("parts_cost_ratio") or 0.0))),
                variable_labor_per_order=max(0.0, float(payload.get("variable_labor_per_order") or 0.0)),
                labor_role=str(payload.get("labor_role") or "").strip() or None,
                labor_hours_per_order=max(0.0, float(payload.get("labor_hours_per_order") or 0.0)),
                consumable_sku=str(payload.get("consumable_sku") or "").strip() or None,
                consumable_units_per_order=max(0.0, float(payload.get("consumable_units_per_order") or 0.0)),
                project_mix=mix,
            )
            save_state(state)
        return api_state()

    @app.delete("/api/stores/{store_id}/services/{service_id}")
    def api_store_service_delete(store_id: str, service_id: str):
        with _lock:
            state = _ensure_state()
            st = state.stores.get(store_id)
            if st and service_id in st.service_lines:
                del st.service_lines[service_id]
                save_state(state)
        return api_state()

    @app.post("/api/stores/{store_id}/projects")
    def api_store_project_upsert(store_id: str, payload: dict = Body(...)):
        with _lock:
            state = _ensure_state()
            st = state.stores.get(store_id)
            if not st:
                return {"error": "store not found"}
            pid = str(payload.get("project_id") or "").strip()
            if not pid:
                return {"error": "project_id is required"}
            parts = payload.get("parts_json")
            parts_dict = {}
            if parts:
                try:
                    raw = json.loads(parts) if isinstance(parts, str) else parts
                    if isinstance(raw, dict):
                        parts_dict = {str(k): float(v) for k, v in raw.items()}
                except Exception:
                    parts_dict = {}
            st.projects[pid] = ServiceProject(
                project_id=pid,
                name=str(payload.get("name") or pid),
                price=float(payload.get("price") or 0.0),
                labor_hours=max(0.0, float(payload.get("labor_hours") or 0.0)),
                variable_cost=max(0.0, float(payload.get("variable_cost") or 0.0)),
                parts=parts_dict,
            )
            save_state(state)
        return api_state()

    @app.delete("/api/stores/{store_id}/projects/{project_id}")
    def api_store_project_delete(store_id: str, project_id: str):
        with _lock:
            state = _ensure_state()
            st = state.stores.get(store_id)
            if st and project_id in st.projects:
                del st.projects[project_id]
                save_state(state)
        return api_state()

    @app.post("/api/stores/{store_id}/roles")
    def api_store_role_upsert(store_id: str, payload: dict = Body(...)):
        with _lock:
            state = _ensure_state()
            st = state.stores.get(store_id)
            if not st:
                return {"error": "store not found"}
            rname = str(payload.get("role") or "").strip()
            if not rname:
                return {"error": "role is required"}
            rp = RolePlan(
                role=rname,
                headcount=max(0, int(payload.get("headcount") or 0)),
                level=str(payload.get("level") or ""),
                base_monthly=max(0.0, float(payload.get("base_monthly") or 0.0)),
                position_allowance=max(0.0, float(payload.get("position_allowance") or 0.0)),
                social_security_rate=max(0.0, float(payload.get("social_security_rate") or 0.0)),
                housing_fund_rate=max(0.0, float(payload.get("housing_fund_rate") or 0.0)),
                workdays_per_month=max(1, int(payload.get("workdays_per_month") or 26)),
            )
            rp.labor_commission_rate = max(0.0, float(payload.get("labor_commission_rate") or 0.0))
            rp.parts_commission_rate = max(0.0, float(payload.get("parts_commission_rate") or 0.0))
            rp.parts_commission_base = str(payload.get("parts_commission_base") or "revenue")
            rp.sales_commission_rate = max(0.0, float(payload.get("sales_commission_rate") or 0.0))
            rp.wash_commission_base = str(payload.get("wash_commission_base") or "revenue")
            rp.wash_commission_rate = max(0.0, float(payload.get("wash_commission_rate") or 0.0))
            rp.maintenance_commission_base = str(payload.get("maintenance_commission_base") or "revenue")
            rp.maintenance_commission_rate = max(0.0, float(payload.get("maintenance_commission_rate") or 0.0))
            rp.detailing_commission_base = str(payload.get("detailing_commission_base") or "revenue")
            rp.detailing_commission_rate = max(0.0, float(payload.get("detailing_commission_rate") or 0.0))
            rp.profit_share_rate = max(0.0, float(payload.get("profit_share_rate") or 0.0))
            rp.min_monthly_orders_threshold = int(payload.get("min_monthly_orders_threshold") or 0)
            rp.overtime_pay_rate = max(0.0, float(payload.get("overtime_pay_rate") or 0.0))
            st.payroll.roles[rname] = rp
            save_state(state)
        return api_state()

    @app.delete("/api/stores/{store_id}/roles/{role}")
    def api_store_role_delete(store_id: str, role: str):
        with _lock:
            state = _ensure_state()
            st = state.stores.get(store_id)
            if st and role in st.payroll.roles:
                del st.payroll.roles[role]
                save_state(state)
        return api_state()

    @app.delete("/api/stores/{store_id}")
    def api_store_delete(store_id: str):
        with _lock:
            state = _ensure_state()
            if store_id in state.stores:
                del state.stores[store_id]
                save_state(state)
        return api_state()

    @app.get("/download/state")
    def download_state():
        p = state_path()
        if not p.exists():
            _ensure_state()
        return FileResponse(str(p), filename="state.json")

    @app.get("/download/ledger")
    def download_ledger():
        p = ledger_path()
        if not p.exists():
            # create empty by saving state once
            _ensure_state()
        return FileResponse(str(p), filename="ledger.csv")

    @app.get("/download/payroll")
    def download_payroll(day: Optional[int] = None):
        import csv
        import io

        with _lock:
            state = _ensure_state()
            rows = _read_ledger_rows()
            if not rows:
                # empty CSV
                content = "day,store_id,store_name,role,level,headcount,fixed,wash_commission,maintenance_commission,detailing_commission,sales_commission,labor_commission,parts_commission,total\n"
                return Response(
                    content,
                    media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="payroll.csv"'},
                )

            latest_day = _latest_ledger_day(rows, fallback_day=state.day)
            day_used = int(day) if day else latest_day

            # Index ledger rows by store_id for that day
            by_store = {}
            for r in rows:
                try:
                    d = int(r.get("day") or 0)
                except Exception:
                    continue
                if d != day_used:
                    continue
                sid = str(r.get("store_id") or "")
                by_store[sid] = r

            out = io.StringIO()
            w = csv.writer(out)
            w.writerow(
                [
                    "day",
                    "store_id",
                    "store_name",
                    "role",
                    "level",
                    "headcount",
                    "fixed",
                    "wash_commission",
                    "maintenance_commission",
                    "detailing_commission",
                    "sales_commission",
                    "labor_commission",
                    "parts_commission",
                    "total",
                ]
            )

            for st in state.stores.values():
                r = by_store.get(st.store_id)
                rev_cat, gp_cat, labor_rev, parts_rev, parts_gp = _daily_bases_from_row(st, r)
                breakdown = _compute_payroll_breakdown(
                    st,
                    revenue_by_category=rev_cat,
                    gross_profit_by_category=gp_cat,
                    labor_revenue=labor_rev,
                    parts_revenue=parts_rev,
                    parts_gross_profit=parts_gp,
                )
                for it in breakdown:
                    w.writerow(
                        [
                            day_used,
                            st.store_id,
                            st.name,
                            it["role"],
                            it.get("level", ""),
                            it["headcount"],
                            f"{it['fixed']:.2f}",
                            f"{it['wash_commission']:.2f}",
                            f"{it['maintenance_commission']:.2f}",
                            f"{it['detailing_commission']:.2f}",
                            f"{it['sales_commission']:.2f}",
                            f"{it.get('labor_commission', 0.0):.2f}",
                            f"{it.get('parts_commission', 0.0):.2f}",
                            f"{it['total']:.2f}",
                        ]
                    )

        return Response(
            out.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="payroll.csv"'},
        )

    return app


app = create_app()
