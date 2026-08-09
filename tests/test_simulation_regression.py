import copy
import random
import unittest

from simgame.engine import EngineConfig, simulate_day
from simgame.models import GameState, Station, Store
from simgame.presets import apply_default_store_template


def make_state() -> GameState:
    state = GameState(rng_seed=20260809)
    state.stations["station-1"] = Station(
        station_id="station-1",
        name="regression station",
        fuel_vehicles_per_day=500,
        visitor_vehicles_per_day=20,
    )
    store = Store(store_id="store-1", name="regression store", station_id="station-1", status="open")
    apply_default_store_template(store)
    state.stores[store.store_id] = store
    return state


class SimulationRegressionTests(unittest.TestCase):
    def test_seeded_simulation_is_reproducible(self):
        first = make_state()
        second = copy.deepcopy(first)
        cfg = EngineConfig()

        first_results = [simulate_day(first, cfg) for _ in range(7)]
        second_results = [simulate_day(second, cfg) for _ in range(7)]

        self.assertEqual(first_results, second_results)
        self.assertEqual(first, second)

    def test_simulation_preserves_non_negative_order_counts(self):
        state = make_state()
        result = simulate_day(state, EngineConfig())
        for store_result in result.store_results:
            self.assertTrue(all(count >= 0 for count in store_result.orders_by_service.values()))
            self.assertTrue(all(count >= 0 for count in store_result.orders_by_project.values()))


if __name__ == "__main__":
    unittest.main()
