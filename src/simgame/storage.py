from __future__ import annotations

import csv
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict

from simgame.models import (
    Asset,
    ActiveEvent,
    BizConfig,
    EventHistoryRecord,
    EventTemplate,
    GameState,
    InventoryItem,
    InsuranceBizConfig,
    MitigationConfig,
    OpexConfig,
    PendingHire,
    PayrollPlan,
    OnlineBizConfig,
    RentConfig,
    RolePlan,
    ServiceLine,
    ServiceProject,
    StationBulkTemplate,
    StoreBulkTemplate,
    Station,
    Store,
    SupplyChainConfig,
    ReplenishmentRule,
    PendingInbound,
    WorkforceConfig,
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
        "version": "0.7.3",
        "state": asdict(state),
    }
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _seed_default_event_templates(state: GameState) -> None:
    if getattr(state, "event_templates", None):
        return

    # Minimal starter set; all can be edited in the UI.
    defaults = [
        EventTemplate(
            template_id="weather_rain",
            name="恶劣天气-下雨",
            event_type="weather",
            enabled=True,
            daily_probability=0.03,
            duration_days_min=1,
            duration_days_max=2,
            cooldown_days=5,
            intensity_min=0.4,
            intensity_max=1.0,
            scope="station",
            target_strategy="random_one",
            store_closed=False,
            traffic_multiplier_min=0.70,
            traffic_multiplier_max=0.95,
            conversion_multiplier_min=0.80,
            conversion_multiplier_max=0.98,
            capacity_multiplier_min=0.90,
            capacity_multiplier_max=1.00,
            variable_cost_multiplier_min=1.00,
            variable_cost_multiplier_max=1.10,
        ),
        EventTemplate(
            template_id="weather_snow",
            name="恶劣天气-下雪",
            event_type="weather",
            enabled=True,
            daily_probability=0.015,
            duration_days_min=1,
            duration_days_max=3,
            cooldown_days=10,
            intensity_min=0.5,
            intensity_max=1.0,
            scope="station",
            target_strategy="random_one",
            store_closed=False,
            traffic_multiplier_min=0.50,
            traffic_multiplier_max=0.85,
            conversion_multiplier_min=0.65,
            conversion_multiplier_max=0.95,
            capacity_multiplier_min=0.80,
            capacity_multiplier_max=1.00,
            variable_cost_multiplier_min=1.05,
            variable_cost_multiplier_max=1.25,
        ),
        EventTemplate(
            template_id="complaint",
            name="投诉事件",
            event_type="complaint",
            enabled=True,
            daily_probability=0.01,
            duration_days_min=2,
            duration_days_max=5,
            cooldown_days=20,
            intensity_min=0.3,
            intensity_max=1.0,
            scope="store",
            target_strategy="random_one",
            store_closed=False,
            traffic_multiplier_min=0.90,
            traffic_multiplier_max=1.00,
            conversion_multiplier_min=0.70,
            conversion_multiplier_max=0.95,
            capacity_multiplier_min=1.00,
            capacity_multiplier_max=1.00,
            variable_cost_multiplier_min=1.00,
            variable_cost_multiplier_max=1.00,
        ),
        EventTemplate(
            template_id="power_outage",
            name="停电",
            event_type="outage",
            enabled=True,
            daily_probability=0.006,
            duration_days_min=1,
            duration_days_max=2,
            cooldown_days=30,
            intensity_min=0.7,
            intensity_max=1.0,
            scope="store",
            target_strategy="random_one",
            store_closed=True,
            traffic_multiplier_min=1.00,
            traffic_multiplier_max=1.00,
            conversion_multiplier_min=1.00,
            conversion_multiplier_max=1.00,
            capacity_multiplier_min=0.00,
            capacity_multiplier_max=0.00,
            variable_cost_multiplier_min=1.00,
            variable_cost_multiplier_max=1.00,
        ),
        EventTemplate(
            template_id="water_outage",
            name="停水",
            event_type="outage",
            enabled=True,
            daily_probability=0.006,
            duration_days_min=1,
            duration_days_max=2,
            cooldown_days=30,
            intensity_min=0.7,
            intensity_max=1.0,
            scope="store",
            target_strategy="random_one",
            store_closed=False,
            traffic_multiplier_min=1.00,
            traffic_multiplier_max=1.00,
            conversion_multiplier_min=1.00,
            conversion_multiplier_max=1.00,
            capacity_multiplier_min=0.40,
            capacity_multiplier_max=0.85,
            variable_cost_multiplier_min=1.00,
            variable_cost_multiplier_max=1.05,
        ),
    ]
    state.event_templates = {t.template_id: t for t in defaults}


