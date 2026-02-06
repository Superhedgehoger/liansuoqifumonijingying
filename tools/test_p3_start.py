from __future__ import annotations

from fastapi.testclient import TestClient

from simgame.storage import reset_data_files
from simgame.webapp import create_app


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_finance_auto_draw() -> None:
    reset_data_files()
    c = TestClient(create_app())
    c.post('/api/reset')
    s = c.get('/api/state').json()
    sid = s['stations'][0]['station_id']
    c.post('/api/stores', json={
        'store_id': 'F1',
        'name': 'F1',
        'station_id': sid,
        'build_days': 1,
        'capex_total': 1200000,
    })
    c.put('/api/finance', json={'hq_credit_limit': 300000, 'hq_auto_finance': True, 'hq_daily_interest_rate': 0.0001})
    c.post('/api/simulate', json={'days': 1})
    s2 = c.get('/api/state').json()
    fin = s2.get('finance', {})
    _assert('hq_credit_limit' in fin and 'hq_auto_finance' in fin, 'finance block should exist with configured fields')


def test_workforce_turnover_and_recruiting() -> None:
    reset_data_files()
    c = TestClient(create_app())
    c.post('/api/reset')
    s = c.get('/api/state').json()
    sid = s['stations'][0]['station_id']
    c.post('/api/stores', json={'store_id': 'W1', 'name': 'W1', 'station_id': sid, 'build_days': 0})
    c.put('/api/stores/W1', json={
        'workforce': {
            'planned_headcount': 8,
            'current_headcount': 2,
            'training_level': 0.4,
            'daily_turnover_rate': 0.0,
            'recruiting_enabled': True,
            'recruiting_daily_budget': 1000,
            'recruiting_lead_days': 1,
            'recruiting_hire_rate_per_100_budget': 0.8,
            'shifts_per_day': 3,
            'staffing_per_shift': 3,
            'overtime_shift_enabled': True,
            'overtime_shift_extra_capacity': 0.2,
            'overtime_shift_daily_cost': 50,
            'skill_by_category': {'wash': 0.8, 'maintenance': 1.2, 'detailing': 1.0, 'other': 1.0},
            'shift_allocation_by_category': {'wash': 1.2, 'maintenance': 0.8, 'detailing': 1.0, 'other': 1.0},
            'skill_by_role': {'技师': 1.1, '店长': 0.9, '销售': 1.0, '客服': 1.0},
            'shift_allocation_by_role': {'技师': 1.2, '店长': 1.0, '销售': 0.9, '客服': 1.0},
        }
    })
    c.post('/api/simulate', json={'days': 1})
    s1 = c.get('/api/state').json()
    st1 = [x for x in s1['stores'] if x['store_id'] == 'W1'][0]
    wf = st1.get('workforce', {})
    _assert(bool(wf.get('recruiting_enabled', False)), 'recruiting config should persist')
    _assert(int(st1.get('workforce', {}).get('shifts_per_day', 0)) == 3, 'shift config should persist')
    _assert(float((st1.get('workforce', {}).get('skill_by_category') or {}).get('wash', 0)) == 0.8, 'skill matrix should persist')
    _assert(float((st1.get('workforce', {}).get('skill_by_role') or {}).get('技师', 0)) == 1.1, 'role skill should persist')


def test_insights_alerts_present() -> None:
    reset_data_files()
    c = TestClient(create_app())
    c.post('/api/reset')
    s = c.get('/api/state').json()
    sid = s['stations'][0]['station_id']
    c.post('/api/stores', json={'store_id': 'A1', 'name': 'A1', 'station_id': sid, 'build_days': 0})
    c.put('/api/stores/A1', json={
        'status': 'open',
        'workforce': {'planned_headcount': 10, 'current_headcount': 3},
        'auto_replenishment_enabled': True,
    })
    c.post('/api/stores/A1/replenishment/rules', json={
        'sku': 'LOW1',
        'name': 'low1',
        'enabled': True,
        'reorder_point': 20,
        'safety_stock': 50,
        'target_stock': 80,
        'lead_time_days': 2,
        'unit_cost': 10,
    })
    s2 = c.get('/api/state').json()
    alerts = s2.get('insights', {}).get('alerts', [])
    _assert(any(a.get('code') == 'workforce_shortage' for a in alerts), 'should emit workforce shortage alert')


def test_budget_fields_present() -> None:
    reset_data_files()
    c = TestClient(create_app())
    c.post('/api/reset')
    c.put('/api/finance', json={
        'budget_monthly_revenue_target': 123456,
        'budget_monthly_profit_target': 23456,
        'budget_monthly_cashflow_target': 34567,
    })
    s = c.get('/api/state').json()
    fin = s.get('finance', {})
    _assert(float(fin.get('budget_monthly_revenue_target', 0)) == 123456.0, 'revenue target should persist')
    _assert('budget_mtd' in fin, 'finance should include budget_mtd block')


def main() -> None:
    tests = [
        test_finance_auto_draw,
        test_workforce_turnover_and_recruiting,
        test_insights_alerts_present,
        test_budget_fields_present,
    ]
    for t in tests:
        t()
        print(f'OK  {t.__name__}')
    print(f'ALL OK ({len(tests)} tests)')


if __name__ == '__main__':
    main()
