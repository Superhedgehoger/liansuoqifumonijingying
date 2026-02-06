from __future__ import annotations

import json
import math
import random
import zlib
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple, cast

from simgame.models import (
    ActiveEvent,
    DayResult,
    DayStoreResult,
    EventHistoryRecord,
    EventTemplate,
    GameState,
    InventoryItem,
    PendingHire,
    PendingInbound,
    ReplenishmentRule,
    ServiceLine,
    ServiceProject,
    Store,
)


def _clamp01(x: float) -> float:
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    return float(x)


def _normal(mean: float, std: float, rng: random.Random) -> float:
    mu = float(mean)
    sigma = max(0.0, float(std))
    if sigma <= 0:
        return mu
    return float(rng.gauss(mu, sigma))


def _poisson(lam: float, rng: random.Random) -> int:
    lam_f = max(0.0, float(lam))
    if lam_f <= 0.0:
        return 0
    # Knuth algorithm; efficient enough for small lambda.
    L = math.exp(-lam_f)
    k = 0
    p = 1.0
    while p > L:
        k += 1
        p *= rng.random()
    return max(0, k - 1)


def _supply_chain_reduction_rate(store: Store) -> float:
    bc = getattr(store, "biz_config", None)
    sc = getattr(bc, "supply_chain", None) if bc else None
    if not sc or not bool(getattr(sc, "enabled", False)):
        return 0.0
    return _clamp01(float(getattr(sc, "cost_reduction_rate", 0.0) or 0.0))


def simulate_value_added_services(
    store: Store, day: int, cfg: EngineConfig, rng: random.Random
) -> tuple[float, float, float, float, float, float, int]:
    """Return (rev_online, gp_online, rev_insurance, gp_insurance, rev_used_car, gp_used_car, used_car_count)."""

    bc = getattr(store, "biz_config", None)
    if not bc:
        return 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0

    rev_online = gp_online = 0.0
    rev_ins = gp_ins = 0.0
    rev_uc = gp_uc = 0.0
    cnt_uc = 0

    # Online business (pure retail)
    online = getattr(bc, "online", None)
    if online and bool(getattr(online, "enabled", False)):
        orders = int(
            round(
                max(
                    0.0,
                    _normal(
                        getattr(online, "daily_orders_mean", 2.0),
                        getattr(online, "daily_orders_std", 0.5),
                        rng,
                    ),
                )
            )
        )
        avg_ticket = max(0.0, float(getattr(online, "avg_ticket", 200.0) or 0.0))
        mr = _clamp01(float(getattr(online, "margin_rate", 0.15) or 0.0))
        rev_online = float(orders) * avg_ticket
        gp_online = rev_online * mr

    # Insurance agency
    ins = getattr(bc, "insurance", None)
    if ins and bool(getattr(ins, "enabled", False)):
        target = max(0.0, float(getattr(ins, "daily_revenue_target", 128.4) or 0.0))
        vol = max(0.0, float(getattr(ins, "volatility", 0.1) or 0.0))
        mr = _clamp01(float(getattr(ins, "margin_rate", 0.20) or 0.0))
        rev_ins = max(0.0, _normal(target, target * vol, rng))
        gp_ins = rev_ins * mr

    # Used car brokerage (Poisson)
    uc = getattr(bc, "used_car", None)
    if uc and bool(getattr(uc, "enabled", False)):
        month_len = max(1, int(getattr(cfg, "month_len_days", 30) or 30))
        monthly_target = max(0.0, float(getattr(uc, "monthly_deal_target", 1.56) or 0.0))
        lam = monthly_target / float(month_len)
        cnt_uc = int(_poisson(lam, rng))
        if cnt_uc > 0:
            rev_per = max(0.0, float(getattr(uc, "revenue_per_deal", 1200.0) or 0.0))
            gp_per = float(getattr(uc, "profit_per_deal", 600.0) or 0.0)
            rev_uc = float(cnt_uc) * rev_per
            gp_uc = float(cnt_uc) * gp_per

    return rev_online, gp_online, rev_ins, gp_ins, rev_uc, gp_uc, cnt_uc


def _daily_rent_cost(store: Store, cfg: EngineConfig) -> float:
    oc = getattr(store, "opex_config", None)
    rent = getattr(oc, "rent", None) if oc else None
    if not rent:
        return 0.0
    strategy = str(getattr(rent, "allocation_strategy", "daily") or "daily").strip().lower()
    monthly = max(0.0, float(getattr(rent, "monthly_cost", 0.0) or 0.0))
    if monthly <= 0:
        return 0.0
    if strategy == "daily":
        month_len = max(1, int(getattr(cfg, "month_len_days", 30) or 30))
        return monthly / float(month_len)
    # Unknown strategy: default to daily amortization
    month_len = max(1, int(getattr(cfg, "month_len_days", 30) or 30))
    return monthly / float(month_len)


def _daily_utilities_cost(store: Store, wash_orders: int, maint_orders: int) -> tuple[float, float]:
    oc = getattr(store, "opex_config", None)
    util = getattr(oc, "utilities", None) if oc else None
    if not util:
        return 0.0, 0.0

    w = max(0, int(wash_orders))
    m = max(0, int(maint_orders))

    water_per = max(0.0, float(getattr(util, "water_cost_per_wash", 0.0) or 0.0))
    elec_base = max(0.0, float(getattr(util, "elec_daily_base", 0.0) or 0.0))
    elec_w = max(0.0, float(getattr(util, "elec_cost_per_wash", 0.0) or 0.0))
    elec_m = max(0.0, float(getattr(util, "elec_cost_per_maint", 0.0) or 0.0))

    cost_water = float(w) * water_per
    cost_elec = elec_base + float(w) * elec_w + float(m) * elec_m
    return cost_water, cost_elec


@dataclass
class EngineConfig:
    month_len_days: int = 30
    hours_per_staff_per_day: float = 8.0


def _int_jitter(base: int, volatility: float, rng: random.Random) -> int:
    v = max(0.0, float(volatility))
    if base <= 0:
        return 0
    delta = int(round(base * v))
    return max(0, base + rng.randint(-delta, delta))


def _ensure_mtd_order_keys(store: Store) -> None:
    for sid in store.service_lines.keys():
        store.mtd_orders_by_service.setdefault(sid, 0)
    for pid in store.projects.keys():
        store.mtd_orders_by_project.setdefault(pid, 0)


def _role_headcount(store: Store, role: str) -> int:
    rp = store.payroll.roles.get(role)
    if not rp:
        return 0
    return max(0, int(rp.headcount))


def _role_capacity_factor(store: Store, role: str) -> float:
    wf = getattr(store, "workforce", None)
    if wf is None:
        return 1.0
    s = float((getattr(wf, "skill_by_role", {}) or {}).get(str(role), 1.0) or 1.0)
    a = float((getattr(wf, "shift_allocation_by_role", {}) or {}).get(str(role), 1.0) or 1.0)
    return max(0.2, min(2.0, s * a))