def _load_event_templates(d: Any) -> Dict[str, EventTemplate]:
    if not isinstance(d, dict):
        return {}
    out: Dict[str, EventTemplate] = {}
    for tid, raw in d.items():
        if not isinstance(raw, dict):
            continue
        template_id = str(raw.get("template_id", tid) or tid)
        out[template_id] = EventTemplate(
            template_id=template_id,
            name=str(raw.get("name", template_id)),
            event_type=str(raw.get("event_type", "other")),
            enabled=bool(raw.get("enabled", True)),
            daily_probability=float(raw.get("daily_probability", 0.0) or 0.0),
            duration_days_min=int(raw.get("duration_days_min", 1) or 1),
            duration_days_max=int(raw.get("duration_days_max", 1) or 1),
            cooldown_days=int(raw.get("cooldown_days", 0) or 0),
            intensity_min=float(raw.get("intensity_min", 0.3) or 0.0),
            intensity_max=float(raw.get("intensity_max", 1.0) or 0.0),
            scope=str(raw.get("scope", "store") or "store"),
            target_strategy=str(raw.get("target_strategy", "random_one") or "random_one"),
            store_closed=bool(raw.get("store_closed", False)),
            traffic_multiplier_min=float(raw.get("traffic_multiplier_min", 1.0) or 0.0),
            traffic_multiplier_max=float(raw.get("traffic_multiplier_max", 1.0) or 0.0),
            conversion_multiplier_min=float(raw.get("conversion_multiplier_min", 1.0) or 0.0),
            conversion_multiplier_max=float(raw.get("conversion_multiplier_max", 1.0) or 0.0),
            capacity_multiplier_min=float(raw.get("capacity_multiplier_min", 1.0) or 0.0),
            capacity_multiplier_max=float(raw.get("capacity_multiplier_max", 1.0) or 0.0),
            variable_cost_multiplier_min=float(raw.get("variable_cost_multiplier_min", 1.0) or 0.0),
            variable_cost_multiplier_max=float(raw.get("variable_cost_multiplier_max", 1.0) or 0.0),
        )
    return out


def _load_active_events(d: Any) -> list[ActiveEvent]:
    if not isinstance(d, list):
        return []
    out: list[ActiveEvent] = []
    for raw in d:
        if not isinstance(raw, dict):
            continue
        out.append(
            ActiveEvent(
                event_id=str(raw.get("event_id", "")),
                template_id=str(raw.get("template_id", "")),
                name=str(raw.get("name", "")),
                event_type=str(raw.get("event_type", "other")),
                scope=str(raw.get("scope", "store")),
                target_id=str(raw.get("target_id", "")),
                start_day=int(raw.get("start_day", 0) or 0),
                end_day=int(raw.get("end_day", 0) or 0),
                intensity=float(raw.get("intensity", 0.0) or 0.0),
                store_closed=bool(raw.get("store_closed", False)),
                traffic_multiplier=float(raw.get("traffic_multiplier", 1.0) or 1.0),
                conversion_multiplier=float(raw.get("conversion_multiplier", 1.0) or 1.0),
                capacity_multiplier=float(raw.get("capacity_multiplier", 1.0) or 1.0),
                variable_cost_multiplier=float(raw.get("variable_cost_multiplier", 1.0) or 1.0),
            )
        )
    return out


