from __future__ import annotations

import csv
import json

from fastapi.testclient import TestClient

from simgame.storage import ledger_path
from simgame.storage import reset_data_files
from simgame.webapp import create_app


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_mitigation_emergency_power() -> None:
    reset_data_files()
    app = create_app()
    c = TestClient(app)
    state = c.get('/api/state').json()
    sid = state['stations'][0]['station_id']
    c.post('/api/stores', json={'store_id': 'M-P2', 'name': 'P2', 'station_id': sid, 'build_days': 0})
    c.put('/api/stores/M-P2', json={
        'mitigation': {
            'use_emergency_power': True,
            'emergency_capacity_multiplier': 0.8,
            'emergency_daily_cost': 99,
        }
    })
    c.post('/api/event-templates', json={
        'template_id': 'pow',
        'name': 'pow',
        'event_type': 'outage',
        'enabled': False,
        'daily_probability': 0,
        'duration_days_min': 1,
        'duration_days_max': 1,
        'cooldown_days': 0,
        'intensity_min': 1,
        'intensity_max': 1,
        'scope': 'store',
        'target_strategy': 'random_one',
        'store_closed': True,
        'capacity_multiplier_min': 0,
        'capacity_multiplier_max': 0,
    })
    day_now = c.get('/api/state').json()['day']
    c.post('/api/events/inject', json={'template_id': 'pow', 'scope': 'store', 'target_id': 'M-P2', 'start_day': day_now, 'duration_days': 1, 'intensity': 1})
    c.post('/api/simulate', json={'days': 1})

    with ledger_path().open('r', encoding='utf-8', newline='') as f:
        rows = [r for r in csv.DictReader(f) if (r.get('store_id') or '') == 'M-P2']
    _assert(len(rows) > 0, 'ledger should contain M-P2 row')
    last = rows[-1]
    _assert((last.get('store_closed') or '').lower() in {'false', '0', ''}, 'store_closed should be false after mitigation')
    _assert(float(last.get('mitigation_cost') or 0.0) >= 99.0, 'mitigation cost should be charged')


def test_auto_replenishment_pipeline() -> None:
    reset_data_files()
    app = create_app()
    c = TestClient(app)
    state = c.get('/api/state').json()
    sid = state['stations'][0]['station_id']
    c.post('/api/stores', json={'store_id': 'M-R', 'name': 'R', 'station_id': sid, 'build_days': 0})

    c.put('/api/stores/M-R', json={'auto_replenishment_enabled': True})
    c.post('/api/stores/M-R/replenishment/rules', json={
        'sku': 'AUTO1',
        'name': 'auto item',
        'enabled': True,
        'reorder_point': 20,
        'safety_stock': 30,
        'target_stock': 40,
        'lead_time_days': 1,
        'unit_cost': 10,
    })

    c.post('/api/simulate', json={'days': 1})
    s1 = c.get('/api/state').json()
    st1 = [x for x in s1['stores'] if x['store_id'] == 'M-R'][0]
    _assert(len(st1.get('pending_inbounds') or []) >= 1, 'should place replenishment order')

    c.post('/api/simulate', json={'days': 1})
    s2 = c.get('/api/state').json()
    st2 = [x for x in s2['stores'] if x['store_id'] == 'M-R'][0]
    inv = {x['sku']: x for x in (st2.get('inventory') or [])}
    _assert(float(inv.get('AUTO1', {}).get('qty', 0.0)) > 0.0, 'inbound should arrive and increase inventory')


def test_site_recommendations_road_graph() -> None:
    reset_data_files()
    app = create_app()
    c = TestClient(app)
    r = c.get('/api/site-recommendations?distance_mode=road_graph&graph_k_neighbors=3&top_k=5')
    _assert(r.status_code == 200, 'site recommendations should return 200')
    j = r.json()
    _assert(j.get('distance_mode') == 'road_graph', 'distance mode should be road_graph')
    _assert(isinstance(j.get('recommendations'), list), 'recommendations should be list')


def main() -> None:
    tests = [
        test_mitigation_emergency_power,
        test_auto_replenishment_pipeline,
        test_site_recommendations_road_graph,
    ]
    for t in tests:
        t()
        print(f'OK  {t.__name__}')
    print(f'ALL OK ({len(tests)} tests)')


if __name__ == '__main__':
    main()
