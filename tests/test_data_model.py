import json
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path

from simgame.models import GameState, Station, Store
from simgame.presets import apply_default_store_template
from simgame.schema import (
    CURRENT_SCHEMA_VERSION,
    DataModelError,
    normalize_envelope,
    stores_referencing_station,
    validate_state,
)
from simgame.storage import load_state, save_state


class DataModelTests(unittest.TestCase):
    def make_state(self) -> GameState:
        state = GameState(day=4, cash=123456.78, rng_seed=42)
        state.stations["station-1"] = Station(station_id="station-1", name="一号站")
        store = Store(store_id="store-1", name="一号店", station_id="station-1", status="open")
        apply_default_store_template(store)
        state.stores[store.store_id] = store
        return state

    def test_v080_state_round_trip(self):
        state = self.make_state()
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "state.json"
            save_state(state, path)
            payload = json.loads(path.read_text(encoding="utf-8"))
            restored = load_state(path)

        self.assertEqual(CURRENT_SCHEMA_VERSION, payload["schema"]["version"])
        self.assertEqual(CURRENT_SCHEMA_VERSION, payload["version"])
        self.assertEqual(asdict(state), asdict(restored))

    def test_legacy_credit_fields_are_migrated(self):
        payload = {
            "version": "0.7.3",
            "state": {
                "day": 3,
                "cash": 50.0,
                "hq_credit_limit": 1000.0,
                "hq_credit_used": 250.0,
                "hq_credit_draw_mix_short_ratio": 0.6,
            },
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "legacy.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            state = load_state(path)

        self.assertEqual(600.0, state.hq_short_credit_limit)
        self.assertEqual(400.0, state.hq_medium_credit_limit)
        self.assertEqual(250.0, state.hq_credit_used)

    def test_raw_state_export_is_accepted(self):
        envelope = normalize_envelope({"day": 2, "cash": 100.0, "stations": {}, "stores": {}})
        self.assertEqual(2, envelope["state"]["day"])
        self.assertEqual("0.7.0", envelope["migrated_from"])

    def test_future_schema_is_rejected(self):
        with self.assertRaisesRegex(DataModelError, "newer than supported"):
            normalize_envelope({"schema": {"version": "9.0.0"}, "state": {}})

    def test_cross_entity_reference_is_validated(self):
        state = GameState()
        state.stores["orphan"] = Store(store_id="orphan", name="orphan", station_id="missing")
        with self.assertRaisesRegex(DataModelError, "missing station"):
            validate_state(state)

    def test_station_reference_guard_lists_linked_stores_stably(self):
        state = self.make_state()
        state.stores["store-2"] = Store(
            store_id="store-2", name="二号店", station_id="station-1"
        )
        state.stores["store-0"] = Store(
            store_id="store-0", name="其他店", station_id="station-2"
        )

        self.assertEqual(
            ["store-1", "store-2"],
            stores_referencing_station(state, "station-1"),
        )
        self.assertEqual([], stores_referencing_station(state, "unused"))


if __name__ == "__main__":
    unittest.main()
