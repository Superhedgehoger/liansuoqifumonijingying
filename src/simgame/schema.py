from __future__ import annotations

import math
from dataclasses import asdict
from typing import Any, Mapping

from simgame.models import GameState


SCHEMA_NAME = "simgame.state"
CURRENT_SCHEMA_VERSION = "0.8.0"


class DataModelError(ValueError):
    """Raised when persisted simulation data violates the public data model."""


def _version_tuple(value: str) -> tuple[int, int, int]:
    try:
        parts = [int(part) for part in str(value).lstrip("v").split(".")]
    except (TypeError, ValueError) as exc:
        raise DataModelError(f"invalid schema version: {value!r}") from exc
    if not 1 <= len(parts) <= 3:
        raise DataModelError(f"invalid schema version: {value!r}")
    return tuple((parts + [0, 0])[:3])


def normalize_envelope(payload: Any) -> dict[str, Any]:
    """Normalize current, legacy and raw-state payloads into a v0.8 envelope."""

    if not isinstance(payload, Mapping):
        raise DataModelError("state file root must be a JSON object")

    raw = dict(payload)
    if "state" in raw:
        state = raw.get("state")
        if not isinstance(state, Mapping):
            raise DataModelError("state file field 'state' must be a JSON object")
        schema = raw.get("schema") if isinstance(raw.get("schema"), Mapping) else {}
        source_version = str(schema.get("version") or raw.get("version") or "0.7.0")
    else:
        # Early exports sometimes contained GameState directly without an envelope.
        state = raw
        source_version = "0.7.0"

    if _version_tuple(source_version) > _version_tuple(CURRENT_SCHEMA_VERSION):
        raise DataModelError(
            f"state schema {source_version} is newer than supported {CURRENT_SCHEMA_VERSION}"
        )

    return {
        "schema": {"name": SCHEMA_NAME, "version": CURRENT_SCHEMA_VERSION},
        "version": CURRENT_SCHEMA_VERSION,
        "migrated_from": source_version if source_version != CURRENT_SCHEMA_VERSION else None,
        "state": dict(state),
    }


def build_envelope(state: GameState) -> dict[str, Any]:
    validate_state(state)
    return {
        "schema": {"name": SCHEMA_NAME, "version": CURRENT_SCHEMA_VERSION},
        # Retained for older clients that only read the top-level version field.
        "version": CURRENT_SCHEMA_VERSION,
        "state": asdict(state),
    }


def validate_state(state: GameState) -> None:
    """Validate cross-entity invariants that dataclass type hints cannot express."""

    errors: list[str] = []
    if int(state.day) < 1:
        errors.append("day must be >= 1")
    if not math.isfinite(float(state.cash)):
        errors.append("cash must be finite")

    for key, station in state.stations.items():
        if key != station.station_id:
            errors.append(f"station key {key!r} does not match station_id {station.station_id!r}")

    for key, store in state.stores.items():
        if key != store.store_id:
            errors.append(f"store key {key!r} does not match store_id {store.store_id!r}")
        if store.station_id and store.station_id not in state.stations:
            errors.append(f"store {key!r} references missing station {store.station_id!r}")
        for service_key, service in store.service_lines.items():
            if service_key != service.service_id:
                errors.append(
                    f"store {key!r} service key {service_key!r} does not match service_id {service.service_id!r}"
                )
        for sku, item in store.inventory.items():
            if sku != item.sku:
                errors.append(f"store {key!r} inventory key {sku!r} does not match sku {item.sku!r}")

    if errors:
        raise DataModelError("; ".join(errors))