def _load_event_history(d: Any) -> list[EventHistoryRecord]:
    if not isinstance(d, list):
        return []
    out: list[EventHistoryRecord] = []
    for raw in d:
        if not isinstance(raw, dict):
            continue
        out.append(
            EventHistoryRecord(
                event_id=str(raw.get("event_id", "")),
                template_id=str(raw.get("template_id", "")),
                name=str(raw.get("name", "")),
                event_type=str(raw.get("event_type", "other")),
                scope=str(raw.get("scope", "store")),
                target_id=str(raw.get("target_id", "")),
                start_day=int(raw.get("start_day", 0) or 0),
                end_day=int(raw.get("end_day", 0) or 0),
                created_day=int(raw.get("created_day", 0) or 0),
                intensity=float(raw.get("intensity", 0.0) or 0.0),
                store_closed=bool(raw.get("store_closed", False)),
                traffic_multiplier=float(raw.get("traffic_multiplier", 1.0) or 1.0),
                conversion_multiplier=float(raw.get("conversion_multiplier", 1.0) or 1.0),
                capacity_multiplier=float(raw.get("capacity_multiplier", 1.0) or 1.0),
                variable_cost_multiplier=float(raw.get("variable_cost_multiplier", 1.0) or 1.0),
            )
        )
    return out


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
    state.rng_seed = int(d.get("rng_seed", getattr(state, "rng_seed", 20260101)) or 20260101)
    state.rng_state = d.get("rng_state", None)
    state.event_templates = _load_event_templates(d.get("event_templates"))
    state.active_events = _load_active_events(d.get("active_events"))
    state.event_history = _load_event_history(d.get("event_history"))
    state.event_cooldowns = {str(k): int(v) for k, v in (d.get("event_cooldowns") or {}).items()}
    state.hq_credit_limit = max(0.0, float(d.get("hq_credit_limit", 0.0) or 0.0))
    state.hq_credit_used = max(0.0, float(d.get("hq_credit_used", 0.0) or 0.0))
    state.hq_daily_interest_rate = max(0.0, float(d.get("hq_daily_interest_rate", 0.0005) or 0.0))
    state.hq_auto_finance = bool(d.get("hq_auto_finance", False))
    state.budget_monthly_revenue_target = max(0.0, float(d.get("budget_monthly_revenue_target", 0.0) or 0.0))
    state.budget_monthly_profit_target = max(0.0, float(d.get("budget_monthly_profit_target", 0.0) or 0.0))
    state.budget_monthly_cashflow_target = max(0.0, float(d.get("budget_monthly_cashflow_target", 0.0) or 0.0))
    state.capex_cash_payment_ratio = max(0.0, min(1.0, float(d.get("capex_cash_payment_ratio", 1.0) or 0.0)))
    state.rolling_budget_window_days = max(7, min(180, int(d.get("rolling_budget_window_days", 30) or 30)))
    state.finance_cost_allocation_method = str(d.get("finance_cost_allocation_method", "revenue") or "revenue")
    state.store_bulk_templates = []
    for t in (d.get("store_bulk_templates") or []):
        if not isinstance(t, dict):
            continue
        name = str(t.get("name", "") or "").strip()
        if not name:
            continue
        state.store_bulk_templates.append(
            StoreBulkTemplate(
                name=name,
                status=str(t.get("status", "open") or "open"),
                inventory_salvage_rate=max(0.0, min(1.0, float(t.get("inventory_salvage_rate", 0.3) or 0.0))),
                asset_salvage_rate=max(0.0, min(1.0, float(t.get("asset_salvage_rate", 0.1) or 0.0))),
            )
        )
    state.station_bulk_templates = []
    for t in (d.get("station_bulk_templates") or []):
        if not isinstance(t, dict):
            continue
        name = str(t.get("name", "") or "").strip()
        if not name:
            continue
        state.station_bulk_templates.append(
            StationBulkTemplate(
                name=name,
                fuel_factor=max(0.0, float(t.get("fuel_factor", 1.0) or 0.0)),
                visitor_factor=max(0.0, float(t.get("visitor_factor", 1.0) or 0.0)),
            )
        )
    _seed_default_event_templates(state)

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
        mit_raw = st_d.get("mitigation") if isinstance(st_d.get("mitigation"), dict) else {}
        store.mitigation = MitigationConfig(
            use_emergency_power=bool(mit_raw.get("use_emergency_power", False)),
            emergency_capacity_multiplier=max(0.0, float(mit_raw.get("emergency_capacity_multiplier", 0.60) or 0.0)),
            emergency_variable_cost_multiplier=max(0.0, float(mit_raw.get("emergency_variable_cost_multiplier", 1.15) or 0.0)),
            emergency_daily_cost=max(0.0, float(mit_raw.get("emergency_daily_cost", 120.0) or 0.0)),
            use_promo_boost=bool(mit_raw.get("use_promo_boost", False)),
            promo_traffic_boost=max(0.0, float(mit_raw.get("promo_traffic_boost", 1.05) or 0.0)),
            promo_conversion_boost=max(0.0, float(mit_raw.get("promo_conversion_boost", 1.08) or 0.0)),
            promo_daily_cost=max(0.0, float(mit_raw.get("promo_daily_cost", 80.0) or 0.0)),
            use_overtime_capacity=bool(mit_raw.get("use_overtime_capacity", False)),
            overtime_capacity_boost=max(0.0, float(mit_raw.get("overtime_capacity_boost", 1.20) or 0.0)),
            overtime_daily_cost=max(0.0, float(mit_raw.get("overtime_daily_cost", 100.0) or 0.0)),
        )

        store.auto_replenishment_enabled = bool(st_d.get("auto_replenishment_enabled", False))
        store.replenishment_rules = {}
        rr_raw = st_d.get("replenishment_rules") or {}
        if isinstance(rr_raw, dict):
            for sku, r in rr_raw.items():
                if not isinstance(r, dict):
                    continue
                sid = str(r.get("sku", sku) or sku)
                store.replenishment_rules[sid] = ReplenishmentRule(
                    sku=sid,
                    name=str(r.get("name", "") or ""),
                    enabled=bool(r.get("enabled", True)),
                    reorder_point=max(0.0, float(r.get("reorder_point", 50.0) or 0.0)),
                    safety_stock=max(0.0, float(r.get("safety_stock", 80.0) or 0.0)),
                    target_stock=max(0.0, float(r.get("target_stock", 150.0) or 0.0)),
                    lead_time_days=max(0, int(r.get("lead_time_days", 2) or 0)),
                    unit_cost=max(0.0, float(r.get("unit_cost", 0.0) or 0.0)),
                )
        store.pending_inbounds = []
        pi_raw = st_d.get("pending_inbounds") or []
        if isinstance(pi_raw, list):
            for p in pi_raw:
                if not isinstance(p, dict):
                    continue
                store.pending_inbounds.append(
                    PendingInbound(
                        sku=str(p.get("sku", "") or ""),
                        name=str(p.get("name", "") or ""),
                        qty=max(0.0, float(p.get("qty", 0.0) or 0.0)),
                        unit_cost=max(0.0, float(p.get("unit_cost", 0.0) or 0.0)),
                        order_day=int(p.get("order_day", 0) or 0),
                        arrive_day=int(p.get("arrive_day", 0) or 0),
                    )
                )
        wf_raw = st_d.get("workforce") if isinstance(st_d.get("workforce"), dict) else {}
        store.workforce = WorkforceConfig(
            planned_headcount=max(0, int(wf_raw.get("planned_headcount", 6) or 0)),
            current_headcount=max(0, int(wf_raw.get("current_headcount", 6) or 0)),
            training_level=max(0.0, min(1.0, float(wf_raw.get("training_level", 0.5) or 0.0))),
            daily_turnover_rate=max(0.0, min(1.0, float(wf_raw.get("daily_turnover_rate", 0.002) or 0.0))),
            recruiting_enabled=bool(wf_raw.get("recruiting_enabled", False)),
            recruiting_daily_budget=max(0.0, float(wf_raw.get("recruiting_daily_budget", 0.0) or 0.0)),
            recruiting_lead_days=max(0, int(wf_raw.get("recruiting_lead_days", 7) or 0)),
            recruiting_hire_rate_per_100_budget=max(
                0.0, float(wf_raw.get("recruiting_hire_rate_per_100_budget", 0.20) or 0.0)
            ),
            planned_leave_rate=max(0.0, min(1.0, float(wf_raw.get("planned_leave_rate", 0.0) or 0.0))),
            unplanned_absence_rate=max(0.0, min(1.0, float(wf_raw.get("unplanned_absence_rate", 0.0) or 0.0))),
            planned_leave_rate_day=max(0.0, min(1.0, float(wf_raw.get("planned_leave_rate_day", 0.0) or 0.0))),
            planned_leave_rate_night=max(0.0, min(1.0, float(wf_raw.get("planned_leave_rate_night", 0.0) or 0.0))),
            sick_leave_rate_day=max(0.0, min(1.0, float(wf_raw.get("sick_leave_rate_day", 0.0) or 0.0))),
            sick_leave_rate_night=max(0.0, min(1.0, float(wf_raw.get("sick_leave_rate_night", 0.0) or 0.0))),
            shifts_per_day=max(1, int(wf_raw.get("shifts_per_day", 2) or 1)),
            staffing_per_shift=max(1, int(wf_raw.get("staffing_per_shift", 3) or 1)),
            shift_hours=max(1.0, float(wf_raw.get("shift_hours", 8.0) or 1.0)),
            overtime_shift_enabled=bool(wf_raw.get("overtime_shift_enabled", False)),
            overtime_shift_extra_capacity=max(0.0, float(wf_raw.get("overtime_shift_extra_capacity", 0.15) or 0.0)),
            overtime_shift_daily_cost=max(0.0, float(wf_raw.get("overtime_shift_daily_cost", 0.0) or 0.0)),
            skill_by_category={
                "wash": max(0.0, float(((wf_raw.get("skill_by_category") or {}).get("wash", 1.0)) or 0.0)),
                "maintenance": max(0.0, float(((wf_raw.get("skill_by_category") or {}).get("maintenance", 1.0)) or 0.0)),
                "detailing": max(0.0, float(((wf_raw.get("skill_by_category") or {}).get("detailing", 1.0)) or 0.0)),
                "other": max(0.0, float(((wf_raw.get("skill_by_category") or {}).get("other", 1.0)) or 0.0)),
            },
            shift_allocation_by_category={
                "wash": max(0.0, float(((wf_raw.get("shift_allocation_by_category") or {}).get("wash", 1.0)) or 0.0)),
                "maintenance": max(0.0, float(((wf_raw.get("shift_allocation_by_category") or {}).get("maintenance", 1.0)) or 0.0)),
                "detailing": max(0.0, float(((wf_raw.get("shift_allocation_by_category") or {}).get("detailing", 1.0)) or 0.0)),
                "other": max(0.0, float(((wf_raw.get("shift_allocation_by_category") or {}).get("other", 1.0)) or 0.0)),
            },
            skill_by_role={
                "技师": max(0.0, float(((wf_raw.get("skill_by_role") or {}).get("技师", 1.0)) or 0.0)),
                "店长": max(0.0, float(((wf_raw.get("skill_by_role") or {}).get("店长", 1.0)) or 0.0)),
                "销售": max(0.0, float(((wf_raw.get("skill_by_role") or {}).get("销售", 1.0)) or 0.0)),
                "客服": max(0.0, float(((wf_raw.get("skill_by_role") or {}).get("客服", 1.0)) or 0.0)),
            },
            shift_allocation_by_role={
                "技师": max(0.0, float(((wf_raw.get("shift_allocation_by_role") or {}).get("技师", 1.0)) or 0.0)),
                "店长": max(0.0, float(((wf_raw.get("shift_allocation_by_role") or {}).get("店长", 1.0)) or 0.0)),
                "销售": max(0.0, float(((wf_raw.get("shift_allocation_by_role") or {}).get("销售", 1.0)) or 0.0)),
                "客服": max(0.0, float(((wf_raw.get("shift_allocation_by_role") or {}).get("客服", 1.0)) or 0.0)),
            },
        )
        store.pending_hires = []
        ph_raw = st_d.get("pending_hires") or []
        if isinstance(ph_raw, list):
            for p in ph_raw:
                if not isinstance(p, dict):
                    continue
                store.pending_hires.append(
                    PendingHire(
                        qty=max(0, int(p.get("qty", 0) or 0)),
                        order_day=int(p.get("order_day", 0) or 0),
                        arrive_day=int(p.get("arrive_day", 0) or 0),
                    )
                )
        store.city = str(st_d.get("city", ""))
        store.district = str(st_d.get("district", ""))
        store.provider = str(st_d.get("provider", ""))
        store.status = str(st_d.get("status", "planning"))
        store.build_days_total = int(st_d.get("build_days_total", 0))
        store.operation_start_day = int(st_d.get("operation_start_day", 1))
        store.traffic_conversion_rate = float(st_d.get("traffic_conversion_rate", 1.0))
        store.local_competition_intensity = max(0.0, min(1.0, float(st_d.get("local_competition_intensity", 0.0) or 0.0)))
        store.attractiveness_index = max(0.5, min(1.5, float(st_d.get("attractiveness_index", 1.0) or 1.0)))
        store.labor_hour_price = float(st_d.get("labor_hour_price", 120.0))
        store.construction_days_remaining = int(st_d.get("construction_days_remaining", 0))
        store.capex_total = float(st_d.get("capex_total", 0.0))
        store.capex_spend_per_day = float(st_d.get("capex_spend_per_day", 0.0))
        store.capex_useful_life_days = int(st_d.get("capex_useful_life_days", 5 * 365))
        store.fixed_overhead_per_day = float(st_d.get("fixed_overhead_per_day", 0.0))
        store.strict_parts = bool(st_d.get("strict_parts", True))
        store.cash_balance = float(st_d.get("cash_balance", 0.0))
        store.finance_credit_used = max(0.0, float(st_d.get("finance_credit_used", 0.0) or 0.0))

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
        # Random events (applied on the day)
        "store_closed",
        "traffic_multiplier",
        "conversion_multiplier",
        "capacity_multiplier",
        "variable_cost_multiplier",
        "event_summary_json",
        "mitigation_cost",
        "mitigation_actions_json",
        "replenishment_cost",
        "replenishment_orders_json",
        "inbound_arrivals_json",
        "workforce_lost",
        "workforce_hired",
        "workforce_recruit_cost",
        "workforce_headcount_start",
        "workforce_headcount_end",
        "workforce_capacity_factor",
        "shift_coverage_ratio",
        "shift_overtime_cost",
        "workforce_leave_absent",
        "workforce_leave_planned",
        "workforce_leave_sick",
        "workforce_leave_cost",
        "workforce_breakdown_json",
        "finance_interest_allocated",
        "finance_capex_financed",
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
                    getattr(sr, "store_closed", False),
                    getattr(sr, "traffic_multiplier", 1.0),
                    getattr(sr, "conversion_multiplier", 1.0),
                    getattr(sr, "capacity_multiplier", 1.0),
                    getattr(sr, "variable_cost_multiplier", 1.0),
                    getattr(sr, "event_summary_json", "[]"),
                    getattr(sr, "mitigation_cost", 0.0),
                    getattr(sr, "mitigation_actions_json", "[]"),
                    getattr(sr, "replenishment_cost", 0.0),
                    getattr(sr, "replenishment_orders_json", "[]"),
                    getattr(sr, "inbound_arrivals_json", "[]"),
                    getattr(sr, "workforce_lost", 0),
                    getattr(sr, "workforce_hired", 0),
                    getattr(sr, "workforce_recruit_cost", 0.0),
                    getattr(sr, "workforce_headcount_start", 0),
                    getattr(sr, "workforce_headcount_end", 0),
                    getattr(sr, "workforce_capacity_factor", 1.0),
                    getattr(sr, "shift_coverage_ratio", 1.0),
                    getattr(sr, "shift_overtime_cost", 0.0),
                    getattr(sr, "workforce_leave_absent", 0),
                    getattr(sr, "workforce_leave_planned", 0),
                    getattr(sr, "workforce_leave_sick", 0),
                    getattr(sr, "workforce_leave_cost", 0.0),
                    getattr(sr, "workforce_breakdown_json", "{}"),
                    getattr(sr, "finance_interest_allocated", 0.0),
                    getattr(sr, "finance_capex_financed", 0.0),
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