def _service_effective_capacity(store: Store, line: ServiceLine, cfg: EngineConfig, capacity_multiplier: float = 1.0) -> int:
    cap = max(0, int(line.capacity_per_day))
    if not line.labor_role or line.labor_hours_per_order <= 0:
        return cap
    hc = _role_headcount(store, line.labor_role)
    if hc <= 0:
        return 0
    role_factor = _role_capacity_factor(store, str(line.labor_role))
    hours = float(hc) * float(cfg.hours_per_staff_per_day) * float(role_factor)
    derived = int(hours // float(line.labor_hours_per_order))
    out = max(0, min(cap, derived))
    out = int(round(float(out) * max(0.0, float(capacity_multiplier))))
    return max(0, out)


def _to_jsonable(x: object) -> object:
    if isinstance(x, tuple):
        return [_to_jsonable(v) for v in x]
    if isinstance(x, list):
        return [_to_jsonable(v) for v in x]
    if isinstance(x, dict):
        return {str(k): _to_jsonable(v) for k, v in x.items()}
    return x


def _to_tuple(x: object) -> object:
    if isinstance(x, list):
        return tuple(_to_tuple(v) for v in x)
    if isinstance(x, dict):
        return {k: _to_tuple(v) for k, v in x.items()}
    return x


def _rng_from_state(state: GameState) -> random.Random:
    rng = random.Random()
    seed = int(getattr(state, "rng_seed", 20260101) or 20260101)
    st = getattr(state, "rng_state", None)
    if st is not None:
        try:
            rng.setstate(cast(tuple[Any, ...], _to_tuple(st)))
            return rng
        except Exception:
            pass
    rng.seed(seed)
    return rng


def _persist_rng_state(state: GameState, rng: random.Random) -> None:
    try:
        state.rng_state = _to_jsonable(rng.getstate())
    except Exception:
        state.rng_state = None


def _stable_u32(s: str) -> int:
    """Return a stable unsigned 32-bit hash for seeding.

    Python's built-in hash() is randomized per process; avoid it for reproducibility.
    """

    return int(zlib.crc32(s.encode("utf-8")) & 0xFFFFFFFF)


def _event_cooldown_key(template_id: str, scope: str, target_id: str) -> str:
    return f"{template_id}:{scope}:{target_id}"


def _event_is_active_on_day(ev: ActiveEvent, day: int) -> bool:
    return int(ev.start_day) <= int(day) <= int(ev.end_day)


def _apply_severity_range(min_v: float, max_v: float, severity: float, worse_is_lower: bool) -> float:
    lo = float(min_v)
    hi = float(max_v)
    if hi < lo:
        lo, hi = hi, lo
    s = _clamp01(float(severity))
    if worse_is_lower:
        # 0 -> best (hi), 1 -> worst (lo)
        return hi - s * (hi - lo)
    # 0 -> best (lo), 1 -> worst (hi)
    return lo + s * (hi - lo)


def _new_active_event(
    template: EventTemplate,
    scope: str,
    target_id: str,
    day: int,
    cfg: EngineConfig,
    rng: random.Random,
) -> tuple[ActiveEvent, EventHistoryRecord]:
    dmin = max(1, int(template.duration_days_min))
    dmax = max(dmin, int(template.duration_days_max))
    duration = rng.randint(dmin, dmax)

    imin = float(template.intensity_min)
    imax = float(template.intensity_max)
    if imax < imin:
        imin, imax = imax, imin
    intensity = float(rng.uniform(imin, imax))
    severity = _clamp01(intensity)

    traffic_mult = _apply_severity_range(template.traffic_multiplier_min, template.traffic_multiplier_max, severity, True)
    conv_mult = _apply_severity_range(template.conversion_multiplier_min, template.conversion_multiplier_max, severity, True)
    cap_mult = _apply_severity_range(template.capacity_multiplier_min, template.capacity_multiplier_max, severity, True)
    var_cost_mult = _apply_severity_range(
        template.variable_cost_multiplier_min, template.variable_cost_multiplier_max, severity, False
    )

    eid = f"EV{int(day):06d}_{rng.getrandbits(32):08x}"
    start_day = int(day)
    end_day = int(day) + int(duration) - 1

    ev = ActiveEvent(
        event_id=eid,
        template_id=template.template_id,
        name=template.name,
        event_type=template.event_type,
        scope=scope,
        target_id=str(target_id or ""),
        start_day=start_day,
        end_day=end_day,
        intensity=float(intensity),
        store_closed=bool(template.store_closed),
        traffic_multiplier=float(traffic_mult),
        conversion_multiplier=float(conv_mult),
        capacity_multiplier=float(cap_mult),
        variable_cost_multiplier=float(var_cost_mult),
    )
    hist = EventHistoryRecord(
        event_id=eid,
        template_id=template.template_id,
        name=template.name,
        event_type=template.event_type,
        scope=scope,
        target_id=str(target_id or ""),
        start_day=start_day,
        end_day=end_day,
        created_day=int(day),
        intensity=float(intensity),
        store_closed=bool(template.store_closed),
        traffic_multiplier=float(traffic_mult),
        conversion_multiplier=float(conv_mult),
        capacity_multiplier=float(cap_mult),
        variable_cost_multiplier=float(var_cost_mult),
    )
    return ev, hist


def _events_day_start(state: GameState, cfg: EngineConfig, rng: random.Random) -> None:
    day = int(state.day)

    # Remove expired events
    state.active_events = [ev for ev in state.active_events if int(ev.end_day) >= day]

    # Trigger new events
    for tmpl in state.event_templates.values():
        if not bool(getattr(tmpl, "enabled", False)):
            continue
        prob = float(getattr(tmpl, "daily_probability", 0.0) or 0.0)
        if prob <= 0:
            continue
        if rng.random() >= prob:
            continue

        scope = str(getattr(tmpl, "scope", "store") or "store")
        strategy = str(getattr(tmpl, "target_strategy", "random_one") or "random_one")

        targets: list[str] = []
        if scope == "global":
            targets = [""]
        elif scope == "station":
            if not state.stations:
                continue
            if strategy == "all":
                targets = list(state.stations.keys())
            else:
                targets = [rng.choice(list(state.stations.keys()))]
        else:  # store
            if not state.stores:
                continue
            if strategy == "all":
                targets = list(state.stores.keys())
            else:
                targets = [rng.choice(list(state.stores.keys()))]

        for target_id in targets:
            key = _event_cooldown_key(tmpl.template_id, scope, str(target_id))
            next_ok = int(state.event_cooldowns.get(key, 1) or 1)
            if day < next_ok:
                continue
            ev, hist = _new_active_event(tmpl, scope=scope, target_id=str(target_id), day=day, cfg=cfg, rng=rng)
            state.active_events.append(ev)
            state.event_history.append(hist)
            # Keep history bounded
            if len(state.event_history) > 5000:
                state.event_history = state.event_history[-5000:]

            cd = max(0, int(getattr(tmpl, "cooldown_days", 0) or 0))
            state.event_cooldowns[key] = int(ev.end_day) + cd + 1


def combine_event_effects_for_store(
    state: GameState, store: Store
) -> tuple[bool, float, float, float, float, list[dict]]:
    day = int(state.day)
    traffic_m = 1.0
    conv_m = 1.0
    cap_m = 1.0
    var_cost_m = 1.0
    closed = False
    summary: list[dict] = []

    for ev in state.active_events:
        if not _event_is_active_on_day(ev, day):
            continue
        applies = False
        if ev.scope == "global":
            applies = True
        elif ev.scope == "station":
            applies = (store.station_id == ev.target_id)
        elif ev.scope == "store":
            applies = (store.store_id == ev.target_id)

        if not applies:
            continue

        closed = closed or bool(ev.store_closed)
        traffic_m *= float(ev.traffic_multiplier)
        conv_m *= float(ev.conversion_multiplier)
        cap_m *= float(ev.capacity_multiplier)
        var_cost_m *= float(ev.variable_cost_multiplier)

        summary.append(
            {
                "event_id": ev.event_id,
                "template_id": ev.template_id,
                "name": ev.name,
                "type": ev.event_type,
                "scope": ev.scope,
                "target_id": ev.target_id,
                "start_day": int(ev.start_day),
                "end_day": int(ev.end_day),
                "closed": bool(ev.store_closed),
                "traffic": float(ev.traffic_multiplier),
                "conversion": float(ev.conversion_multiplier),
                "capacity": float(ev.capacity_multiplier),
                "var_cost": float(ev.variable_cost_multiplier),
            }
        )

    # Clamp combined multipliers to avoid runaway.
    traffic_m = max(0.1, min(2.0, float(traffic_m)))
    conv_m = max(0.1, min(2.0, float(conv_m)))
    cap_m = max(0.0, min(2.0, float(cap_m)))
    var_cost_m = max(0.5, min(5.0, float(var_cost_m)))

    return closed, traffic_m, conv_m, cap_m, var_cost_m, summary


def inject_event_from_template(
    state: GameState,
    template_id: str,
    scope: str,
    target_id: str,
    start_day: int,
    duration_days: int,
    intensity: Optional[float] = None,
) -> ActiveEvent:
    tmpl = state.event_templates.get(template_id)
    if tmpl is None:
        raise ValueError(f"unknown template_id: {template_id}")

    seed = int(getattr(state, "rng_seed", 20260101) or 20260101)
    seed ^= int(start_day)
    seed ^= _stable_u32(str(template_id or ""))
    seed ^= _stable_u32(str(scope or ""))
    seed ^= _stable_u32(str(target_id or ""))
    rr = random.Random(seed)
    ev, hist = _new_active_event(tmpl, scope=scope, target_id=target_id, day=start_day, cfg=EngineConfig(), rng=rr)

    # Override duration/intensity deterministically.
    if duration_days > 0:
        ev.start_day = int(start_day)
        ev.end_day = int(start_day) + int(duration_days) - 1
        hist.start_day = ev.start_day
        hist.end_day = ev.end_day
    if intensity is not None:
        sev = _clamp01(float(intensity))
        ev.intensity = float(intensity)
        hist.intensity = float(intensity)
        # Recompute multipliers from template with this severity.
        ev.traffic_multiplier = _apply_severity_range(tmpl.traffic_multiplier_min, tmpl.traffic_multiplier_max, sev, True)
        ev.conversion_multiplier = _apply_severity_range(
            tmpl.conversion_multiplier_min, tmpl.conversion_multiplier_max, sev, True
        )
        ev.capacity_multiplier = _apply_severity_range(tmpl.capacity_multiplier_min, tmpl.capacity_multiplier_max, sev, True)
        ev.variable_cost_multiplier = _apply_severity_range(
            tmpl.variable_cost_multiplier_min, tmpl.variable_cost_multiplier_max, sev, False
        )
        hist.traffic_multiplier = float(ev.traffic_multiplier)
        hist.conversion_multiplier = float(ev.conversion_multiplier)
        hist.capacity_multiplier = float(ev.capacity_multiplier)
        hist.variable_cost_multiplier = float(ev.variable_cost_multiplier)

    state.active_events.append(ev)
    state.event_history.append(hist)
    if len(state.event_history) > 5000:
        state.event_history = state.event_history[-5000:]

    key = _event_cooldown_key(tmpl.template_id, scope, target_id)
    cd = max(0, int(getattr(tmpl, "cooldown_days", 0) or 0))
    state.event_cooldowns[key] = int(ev.end_day) + cd + 1
    return ev


def _apply_consumable_limit(
    store: Store,
    line: ServiceLine,
    desired_orders: int,
) -> Tuple[int, float]:
    """Return (feasible_orders, consumable_cogs)."""

    if desired_orders <= 0:
        return 0, 0.0

    if not line.consumable_sku or line.consumable_units_per_order <= 0:
        return desired_orders, 0.0

    item = store.inventory.get(line.consumable_sku)
    if item is None:
        # No consumables -> cannot fulfill
        return 0, 0.0

    need_units = desired_orders * line.consumable_units_per_order
    if item.qty <= 0:
        return 0, 0.0

    if need_units <= item.qty:
        item.qty -= need_units
        return desired_orders, need_units * item.unit_cost

    feasible = int(item.qty // line.consumable_units_per_order)
    feasible = max(0, feasible)
    used_units = feasible * line.consumable_units_per_order
    item.qty -= used_units
    return feasible, used_units * item.unit_cost


def _weighted_choice(pairs: List[Tuple[str, float]], rng: random.Random) -> str:
    total = sum(max(0.0, float(w)) for _, w in pairs)
    if total <= 0:
        return pairs[0][0]
    r = rng.random() * total
    upto = 0.0
    for k, w in pairs:
        w2 = max(0.0, float(w))
        upto += w2
        if upto >= r:
            return k
    return pairs[-1][0]


def _apply_parts_limit(store: Store, project: ServiceProject, desired_orders: int) -> Tuple[int, float]:
    """Return (feasible_orders, parts_cogs)."""
    if desired_orders <= 0:
        return 0, 0.0
    if not project.parts:
        return desired_orders, 0.0

    # Determine maximum feasible by each required part
    feasible = desired_orders
    for sku, per_order_qty in project.parts.items():
        if per_order_qty <= 0:
            continue
        item = store.inventory.get(sku)
        if item is None or item.qty <= 0:
            return 0, 0.0
        feasible = min(feasible, int(item.qty // float(per_order_qty)))
        if feasible <= 0:
            return 0, 0.0

    parts_cogs = 0.0
    for sku, per_order_qty in project.parts.items():
        if per_order_qty <= 0:
            continue
        item = store.inventory[sku]
        used = float(feasible) * float(per_order_qty)
        item.qty -= used
        parts_cogs += used * float(item.unit_cost)

    return feasible, parts_cogs


def _compute_labor_cost(
    store: Store,
    orders_by_service: Dict[str, int],
    revenue_by_service: Dict[str, float],
    gross_profit_by_service: Dict[str, float],
    orders_by_project: Dict[str, int],
    gross_profit_by_project: Dict[str, float],
    revenue_by_category: Dict[str, float],
    gross_profit_by_category: Dict[str, float],
    labor_revenue: float,
    parts_revenue: float,
    parts_gross_profit: float,
    is_month_end: bool,
) -> float:
    total = 0.0

    def _pick_base(base: str, revenue_value: float, gross_profit_value: float) -> float:
        b = (base or "revenue").strip().lower()
        if b == "gross_profit":
            return max(0.0, float(gross_profit_value))
        return max(0.0, float(revenue_value))

    revenue_total = sum(float(v) for v in revenue_by_category.values())

    for role, plan in store.payroll.roles.items():
        if plan.headcount <= 0:
            continue

        # Base pay is treated as fixed daily cost.
        total += plan.base_daily()

        # Broad sales commission (revenue-based)
        if plan.sales_commission_rate:
            total += max(0.0, revenue_total) * max(0.0, float(plan.sales_commission_rate))

        # Category commissions (revenue or gross profit)
        if getattr(plan, "wash_commission_rate", 0.0):
            base_value = _pick_base(
                getattr(plan, "wash_commission_base", "revenue"),
                revenue_by_category.get("wash", 0.0),
                gross_profit_by_category.get("wash", 0.0),
            )
            total += base_value * max(0.0, float(getattr(plan, "wash_commission_rate", 0.0)))
        if getattr(plan, "maintenance_commission_rate", 0.0):
            base_value = _pick_base(
                getattr(plan, "maintenance_commission_base", "revenue"),
                revenue_by_category.get("maintenance", 0.0),
                gross_profit_by_category.get("maintenance", 0.0),
            )
            total += base_value * max(0.0, float(getattr(plan, "maintenance_commission_rate", 0.0)))
        if getattr(plan, "detailing_commission_rate", 0.0):
            base_value = _pick_base(
                getattr(plan, "detailing_commission_base", "revenue"),
                revenue_by_category.get("detailing", 0.0),
                gross_profit_by_category.get("detailing", 0.0),
            )
            total += base_value * max(0.0, float(getattr(plan, "detailing_commission_rate", 0.0)))

        # Broad labor/parts commissions (projects)
        if getattr(plan, "labor_commission_rate", 0.0):
            total += max(0.0, float(labor_revenue)) * max(0.0, float(getattr(plan, "labor_commission_rate", 0.0)))
        if getattr(plan, "parts_commission_rate", 0.0):
            parts_base = _pick_base(
                getattr(plan, "parts_commission_base", "revenue"),
                parts_revenue,
                parts_gross_profit,
            )
            total += parts_base * max(0.0, float(getattr(plan, "parts_commission_rate", 0.0)))

        # Piece rate by service
        for sid, orders in orders_by_service.items():
            rate = plan.piece_rate.get(sid, 0.0)
            if rate:
                total += float(orders) * float(rate) * float(plan.headcount)

        # Piece rate by project
        for pid, orders in orders_by_project.items():
            rate = plan.piece_rate_project.get(pid, 0.0)
            if rate:
                total += float(orders) * float(rate) * float(plan.headcount)

        # Sales commission (revenue)
        for sid, rev in revenue_by_service.items():
            r = plan.sales_commission_by_service.get(sid, 0.0)
            if r:
                total += float(rev) * float(r)

        # Gross profit commission (service)
        for sid, gp in gross_profit_by_service.items():
            r = plan.gross_profit_commission_by_service.get(sid, 0.0)
            if r:
                total += max(0.0, float(gp)) * float(r)

        # Gross profit commission (project)
        for pid, gp in gross_profit_by_project.items():
            r = plan.gross_profit_commission_by_project.get(pid, 0.0)
            if r:
                total += max(0.0, float(gp)) * float(r)

        # Tier bonus evaluated monthly, paid at month-end.
        if is_month_end and plan.monthly_tier_bonus:
            # Total orders in month (all services) as a simple proxy
            mtd_orders_total = sum(store.mtd_orders_by_service.values())
            best = 0.0
            for threshold, bonus in plan.monthly_tier_bonus:
                if mtd_orders_total >= int(threshold):
                    best = max(best, float(bonus))
            total += best * float(plan.headcount)

        # Profit share evaluated monthly, paid at month-end.
        if is_month_end and plan.profit_share_rate:
            # Apply on store MTD operating profit; do not pay on negative.
            profit = max(0.0, float(store.mtd_operating_profit))
            total += profit * float(plan.profit_share_rate)

    return total


def _depreciation_cost(store: Store, day: int) -> float:
    return sum(a.depreciation_on_day(day) for a in store.assets)


def _orders_for_store(
    store: Store,
    fuel_traffic: int,
    visitor_traffic: int,
    cfg: EngineConfig,
    conversion_multiplier: float = 1.0,
    capacity_multiplier: float = 1.0,
    category_capacity_factors: Dict[str, float] | None = None,
) -> Dict[str, int]:
    """Compute feasible orders per service line.

    Rules:
    - Demand is driven by station traffic.
    - Each vehicle can at most buy one service; if raw demand exceeds traffic,
      scale down proportionally.
    - Apply per-line capacity.
    - Apply consumable limits.
    """

    if store.status != "open" or not store.service_lines:
        return {}

    # Not started operating yet
    op_day = int(getattr(store, "operation_start_day", 1) or 1)
    if op_day > 0 and cfg is not None:
        # state.day is passed elsewhere; here we can't see it, so caller should guard.
        pass

    traffic_total = max(0, int(fuel_traffic) + int(visitor_traffic))
    if traffic_total <= 0:
        return {}

    raw: Dict[str, float] = {}
    comp = max(0.0, min(1.0, float(getattr(store, "local_competition_intensity", 0.0) or 0.0)))
    attract = float(getattr(store, "attractiveness_index", 1.0) or 1.0)
    attract = max(0.5, min(1.5, attract))
    # Competitor diversion model (P1):
    # - stronger competition reduces capture
    # - store attractiveness partially offsets diversion
    competition_factor = max(0.2, min(1.5, (1.0 - 0.7 * comp) * attract))

    for sid, line in store.service_lines.items():
        mult = float(getattr(store, "traffic_conversion_rate", 1.0) or 1.0) * max(0.0, float(conversion_multiplier))
        if mult < 0:
            mult = 0.0
        raw_orders = (
            fuel_traffic * line.conversion_from_fuel + visitor_traffic * line.conversion_from_visitor
        ) * mult * competition_factor
        raw[sid] = max(0.0, float(raw_orders))

    raw_total = sum(raw.values())
    if raw_total <= 0:
        return {}

    scale = 1.0
    if raw_total > traffic_total:
        scale = traffic_total / raw_total

    desired_int: Dict[str, int] = {}
    for sid, line in store.service_lines.items():
        desired = int(round(raw[sid] * scale))
        cat = str(getattr(line, "category", "other") or "other")
        cat_factor = 1.0
        if category_capacity_factors is not None:
            cat_factor = max(0.0, float(category_capacity_factors.get(cat, 1.0) or 1.0))
        eff_cap = _service_effective_capacity(
            store,
            line,
            cfg=cfg,
            capacity_multiplier=float(capacity_multiplier) * float(cat_factor),
        )
        desired = max(0, min(int(eff_cap), desired))
        desired_int[sid] = desired

    # Apply consumables; if inventory is insufficient, orders shrink.
    feasible: Dict[str, int] = {}
    for sid, line in store.service_lines.items():
        qty, _ = _apply_consumable_limit(store, line, desired_int.get(sid, 0))
        feasible[sid] = qty

    return feasible


def _generate_projects_for_service_line(
    store: Store,
    line: ServiceLine,
    orders: int,
    parts_cost_reduction_rate: float = 0.0,
    rng: random.Random | None = None,
) -> Tuple[Dict[str, int], float, float, float, Dict[str, float]]:
    """Return (orders_by_project, revenue, parts_cogs, project_variable_cost, parts_cogs_by_project).

    For each order, pick a project according to ``line.project_mix``.
    Parts COGS are deducted from inventory if ``store.strict_parts`` is True.
    If ``store.strict_parts`` is False, missing inventory will be approximated via
    ``line.parts_cost_ratio``.
    """

    if orders <= 0:
        return {}, 0.0, 0.0, 0.0, {}
    if not line.project_mix:
        return (
            {},
            float(orders) * float(line.price),
            float(orders) * float(line.price) * float(line.parts_cost_ratio),
            0.0,
            {},
        )

    counts: Dict[str, int] = {}
    revenue = 0.0
    parts_cogs = 0.0
    project_variable_cost = 0.0
    parts_cogs_by_project: Dict[str, float] = {}

    rr = rng or random.Random()
    for _ in range(int(orders)):
        pid = _weighted_choice(line.project_mix, rr)
        counts[pid] = counts.get(pid, 0) + 1

    red = _clamp01(float(parts_cost_reduction_rate or 0.0))

    for pid, cnt in counts.items():
        proj = store.projects.get(pid)
        if proj is None:
            # Fallback to service line pricing
            revenue += float(cnt) * float(line.price)
            parts_cogs += float(cnt) * float(line.price) * float(line.parts_cost_ratio)
            continue

        revenue += float(cnt) * float(proj.price)
        project_variable_cost += float(cnt) * float(proj.variable_cost)
        if store.strict_parts:
            feasible, cogs = _apply_parts_limit(store, proj, int(cnt))
            if feasible < int(cnt):
                # Reduce revenue for unfulfilled work
                revenue -= float(int(cnt) - feasible) * float(proj.price)
                project_variable_cost -= float(int(cnt) - feasible) * float(proj.variable_cost)
                counts[pid] = feasible
            cogs2 = float(cogs)
            if red > 0:
                cogs2 *= 1.0 - red
            parts_cogs += cogs2
            parts_cogs_by_project[pid] = parts_cogs_by_project.get(pid, 0.0) + float(cogs2)
        else:
            cogs2 = float(cnt) * float(proj.price) * float(line.parts_cost_ratio)
            if red > 0:
                cogs2 *= 1.0 - red
            parts_cogs += cogs2
            parts_cogs_by_project[pid] = parts_cogs_by_project.get(pid, 0.0) + float(cogs2)

    # Remove any zero-count projects
    counts = {k: v for k, v in counts.items() if v > 0}
    return counts, revenue, parts_cogs, project_variable_cost, parts_cogs_by_project


def _process_pending_inbounds(store: Store, day: int) -> list[dict]:
    arrivals: list[dict] = []
    remaining: list[PendingInbound] = []
    for p in list(getattr(store, "pending_inbounds", []) or []):
        if int(getattr(p, "arrive_day", 0) or 0) <= int(day):
            sku = str(getattr(p, "sku", "") or "")
            if not sku:
                continue
            qty = max(0.0, float(getattr(p, "qty", 0.0) or 0.0))
            if qty <= 0:
                continue
            name = str(getattr(p, "name", sku) or sku)
            unit_cost = max(0.0, float(getattr(p, "unit_cost", 0.0) or 0.0))
            item = store.inventory.get(sku)
            if item is None:
                store.inventory[sku] = InventoryItem(sku=sku, name=name, unit_cost=unit_cost, qty=qty)
            else:
                if item.qty + qty > 0:
                    item.unit_cost = (item.unit_cost * item.qty + unit_cost * qty) / (item.qty + qty)
                item.qty += qty
                if name:
                    item.name = name
            arrivals.append(
                {
                    "sku": sku,
                    "name": name,
                    "qty": float(round(qty, 4)),
                    "unit_cost": float(round(unit_cost, 4)),
                    "arrive_day": int(day),
                }
            )
        else:
            remaining.append(p)
    store.pending_inbounds = remaining
    return arrivals


def _auto_replenish(state: GameState, store: Store, day: int) -> tuple[float, list[dict]]:
    if not bool(getattr(store, "auto_replenishment_enabled", False)):
        return 0.0, []

    rules: Dict[str, ReplenishmentRule] = getattr(store, "replenishment_rules", {}) or {}
    if not rules:
        return 0.0, []

    total_cost = 0.0
    orders: list[dict] = []
    pending: list[PendingInbound] = list(getattr(store, "pending_inbounds", []) or [])

    for sku, rule in rules.items():
        if not bool(getattr(rule, "enabled", True)):
            continue
        sku_s = str(getattr(rule, "sku", sku) or sku)
        item = store.inventory.get(sku_s)
        qty_now = float(item.qty if item else 0.0)
        on_order = 0.0
        for p in pending:
            if str(getattr(p, "sku", "") or "") == sku_s:
                on_order += max(0.0, float(getattr(p, "qty", 0.0) or 0.0))

        reorder_point = max(0.0, float(getattr(rule, "reorder_point", 0.0) or 0.0))
        safety_stock = max(0.0, float(getattr(rule, "safety_stock", 0.0) or 0.0))
        target_stock = max(safety_stock, float(getattr(rule, "target_stock", 0.0) or 0.0))
        effective = qty_now + on_order

        if effective > reorder_point:
            continue

        need_qty = max(0.0, target_stock - effective)
        if need_qty <= 0:
            continue

        unit_cost = max(0.0, float(getattr(rule, "unit_cost", 0.0) or 0.0))
        if unit_cost <= 0 and item is not None:
            unit_cost = max(0.0, float(item.unit_cost))
        if unit_cost <= 0:
            continue

        est_cost = need_qty * unit_cost
        actual_cost = min(max(0.0, float(state.cash)), est_cost)
        if actual_cost <= 0:
            continue
        buy_qty = actual_cost / unit_cost
        if buy_qty <= 0:
            continue

        lead_days = max(0, int(getattr(rule, "lead_time_days", 0) or 0))
        arrive_day = int(day) + lead_days
        inbound = PendingInbound(
            sku=sku_s,
            name=str(getattr(rule, "name", "") or (item.name if item else sku_s)),
            qty=buy_qty,
            unit_cost=unit_cost,
            order_day=int(day),
            arrive_day=arrive_day,
        )
        pending.append(inbound)
        total_cost += actual_cost

        orders.append(
            {
                "sku": sku_s,
                "qty": float(round(buy_qty, 4)),
                "unit_cost": float(round(unit_cost, 4)),
                "order_day": int(day),
                "arrive_day": int(arrive_day),
                "cash_out": float(round(actual_cost, 4)),
            }
        )

    store.pending_inbounds = pending
    return total_cost, orders


def _process_pending_hires(store: Store, day: int) -> int:
    hired = 0
    remain = []
    for p in list(getattr(store, "pending_hires", []) or []):
        qty = max(0, int(getattr(p, "qty", 0) or 0))
        if int(getattr(p, "arrive_day", 0) or 0) <= int(day):
            hired += qty
        else:
            remain.append(p)
    store.pending_hires = remain
    return hired


def _sample_turnover(headcount: int, rate: float, rng: random.Random) -> int:
    hc = max(0, int(headcount))
    p = max(0.0, min(1.0, float(rate)))
    out = 0
    for _ in range(hc):
        if rng.random() < p:
            out += 1
    return out


def _workforce_daily(store: Store, day: int, rng: random.Random) -> tuple[int, int, float, float, float, float]:
    wf = getattr(store, "workforce", None)
    if wf is None:
        return 0, 0, 0.0, 1.0, 1.0, 0.0

    current = max(0, int(getattr(wf, "current_headcount", 0) or 0))
    planned = max(1, int(getattr(wf, "planned_headcount", current if current > 0 else 1) or 1))
    training = max(0.0, min(1.0, float(getattr(wf, "training_level", 0.5) or 0.0)))

    hired = _process_pending_hires(store, day)
    current += hired

    lost = _sample_turnover(current, float(getattr(wf, "daily_turnover_rate", 0.0) or 0.0), rng)
    current = max(0, current - lost)

    recruit_cost = 0.0
    if bool(getattr(wf, "recruiting_enabled", False)) and current < planned:
        budget = max(0.0, float(getattr(wf, "recruiting_daily_budget", 0.0) or 0.0))
        if budget > 0:
            recruit_cost = budget
            hire_lambda = (budget / 100.0) * max(
                0.0, float(getattr(wf, "recruiting_hire_rate_per_100_budget", 0.20) or 0.0)
            )
            hire_qty = _poisson(hire_lambda, rng)
            if hire_qty > 0:
                lead = max(0, int(getattr(wf, "recruiting_lead_days", 7) or 0))
                store.pending_hires.append(PendingHire(qty=hire_qty, order_day=int(day), arrive_day=int(day) + lead))

    wf.current_headcount = current

    # Capacity factor from staffing gap and training.
    staffing_ratio = float(current) / float(planned)
    base_factor = max(0.4, min(1.3, staffing_ratio * (0.8 + 0.4 * training)))

    # Shift coverage factor (P3-next)
    shifts = max(1, int(getattr(wf, "shifts_per_day", 2) or 1))
    staffing = max(1, int(getattr(wf, "staffing_per_shift", 3) or 1))
    required = float(shifts * staffing)
    coverage = min(1.2, float(current) / required)
    overtime_cost = 0.0
    if coverage < 1.0 and bool(getattr(wf, "overtime_shift_enabled", False)):
        extra = max(0.0, float(getattr(wf, "overtime_shift_extra_capacity", 0.15) or 0.0))
        coverage = min(1.2, coverage + extra)
        overtime_cost = max(0.0, float(getattr(wf, "overtime_shift_daily_cost", 0.0) or 0.0))

    factor = max(0.3, min(1.4, base_factor * max(0.3, coverage)))
    return lost, hired, recruit_cost, factor, coverage, overtime_cost


def _workforce_category_capacity_factors(store: Store) -> Dict[str, float]:
    wf = getattr(store, "workforce", None)
    if wf is None:
        return {"wash": 1.0, "maintenance": 1.0, "detailing": 1.0, "other": 1.0}
    skills = getattr(wf, "skill_by_category", {}) or {}
    alloc = getattr(wf, "shift_allocation_by_category", {}) or {}
    out: Dict[str, float] = {}
    for cat in ("wash", "maintenance", "detailing", "other"):
        s = max(0.0, float(skills.get(cat, 1.0) or 0.0))
        a = max(0.0, float(alloc.get(cat, 1.0) or 0.0))
        out[cat] = max(0.2, min(2.0, s * a))
    return out


def _workforce_role_capacity_factors(store: Store) -> Dict[str, float]:
    wf = getattr(store, "workforce", None)
    if wf is None:
        return {"技师": 1.0, "店长": 1.0, "销售": 1.0, "客服": 1.0}
    skills = getattr(wf, "skill_by_role", {}) or {}
    alloc = getattr(wf, "shift_allocation_by_role", {}) or {}
    out: Dict[str, float] = {}
    for role in ("技师", "店长", "销售", "客服"):
        s = max(0.0, float(skills.get(role, 1.0) or 0.0))
        a = max(0.0, float(alloc.get(role, 1.0) or 0.0))
        out[role] = max(0.2, min(2.0, s * a))
    return out


def _apply_hq_finance(state: GameState, day_result: DayResult) -> None:
    used = max(0.0, float(getattr(state, "hq_credit_used", 0.0) or 0.0))
    rate = max(0.0, float(getattr(state, "hq_daily_interest_rate", 0.0) or 0.0))
    if used > 0 and rate > 0:
        interest = used * rate
        state.cash -= interest
        day_result.finance_interest_cost = float(interest)
        day_result.total_net_cashflow -= float(interest)

    if bool(getattr(state, "hq_auto_finance", False)):
        limit = max(0.0, float(getattr(state, "hq_credit_limit", 0.0) or 0.0))
        used = max(0.0, float(getattr(state, "hq_credit_used", 0.0) or 0.0))
        room = max(0.0, limit - used)
        if state.cash < 0 and room > 0:
            draw = min(room, -float(state.cash))
            state.cash += draw
            state.hq_credit_used = used + draw
            day_result.finance_credit_draw = float(draw)

        used = max(0.0, float(getattr(state, "hq_credit_used", 0.0) or 0.0))
        if state.cash > 0 and used > 0:
            repay = min(used, float(state.cash) * 0.30)
            if repay > 0:
                state.cash -= repay
                state.hq_credit_used = used - repay
                day_result.finance_credit_repay = float(repay)


def simulate_day(state: GameState, cfg: EngineConfig) -> DayResult:
    rng = _rng_from_state(state)

    # Random events: day start settlement
    _events_day_start(state, cfg=cfg, rng=rng)

    is_month_end = state.month_day_index(cfg.month_len_days) == cfg.month_len_days

    day_result = DayResult(day=state.day)

    for store in state.stores.values():
        station = state.stations.get(store.station_id)
        if station is None:
            continue

        sr = DayStoreResult(
            store_id=store.store_id,
            store_name=store.name,
            station_id=store.station_id,
            status=store.status,
        )

        # Construction spend
        if store.status == "constructing":
            spend = max(0.0, float(store.capex_spend_per_day))
            if spend > 0:
                actual = min(state.cash, spend)
                state.cash -= actual
                sr.cash_out += actual
                store.cash_balance -= actual
            store.construction_days_remaining = max(0, int(store.construction_days_remaining) - 1)
            if store.construction_days_remaining <= 0:
                store.status = "open"
                # Put the capex into service as a depreciable asset.
                if store.capex_total > 0:
                    useful = int(getattr(store, "capex_useful_life_days", 5 * 365))
                    if useful <= 0:
                        useful = 5 * 365
                    from simgame.models import Asset

                    store.assets.append(
                        Asset(
                            name=f"{store.name}-CAPEX",
                            capex=float(store.capex_total),
                            useful_life_days=useful,
                            in_service_day=state.day,
                        )
                    )

        # Closed/planning has no ops
        if store.status != "open":
            sr.net_cashflow = sr.cash_in - sr.cash_out
            day_result.store_results.append(sr)
            day_result.total_net_cashflow += sr.net_cashflow
            continue

        # Open but not yet started operating
        op_day = int(getattr(store, "operation_start_day", 1) or 1)
        if op_day > state.day:
            sr.net_cashflow = sr.cash_in - sr.cash_out
            day_result.store_results.append(sr)
            day_result.total_net_cashflow += sr.net_cashflow
            continue

        # Event effects for the day (before traffic/orders)
        (
            sr.store_closed,
            sr.traffic_multiplier,
            sr.conversion_multiplier,
            sr.capacity_multiplier,
            sr.variable_cost_multiplier,
            _ev_summary,
        ) = combine_event_effects_for_store(state, store)
        sr.event_summary_json = json.dumps(_ev_summary, ensure_ascii=False)

        # Workforce lifecycle (P3)
        wf = getattr(store, "workforce", None)
        sr.workforce_headcount_start = int(getattr(wf, "current_headcount", 0) or 0) if wf else 0
        wf_daily = _workforce_daily(store, state.day, rng)
        sr.workforce_lost = int(wf_daily[0])
        sr.workforce_hired = int(wf_daily[1])
        sr.workforce_recruit_cost = float(wf_daily[2])
        sr.workforce_capacity_factor = float(wf_daily[3])
        sr.shift_coverage_ratio = float(wf_daily[4]) if len(wf_daily) > 4 else 1.0
        sr.shift_overtime_cost = float(wf_daily[5]) if len(wf_daily) > 5 else 0.0
        sr.workforce_recruit_cost += float(sr.shift_overtime_cost)
        wf_cat_factors = _workforce_category_capacity_factors(store)
        wf_role_factors = _workforce_role_capacity_factors(store)
        if sr.workforce_capacity_factor > 0:
            sr.capacity_multiplier *= float(sr.workforce_capacity_factor)
        sr.workforce_breakdown_json = json.dumps(
            {
                "headcount_start": int(sr.workforce_headcount_start),
                "headcount_end": int(sr.workforce_headcount_end),
                "capacity_factor": float(sr.workforce_capacity_factor),
                "shift_coverage_ratio": float(sr.shift_coverage_ratio),
                "shift_overtime_cost": float(sr.shift_overtime_cost),
                "category_factors": wf_cat_factors,
                "role_factors": wf_role_factors,
            },
            ensure_ascii=False,
        )
        sr.workforce_headcount_end = int(getattr(getattr(store, "workforce", None), "current_headcount", 0) or 0)

        # Event mitigation actions
        mitigation_actions: list[dict] = []
        mit = getattr(store, "mitigation", None)
        if mit is not None:
            if sr.store_closed and bool(getattr(mit, "use_emergency_power", False)):
                sr.store_closed = False
                sr.capacity_multiplier = max(
                    float(sr.capacity_multiplier), float(getattr(mit, "emergency_capacity_multiplier", 0.60) or 0.60)
                )
                sr.variable_cost_multiplier *= max(
                    0.0, float(getattr(mit, "emergency_variable_cost_multiplier", 1.15) or 1.15)
                )
                c = max(0.0, float(getattr(mit, "emergency_daily_cost", 120.0) or 0.0))
                sr.mitigation_cost += c
                mitigation_actions.append({"action": "emergency_power", "cost": c})

            if (sr.traffic_multiplier < 1.0 or sr.conversion_multiplier < 1.0) and bool(
                getattr(mit, "use_promo_boost", False)
            ):
                sr.traffic_multiplier *= max(0.0, float(getattr(mit, "promo_traffic_boost", 1.05) or 1.05))
                sr.conversion_multiplier *= max(0.0, float(getattr(mit, "promo_conversion_boost", 1.08) or 1.08))
                c = max(0.0, float(getattr(mit, "promo_daily_cost", 80.0) or 0.0))
                sr.mitigation_cost += c
                mitigation_actions.append({"action": "promo_boost", "cost": c})

            if sr.capacity_multiplier < 1.0 and bool(getattr(mit, "use_overtime_capacity", False)):
                sr.capacity_multiplier *= max(0.0, float(getattr(mit, "overtime_capacity_boost", 1.20) or 1.20))
                c = max(0.0, float(getattr(mit, "overtime_daily_cost", 100.0) or 0.0))
                sr.mitigation_cost += c
                mitigation_actions.append({"action": "overtime_capacity", "cost": c})

        # Clamp after mitigation
        sr.traffic_multiplier = max(0.0, min(3.0, float(sr.traffic_multiplier)))
        sr.conversion_multiplier = max(0.0, min(3.0, float(sr.conversion_multiplier)))
        sr.capacity_multiplier = max(0.0, min(3.0, float(sr.capacity_multiplier)))
        sr.variable_cost_multiplier = max(0.0, min(5.0, float(sr.variable_cost_multiplier)))
        sr.mitigation_actions_json = json.dumps(mitigation_actions, ensure_ascii=False)

        # Inventory pipeline (arrivals -> auto replenishment order)
        arrivals = _process_pending_inbounds(store, state.day)
        sr.inbound_arrivals_json = json.dumps(arrivals, ensure_ascii=False)
        repl_cost, repl_orders = _auto_replenish(state, store, state.day)
        sr.replenishment_cost = float(repl_cost)
        sr.replenishment_orders_json = json.dumps(repl_orders, ensure_ascii=False)

        # Traffic
        base_fuel = _int_jitter(station.fuel_vehicles_per_day, station.traffic_volatility, rng)
        base_vis = _int_jitter(station.visitor_vehicles_per_day, station.traffic_volatility, rng)
        sr.fuel_traffic = int(round(float(base_fuel) * float(sr.traffic_multiplier)))
        sr.visitor_traffic = int(round(float(base_vis) * float(sr.traffic_multiplier)))

        _ensure_mtd_order_keys(store)

        # Orders
        if sr.store_closed:
            orders_by_service = {}
        else:
            orders_by_service = _orders_for_store(
                store,
                sr.fuel_traffic,
                sr.visitor_traffic,
                cfg=cfg,
                conversion_multiplier=float(sr.conversion_multiplier),
                capacity_multiplier=float(sr.capacity_multiplier),
                category_capacity_factors=wf_cat_factors,
            )
        sr.orders_by_service = orders_by_service

        wash_orders_actual = 0
        maint_orders_actual = 0

        revenue_by_service: Dict[str, float] = {}
        gross_profit_by_service: Dict[str, float] = {}
        gross_profit_by_project: Dict[str, float] = {}
        orders_by_project: Dict[str, int] = {}
        parts_cogs_by_project: Dict[str, float] = {}

        # Revenue/costs (core services)
        revenue_core = 0.0
        variable_cost = 0.0
        parts_cogs = 0.0
        consumable_cogs = 0.0

        sc_reduction = _supply_chain_reduction_rate(store)

        for sid, orders in orders_by_service.items():
            line = store.service_lines[sid]

            # Auto-service project handling
            if line.project_mix:
                red = sc_reduction if getattr(line, "category", "other") == "maintenance" else 0.0
                proj_counts, proj_revenue, proj_parts_cogs, proj_var_cost, proj_parts_by = _generate_projects_for_service_line(
                    store, line, int(orders), parts_cost_reduction_rate=red, rng=rng
                )
                for pid, n in proj_counts.items():
                    orders_by_project[pid] = orders_by_project.get(pid, 0) + int(n)
                for pid, c in proj_parts_by.items():
                    parts_cogs_by_project[pid] = parts_cogs_by_project.get(pid, 0.0) + float(c)
                revenue_core += proj_revenue
                revenue_by_service[sid] = revenue_by_service.get(sid, 0.0) + proj_revenue
                # line.variable_cost_per_order is non-inventory daily variable cost per order.
                fulfilled = sum(proj_counts.values())

                if getattr(line, "category", "other") == "wash":
                    wash_orders_actual += int(fulfilled)
                elif getattr(line, "category", "other") == "maintenance":
                    maint_orders_actual += int(fulfilled)

                variable_cost += float(fulfilled) * float(line.variable_cost_per_order)
                variable_cost += float(proj_var_cost)
                parts_cogs += proj_parts_cogs
                continue

            line_revenue = float(orders) * float(line.price)
            revenue_core += line_revenue
            revenue_by_service[sid] = revenue_by_service.get(sid, 0.0) + line_revenue

            if getattr(line, "category", "other") == "wash":
                wash_orders_actual += int(orders)
            elif getattr(line, "category", "other") == "maintenance":
                maint_orders_actual += int(orders)

            variable_cost += float(orders) * float(line.variable_cost_per_order)
            line_parts_cogs = float(orders) * float(line.price) * float(line.parts_cost_ratio)
            if sc_reduction > 0 and getattr(line, "category", "other") == "maintenance":
                line_parts_cogs *= 1.0 - sc_reduction
            parts_cogs += line_parts_cogs

            # Consumable COGS already embedded by deducting inventory units; we record it too.
            if line.consumable_sku and line.consumable_units_per_order > 0:
                item = store.inventory.get(line.consumable_sku)
                unit_cost = item.unit_cost if item else 0.0
                consumable_cogs += float(orders) * float(line.consumable_units_per_order) * float(unit_cost)

        # To avoid double counting, treat consumable_cogs as a part of variable cost.
        variable_cost += consumable_cogs

        # Value-added streams
        if sr.store_closed:
            sr.rev_online = 0.0
            sr.gp_online = 0.0
            sr.rev_insurance = 0.0
            sr.gp_insurance = 0.0
            sr.rev_used_car = 0.0
            sr.gp_used_car = 0.0
            sr.count_used_car = 0
        else:
            (
                sr.rev_online,
                sr.gp_online,
                sr.rev_insurance,
                sr.gp_insurance,
                sr.rev_used_car,
                sr.gp_used_car,
                sr.count_used_car,
            ) = simulate_value_added_services(store, state.day, cfg, rng=rng)

        value_added_revenue = sr.rev_online + sr.rev_insurance + sr.rev_used_car
        value_added_gross_profit = sr.gp_online + sr.gp_insurance + sr.gp_used_car

        # Apply variable cost multiplier (events) on variable costs and COGS.
        variable_cost *= float(sr.variable_cost_multiplier)
        parts_cogs *= float(sr.variable_cost_multiplier)

        sr.revenue = revenue_core + value_added_revenue
        sr.variable_cost = variable_cost
        sr.parts_cogs = parts_cogs
        sr.revenue_by_service = revenue_by_service

        # OPEX
        sr.cost_rent = _daily_rent_cost(store, cfg)
        sr.cost_water, sr.cost_elec = _daily_utilities_cost(store, wash_orders_actual, maint_orders_actual)

        # Depreciation/fixed overhead
        sr.depreciation_cost = _depreciation_cost(store, state.day)
        sr.fixed_overhead = float(store.fixed_overhead_per_day) + float(sr.mitigation_cost)

        gross_profit_core = revenue_core - variable_cost - parts_cogs
        gross_profit_total = gross_profit_core + value_added_gross_profit
        operating_profit_before_labor = (
            gross_profit_total
            - sr.depreciation_cost
            - sr.fixed_overhead
            - sr.cost_rent
            - sr.cost_water
            - sr.cost_elec
        )

        # Gross profit by service (simple allocation by revenue share)
        if revenue_core > 0 and revenue_by_service:
            for sid, rev in revenue_by_service.items():
                share = float(rev) / float(revenue_core)
                gross_profit_by_service[sid] = gross_profit_core * share
        else:
            gross_profit_by_service = {}

        # Gross profit by project (only for generated projects; allocate within service by project revenue)
        if orders_by_project:
            # compute project revenues from catalog price
            proj_rev_total = 0.0
            proj_rev: Dict[str, float] = {}
            for pid, n in orders_by_project.items():
                p = store.projects.get(pid)
                if not p:
                    continue
                r = float(n) * float(p.price)
                proj_rev[pid] = r
                proj_rev_total += r
            if proj_rev_total > 0:
                for pid, r in proj_rev.items():
                     gross_profit_by_project[pid] = gross_profit_core * (r / proj_rev_total)

        sr.orders_by_project = orders_by_project
        sr.gross_profit_by_service = gross_profit_by_service
        sr.gross_profit_by_project = gross_profit_by_project

        # Payroll: category GP + parts/labor bases
        revenue_by_category: Dict[str, float] = {"wash": 0.0, "maintenance": 0.0, "detailing": 0.0, "other": 0.0}
        gp_by_category: Dict[str, float] = {"wash": 0.0, "maintenance": 0.0, "detailing": 0.0, "other": 0.0}

        for sid, rev in revenue_by_service.items():
            line = store.service_lines.get(sid)
            cat = (getattr(line, "category", "other") if line else "other") or "other"
            if cat not in revenue_by_category:
                cat = "other"
            revenue_by_category[cat] += float(rev)
            gp_by_category[cat] += float(gross_profit_by_service.get(sid, 0.0))

        # Projects are treated as maintenance
        if orders_by_project:
            # compute project revenues
            proj_rev: Dict[str, float] = {}
            for pid, n in orders_by_project.items():
                p = store.projects.get(pid)
                if not p:
                    continue
                proj_rev[pid] = float(n) * float(p.price)
            revenue_by_category["maintenance"] += sum(proj_rev.values())
            gp_by_category["maintenance"] += sum(float(gross_profit_by_project.get(pid, 0.0)) for pid in orders_by_project.keys())

        # Labor revenue based on project labor-hour proportion
        hour_price = float(getattr(store, "labor_hour_price", 120.0) or 0.0)
        if hour_price < 0:
            hour_price = 0.0
        labor_revenue = 0.0
        parts_revenue = 0.0
        parts_gp = 0.0
        for pid, n in orders_by_project.items():
            p = store.projects.get(pid)
            if not p:
                continue
            qty = int(n)
            proj_price = float(p.price)
            proj_total = float(qty) * proj_price
            denom = proj_price if proj_price > 0 else 0.0
            ratio = 0.0
            if denom > 0:
                ratio = min(1.0, max(0.0, (float(p.labor_hours) * hour_price) / denom))
            proj_labor_rev = proj_total * ratio
            proj_parts_rev = max(0.0, proj_total - proj_labor_rev)
            labor_revenue += proj_labor_rev
            parts_revenue += proj_parts_rev
            cogs = float(parts_cogs_by_project.get(pid, 0.0))
            parts_gp += max(0.0, proj_parts_rev - cogs)

        # Persist daily breakdowns for exports/UI
        sr.revenue_by_category = revenue_by_category
        sr.gross_profit_by_category = gp_by_category
        sr.parts_cogs_by_project = parts_cogs_by_project
        sr.labor_revenue = labor_revenue
        sr.parts_revenue = parts_revenue
        sr.parts_gross_profit = parts_gp

        # Labor cost (daily base + per-order; monthly bonus/profit share at month-end)
        sr.labor_cost = _compute_labor_cost(
            store=store,
            orders_by_service=orders_by_service,
            revenue_by_service=revenue_by_service,
            gross_profit_by_service=gross_profit_by_service,
            orders_by_project=orders_by_project,
            gross_profit_by_project=gross_profit_by_project,
            revenue_by_category=revenue_by_category,
            gross_profit_by_category=gp_by_category,
            labor_revenue=labor_revenue,
            parts_revenue=parts_revenue,
            parts_gross_profit=parts_gp,
            is_month_end=is_month_end,
        )

        sr.operating_profit = operating_profit_before_labor - sr.labor_cost

        # Cashflow
        sr.cash_in = sr.revenue
        # Daily labor is paid out as cash; depreciation is non-cash.
        sr.cash_out += sr.labor_cost + sr.fixed_overhead + sr.cost_rent + sr.cost_water + sr.cost_elec
        # Auto replenishment is cash out (inventory asset), not P/L expense.
        sr.cash_out += float(sr.replenishment_cost)
        sr.cash_out += float(sr.workforce_recruit_cost)

        state.cash += sr.cash_in
        state.cash -= sr.cash_out

        sr.net_cashflow = sr.cash_in - sr.cash_out
        store.cash_balance += sr.net_cashflow

        # Update month trackers
        for sid, orders in orders_by_service.items():
            store.mtd_orders_by_service[sid] = store.mtd_orders_by_service.get(sid, 0) + int(orders)
        for pid, orders in orders_by_project.items():
            store.mtd_orders_by_project[pid] = store.mtd_orders_by_project.get(pid, 0) + int(orders)
        store.mtd_revenue += sr.revenue
        store.mtd_variable_cost += variable_cost
        store.mtd_parts_cogs += parts_cogs
        store.mtd_labor_cost += sr.labor_cost
        store.mtd_depr_cost += sr.depreciation_cost
        store.mtd_fixed_overhead += sr.fixed_overhead
        store.mtd_operating_profit += sr.operating_profit
        store.mtd_cash_in += sr.cash_in
        store.mtd_cash_out += sr.cash_out

        day_result.store_results.append(sr)
        day_result.total_revenue += sr.revenue
        day_result.total_operating_profit += sr.operating_profit
        day_result.total_net_cashflow += sr.net_cashflow

    state.ledger.append(day_result)

    # HQ finance handling (P3)
    _apply_hq_finance(state, day_result)

    # Persist RNG state so split runs stay reproducible.
    _persist_rng_state(state, rng)
    state.day += 1

    # Month-end reset
    if is_month_end:
        for store in state.stores.values():
            store.reset_month_trackers()

    return day_result


def close_store(
    state: GameState,
    store_id: str,
    inventory_salvage_rate: float = 0.30,
    asset_salvage_rate: float = 0.10,
) -> float:
    """Close store and return cash recovered (salvage)."""

    store = state.stores[store_id]
    if store.status == "closed":
        return 0.0
    store.status = "closed"

    inv_rate = max(0.0, min(1.0, float(inventory_salvage_rate)))
    asset_rate = max(0.0, min(1.0, float(asset_salvage_rate)))

    recovered = 0.0
    # Salvage inventory
    for item in store.inventory.values():
        recovered += float(item.qty) * float(item.unit_cost) * inv_rate
    store.inventory = {}

    # Salvage assets (rough)
    for a in store.assets:
        recovered += float(a.capex) * asset_rate

    state.cash += recovered
    return recovered


def purchase_inventory(
    state: GameState,
    store_id: str,
    sku: str,
    name: str,
    unit_cost: float,
    qty: float,
) -> float:
    store = state.stores[store_id]
    qty = float(qty)
    unit_cost = float(unit_cost)
    if qty <= 0 or unit_cost < 0:
        return 0.0
    total = qty * unit_cost
    actual = min(state.cash, total)
    if actual <= 0:
        return 0.0

    bought_qty = actual / unit_cost if unit_cost > 0 else 0.0
    state.cash -= actual

    item = store.inventory.get(sku)
    if item is None:
        store.inventory[sku] = InventoryItem(sku=sku, name=name, unit_cost=unit_cost, qty=bought_qty)
    else:
        # Weighted average unit cost
        if item.qty + bought_qty > 0:
            item.unit_cost = (item.unit_cost * item.qty + unit_cost * bought_qty) / (item.qty + bought_qty)
        item.qty += bought_qty
        if name:
            item.name = name

    store.mtd_cash_out += actual
    return actual
