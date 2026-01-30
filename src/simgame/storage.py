from __future__ import annotations

import csv
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict

from simgame.models import (
    Asset,
    BizConfig,
    GameState,
    InventoryItem,
    InsuranceBizConfig,
    OpexConfig,
    PayrollPlan,
    OnlineBizConfig,
    RentConfig,
    RolePlan,
    ServiceLine,
    ServiceProject,
    Station,
    Store,
    SupplyChainConfig,
    UtilitiesConfig,
    UsedCarBizConfig,
)


def project_root() -> Path:
    # .../模拟经营/src/simgame/storage.py -> parents[2] == .../模拟经营
    return Path(__file__).resolve().parents[2]


def data_dir() -> Path:
    p = project_root() / "data"
    p.mkdir(parents=True, exist_ok=True)
    return p


def state_path() -> Path:
    return data_dir() / "state.json"


def ledger_path() -> Path:
    return data_dir() / "ledger.csv"


def snapshots_dir() -> Path:
    p = data_dir() / "snapshots"
    p.mkdir(parents=True, exist_ok=True)
    return p


def snapshot_path(day: int) -> Path:
    return snapshots_dir() / f"state_day_{int(day):06d}.json"


def save_snapshot(state: GameState) -> None:
    # Snapshot is a full state.json payload so it can be loaded via load_state().
    save_state(state, path=snapshot_path(state.day))


