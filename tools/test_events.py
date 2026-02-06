from __future__ import annotations

import csv
import json
import tempfile
from pathlib import Path

from simgame.engine import EngineConfig, inject_event_from_template, simulate_day
from simgame.models import Asset, EventTemplate, GameState, InventoryItem, ServiceLine, Station, Store


def _make_min_state(seed: int = 20260101) -> GameState:
    s = GameState()
    s.day = 1
    s.cash = 1_000_000.0
    s.rng_seed = int(seed)
    s.rng_state = None

    st = Station(
        station_id="S1",
        name="Test Station",
        fuel_vehicles_per_day=100,
        visitor_vehicles_per_day=0,
        traffic_volatility=0.0,
    )
    s.stations[st.station_id] = st

    store = Store(store_id="M1", name="Test Store", station_id=st.station_id)
    store.status = "open"
    store.operation_start_day = 1
    store.traffic_conversion_rate = 1.0
    store.fixed_overhead_per_day = 100.0

    # Ensure there are fixed costs even when store_closed.
    store.assets.append(Asset(name="CAPEX", capex=36500.0, useful_life_days=365, in_service_day=1))  # 100/day
    store.opex_config.rent.monthly_cost = 3000.0  # 100/day when month_len=30
    store.opex_config.utilities.elec_daily_base = 50.0
    store.opex_config.utilities.water_cost_per_wash = 1.5
    store.opex_config.utilities.elec_cost_per_wash = 0.8
    store.opex_config.utilities.elec_cost_per_maint = 2.0

    # One simple service.
    store.service_lines["wash"] = ServiceLine(
        service_id="wash",
        name="Wash",
        price=50.0,
        conversion_from_fuel=0.10,
        conversion_from_visitor=0.0,
        capacity_per_day=1000,
        variable_cost_per_order=5.0,
        category="wash",
        parts_cost_ratio=0.0,
        consumable_sku="CHEM",
        consumable_units_per_order=1.0,
    )
    store.inventory["CHEM"] = InventoryItem(sku="CHEM", name="Chem", unit_cost=20.0, qty=10_000.0)

    s.stores[store.store_id] = store
    return s


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_store_closed_no_orders_but_fixed_costs() -> None:
    s = _make_min_state(seed=123)
    s.event_templates["power"] = EventTemplate(
        template_id="power",
        name="Power Outage",
        event_type="outage",
        enabled=False,
        daily_probability=0.0,
        duration_days_min=1,
        duration_days_max=1,
        cooldown_days=30,
        intensity_min=1.0,
        intensity_max=1.0,
        scope="store",
        target_strategy="random_one",
        store_closed=True,
        capacity_multiplier_min=0.0,
        capacity_multiplier_max=0.0,
    )

    chem_before = s.stores["M1"].inventory["CHEM"].qty
    inject_event_from_template(s, template_id="power", scope="store", target_id="M1", start_day=1, duration_days=1, intensity=1.0)
    dr = simulate_day(s, EngineConfig(month_len_days=30))
    sr = dr.store_results[0]

    _assert(sr.store_closed is True, "expected store_closed=true")
    _assert(sr.orders_by_service == {}, "expected no orders when store_closed")
    _assert(sr.revenue == 0.0, "expected revenue=0 when store_closed")
    _assert(sr.fixed_overhead > 0.0, "expected fixed_overhead still charged")
    _assert(sr.depreciation_cost > 0.0, "expected depreciation still charged")
    _assert(sr.cost_rent > 0.0, "expected rent still charged")
    _assert(sr.cost_elec > 0.0, "expected base electricity still charged")

    chem_after = s.stores["M1"].inventory["CHEM"].qty
    _assert(chem_after == chem_before, "expected no consumables used when store_closed")


def test_traffic_multiplier_reduces_orders() -> None:
    s = _make_min_state(seed=123)
    s.event_templates["rain"] = EventTemplate(
        template_id="rain",
        name="Rain",
        event_type="weather",
        enabled=False,
        daily_probability=0.0,
        duration_days_min=1,
        duration_days_max=1,
        cooldown_days=0,
        intensity_min=1.0,
        intensity_max=1.0,
        scope="station",
        target_strategy="random_one",
        store_closed=False,
        traffic_multiplier_min=0.5,
        traffic_multiplier_max=0.5,
    )

    inject_event_from_template(s, template_id="rain", scope="station", target_id="S1", start_day=1, duration_days=1, intensity=1.0)
    dr = simulate_day(s, EngineConfig(month_len_days=30))
    sr = dr.store_results[0]
    # baseline would be fuel_traffic=100, orders=10
    _assert(sr.fuel_traffic == 50, f"expected fuel_traffic=50, got {sr.fuel_traffic}")
    _assert(sr.orders_by_service.get("wash", 0) == 5, f"expected wash orders=5, got {sr.orders_by_service}")


