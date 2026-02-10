from __future__ import annotations

import threading
from pathlib import Path
from typing import Optional

import copy
import heapq
import json
import math
import uuid
from datetime import datetime, timezone

from fastapi import Body, FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response

from simgame.engine import EngineConfig, close_store, inject_event_from_template, purchase_inventory, simulate_day
from simgame.models import (
    ActiveEvent,
    Asset,
    EventHistoryRecord,
    EventTemplate,
    GameState,
    RolePlan,
    ServiceLine,
    ServiceProject,
    StationBulkTemplate,
    Station,
    Store,
    StoreBulkTemplate,
)
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
        try:
            return load_state(p)
        except Exception:
            # Corrupted state file fallback: rebuild seed state.
            try:
                p.unlink()
            except Exception:
                pass
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
    simulate_jobs: dict[str, dict] = {}
    simulate_jobs_lock = threading.Lock()

    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _simulate_job_snapshot(job_id: str) -> Optional[dict]:
        with simulate_jobs_lock:
            j = simulate_jobs.get(job_id)
            if j is None:
                return None
            return {
                "job_id": str(j.get("job_id") or ""),
                "status": str(j.get("status") or "unknown"),
                "days": int(j.get("days") or 0),
                "completed_days": int(j.get("completed_days") or 0),
                "progress": float(j.get("progress") or 0.0),
                "message": str(j.get("message") or ""),
                "error": str(j.get("error") or ""),
                "cancel_requested": bool(j.get("cancel_requested", False)),
                "created_at": str(j.get("created_at") or ""),
                "started_at": str(j.get("started_at") or ""),
                "finished_at": str(j.get("finished_at") or ""),
            }

    def _has_active_simulation_job() -> bool:
        with simulate_jobs_lock:
            for j in simulate_jobs.values():
                if str(j.get("status") or "") in {"pending", "running"}:
                    return True
        return False

    def _run_simulate_job(job_id: str, days: int) -> None:
        with simulate_jobs_lock:
            j = simulate_jobs.get(job_id)
            if not j:
                return
            j["status"] = "running"
            j["started_at"] = _now_iso()
            j["message"] = f"正在模拟 0/{days} 天"

        try:
            for i in range(days):
                with simulate_jobs_lock:
                    j = simulate_jobs.get(job_id)
                    if not j:
                        return
                    if bool(j.get("cancel_requested", False)):
                        j["status"] = "cancelled"
                        j["message"] = f"已取消，已完成 {int(j.get('completed_days') or 0)}/{days} 天"
                        j["finished_at"] = _now_iso()
                        return

                with _lock:
                    state = _ensure_state()
                    dr = simulate_day(state, cfg)
                    append_ledger_csv(dr)
                    save_snapshot(state)
                    save_state(state)

                done = i + 1
                with simulate_jobs_lock:
                    j = simulate_jobs.get(job_id)
                    if not j:
                        return
                    j["completed_days"] = done
                    j["progress"] = round(done / float(days), 6)
                    j["message"] = f"正在模拟 {done}/{days} 天"

            with simulate_jobs_lock:
                j = simulate_jobs.get(job_id)
                if not j:
                    return
                j["status"] = "succeeded"
                j["progress"] = 1.0
                j["message"] = f"模拟完成，共 {days} 天"
                j["finished_at"] = _now_iso()
        except Exception as e:
            with simulate_jobs_lock:
                j = simulate_jobs.get(job_id)
                if not j:
                    return
                j["status"] = "failed"
                j["error"] = str(e)
                j["message"] = "模拟失败"
                j["finished_at"] = _now_iso()

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
            "local_competition_intensity": float(getattr(st, "local_competition_intensity", 0.0) or 0.0),
            "attractiveness_index": float(getattr(st, "attractiveness_index", 1.0) or 1.0),
            "labor_hour_price": float(getattr(st, "labor_hour_price", 120.0) or 0.0),
            "capex_total": st.capex_total,
            "capex_useful_life_days": getattr(st, "capex_useful_life_days", 5 * 365),
            "construction_days_remaining": st.construction_days_remaining,
            "capex_spend_per_day": st.capex_spend_per_day,
            "fixed_overhead_per_day": st.fixed_overhead_per_day,
            "strict_parts": bool(st.strict_parts),
            "cash_balance": float(getattr(st, "cash_balance", 0.0)),
            "mitigation": {
                "use_emergency_power": bool(getattr(getattr(st, "mitigation", None), "use_emergency_power", False)),
                "emergency_capacity_multiplier": float(
                    getattr(getattr(st, "mitigation", None), "emergency_capacity_multiplier", 0.60) or 0.60
                ),
                "emergency_variable_cost_multiplier": float(
                    getattr(getattr(st, "mitigation", None), "emergency_variable_cost_multiplier", 1.15) or 1.15
                ),
                "emergency_daily_cost": float(
                    getattr(getattr(st, "mitigation", None), "emergency_daily_cost", 120.0) or 120.0
                ),
                "use_promo_boost": bool(getattr(getattr(st, "mitigation", None), "use_promo_boost", False)),
                "promo_traffic_boost": float(
                    getattr(getattr(st, "mitigation", None), "promo_traffic_boost", 1.05) or 1.05
                ),
                "promo_conversion_boost": float(
                    getattr(getattr(st, "mitigation", None), "promo_conversion_boost", 1.08) or 1.08
                ),
                "promo_daily_cost": float(getattr(getattr(st, "mitigation", None), "promo_daily_cost", 80.0) or 80.0),
                "use_overtime_capacity": bool(
                    getattr(getattr(st, "mitigation", None), "use_overtime_capacity", False)
                ),
                "overtime_capacity_boost": float(
                    getattr(getattr(st, "mitigation", None), "overtime_capacity_boost", 1.20) or 1.20
                ),
                "overtime_daily_cost": float(
                    getattr(getattr(st, "mitigation", None), "overtime_daily_cost", 100.0) or 100.0
                ),
            },
            "auto_replenishment_enabled": bool(getattr(st, "auto_replenishment_enabled", False)),
            "replenishment_rules": [
                {
                    "sku": str(k),
                    "name": str(getattr(v, "name", "") or ""),
                    "enabled": bool(getattr(v, "enabled", True)),
                    "reorder_point": float(getattr(v, "reorder_point", 0.0) or 0.0),
                    "safety_stock": float(getattr(v, "safety_stock", 0.0) or 0.0),
                    "target_stock": float(getattr(v, "target_stock", 0.0) or 0.0),
                    "lead_time_days": int(getattr(v, "lead_time_days", 0) or 0),
                    "unit_cost": float(getattr(v, "unit_cost", 0.0) or 0.0),
                }
                for k, v in (getattr(st, "replenishment_rules", {}) or {}).items()
            ],
            "pending_inbounds": [
                {
                    "sku": str(getattr(p, "sku", "") or ""),
                    "name": str(getattr(p, "name", "") or ""),
                    "qty": float(getattr(p, "qty", 0.0) or 0.0),
                    "unit_cost": float(getattr(p, "unit_cost", 0.0) or 0.0),
                    "order_day": int(getattr(p, "order_day", 0) or 0),
                    "arrive_day": int(getattr(p, "arrive_day", 0) or 0),
                }
                for p in (getattr(st, "pending_inbounds", []) or [])
            ],
            "workforce": {
                "planned_headcount": int(getattr(getattr(st, "workforce", None), "planned_headcount", 0) or 0),
                "current_headcount": int(getattr(getattr(st, "workforce", None), "current_headcount", 0) or 0),
                "training_level": float(getattr(getattr(st, "workforce", None), "training_level", 0.5) or 0.0),
                "daily_turnover_rate": float(
                    getattr(getattr(st, "workforce", None), "daily_turnover_rate", 0.002) or 0.0
                ),
                "recruiting_enabled": bool(getattr(getattr(st, "workforce", None), "recruiting_enabled", False)),
                "recruiting_daily_budget": float(
                    getattr(getattr(st, "workforce", None), "recruiting_daily_budget", 0.0) or 0.0
                ),
                "recruiting_lead_days": int(
                    getattr(getattr(st, "workforce", None), "recruiting_lead_days", 7) or 0
                ),
                "recruiting_hire_rate_per_100_budget": float(
                    getattr(getattr(st, "workforce", None), "recruiting_hire_rate_per_100_budget", 0.20) or 0.0
                ),
                "planned_leave_rate": float(
                    getattr(getattr(st, "workforce", None), "planned_leave_rate", 0.0) or 0.0
                ),
                "unplanned_absence_rate": float(
                    getattr(getattr(st, "workforce", None), "unplanned_absence_rate", 0.0) or 0.0
                ),
                "planned_leave_rate_day": float(
                    getattr(getattr(st, "workforce", None), "planned_leave_rate_day", 0.0) or 0.0
                ),
                "planned_leave_rate_night": float(
                    getattr(getattr(st, "workforce", None), "planned_leave_rate_night", 0.0) or 0.0
                ),
                "sick_leave_rate_day": float(
                    getattr(getattr(st, "workforce", None), "sick_leave_rate_day", 0.0) or 0.0
                ),
                "sick_leave_rate_night": float(
                    getattr(getattr(st, "workforce", None), "sick_leave_rate_night", 0.0) or 0.0
                ),
                "shifts_per_day": int(getattr(getattr(st, "workforce", None), "shifts_per_day", 2) or 0),
                "staffing_per_shift": int(getattr(getattr(st, "workforce", None), "staffing_per_shift", 3) or 0),
                "shift_hours": float(getattr(getattr(st, "workforce", None), "shift_hours", 8.0) or 0.0),
                "overtime_shift_enabled": bool(
                    getattr(getattr(st, "workforce", None), "overtime_shift_enabled", False)
                ),
                "overtime_shift_extra_capacity": float(
                    getattr(getattr(st, "workforce", None), "overtime_shift_extra_capacity", 0.15) or 0.0
                ),
                "overtime_shift_daily_cost": float(
                    getattr(getattr(st, "workforce", None), "overtime_shift_daily_cost", 0.0) or 0.0
                ),
                "skill_by_category": {
                    "wash": float(
                        ((getattr(getattr(st, "workforce", None), "skill_by_category", {}) or {}).get("wash", 1.0))
                    ),
                    "maintenance": float(
                        ((getattr(getattr(st, "workforce", None), "skill_by_category", {}) or {}).get("maintenance", 1.0))
                    ),
                    "detailing": float(
                        ((getattr(getattr(st, "workforce", None), "skill_by_category", {}) or {}).get("detailing", 1.0))
                    ),
                    "other": float(
                        ((getattr(getattr(st, "workforce", None), "skill_by_category", {}) or {}).get("other", 1.0))
                    ),
                },
                "shift_allocation_by_category": {
                    "wash": float(
                        ((getattr(getattr(st, "workforce", None), "shift_allocation_by_category", {}) or {}).get("wash", 1.0))
                    ),
                    "maintenance": float(
                        ((getattr(getattr(st, "workforce", None), "shift_allocation_by_category", {}) or {}).get("maintenance", 1.0))
                    ),
                    "detailing": float(
                        ((getattr(getattr(st, "workforce", None), "shift_allocation_by_category", {}) or {}).get("detailing", 1.0))
                    ),
                    "other": float(
                        ((getattr(getattr(st, "workforce", None), "shift_allocation_by_category", {}) or {}).get("other", 1.0))
                    ),
                },
                "skill_by_role": {
                    "技师": float(
                        ((getattr(getattr(st, "workforce", None), "skill_by_role", {}) or {}).get("技师", 1.0))
                    ),
                    "店长": float(
                        ((getattr(getattr(st, "workforce", None), "skill_by_role", {}) or {}).get("店长", 1.0))
                    ),
                    "销售": float(
                        ((getattr(getattr(st, "workforce", None), "skill_by_role", {}) or {}).get("销售", 1.0))
                    ),
                    "客服": float(
                        ((getattr(getattr(st, "workforce", None), "skill_by_role", {}) or {}).get("客服", 1.0))
                    ),
                },
                "shift_allocation_by_role": {
                    "技师": float(
                        ((getattr(getattr(st, "workforce", None), "shift_allocation_by_role", {}) or {}).get("技师", 1.0))
                    ),
                    "店长": float(
                        ((getattr(getattr(st, "workforce", None), "shift_allocation_by_role", {}) or {}).get("店长", 1.0))
                    ),
                    "销售": float(
                        ((getattr(getattr(st, "workforce", None), "shift_allocation_by_role", {}) or {}).get("销售", 1.0))
                    ),
                    "客服": float(
                        ((getattr(getattr(st, "workforce", None), "shift_allocation_by_role", {}) or {}).get("客服", 1.0))
                    ),
                },
            },
            "pending_hires": [
                {
                    "qty": int(getattr(p, "qty", 0) or 0),
                    "order_day": int(getattr(p, "order_day", 0) or 0),
                    "arrive_day": int(getattr(p, "arrive_day", 0) or 0),
                }
                for p in (getattr(st, "pending_hires", []) or [])
            ],
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
            "finance_credit_used": float(getattr(st, "finance_credit_used", 0.0) or 0.0),
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

    def _event_template_to_dto(t: EventTemplate) -> dict:
        return {
            "template_id": t.template_id,
            "name": t.name,
            "event_type": t.event_type,
            "enabled": bool(t.enabled),
            "daily_probability": float(t.daily_probability),
            "duration_days_min": int(t.duration_days_min),
            "duration_days_max": int(t.duration_days_max),
            "cooldown_days": int(t.cooldown_days),
            "intensity_min": float(t.intensity_min),
            "intensity_max": float(t.intensity_max),
            "scope": str(t.scope),
            "target_strategy": str(getattr(t, "target_strategy", "random_one")),
            "store_closed": bool(getattr(t, "store_closed", False)),
            "traffic_multiplier_min": float(getattr(t, "traffic_multiplier_min", 1.0)),
            "traffic_multiplier_max": float(getattr(t, "traffic_multiplier_max", 1.0)),
            "conversion_multiplier_min": float(getattr(t, "conversion_multiplier_min", 1.0)),
            "conversion_multiplier_max": float(getattr(t, "conversion_multiplier_max", 1.0)),
            "capacity_multiplier_min": float(getattr(t, "capacity_multiplier_min", 1.0)),
            "capacity_multiplier_max": float(getattr(t, "capacity_multiplier_max", 1.0)),
            "variable_cost_multiplier_min": float(getattr(t, "variable_cost_multiplier_min", 1.0)),
            "variable_cost_multiplier_max": float(getattr(t, "variable_cost_multiplier_max", 1.0)),
        }

    def _active_event_to_dto(e: ActiveEvent) -> dict:
        return {
            "event_id": e.event_id,
            "template_id": e.template_id,
            "name": e.name,
            "event_type": e.event_type,
            "scope": e.scope,
            "target_id": e.target_id,
            "start_day": int(e.start_day),
            "end_day": int(e.end_day),
            "intensity": float(e.intensity),
            "store_closed": bool(e.store_closed),
            "traffic_multiplier": float(e.traffic_multiplier),
            "conversion_multiplier": float(e.conversion_multiplier),
            "capacity_multiplier": float(e.capacity_multiplier),
            "variable_cost_multiplier": float(e.variable_cost_multiplier),
        }

    def _event_history_to_dto(h: EventHistoryRecord) -> dict:
        return {
            "event_id": h.event_id,
            "template_id": h.template_id,
            "name": h.name,
            "event_type": h.event_type,
            "scope": h.scope,
            "target_id": h.target_id,
            "start_day": int(h.start_day),
            "end_day": int(h.end_day),
            "created_day": int(h.created_day),
            "intensity": float(h.intensity),
            "store_closed": bool(h.store_closed),
            "traffic_multiplier": float(h.traffic_multiplier),
            "conversion_multiplier": float(h.conversion_multiplier),
            "capacity_multiplier": float(h.capacity_multiplier),
            "variable_cost_multiplier": float(h.variable_cost_multiplier),
        }

    def _coord_for_station(s: Station) -> tuple[float, float]:
        x = float(getattr(s, "map_x", 0.0) or 0.0)
        y = float(getattr(s, "map_y", 0.0) or 0.0)
        if x > 0 and y > 0:
            return x, y
        # Fallback to deterministic pseudo coordinates in [20, 80].
        import zlib

        sid = str(getattr(s, "station_id", "") or "")
        hx = int(zlib.crc32(sid.encode("utf-8")) & 0xFFFFFFFF)
        hy = int(zlib.crc32((sid + "_y").encode("utf-8")) & 0xFFFFFFFF)
        return 20.0 + float(hx % 61), 20.0 + float(hy % 61)

    def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
        dx = float(a[0]) - float(b[0])
        dy = float(a[1]) - float(b[1])
        return float(math.sqrt(dx * dx + dy * dy))

    def _road_proxy_dist(sa: Station, sb: Station, a: tuple[float, float], b: tuple[float, float]) -> float:
        """Road-reachability proxy distance.

        This is a lightweight approximation before integrating real OSM road graph:
        - base geometric distance
        - city/district boundary penalties
        - station-type friction
        - average traffic volatility as congestion factor
        """

        base = _dist(a, b)
        penalty = 1.0

        city_a = str(getattr(sa, "city", "") or "").strip().lower()
        city_b = str(getattr(sb, "city", "") or "").strip().lower()
        if city_a and city_b and city_a != city_b:
            penalty += 0.35

        dist_a = str(getattr(sa, "district", "") or "").strip().lower()
        dist_b = str(getattr(sb, "district", "") or "").strip().lower()
        if dist_a and dist_b and dist_a != dist_b:
            penalty += 0.18

        st_a = str(getattr(sa, "station_type", "") or "").strip().lower()
        st_b = str(getattr(sb, "station_type", "") or "").strip().lower()
        if ("高速" in st_a) or ("高速" in st_b):
            penalty += 0.12

        vol = (
            max(0.0, float(getattr(sa, "traffic_volatility", 0.0) or 0.0))
            + max(0.0, float(getattr(sb, "traffic_volatility", 0.0) or 0.0))
        ) / 2.0
        penalty += min(0.2, vol)

        return float(base * max(1.0, penalty))

    def _station_distance(
        sa: Station,
        sb: Station,
        a: tuple[float, float],
        b: tuple[float, float],
        distance_mode: str,
    ) -> float:
        mode = str(distance_mode or "euclidean").strip().lower()
        if mode == "road_proxy":
            return _road_proxy_dist(sa, sb, a, b)
        return _dist(a, b)

    def _build_station_graph(state: GameState, station_points: dict[str, tuple[float, float]], k_neighbors: int = 3) -> dict[str, list[tuple[str, float]]]:
        stations = list(state.stations.values())
        k = max(1, min(10, int(k_neighbors)))
        graph: dict[str, list[tuple[str, float]]] = {}
        for s in stations:
            sid = str(s.station_id)
            graph.setdefault(sid, [])

        for s in stations:
            sid = str(s.station_id)
            p = station_points.get(sid)
            if p is None:
                continue
            dists: list[tuple[float, str]] = []
            for t in stations:
                tid = str(t.station_id)
                if tid == sid:
                    continue
                p2 = station_points.get(tid)
                if p2 is None:
                    continue
                w = _road_proxy_dist(s, t, p, p2)
                dists.append((w, tid))
            dists.sort(key=lambda x: x[0])
            for w, tid in dists[:k]:
                graph[sid].append((tid, float(w)))
                graph.setdefault(tid, []).append((sid, float(w)))
        return graph

    def _graph_shortest_dist(graph: dict[str, list[tuple[str, float]]], src: str, dst: str) -> float:
        if src == dst:
            return 0.0
        if src not in graph or dst not in graph:
            return 9999.0
        pq: list[tuple[float, str]] = [(0.0, src)]
        seen: dict[str, float] = {src: 0.0}
        while pq:
            dist_u, u = heapq.heappop(pq)
            if u == dst:
                return float(dist_u)
            if dist_u > float(seen.get(u, 9999.0)):
                continue
            for v, w in graph.get(u, []):
                nd = float(dist_u) + float(w)
                if nd < float(seen.get(v, 9999.0)):
                    seen[v] = nd
                    heapq.heappush(pq, (nd, v))
        return 9999.0

    def _site_recommendations(
        state: GameState,
        top_k: int,
        radius: float,
        distance_mode: str = "euclidean",
        graph_k_neighbors: int = 3,
    ) -> list[dict]:
        open_store_station_ids: set[str] = set()
        for st in state.stores.values():
            if str(getattr(st, "status", "")) == "open":
                open_store_station_ids.add(str(getattr(st, "station_id", "") or ""))

        avg_conv = 0.0
        conv_n = 0
        for st in state.stores.values():
            if str(getattr(st, "status", "")) == "open":
                avg_conv += max(0.0, float(getattr(st, "traffic_conversion_rate", 1.0) or 0.0))
                conv_n += 1
        avg_conv = (avg_conv / float(conv_n)) if conv_n > 0 else 1.0

        station_points: dict[str, tuple[float, float]] = {sid: _coord_for_station(s) for sid, s in state.stations.items()}
        mode = str(distance_mode or "euclidean").strip().lower()
        station_graph = _build_station_graph(state, station_points, k_neighbors=graph_k_neighbors) if mode == "road_graph" else {}

        rows: list[dict] = []
        for sid, s in state.stations.items():
            pos = station_points[sid]
            demand = max(0.0, float(getattr(s, "fuel_vehicles_per_day", 0))) + 0.4 * max(
                0.0, float(getattr(s, "visitor_vehicles_per_day", 0))
            )

            nearest_open_dist = 9999.0
            reachable = False
            for osid in open_store_station_ids:
                p2 = station_points.get(osid)
                if p2 is None:
                    continue
                s2 = state.stations.get(osid)
                if s2 is None:
                    continue
                if mode == "road_graph":
                    d = _graph_shortest_dist(station_graph, sid, osid)
                else:
                    d = _station_distance(s, s2, pos, p2, distance_mode=mode)
                if d < 9999.0:
                    reachable = True
                if d < nearest_open_dist:
                    nearest_open_dist = d

            covered = nearest_open_dist <= radius
            covered_ratio = max(0.0, 1.0 - (nearest_open_dist / max(0.1, radius))) if covered else 0.0
            uncovered_demand = demand * (1.0 - covered_ratio)

            demand_component = uncovered_demand * avg_conv
            coverage_component = (1.0 - covered_ratio)
            base_score = demand_component
            # Penalize opening on a station that already has an open store.
            if sid in open_store_station_ids:
                base_score *= 0.35

            has_real_coord = bool(float(getattr(s, "map_x", 0.0) or 0.0) > 0 and float(getattr(s, "map_y", 0.0) or 0.0) > 0)
            confidence = 1.0
            if not has_real_coord:
                confidence -= 0.25
            if mode == "road_graph" and not reachable and open_store_station_ids:
                confidence -= 0.35
            confidence = max(0.2, min(1.0, confidence))

            rows.append(
                {
                    "station_id": sid,
                    "station_name": str(getattr(s, "name", sid) or sid),
                    "city": str(getattr(s, "city", "") or ""),
                    "district": str(getattr(s, "district", "") or ""),
                    "provider": str(getattr(s, "provider", "") or ""),
                    "demand_index": float(demand),
                    "nearest_open_distance": float(round(nearest_open_dist, 3)),
                    "covered_by_existing": bool(covered),
                    "uncovered_demand": float(round(uncovered_demand, 3)),
                    "recommendation_score": float(round(base_score, 3)),
                    "distance_confidence": float(round(confidence, 3)),
                    "already_has_open_store": bool(sid in open_store_station_ids),
                    "score_breakdown": {
                        "demand_component": float(round(demand_component, 3)),
                        "coverage_component": float(round(coverage_component, 3)),
                    },
                }
            )

        rows.sort(key=lambda x: float(x.get("recommendation_score") or 0.0), reverse=True)
        return rows[: max(1, int(top_k))]

    def _apply_station_patch(state: GameState, patch: dict) -> None:
        sid = str((patch or {}).get("station_id") or "").strip()
        if not sid:
            return
        s = state.stations.get(sid)
        if not s:
            return
        if "fuel_vehicles_per_day" in patch:
            s.fuel_vehicles_per_day = max(0, int(patch.get("fuel_vehicles_per_day") or 0))
        if "visitor_vehicles_per_day" in patch:
            s.visitor_vehicles_per_day = max(0, int(patch.get("visitor_vehicles_per_day") or 0))
        if "traffic_volatility" in patch:
            s.traffic_volatility = max(0.0, min(1.0, float(patch.get("traffic_volatility") or 0.0)))

    def _apply_store_patch(state: GameState, patch: dict) -> None:
        sid = str((patch or {}).get("store_id") or "").strip()
        if not sid:
            return
        st = state.stores.get(sid)
        if not st:
            return
        if "traffic_conversion_rate" in patch:
            st.traffic_conversion_rate = max(0.0, float(patch.get("traffic_conversion_rate") or 0.0))
        if "local_competition_intensity" in patch:
            st.local_competition_intensity = max(0.0, min(1.0, float(patch.get("local_competition_intensity") or 0.0)))
        if "attractiveness_index" in patch:
            st.attractiveness_index = max(0.5, min(1.5, float(patch.get("attractiveness_index") or 1.0)))
        if "fixed_overhead_per_day" in patch:
            st.fixed_overhead_per_day = max(0.0, float(patch.get("fixed_overhead_per_day") or 0.0))

    def _simulate_scenario_metrics(base_state: GameState, days: int, seed: int | None, scenario: dict | None = None) -> dict:
        st = copy.deepcopy(base_state)
        if seed is not None:
            st.rng_seed = int(seed)
            st.rng_state = None

        scenario = scenario or {}
        for p in (scenario.get("station_patches") or []):
            if isinstance(p, dict):
                _apply_station_patch(st, p)
        for p in (scenario.get("store_patches") or []):
            if isinstance(p, dict):
                _apply_store_patch(st, p)

        total_revenue = 0.0
        total_profit = 0.0
        total_cashflow = 0.0
        total_orders = 0

        for _ in range(max(1, int(days))):
            dr = simulate_day(st, cfg)
            total_revenue += float(getattr(dr, "total_revenue", 0.0) or 0.0)
            total_profit += float(getattr(dr, "total_operating_profit", 0.0) or 0.0)
            total_cashflow += float(getattr(dr, "total_net_cashflow", 0.0) or 0.0)
            for sr in getattr(dr, "store_results", []) or []:
                total_orders += int(sum((getattr(sr, "orders_by_service", {}) or {}).values()))

        return {
            "days": int(days),
            "end_day": int(st.day),
            "end_cash": float(st.cash),
            "total_revenue": float(round(total_revenue, 4)),
            "total_operating_profit": float(round(total_profit, 4)),
            "total_net_cashflow": float(round(total_cashflow, 4)),
            "avg_daily_orders": float(round(total_orders / float(max(1, int(days))), 4)),
            "open_store_count": int(sum(1 for x in st.stores.values() if str(getattr(x, "status", "")) == "open")),
        }

    # -------------------- JSON API (for the React frontend) --------------------

    def _state_to_dto(state: GameState) -> dict:
        month_len = max(1, int(getattr(cfg, "month_len_days", 30) or 30))
        month_start = ((int(state.day) - 1) // month_len) * month_len + 1
        month_end = month_start + month_len - 1
        rows = _read_ledger_rows()
        mtd_revenue = 0.0
        mtd_profit = 0.0
        mtd_cashflow = 0.0
        mtd_finance_interest = 0.0
        mtd_financed_capex = 0.0
        for r in rows:
            try:
                d = int(r.get("day") or 0)
            except Exception:
                continue

        def _sum_orders_json(raw: str) -> int:
            try:
                obj = json.loads(raw) if raw else {}
                if isinstance(obj, dict):
                    return int(sum(max(0, int(v or 0)) for v in obj.values()))
            except Exception:
                pass
            return 0

        rolling_days = max(7, min(180, int(getattr(state, "rolling_budget_window_days", 30) or 30)))
        rolling_start = max(1, int(state.day) - rolling_days + 1)
        prev_start = max(1, rolling_start - rolling_days)
        prev_end = rolling_start - 1

        rolling_rev = 0.0
        rolling_profit = 0.0
        rolling_cashflow = 0.0
        rolling_orders = 0
        rolling_headcount = 0.0
        prev_rev = 0.0
        prev_profit = 0.0
        prev_cashflow = 0.0

        region_aggr: dict[str, dict] = {}
        category_aggr: dict[str, dict] = {}
        role_aggr: dict[str, dict] = {}
        trend_daily: dict[int, dict] = {}

        for r in rows:
            try:
                d = int(r.get("day") or 0)
            except Exception:
                continue
            if d <= 0:
                continue

            try:
                rev = float(r.get("revenue") or 0.0)
                pft = float(r.get("operating_profit") or 0.0)
                cfs = float(r.get("net_cashflow") or 0.0)
                hc = max(0.0, float(r.get("workforce_headcount_end") or 0.0))
            except Exception:
                continue

            if prev_start <= d <= prev_end:
                prev_rev += rev
                prev_profit += pft
                prev_cashflow += cfs

            if d < rolling_start or d > int(state.day):
                continue

            rolling_rev += rev
            rolling_profit += pft
            rolling_cashflow += cfs
            rolling_headcount += hc
            od = _sum_orders_json(str(r.get("orders_by_service_json") or ""))
            rolling_orders += od

            sid = str(r.get("store_id") or "")
            st = state.stores.get(sid)
            city = str(getattr(st, "city", "") or "未分配")
            district = str(getattr(st, "district", "") or "未分配")
            region = f"{city}/{district}"
            reg = region_aggr.setdefault(region, {"revenue": 0.0, "orders": 0, "headcount": 0.0})
            reg["revenue"] += rev
            reg["orders"] += od
            reg["headcount"] += hc

            try:
                cat_rev = json.loads(str(r.get("revenue_by_category_json") or "{}"))
            except Exception:
                cat_rev = {}
            if isinstance(cat_rev, dict):
                for k, v in cat_rev.items():
                    key = str(k or "other")
                    row = category_aggr.setdefault(key, {"revenue": 0.0, "headcount": 0.0})
                    row["revenue"] += max(0.0, float(v or 0.0))
                    row["headcount"] += hc

            role_weights: dict[str, float] = {}
            try:
                wb = json.loads(str(r.get("workforce_breakdown_json") or "{}"))
                role_weights = (wb.get("role_factors") or {}) if isinstance(wb, dict) else {}
            except Exception:
                role_weights = {}
            if not isinstance(role_weights, dict) or len(role_weights) == 0:
                role_weights = {"技师": 1.0}
            weight_sum = sum(max(0.0, float(x or 0.0)) for x in role_weights.values())
            if weight_sum <= 0:
                weight_sum = 1.0
            role_hc_map = {}
            if st is not None:
                for rr in getattr(getattr(st, "payroll", None), "roles", {}).values():
                    role_hc_map[str(getattr(rr, "role", "") or "")] = max(0.0, float(getattr(rr, "headcount", 0) or 0.0))
            for role, w in role_weights.items():
                rk = str(role or "未知")
                wf = max(0.0, float(w or 0.0)) / weight_sum
                row = role_aggr.setdefault(rk, {"revenue": 0.0, "headcount": 0.0})
                row["revenue"] += rev * wf
                row["headcount"] += max(0.0, float(role_hc_map.get(rk, 0.0) or 0.0))

            td = trend_daily.setdefault(d, {"day": d, "revenue": 0.0, "profit": 0.0, "cashflow": 0.0, "orders": 0, "headcount": 0.0})
            td["revenue"] += rev
            td["profit"] += pft
            td["cashflow"] += cfs
            td["orders"] += od
            td["headcount"] += hc

        rolling_avg_rev = rolling_rev / float(rolling_days)
        prev_avg_rev = prev_rev / float(rolling_days)
        rolling_rev_momentum = 0.0
        if abs(prev_avg_rev) > 1e-9:
            rolling_rev_momentum = (rolling_avg_rev - prev_avg_rev) / abs(prev_avg_rev)

        by_region = []
        for k, v in region_aggr.items():
            h = max(1.0, float(v.get("headcount") or 0.0))
            by_region.append(
                {
                    "region": k,
                    "revenue": float(round(float(v.get("revenue") or 0.0), 4)),
                    "orders": int(v.get("orders") or 0),
                    "headcount": float(round(float(v.get("headcount") or 0.0), 4)),
                    "revenue_per_headcount": float(round(float(v.get("revenue") or 0.0) / h, 4)),
                }
            )
        by_region.sort(key=lambda x: float(x.get("revenue", 0.0)), reverse=True)

        by_category = []
        for k, v in category_aggr.items():
            h = max(1.0, float(v.get("headcount") or 0.0))
            by_category.append(
                {
                    "category": str(k),
                    "revenue": float(round(float(v.get("revenue") or 0.0), 4)),
                    "headcount": float(round(float(v.get("headcount") or 0.0), 4)),
                    "revenue_per_headcount": float(round(float(v.get("revenue") or 0.0) / h, 4)),
                }
            )
        by_category.sort(key=lambda x: float(x.get("revenue", 0.0)), reverse=True)

        by_role = []
        for k, v in role_aggr.items():
            h = max(1.0, float(v.get("headcount") or 0.0))
            by_role.append(
                {
                    "role": str(k),
                    "revenue": float(round(float(v.get("revenue") or 0.0), 4)),
                    "headcount": float(round(float(v.get("headcount") or 0.0), 4)),
                    "revenue_per_headcount": float(round(float(v.get("revenue") or 0.0) / h, 4)),
                }
            )
        by_role.sort(key=lambda x: float(x.get("revenue", 0.0)), reverse=True)

        trend_rows = []
        for d in sorted(trend_daily.keys()):
            it = trend_daily[d]
            h = max(1.0, float(it.get("headcount") or 0.0))
            trend_rows.append(
                {
                    "day": int(d),
                    "revenue": float(round(float(it.get("revenue") or 0.0), 4)),
                    "profit": float(round(float(it.get("profit") or 0.0), 4)),
                    "cashflow": float(round(float(it.get("cashflow") or 0.0), 4)),
                    "orders": int(it.get("orders") or 0),
                    "revenue_per_headcount": float(round(float(it.get("revenue") or 0.0) / h, 4)),
                }
            )
        alerts: list[dict] = []
        cash = float(getattr(state, "cash", 0.0) or 0.0)
        if cash < 0:
            alerts.append({"level": "high", "code": "cash_negative", "message": f"总部现金为负：{cash:.2f}"})

        credit_limit = max(0.0, float(getattr(state, "hq_credit_limit", 0.0) or 0.0))
        credit_used = max(0.0, float(getattr(state, "hq_credit_used", 0.0) or 0.0))
        if credit_limit > 0 and (credit_used / credit_limit) >= 0.8:
            alerts.append(
                {
                    "level": "medium",
                    "code": "credit_usage_high",
                    "message": f"授信占用偏高：{(credit_used / credit_limit) * 100:.1f}%",
                }
            )

        rev_target = max(0.0, float(getattr(state, "budget_monthly_revenue_target", 0.0) or 0.0))
        pft_target = max(0.0, float(getattr(state, "budget_monthly_profit_target", 0.0) or 0.0))
        cfs_target = max(0.0, float(getattr(state, "budget_monthly_cashflow_target", 0.0) or 0.0))
        day_in_month = max(1, int(state.month_day_index(month_len)))
        progress = min(1.0, day_in_month / float(month_len))
        if rev_target > 0 and progress >= 0.5 and (mtd_revenue / rev_target) < progress * 0.75:
            alerts.append(
                {
                    "level": "medium",
                    "code": "budget_revenue_behind",
                    "message": f"月度营收预算落后：{mtd_revenue:.0f}/{rev_target:.0f}",
                }
            )
        if pft_target > 0 and progress >= 0.5 and (mtd_profit / pft_target) < progress * 0.75:
            alerts.append(
                {
                    "level": "medium",
                    "code": "budget_profit_behind",
                    "message": f"月度利润预算落后：{mtd_profit:.0f}/{pft_target:.0f}",
                }
            )
        if cfs_target > 0 and progress >= 0.5 and (mtd_cashflow / cfs_target) < progress * 0.75:
            alerts.append(
                {
                    "level": "medium",
                    "code": "budget_cashflow_behind",
                    "message": f"月度现金流预算落后：{mtd_cashflow:.0f}/{cfs_target:.0f}",
                }
            )

        for st in state.stores.values():
            if str(getattr(st, "status", "")) != "open":
                continue
            wf = getattr(st, "workforce", None)
            if wf is not None:
                planned = max(1, int(getattr(wf, "planned_headcount", 1) or 1))
                current = max(0, int(getattr(wf, "current_headcount", 0) or 0))
                if current / planned < 0.6:
                    alerts.append(
                        {
                            "level": "medium",
                            "code": "workforce_shortage",
                            "message": f"{st.store_id} 人手不足：{current}/{planned}",
                        }
                    )
            if bool(getattr(st, "auto_replenishment_enabled", False)):
                for sku, rule in (getattr(st, "replenishment_rules", {}) or {}).items():
                    item = st.inventory.get(sku)
                    qty = float(item.qty if item else 0.0)
                    if qty < float(getattr(rule, "safety_stock", 0.0) or 0.0):
                        alerts.append(
                            {
                                "level": "low",
                                "code": "inventory_below_safety",
                                "message": f"{st.store_id} {sku} 低于安全库存（{qty:.1f}）",
                            }
                        )

        return {
            "day": state.day,
            "cash": state.cash,
            "finance": {
                "hq_credit_limit": float(getattr(state, "hq_credit_limit", 0.0) or 0.0),
                "hq_credit_used": float(getattr(state, "hq_credit_used", 0.0) or 0.0),
                "hq_daily_interest_rate": float(getattr(state, "hq_daily_interest_rate", 0.0005) or 0.0),
                "hq_auto_finance": bool(getattr(state, "hq_auto_finance", False)),
                "budget_monthly_revenue_target": float(
                    getattr(state, "budget_monthly_revenue_target", 0.0) or 0.0
                ),
                "budget_monthly_profit_target": float(
                    getattr(state, "budget_monthly_profit_target", 0.0) or 0.0
                ),
                "budget_monthly_cashflow_target": float(
                    getattr(state, "budget_monthly_cashflow_target", 0.0) or 0.0
                ),
                "capex_cash_payment_ratio": float(getattr(state, "capex_cash_payment_ratio", 1.0) or 0.0),
                "rolling_budget_window_days": int(getattr(state, "rolling_budget_window_days", 30) or 30),
                "finance_cost_allocation_method": str(
                    getattr(state, "finance_cost_allocation_method", "revenue") or "revenue"
                ),
                "budget_mtd": {
                    "month_start_day": int(month_start),
                    "month_end_day": int(month_end),
                    "day_in_month": int(day_in_month),
                    "progress": float(round(progress, 6)),
                    "revenue": float(round(mtd_revenue, 4)),
                    "profit": float(round(mtd_profit, 4)),
                    "cashflow": float(round(mtd_cashflow, 4)),
                    "finance_interest": float(round(mtd_finance_interest, 4)),
                    "financed_capex": float(round(mtd_financed_capex, 4)),
                },
                "rolling_budget": {
                    "window_days": int(rolling_days),
                    "start_day": int(rolling_start),
                    "end_day": int(state.day),
                    "revenue": float(round(rolling_rev, 4)),
                    "profit": float(round(rolling_profit, 4)),
                    "cashflow": float(round(rolling_cashflow, 4)),
                    "orders": int(rolling_orders),
                    "avg_daily_revenue": float(round(rolling_avg_rev, 4)),
                    "avg_daily_profit": float(round(rolling_profit / float(rolling_days), 4)),
                    "avg_daily_cashflow": float(round(rolling_cashflow / float(rolling_days), 4)),
                    "avg_revenue_per_headcount": float(
                        round(rolling_rev / max(1.0, float(rolling_headcount)), 4)
                    ),
                    "revenue_momentum_vs_prev_window": float(round(rolling_rev_momentum, 6)),
                },
            },
            "stations": [_station_to_dto(s) for s in state.stations.values()],
            "stores": [_store_to_dto(s) for s in state.stores.values()],
            "ledger": _read_ledger_entries(limit=200),
            "insights": {
                "alerts": alerts[:300],
                "productivity": {
                    "by_region": by_region[:50],
                    "by_category": by_category[:20],
                    "by_role": by_role[:20],
                    "trend_daily": trend_rows[-90:],
                },
            },
            "bulk_templates": {
                "store_ops": [
                    {
                        "name": str(t.name),
                        "status": str(t.status),
                        "inv": float(t.inventory_salvage_rate),
                        "asset": float(t.asset_salvage_rate),
                    }
                    for t in (getattr(state, "store_bulk_templates", []) or [])
                ],
                "station_ops": [
                    {
                        "name": str(t.name),
                        "fuel_factor": float(t.fuel_factor),
                        "visitor_factor": float(t.visitor_factor),
                    }
                    for t in (getattr(state, "station_bulk_templates", []) or [])
                ],
            },
            "events": {
                "rng_seed": int(getattr(state, "rng_seed", 0) or 0),
                "templates": [_event_template_to_dto(t) for t in getattr(state, "event_templates", {}).values()],
                "active": [_active_event_to_dto(e) for e in getattr(state, "active_events", [])],
                "history": [_event_history_to_dto(h) for h in getattr(state, "event_history", [])][-500:],
            },
        }

    @app.get("/api/state")
    def api_state():
        with _lock:
            state = _ensure_state()
            dto = _state_to_dto(state)
        return dto

    @app.get("/api/events")
    def api_events():
        with _lock:
            state = _ensure_state()
            return {
                "rng_seed": int(getattr(state, "rng_seed", 0) or 0),
                "templates": [_event_template_to_dto(t) for t in getattr(state, "event_templates", {}).values()],
                "active": [_active_event_to_dto(e) for e in getattr(state, "active_events", [])],
                "history": [_event_history_to_dto(h) for h in getattr(state, "event_history", [])][-500:],
            }

    @app.put("/api/finance")
    def api_finance_update(payload: dict = Body(default={})):
        with _lock:
            state = _ensure_state()
            if "hq_credit_limit" in payload:
                state.hq_credit_limit = max(0.0, float(payload.get("hq_credit_limit") or 0.0))
            if "hq_daily_interest_rate" in payload:
                state.hq_daily_interest_rate = max(0.0, float(payload.get("hq_daily_interest_rate") or 0.0))
            if "hq_auto_finance" in payload:
                state.hq_auto_finance = bool(payload.get("hq_auto_finance"))
            if "budget_monthly_revenue_target" in payload:
                state.budget_monthly_revenue_target = max(
                    0.0, float(payload.get("budget_monthly_revenue_target") or 0.0)
                )
            if "budget_monthly_profit_target" in payload:
                state.budget_monthly_profit_target = max(
                    0.0, float(payload.get("budget_monthly_profit_target") or 0.0)
                )
            if "budget_monthly_cashflow_target" in payload:
                state.budget_monthly_cashflow_target = max(
                    0.0, float(payload.get("budget_monthly_cashflow_target") or 0.0)
                )
            if "capex_cash_payment_ratio" in payload:
                state.capex_cash_payment_ratio = max(0.0, min(1.0, float(payload.get("capex_cash_payment_ratio") or 0.0)))
            if "rolling_budget_window_days" in payload:
                state.rolling_budget_window_days = max(7, min(180, int(payload.get("rolling_budget_window_days") or 30)))
            if "finance_cost_allocation_method" in payload:
                m = str(payload.get("finance_cost_allocation_method") or "revenue").strip().lower()
                if m not in {"revenue", "credit_usage"}:
                    m = "revenue"
                state.finance_cost_allocation_method = m
            # Optional manual repay
            if "manual_repay" in payload:
                repay = max(0.0, float(payload.get("manual_repay") or 0.0))
                actual = min(repay, float(state.cash), float(getattr(state, "hq_credit_used", 0.0) or 0.0))
                if actual > 0:
                    state.cash -= actual
                    state.hq_credit_used = max(0.0, float(state.hq_credit_used) - actual)
                    store_used = {
                        sid: max(0.0, float(getattr(st, "finance_credit_used", 0.0) or 0.0))
                        for sid, st in state.stores.items()
                    }
                    total_store_used = sum(store_used.values())
                    if total_store_used > 0:
                        left = float(actual)
                        keys = list(store_used.keys())
                        for idx, sid in enumerate(keys):
                            st = state.stores[sid]
                            used_i = store_used[sid]
                            if used_i <= 0:
                                continue
                            if idx == len(keys) - 1:
                                deduct = min(left, float(getattr(st, "finance_credit_used", 0.0) or 0.0))
                            else:
                                deduct = min(
                                    left,
                                    float(getattr(st, "finance_credit_used", 0.0) or 0.0),
                                    actual * (used_i / total_store_used),
                                )
                            if deduct > 0:
                                st.finance_credit_used = max(0.0, float(st.finance_credit_used) - deduct)
                                left -= deduct
            save_state(state)
        return api_state()

    @app.post("/api/bulk-templates/store-ops")
    def api_store_bulk_template_upsert(payload: dict = Body(default={})):
        with _lock:
            state = _ensure_state()
            name = str(payload.get("name") or "").strip()
            if not name:
                return {"error": "name is required"}
            status = str(payload.get("status") or "open").strip()
            if status not in {"planning", "constructing", "open", "closed"}:
                status = "open"
            inv = max(0.0, min(1.0, float(payload.get("inv", 0.3) or 0.0)))
            asset = max(0.0, min(1.0, float(payload.get("asset", 0.1) or 0.0)))

            templates = [x for x in (getattr(state, "store_bulk_templates", []) or []) if str(x.name) != name]
            templates.insert(
                0,
                StoreBulkTemplate(
                    name=name,
                    status=status,
                    inventory_salvage_rate=inv,
                    asset_salvage_rate=asset,
                ),
            )
            state.store_bulk_templates = templates[:20]
            save_state(state)
        return api_state()

    @app.delete("/api/bulk-templates/store-ops/{name}")
    def api_store_bulk_template_delete(name: str):
        with _lock:
            state = _ensure_state()
            state.store_bulk_templates = [x for x in (getattr(state, "store_bulk_templates", []) or []) if str(x.name) != str(name)]
            save_state(state)
        return api_state()

    @app.patch("/api/bulk-templates/store-ops/{name}")
    def api_store_bulk_template_rename(name: str, payload: dict = Body(default={})):
        new_name = str(payload.get("new_name") or "").strip()
        if not new_name:
            return {"error": "new_name is required"}
        with _lock:
            state = _ensure_state()
            templates = list(getattr(state, "store_bulk_templates", []) or [])
            target = None
            rest = []
            for t in templates:
                if str(t.name) == str(name):
                    target = t
                elif str(t.name) != new_name:
                    rest.append(t)
            if target is None:
                return {"error": "template not found"}
            rest.insert(
                0,
                StoreBulkTemplate(
                    name=new_name,
                    status=str(target.status),
                    inventory_salvage_rate=float(target.inventory_salvage_rate),
                    asset_salvage_rate=float(target.asset_salvage_rate),
                ),
            )
            state.store_bulk_templates = rest[:20]
            save_state(state)
        return api_state()

    @app.get("/api/bulk-templates/store-ops/export")
    def api_store_bulk_template_export():
        with _lock:
            state = _ensure_state()
            return {
                "templates": [
                    {
                        "name": str(t.name),
                        "status": str(t.status),
                        "inv": float(t.inventory_salvage_rate),
                        "asset": float(t.asset_salvage_rate),
                    }
                    for t in (getattr(state, "store_bulk_templates", []) or [])
                ]
            }

    @app.post("/api/bulk-templates/store-ops/import")
    def api_store_bulk_template_import(payload: dict = Body(default={})):
        mode = str(payload.get("mode") or "merge").strip().lower()
        if mode not in {"merge", "replace"}:
            mode = "merge"
        raw_templates = payload.get("templates") or []
        with _lock:
            state = _ensure_state()
            current = list(getattr(state, "store_bulk_templates", []) or [])
            by_name = {}
            if mode == "merge":
                for t in current:
                    by_name[str(t.name)] = t

            for item in raw_templates:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "").strip()
                if not name:
                    continue
                status = str(item.get("status") or "open").strip()
                if status not in {"planning", "constructing", "open", "closed"}:
                    status = "open"
                inv = max(0.0, min(1.0, float(item.get("inv", 0.3) or 0.0)))
                asset = max(0.0, min(1.0, float(item.get("asset", 0.1) or 0.0)))
                by_name[name] = StoreBulkTemplate(
                    name=name,
                    status=status,
                    inventory_salvage_rate=inv,
                    asset_salvage_rate=asset,
                )

            state.store_bulk_templates = list(by_name.values())[:20]
            save_state(state)
        return api_state()

    @app.post("/api/bulk-templates/station-ops")
    def api_station_bulk_template_upsert(payload: dict = Body(default={})):
        with _lock:
            state = _ensure_state()
            name = str(payload.get("name") or "").strip()
            if not name:
                return {"error": "name is required"}
            fuel_factor = max(0.0, float(payload.get("fuel_factor", 1.0) or 0.0))
            visitor_factor = max(0.0, float(payload.get("visitor_factor", 1.0) or 0.0))

            templates = [x for x in (getattr(state, "station_bulk_templates", []) or []) if str(x.name) != name]
            templates.insert(0, StationBulkTemplate(name=name, fuel_factor=fuel_factor, visitor_factor=visitor_factor))
            state.station_bulk_templates = templates[:20]
            save_state(state)
        return api_state()

    @app.delete("/api/bulk-templates/station-ops/{name}")
    def api_station_bulk_template_delete(name: str):
        with _lock:
            state = _ensure_state()
            state.station_bulk_templates = [
                x for x in (getattr(state, "station_bulk_templates", []) or []) if str(x.name) != str(name)
            ]
            save_state(state)
        return api_state()

    @app.patch("/api/bulk-templates/station-ops/{name}")
    def api_station_bulk_template_rename(name: str, payload: dict = Body(default={})):
        new_name = str(payload.get("new_name") or "").strip()
        if not new_name:
            return {"error": "new_name is required"}
        with _lock:
            state = _ensure_state()
            templates = list(getattr(state, "station_bulk_templates", []) or [])
            target = None
            rest = []
            for t in templates:
                if str(t.name) == str(name):
                    target = t
                elif str(t.name) != new_name:
                    rest.append(t)
            if target is None:
                return {"error": "template not found"}
            rest.insert(
                0,
                StationBulkTemplate(
                    name=new_name,
                    fuel_factor=float(target.fuel_factor),
                    visitor_factor=float(target.visitor_factor),
                ),
            )
            state.station_bulk_templates = rest[:20]
            save_state(state)
        return api_state()

    @app.get("/api/bulk-templates/station-ops/export")
    def api_station_bulk_template_export():
        with _lock:
            state = _ensure_state()
            return {
                "templates": [
                    {
                        "name": str(t.name),
                        "fuel_factor": float(t.fuel_factor),
                        "visitor_factor": float(t.visitor_factor),
                    }
                    for t in (getattr(state, "station_bulk_templates", []) or [])
                ]
            }

    @app.post("/api/bulk-templates/station-ops/import")
    def api_station_bulk_template_import(payload: dict = Body(default={})):
        mode = str(payload.get("mode") or "merge").strip().lower()
        if mode not in {"merge", "replace"}:
            mode = "merge"
        raw_templates = payload.get("templates") or []
        with _lock:
            state = _ensure_state()
            current = list(getattr(state, "station_bulk_templates", []) or [])
            by_name = {}
            if mode == "merge":
                for t in current:
                    by_name[str(t.name)] = t

            for item in raw_templates:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "").strip()
                if not name:
                    continue
                fuel_factor = max(0.0, float(item.get("fuel_factor", 1.0) or 0.0))
                visitor_factor = max(0.0, float(item.get("visitor_factor", 1.0) or 0.0))
                by_name[name] = StationBulkTemplate(
                    name=name,
                    fuel_factor=fuel_factor,
                    visitor_factor=visitor_factor,
                )

            state.station_bulk_templates = list(by_name.values())[:20]
            save_state(state)
        return api_state()

    @app.get("/api/site-recommendations")
    def api_site_recommendations(
        top_k: int = 10,
        radius: float = 15.0,
        distance_mode: str = "road_proxy",
        graph_k_neighbors: int = 3,
    ):
        mode = str(distance_mode or "road_proxy").strip().lower()
        if mode not in {"euclidean", "road_proxy", "road_graph"}:
            mode = "road_proxy"
        with _lock:
            state = _ensure_state()
            recs = _site_recommendations(
                state,
                top_k=max(1, min(100, int(top_k))),
                radius=max(1.0, float(radius)),
                distance_mode=mode,
                graph_k_neighbors=max(1, min(10, int(graph_k_neighbors))),
            )
        return {
            "top_k": max(1, min(100, int(top_k))),
            "radius": max(1.0, float(radius)),
            "distance_mode": mode,
            "graph_k_neighbors": max(1, min(10, int(graph_k_neighbors))),
            "recommendations": recs,
        }

    @app.post("/api/scenarios/compare")
    def api_scenarios_compare(payload: dict = Body(default={})):
        days = max(1, min(3650, int(payload.get("days", 30) or 30)))
        seed_raw = payload.get("seed", None)
        seed = int(seed_raw) if seed_raw is not None else None
        scenarios = payload.get("scenarios") or []
        if not isinstance(scenarios, list):
            return {"error": "scenarios must be a list"}

        with _lock:
            state = _ensure_state()
            baseline = _simulate_scenario_metrics(state, days=days, seed=seed, scenario=None)

            out = []
            for idx, sc in enumerate(scenarios):
                if not isinstance(sc, dict):
                    continue
                name = str(sc.get("name") or f"scenario_{idx + 1}")
                m = _simulate_scenario_metrics(state, days=days, seed=seed, scenario=sc)
                out.append(
                    {
                        "name": name,
                        "metrics": m,
                        "delta_vs_baseline": {
                            "total_revenue": float(round(m["total_revenue"] - baseline["total_revenue"], 4)),
                            "total_operating_profit": float(
                                round(m["total_operating_profit"] - baseline["total_operating_profit"], 4)
                            ),
                            "total_net_cashflow": float(
                                round(m["total_net_cashflow"] - baseline["total_net_cashflow"], 4)
                            ),
                            "avg_daily_orders": float(round(m["avg_daily_orders"] - baseline["avg_daily_orders"], 4)),
                        },
                    }
                )

        return {
            "days": days,
            "seed": seed,
            "baseline": baseline,
            "scenarios": out,
        }

    @app.post("/api/events/seed")
    def api_events_set_seed(payload: dict = Body(default={})):
        seed = int(payload.get("seed", 0) or 0)
        with _lock:
            state = _ensure_state()
            state.rng_seed = int(seed)
            state.rng_state = None
            save_state(state)
        return api_state()

    @app.post("/api/event-templates")
    def api_event_template_upsert(payload: dict = Body(default={})):
        with _lock:
            state = _ensure_state()
            tid = str(payload.get("template_id") or "").strip() or f"tmpl_{uuid.uuid4().hex[:8]}"
            t = EventTemplate(
                template_id=tid,
                name=str(payload.get("name") or tid),
                event_type=str(payload.get("event_type") or "other"),
            )
            # Optional fields
            t.enabled = bool(payload.get("enabled", True))
            t.daily_probability = float(payload.get("daily_probability", 0.0) or 0.0)
            t.duration_days_min = int(payload.get("duration_days_min", 1) or 1)
            t.duration_days_max = int(payload.get("duration_days_max", t.duration_days_min) or t.duration_days_min)
            t.cooldown_days = int(payload.get("cooldown_days", 0) or 0)
            t.intensity_min = float(payload.get("intensity_min", 0.3) or 0.0)
            t.intensity_max = float(payload.get("intensity_max", 1.0) or 0.0)
            t.scope = str(payload.get("scope", "store") or "store")
            t.target_strategy = str(payload.get("target_strategy", "random_one") or "random_one")
            t.store_closed = bool(payload.get("store_closed", False))
            t.traffic_multiplier_min = float(payload.get("traffic_multiplier_min", 1.0) or 0.0)
            t.traffic_multiplier_max = float(payload.get("traffic_multiplier_max", 1.0) or 0.0)
            t.conversion_multiplier_min = float(payload.get("conversion_multiplier_min", 1.0) or 0.0)
            t.conversion_multiplier_max = float(payload.get("conversion_multiplier_max", 1.0) or 0.0)
            t.capacity_multiplier_min = float(payload.get("capacity_multiplier_min", 1.0) or 0.0)
            t.capacity_multiplier_max = float(payload.get("capacity_multiplier_max", 1.0) or 0.0)
            t.variable_cost_multiplier_min = float(payload.get("variable_cost_multiplier_min", 1.0) or 0.0)
            t.variable_cost_multiplier_max = float(payload.get("variable_cost_multiplier_max", 1.0) or 0.0)
            state.event_templates[tid] = t
            save_state(state)
        return api_state()

    @app.delete("/api/event-templates/{template_id}")
    def api_event_template_delete(template_id: str):
        with _lock:
            state = _ensure_state()
            if template_id in state.event_templates:
                del state.event_templates[template_id]
                save_state(state)
        return api_state()

    @app.post("/api/events/inject")
    def api_event_inject(payload: dict = Body(default={})):
        template_id = str(payload.get("template_id") or "").strip()
        scope = str(payload.get("scope") or "store").strip()
        target_id = str(payload.get("target_id") or "").strip()
        start_day = int(payload.get("start_day") or 0)
        duration_days = int(payload.get("duration_days") or 1)
        intensity = payload.get("intensity", None)
        intensity_f = float(intensity) if intensity is not None else None

        with _lock:
            state = _ensure_state()
            if start_day <= 0:
                start_day = int(state.day)
            inject_event_from_template(
                state,
                template_id=template_id,
                scope=scope,
                target_id=target_id,
                start_day=start_day,
                duration_days=max(1, duration_days),
                intensity=intensity_f,
            )
            save_state(state)
        return api_state()

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
            dto = _state_to_dto(state)
        return dto

    @app.post("/api/simulate/async")
    def api_simulate_async(payload: dict = Body(default={})):  # {days:int}
        days = int(payload.get("days", 1) or 1)
        days = max(1, min(3650, days))
        if _has_active_simulation_job():
            return {
                "error": "simulation job already running",
                "code": "simulation_busy",
            }
        job_id = f"sim_{uuid.uuid4().hex[:12]}"
        with simulate_jobs_lock:
            simulate_jobs[job_id] = {
                "job_id": job_id,
                "status": "pending",
                "days": days,
                "completed_days": 0,
                "progress": 0.0,
                "message": f"任务已创建，待执行（0/{days}）",
                "error": "",
                "cancel_requested": False,
                "created_at": _now_iso(),
                "started_at": "",
                "finished_at": "",
            }
        t = threading.Thread(target=_run_simulate_job, args=(job_id, days), daemon=True)
        t.start()
        snapshot = _simulate_job_snapshot(job_id)
        return snapshot or {"error": "job_create_failed"}

    @app.get("/api/simulate/jobs/{job_id}")
    def api_simulate_job_status(job_id: str):
        snapshot = _simulate_job_snapshot(job_id)
        if snapshot is None:
            return {
                "error": "job_not_found",
                "job_id": job_id,
            }
        return snapshot

    @app.post("/api/simulate/jobs/{job_id}/cancel")
    def api_simulate_job_cancel(job_id: str):
        should_return_snapshot = False
        with simulate_jobs_lock:
            j = simulate_jobs.get(job_id)
            if j is None:
                return {
                    "error": "job_not_found",
                    "job_id": job_id,
                }
            st = str(j.get("status") or "")
            if st in {"succeeded", "failed", "cancelled"}:
                should_return_snapshot = True
            else:
                j["cancel_requested"] = True
                j["message"] = "已请求取消，正在结束当前步..."
        if should_return_snapshot:
            return _simulate_job_snapshot(job_id)
        return _simulate_job_snapshot(job_id)

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
            dto = _state_to_dto(state2)
        return dto

    @app.post("/api/reset")
    def api_reset():
        with _lock:
            reset_data_files()
            state = _ensure_state()
            dto = _state_to_dto(state)
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
            st.local_competition_intensity = max(
                0.0, min(1.0, float(payload.get("local_competition_intensity", 0.0) or 0.0))
            )
            st.attractiveness_index = max(0.5, min(1.5, float(payload.get("attractiveness_index", 1.0) or 1.0)))
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
            if "local_competition_intensity" in payload:
                st.local_competition_intensity = max(
                    0.0, min(1.0, float(payload.get("local_competition_intensity") or 0.0))
                )
            if "attractiveness_index" in payload:
                st.attractiveness_index = max(0.5, min(1.5, float(payload.get("attractiveness_index") or 1.0)))
            if "auto_replenishment_enabled" in payload:
                st.auto_replenishment_enabled = bool(payload.get("auto_replenishment_enabled"))

            w = payload.get("workforce")
            if isinstance(w, dict):
                wf = getattr(st, "workforce", None)
                if wf is not None:
                    if "planned_headcount" in w:
                        wf.planned_headcount = max(0, int(w.get("planned_headcount") or 0))
                    if "current_headcount" in w:
                        wf.current_headcount = max(0, int(w.get("current_headcount") or 0))
                    if "training_level" in w:
                        wf.training_level = max(0.0, min(1.0, float(w.get("training_level") or 0.0)))
                    if "daily_turnover_rate" in w:
                        wf.daily_turnover_rate = max(0.0, min(1.0, float(w.get("daily_turnover_rate") or 0.0)))
                    if "recruiting_enabled" in w:
                        wf.recruiting_enabled = bool(w.get("recruiting_enabled"))
                    if "recruiting_daily_budget" in w:
                        wf.recruiting_daily_budget = max(0.0, float(w.get("recruiting_daily_budget") or 0.0))
                    if "recruiting_lead_days" in w:
                        wf.recruiting_lead_days = max(0, int(w.get("recruiting_lead_days") or 0))
                    if "recruiting_hire_rate_per_100_budget" in w:
                        wf.recruiting_hire_rate_per_100_budget = max(
                            0.0, float(w.get("recruiting_hire_rate_per_100_budget") or 0.0)
                        )
                    if "planned_leave_rate" in w:
                        wf.planned_leave_rate = max(0.0, min(1.0, float(w.get("planned_leave_rate") or 0.0)))
                    if "unplanned_absence_rate" in w:
                        wf.unplanned_absence_rate = max(
                            0.0, min(1.0, float(w.get("unplanned_absence_rate") or 0.0))
                        )
                    if "planned_leave_rate_day" in w:
                        wf.planned_leave_rate_day = max(
                            0.0, min(1.0, float(w.get("planned_leave_rate_day") or 0.0))
                        )
                    if "planned_leave_rate_night" in w:
                        wf.planned_leave_rate_night = max(
                            0.0, min(1.0, float(w.get("planned_leave_rate_night") or 0.0))
                        )
                    if "sick_leave_rate_day" in w:
                        wf.sick_leave_rate_day = max(0.0, min(1.0, float(w.get("sick_leave_rate_day") or 0.0)))
                    if "sick_leave_rate_night" in w:
                        wf.sick_leave_rate_night = max(
                            0.0, min(1.0, float(w.get("sick_leave_rate_night") or 0.0))
                        )
                    if "shifts_per_day" in w:
                        wf.shifts_per_day = max(1, int(w.get("shifts_per_day") or 1))
                    if "staffing_per_shift" in w:
                        wf.staffing_per_shift = max(1, int(w.get("staffing_per_shift") or 1))
                    if "shift_hours" in w:
                        wf.shift_hours = max(1.0, float(w.get("shift_hours") or 1.0))
                    if "overtime_shift_enabled" in w:
                        wf.overtime_shift_enabled = bool(w.get("overtime_shift_enabled"))
                    if "overtime_shift_extra_capacity" in w:
                        wf.overtime_shift_extra_capacity = max(
                            0.0, float(w.get("overtime_shift_extra_capacity") or 0.0)
                        )
                    if "overtime_shift_daily_cost" in w:
                        wf.overtime_shift_daily_cost = max(0.0, float(w.get("overtime_shift_daily_cost") or 0.0))
                    if "skill_by_category" in w and isinstance(w.get("skill_by_category"), dict):
                        d = w.get("skill_by_category") or {}
                        wf.skill_by_category = {
                            "wash": max(0.0, float(d.get("wash", 1.0) or 0.0)),
                            "maintenance": max(0.0, float(d.get("maintenance", 1.0) or 0.0)),
                            "detailing": max(0.0, float(d.get("detailing", 1.0) or 0.0)),
                            "other": max(0.0, float(d.get("other", 1.0) or 0.0)),
                        }
                    if "shift_allocation_by_category" in w and isinstance(w.get("shift_allocation_by_category"), dict):
                        d = w.get("shift_allocation_by_category") or {}
                        wf.shift_allocation_by_category = {
                            "wash": max(0.0, float(d.get("wash", 1.0) or 0.0)),
                            "maintenance": max(0.0, float(d.get("maintenance", 1.0) or 0.0)),
                            "detailing": max(0.0, float(d.get("detailing", 1.0) or 0.0)),
                            "other": max(0.0, float(d.get("other", 1.0) or 0.0)),
                        }
                    if "skill_by_role" in w and isinstance(w.get("skill_by_role"), dict):
                        d = w.get("skill_by_role") or {}
                        wf.skill_by_role = {
                            "技师": max(0.0, float(d.get("技师", 1.0) or 0.0)),
                            "店长": max(0.0, float(d.get("店长", 1.0) or 0.0)),
                            "销售": max(0.0, float(d.get("销售", 1.0) or 0.0)),
                            "客服": max(0.0, float(d.get("客服", 1.0) or 0.0)),
                        }
                    if "shift_allocation_by_role" in w and isinstance(w.get("shift_allocation_by_role"), dict):
                        d = w.get("shift_allocation_by_role") or {}
                        wf.shift_allocation_by_role = {
                            "技师": max(0.0, float(d.get("技师", 1.0) or 0.0)),
                            "店长": max(0.0, float(d.get("店长", 1.0) or 0.0)),
                            "销售": max(0.0, float(d.get("销售", 1.0) or 0.0)),
                            "客服": max(0.0, float(d.get("客服", 1.0) or 0.0)),
                        }

            # mitigation (nested patch)
            m = payload.get("mitigation")
            if isinstance(m, dict):
                mit = getattr(st, "mitigation", None)
                if mit is not None:
                    if "use_emergency_power" in m:
                        mit.use_emergency_power = bool(m.get("use_emergency_power"))
                    if "emergency_capacity_multiplier" in m:
                        mit.emergency_capacity_multiplier = max(0.0, float(m.get("emergency_capacity_multiplier") or 0.0))
                    if "emergency_variable_cost_multiplier" in m:
                        mit.emergency_variable_cost_multiplier = max(
                            0.0, float(m.get("emergency_variable_cost_multiplier") or 0.0)
                        )
                    if "emergency_daily_cost" in m:
                        mit.emergency_daily_cost = max(0.0, float(m.get("emergency_daily_cost") or 0.0))

                    if "use_promo_boost" in m:
                        mit.use_promo_boost = bool(m.get("use_promo_boost"))
                    if "promo_traffic_boost" in m:
                        mit.promo_traffic_boost = max(0.0, float(m.get("promo_traffic_boost") or 0.0))
                    if "promo_conversion_boost" in m:
                        mit.promo_conversion_boost = max(0.0, float(m.get("promo_conversion_boost") or 0.0))
                    if "promo_daily_cost" in m:
                        mit.promo_daily_cost = max(0.0, float(m.get("promo_daily_cost") or 0.0))

                    if "use_overtime_capacity" in m:
                        mit.use_overtime_capacity = bool(m.get("use_overtime_capacity"))
                    if "overtime_capacity_boost" in m:
                        mit.overtime_capacity_boost = max(0.0, float(m.get("overtime_capacity_boost") or 0.0))
                    if "overtime_daily_cost" in m:
                        mit.overtime_daily_cost = max(0.0, float(m.get("overtime_daily_cost") or 0.0))

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

    @app.post("/api/stores/{store_id}/replenishment/rules")
    def api_store_replenishment_rule_upsert(store_id: str, payload: dict = Body(...)):
        with _lock:
            state = _ensure_state()
            st = state.stores.get(store_id)
            if not st:
                return {"error": "store not found"}
            sku = str(payload.get("sku") or "").strip()
            if not sku:
                return {"error": "sku is required"}

            from simgame.models import ReplenishmentRule

            old = (getattr(st, "replenishment_rules", {}) or {}).get(sku)
            rp_v = payload.get("reorder_point") if "reorder_point" in payload else (getattr(old, "reorder_point", 50.0) if old else 50.0)
            ss_v = payload.get("safety_stock") if "safety_stock" in payload else (getattr(old, "safety_stock", 80.0) if old else 80.0)
            ts_v = payload.get("target_stock") if "target_stock" in payload else (getattr(old, "target_stock", 150.0) if old else 150.0)
            lt_v = payload.get("lead_time_days") if "lead_time_days" in payload else (getattr(old, "lead_time_days", 2) if old else 2)
            uc_v = payload.get("unit_cost") if "unit_cost" in payload else (getattr(old, "unit_cost", 0.0) if old else 0.0)
            rule = ReplenishmentRule(
                sku=sku,
                name=str(payload.get("name") or (getattr(old, "name", "") if old else "")),
                enabled=bool(payload.get("enabled") if "enabled" in payload else (getattr(old, "enabled", True) if old else True)),
                reorder_point=max(0.0, float(rp_v or 0.0)),
                safety_stock=max(0.0, float(ss_v or 0.0)),
                target_stock=max(0.0, float(ts_v or 0.0)),
                lead_time_days=max(0, int(lt_v or 0)),
                unit_cost=max(0.0, float(uc_v or 0.0)),
            )
            if rule.target_stock < rule.safety_stock:
                rule.target_stock = rule.safety_stock
            st.replenishment_rules[sku] = rule
            save_state(state)
        return api_state()

    @app.delete("/api/stores/{store_id}/replenishment/rules/{sku}")
    def api_store_replenishment_rule_delete(store_id: str, sku: str):
        with _lock:
            state = _ensure_state()
            st = state.stores.get(store_id)
            if not st:
                return {"error": "store not found"}
            if sku in st.replenishment_rules:
                del st.replenishment_rules[sku]
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