def truncate_ledger_before_day(target_day: int) -> None:
    """Keep ledger rows with day < target_day."""

    p = ledger_path()
    if not p.exists():
        return

    try:
        with p.open("r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            fieldnames = list(reader.fieldnames or [])
            rows = list(reader)
    except Exception:
        return

    kept = []
    for r in rows:
        try:
            d = int(r.get("day") or 0)
        except Exception:
            d = 0
        if d < int(target_day):
            kept.append(r)

    with p.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(kept)


def reset_data_files() -> None:
    """Delete persisted state/ledger/snapshots."""

    for fp in [state_path(), ledger_path()]:
        try:
            fp.unlink(missing_ok=True)
        except Exception:
            pass

    sdir = snapshots_dir()
    try:
        for p in sdir.glob("state_day_*.json"):
            try:
                p.unlink()
            except Exception:
                pass
    except Exception:
        pass


def save_state(state: GameState, path: Path | None = None) -> None:
    p = path or state_path()
    payload = {
        "version": "0.7.0",
        "state": asdict(state),
    }
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_biz_config(d: Any) -> BizConfig:
    if not isinstance(d, dict):
        return BizConfig()

    online_raw = d.get("online", {})
    insurance_raw = d.get("insurance", {})
    used_car_raw = d.get("used_car", {})
    sc_raw = d.get("supply_chain", {})

    online_d: Dict[str, Any] = online_raw if isinstance(online_raw, dict) else {}
    insurance_d: Dict[str, Any] = insurance_raw if isinstance(insurance_raw, dict) else {}
    used_car_d: Dict[str, Any] = used_car_raw if isinstance(used_car_raw, dict) else {}
    sc_d: Dict[str, Any] = sc_raw if isinstance(sc_raw, dict) else {}

    online = OnlineBizConfig(
        enabled=bool(online_d.get("enabled", True)),
        daily_orders_mean=float(online_d.get("daily_orders_mean", 2.0) or 0.0),
        daily_orders_std=max(0.0, float(online_d.get("daily_orders_std", 0.5) or 0.0)),
        avg_ticket=max(0.0, float(online_d.get("avg_ticket", 200.0) or 0.0)),
        margin_rate=max(0.0, float(online_d.get("margin_rate", 0.15) or 0.0)),
    )
    insurance = InsuranceBizConfig(
        enabled=bool(insurance_d.get("enabled", True)),
        daily_revenue_target=max(0.0, float(insurance_d.get("daily_revenue_target", 128.4) or 0.0)),
        volatility=max(0.0, float(insurance_d.get("volatility", 0.1) or 0.0)),
        margin_rate=max(0.0, float(insurance_d.get("margin_rate", 0.20) or 0.0)),
    )
    used_car = UsedCarBizConfig(
        enabled=bool(used_car_d.get("enabled", True)),
        monthly_deal_target=max(0.0, float(used_car_d.get("monthly_deal_target", 1.56) or 0.0)),
        revenue_per_deal=max(0.0, float(used_car_d.get("revenue_per_deal", 1200.0) or 0.0)),
        profit_per_deal=max(0.0, float(used_car_d.get("profit_per_deal", 600.0) or 0.0)),
    )
    supply_chain = SupplyChainConfig(
        enabled=bool(sc_d.get("enabled", True)),
        cost_reduction_rate=max(0.0, float(sc_d.get("cost_reduction_rate", 0.03) or 0.0)),
    )
    return BizConfig(online=online, insurance=insurance, used_car=used_car, supply_chain=supply_chain)


def _load_opex_config(d: Any) -> OpexConfig:
    if not isinstance(d, dict):
        return OpexConfig()

    rent_raw = d.get("rent", {})
    util_raw = d.get("utilities", {})
    rent_d: Dict[str, Any] = rent_raw if isinstance(rent_raw, dict) else {}
    util_d: Dict[str, Any] = util_raw if isinstance(util_raw, dict) else {}

    rent = RentConfig(
        monthly_cost=max(0.0, float(rent_d.get("monthly_cost", 15000.0) or 0.0)),
        allocation_strategy=str(rent_d.get("allocation_strategy", "daily") or "daily"),
    )
    utilities = UtilitiesConfig(
        water_cost_per_wash=max(0.0, float(util_d.get("water_cost_per_wash", 1.5) or 0.0)),
        elec_daily_base=max(0.0, float(util_d.get("elec_daily_base", 50.0) or 0.0)),
        elec_cost_per_wash=max(0.0, float(util_d.get("elec_cost_per_wash", 0.8) or 0.0)),
        elec_cost_per_maint=max(0.0, float(util_d.get("elec_cost_per_maint", 2.0) or 0.0)),
    )
    return OpexConfig(rent=rent, utilities=utilities)


def load_state(path: Path | None = None) -> GameState:
    p = path or state_path()
    payload = json.loads(p.read_text(encoding="utf-8"))
    d = payload.get("state", {})

    state = GameState(day=int(d.get("day", 1)), cash=float(d.get("cash", 0.0)))

    # Stations
    for sid, sd in (d.get("stations") or {}).items():
        state.stations[sid] = Station(
            station_id=str(sd.get("station_id", sid)),
            name=str(sd.get("name", sid)),
            station_type=str(sd.get("station_type", "")),
            city=str(sd.get("city", "")),
            district=str(sd.get("district", "")),
            provider=str(sd.get("provider", "")),
            map_x=float(sd.get("map_x", 0.0)),
            map_y=float(sd.get("map_y", 0.0)),
            fuel_vehicles_per_day=int(sd.get("fuel_vehicles_per_day", 0)),
            visitor_vehicles_per_day=int(sd.get("visitor_vehicles_per_day", 0)),
            traffic_volatility=float(sd.get("traffic_volatility", 0.0)),
        )

    # Stores
    for store_id, st_d in (d.get("stores") or {}).items():
        store = Store(
            store_id=str(st_d.get("store_id", store_id)),
            name=str(st_d.get("name", store_id)),
            station_id=str(st_d.get("station_id", "")),
        )
        store.biz_config = _load_biz_config(st_d.get("biz_config"))
        store.opex_config = _load_opex_config(st_d.get("opex_config"))
        store.city = str(st_d.get("city", ""))
        store.district = str(st_d.get("district", ""))
        store.provider = str(st_d.get("provider", ""))
        store.status = str(st_d.get("status", "planning"))
        store.build_days_total = int(st_d.get("build_days_total", 0))
        store.operation_start_day = int(st_d.get("operation_start_day", 1))
        store.traffic_conversion_rate = float(st_d.get("traffic_conversion_rate", 1.0))
        store.labor_hour_price = float(st_d.get("labor_hour_price", 120.0))
        store.construction_days_remaining = int(st_d.get("construction_days_remaining", 0))
        store.capex_total = float(st_d.get("capex_total", 0.0))
        store.capex_spend_per_day = float(st_d.get("capex_spend_per_day", 0.0))
        store.capex_useful_life_days = int(st_d.get("capex_useful_life_days", 5 * 365))
        store.fixed_overhead_per_day = float(st_d.get("fixed_overhead_per_day", 0.0))
        store.strict_parts = bool(st_d.get("strict_parts", True))
        store.cash_balance = float(st_d.get("cash_balance", 0.0))

        # Service lines
        for sid, ld in (st_d.get("service_lines") or {}).items():
            store.service_lines[sid] = ServiceLine(
                service_id=str(ld.get("service_id", sid)),
                name=str(ld.get("name", sid)),
                category=str(ld.get("category", "other")),
                price=float(ld.get("price", 0.0)),
                conversion_from_fuel=float(ld.get("conversion_from_fuel", 0.0)),
                conversion_from_visitor=float(ld.get("conversion_from_visitor", 0.0)),
                capacity_per_day=int(ld.get("capacity_per_day", 0)),
                variable_cost_per_order=float(ld.get("variable_cost_per_order", 0.0)),
                parts_cost_ratio=float(ld.get("parts_cost_ratio", 0.0)),
                variable_labor_per_order=float(ld.get("variable_labor_per_order", 0.0)),
                labor_role=ld.get("labor_role"),
                labor_hours_per_order=float(ld.get("labor_hours_per_order", 0.0)),
                consumable_sku=ld.get("consumable_sku"),
                consumable_units_per_order=float(ld.get("consumable_units_per_order", 0.0)),
                project_mix=[(str(a), float(b)) for a, b in (ld.get("project_mix") or [])],
            )

        # Projects
        for pid, pd in (st_d.get("projects") or {}).items():
            store.projects[pid] = ServiceProject(
                project_id=str(pd.get("project_id", pid)),
                name=str(pd.get("name", pid)),
                price=float(pd.get("price", 0.0)),
                labor_hours=float(pd.get("labor_hours", 0.0)),
                variable_cost=float(pd.get("variable_cost", 0.0)),
                parts={str(k): float(v) for k, v in (pd.get("parts") or {}).items()},
            )

        # Inventory
        for sku, it in (st_d.get("inventory") or {}).items():
            store.inventory[sku] = InventoryItem(
                sku=str(it.get("sku", sku)),
                name=str(it.get("name", sku)),
                unit_cost=float(it.get("unit_cost", 0.0)),
                qty=float(it.get("qty", 0.0)),
            )

        # Assets
        for a in (st_d.get("assets") or []):
            store.assets.append(
                Asset(
                    name=str(a.get("name", "asset")),
                    capex=float(a.get("capex", 0.0)),
                    useful_life_days=int(a.get("useful_life_days", 0)),
                    in_service_day=int(a.get("in_service_day", 1)),
                )
            )

        # Payroll
        roles: Dict[str, RolePlan] = {}
        for rname, rp in ((st_d.get("payroll") or {}).get("roles") or {}).items():
            plan = RolePlan(
                role=str(rp.get("role", rname)),
                headcount=int(rp.get("headcount", 0)),
                level=str(rp.get("level", "")),
                base_monthly=float(rp.get("base_monthly", 0.0)),
                position_allowance=float(rp.get("position_allowance", 0.0)),
                social_security_rate=float(rp.get("social_security_rate", 0.0)),
                housing_fund_rate=float(rp.get("housing_fund_rate", 0.0)),
                workdays_per_month=int(rp.get("workdays_per_month", 26)),
            )
            plan.piece_rate = {str(k): float(v) for k, v in (rp.get("piece_rate") or {}).items()}
            plan.piece_rate_project = {str(k): float(v) for k, v in (rp.get("piece_rate_project") or {}).items()}
            plan.monthly_tier_bonus = [(int(a), float(b)) for a, b in (rp.get("monthly_tier_bonus") or [])]
            plan.profit_share_rate = float(rp.get("profit_share_rate", 0.0))
            plan.labor_commission_rate = float(rp.get("labor_commission_rate", 0.0))
            plan.parts_commission_rate = float(rp.get("parts_commission_rate", 0.0))
            plan.sales_commission_rate = float(rp.get("sales_commission_rate", 0.0))
            plan.wash_commission_base = str(rp.get("wash_commission_base", "revenue"))
            plan.wash_commission_rate = float(rp.get("wash_commission_rate", 0.0))
            plan.maintenance_commission_base = str(rp.get("maintenance_commission_base", "revenue"))
            plan.maintenance_commission_rate = float(rp.get("maintenance_commission_rate", 0.0))
            plan.detailing_commission_base = str(rp.get("detailing_commission_base", "revenue"))
            plan.detailing_commission_rate = float(rp.get("detailing_commission_rate", 0.0))
            plan.parts_commission_base = str(rp.get("parts_commission_base", "revenue"))
            plan.min_monthly_orders_threshold = int(rp.get("min_monthly_orders_threshold", 0) or 0)
            plan.overtime_pay_rate = float(rp.get("overtime_pay_rate", 0.0))
            plan.sales_commission_by_service = {str(k): float(v) for k, v in (rp.get("sales_commission_by_service") or {}).items()}
            plan.gross_profit_commission_by_service = {
                str(k): float(v) for k, v in (rp.get("gross_profit_commission_by_service") or {}).items()
            }
            plan.gross_profit_commission_by_project = {
                str(k): float(v) for k, v in (rp.get("gross_profit_commission_by_project") or {}).items()
            }
            roles[rname] = plan
        store.payroll = PayrollPlan(roles=roles)

        # Month trackers
        store.mtd_orders_by_service = {str(k): int(v) for k, v in (st_d.get("mtd_orders_by_service") or {}).items()}
        store.mtd_orders_by_project = {str(k): int(v) for k, v in (st_d.get("mtd_orders_by_project") or {}).items()}
        store.mtd_revenue = float(st_d.get("mtd_revenue", 0.0))
        store.mtd_variable_cost = float(st_d.get("mtd_variable_cost", 0.0))
        store.mtd_parts_cogs = float(st_d.get("mtd_parts_cogs", 0.0))
        store.mtd_labor_cost = float(st_d.get("mtd_labor_cost", 0.0))
        store.mtd_depr_cost = float(st_d.get("mtd_depr_cost", 0.0))
        store.mtd_fixed_overhead = float(st_d.get("mtd_fixed_overhead", 0.0))
        store.mtd_operating_profit = float(st_d.get("mtd_operating_profit", 0.0))
        store.mtd_cash_in = float(st_d.get("mtd_cash_in", 0.0))
        store.mtd_cash_out = float(st_d.get("mtd_cash_out", 0.0))

        state.stores[store_id] = store

    # Ledger is intentionally not restored (keeps state.json small); use ledger.csv for history.
    state.ledger = []
    return state


def append_ledger_csv(day_result: Any) -> None:
    p = ledger_path()

    columns = [
        "day",
        "store_id",
        "store_name",
        "station_id",
        "status",
        "fuel_traffic",
        "visitor_traffic",
        "revenue",
        "variable_cost",
        "parts_cogs",
        "labor_cost",
        "depreciation_cost",
        "fixed_overhead",
        "cost_rent",
        "cost_water",
        "cost_elec",
        "operating_profit",
        "cash_in",
        "cash_out",
        "net_cashflow",
        "orders_by_service_json",
        "orders_by_project_json",
        "revenue_by_service_json",
        "gross_profit_by_service_json",
        "gross_profit_by_project_json",
        "revenue_by_category_json",
        "gross_profit_by_category_json",
        "parts_cogs_by_project_json",
        "labor_revenue",
        "parts_revenue",
        "parts_gross_profit",
        # Value-added streams
        "rev_online",
        "gp_online",
        "rev_insurance",
        "gp_insurance",
        "rev_used_car",
        "gp_used_car",
        "count_used_car",
    ]

    # If ledger.csv exists with an older header, migrate it in-place (fill new columns with blanks).
    if p.exists():
        try:
            with p.open("r", encoding="utf-8", newline="") as f:
                reader = csv.DictReader(f)
                existing = list(reader.fieldnames or [])
                rows = list(reader)
            if existing and (existing != columns):
                with p.open("w", encoding="utf-8", newline="") as f:
                    w2 = csv.DictWriter(f, fieldnames=columns)
                    w2.writeheader()
                    for r in rows:
                        w2.writerow({c: r.get(c, "") for c in columns})
        except Exception:
            # If migration fails, continue appending using current file as-is.
            pass

    write_header = (not p.exists()) or (p.stat().st_size <= 0)
    with p.open("a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if write_header:
            w.writerow(columns)

        for sr in getattr(day_result, "store_results", []):
            w.writerow(
                [
                    getattr(day_result, "day", ""),
                    sr.store_id,
                    sr.store_name,
                    sr.station_id,
                    sr.status,
                    sr.fuel_traffic,
                    sr.visitor_traffic,
                    sr.revenue,
                    sr.variable_cost,
                    sr.parts_cogs,
                    sr.labor_cost,
                    sr.depreciation_cost,
                    sr.fixed_overhead,
                    getattr(sr, "cost_rent", 0.0),
                    getattr(sr, "cost_water", 0.0),
                    getattr(sr, "cost_elec", 0.0),
                    sr.operating_profit,
                    sr.cash_in,
                    sr.cash_out,
                    sr.net_cashflow,
                    json.dumps(sr.orders_by_service, ensure_ascii=False),
                    json.dumps(sr.orders_by_project, ensure_ascii=False),
                    json.dumps(getattr(sr, "revenue_by_service", {}) or {}, ensure_ascii=False),
                    json.dumps(getattr(sr, "gross_profit_by_service", {}) or {}, ensure_ascii=False),
                    json.dumps(getattr(sr, "gross_profit_by_project", {}) or {}, ensure_ascii=False),
                    json.dumps(getattr(sr, "revenue_by_category", {}) or {}, ensure_ascii=False),
                    json.dumps(getattr(sr, "gross_profit_by_category", {}) or {}, ensure_ascii=False),
                    json.dumps(getattr(sr, "parts_cogs_by_project", {}) or {}, ensure_ascii=False),
                    getattr(sr, "labor_revenue", 0.0),
                    getattr(sr, "parts_revenue", 0.0),
                    getattr(sr, "parts_gross_profit", 0.0),
                    getattr(sr, "rev_online", 0.0),
                    getattr(sr, "gp_online", 0.0),
                    getattr(sr, "rev_insurance", 0.0),
                    getattr(sr, "gp_insurance", 0.0),
                    getattr(sr, "rev_used_car", 0.0),
                    getattr(sr, "gp_used_car", 0.0),
                    getattr(sr, "count_used_car", 0),
                ]
            )
