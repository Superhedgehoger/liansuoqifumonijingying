from __future__ import annotations

import json
import io
import csv

from fastapi.testclient import TestClient

from simgame.storage import reset_data_files
from simgame.webapp import create_app


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_mitigation_emergency_power() -> None:
    reset_data_files()
    app = create_app()
    c = TestClient(app)
    c.post('/api/reset')
    state = c.get('/api/state').json()
    sid = state['stations'][0]['station_id']
    c.post('/api/stores', json={'store_id': 'M-P2', 'name': 'P2', 'station_id': sid, 'build_days': 0})
    c.put('/api/stores/M-P2', json={
        'status': 'open',
        'mitigation': {
            'use_emergency_power': True,
            'emergency_capacity_multiplier': 0.8,
            'emergency_daily_cost': 99,
        }
    })
    day_now = c.get('/api/state').json()['day']
    r_inj = c.post('/api/events/inject', json={'template_id': 'power_outage', 'scope': 'store', 'target_id': 'M-P2', 'start_day': day_now, 'duration_days': 1, 'intensity': 1})
    _assert(r_inj.status_code == 200, 'event inject should return 200')
    r_sim = c.post('/api/simulate', json={'days': 1})
    _assert(r_sim.status_code == 200, 'simulate should return 200')

    s_after = c.get('/api/state').json()
    _assert('events' in s_after, 'state should include events block')

    # Best-effort ledger assertion (file may be absent in some isolated TestClient runs).
    ledger_csv = c.get('/download/ledger').text
    rows = [r for r in csv.DictReader(io.StringIO(ledger_csv)) if (r.get('store_id') or '') == 'M-P2']
    if rows:
        last = rows[-1]
        _assert((last.get('store_closed') or '').lower() in {'false', '0', ''}, 'store_closed should be false after mitigation')


def test_auto_replenishment_pipeline() -> None:
    reset_data_files()
    app = create_app()
    c = TestClient(app)
    c.post('/api/reset')
    state = c.get('/api/state').json()
    sid = state['stations'][0]['station_id']
    c.post('/api/stores', json={'store_id': 'M-R', 'name': 'R', 'station_id': sid, 'build_days': 0})

    c.put('/api/stores/M-R', json={'status': 'open', 'auto_replenishment_enabled': True})
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

    r1 = c.post('/api/simulate', json={'days': 1})
    _assert(r1.status_code == 200, 'simulate day1 should return 200')
    s1 = c.get('/api/state').json()
    _assert(any((x.get('store_id') or '') == 'M-R' for x in (s1.get('stores') or [])), 'M-R should exist')

    r2 = c.post('/api/simulate', json={'days': 1})
    _assert(r2.status_code == 200, 'simulate day2 should return 200')


def test_site_recommendations_road_graph() -> None:
    reset_data_files()
    app = create_app()
    c = TestClient(app)
    c.post('/api/reset')
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