def test_cooldown_blocks_until_next_ok_day() -> None:
    s = _make_min_state(seed=7)
    s.event_templates["hit"] = EventTemplate(
        template_id="hit",
        name="Always Hit",
        event_type="other",
        enabled=True,
        daily_probability=1.0,
        duration_days_min=1,
        duration_days_max=1,
        cooldown_days=3,
        intensity_min=1.0,
        intensity_max=1.0,
        scope="store",
        target_strategy="random_one",
        store_closed=False,
    )

    # Simulate 5 days: should trigger on day1 and day5.
    for _ in range(5):
        simulate_day(s, EngineConfig(month_len_days=30))
    created_days = [h.created_day for h in s.event_history if h.template_id == "hit"]
    _assert(created_days == [1, 5], f"expected created_day [1,5], got {created_days}")


def test_injection_written_to_event_summary_and_ledger_csv() -> None:
    s = _make_min_state(seed=123)
    s.event_templates["rain"] = EventTemplate(
        template_id="rain",
        name="Rain",
        event_type="weather",
        enabled=False,
        daily_probability=0.0,
        duration_days_min=1,
        duration_days_max=1,
        cooldown_days=0,
        intensity_min=1.0,
        intensity_max=1.0,
        scope="station",
        target_strategy="random_one",
        store_closed=False,
        traffic_multiplier_min=0.5,
        traffic_multiplier_max=0.5,
    )

    inject_event_from_template(s, template_id="rain", scope="station", target_id="S1", start_day=1, duration_days=1, intensity=1.0)
    dr = simulate_day(s, EngineConfig(month_len_days=30))
    sr = dr.store_results[0]
    summary = json.loads(sr.event_summary_json)
    _assert(isinstance(summary, list) and summary, "expected non-empty event_summary_json")
    _assert(summary[0].get("template_id") == "rain", "expected summary include template_id")

    # Write ledger to a temp file without touching real data/ledger.csv.
    import simgame.storage as storage

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "ledger.csv"
        storage.ledger_path = lambda: tmp  # type: ignore[assignment]
        storage.append_ledger_csv(dr)
        rows = list(csv.DictReader(tmp.open("r", encoding="utf-8", newline="")))
        _assert(len(rows) == 1, "expected 1 ledger row")
        _assert(rows[0].get("store_closed") in ("False", "false", "0", ""), "expected store_closed false")
        ev_json = rows[0].get("event_summary_json") or "[]"
        ev = json.loads(ev_json)
        _assert(ev and ev[0].get("template_id") == "rain", "expected ledger event_summary_json includes injected event")


def test_seed_reproducibility() -> None:
    def run(seed: int) -> list[tuple[int, int, float]]:
        s = _make_min_state(seed=seed)
        # A probabilistic template (but deterministic given seed/state)
        s.event_templates["weather"] = EventTemplate(
            template_id="weather",
            name="Weather",
            event_type="weather",
            enabled=True,
            daily_probability=0.35,
            duration_days_min=1,
            duration_days_max=2,
            cooldown_days=2,
            intensity_min=0.4,
            intensity_max=1.0,
            scope="station",
            target_strategy="random_one",
            store_closed=False,
            traffic_multiplier_min=0.6,
            traffic_multiplier_max=1.0,
            conversion_multiplier_min=0.8,
            conversion_multiplier_max=1.0,
        )
        out: list[tuple[int, int, float]] = []
        cfg = EngineConfig(month_len_days=30)
        for _ in range(10):
            dr = simulate_day(s, cfg)
            sr = dr.store_results[0]
            out.append((dr.day, sr.orders_by_service.get("wash", 0), round(sr.revenue, 6)))
        return out

    a = run(4242)
    b = run(4242)
    _assert(a == b, "expected identical results with same seed")


def main() -> None:
    tests = [
        test_store_closed_no_orders_but_fixed_costs,
        test_traffic_multiplier_reduces_orders,
        test_cooldown_blocks_until_next_ok_day,
        test_injection_written_to_event_summary_and_ledger_csv,
        test_seed_reproducibility,
    ]
    for t in tests:
        t()
        print(f"OK  {t.__name__}")
    print(f"ALL OK ({len(tests)} tests)")


if __name__ == "__main__":
    main()
