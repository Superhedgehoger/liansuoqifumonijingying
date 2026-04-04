from __future__ import annotations

import csv
import io
import time

from fastapi.testclient import TestClient

from simgame.storage import reset_data_files
from simgame.webapp import create_app


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_workforce_shift_leave_fields() -> None:
    reset_data_files()
    c = TestClient(create_app())
    c.post('/api/reset')
    s = c.get('/api/state').json()
    sid = s['stations'][0]['station_id']
    c.post('/api/stores', json={'store_id': 'L1', 'name': 'L1', 'station_id': sid, 'build_days': 0})
    c.put('/api/stores/L1', json={
        'status': 'open',
        'workforce': {
            'planned_headcount': 12,
            'current_headcount': 12,
            'planned_leave_rate_day': 0.20,
            'planned_leave_rate_night': 0.10,
            'sick_leave_rate_day': 0.05,
            'sick_leave_rate_night': 0.03,
        },
    })
    c.post('/api/simulate', json={'days': 1})
    s2 = c.get('/api/state').json()
    st = [x for x in s2['stores'] if x['store_id'] == 'L1'][0]
    wf = st.get('workforce', {})
    _assert(float(wf.get('planned_leave_rate_day', 0)) == 0.20, 'planned_leave_rate_day should persist')
    _assert(float(wf.get('sick_leave_rate_night', 0)) == 0.03, 'sick_leave_rate_night should persist')

    ledger_csv = c.get('/download/ledger').text
    rows = [r for r in csv.DictReader(io.StringIO(ledger_csv)) if (r.get('store_id') or '') == 'L1']
    _assert(len(rows) > 0, 'ledger rows for L1 should exist')
    last = rows[-1]
    _assert('workforce_leave_planned' in last and 'workforce_leave_sick' in last, 'ledger should include leave breakdown')


def test_finance_allocation_method_credit_usage() -> None:
    reset_data_files()
    c = TestClient(create_app())
    c.post('/api/reset')
    s = c.get('/api/state').json()
    sid = s['stations'][0]['station_id']
    c.post('/api/stores', json={'store_id': 'F1', 'name': 'F1', 'station_id': sid, 'build_days': 2, 'capex_total': 200000})
    c.put('/api/finance', json={
        'hq_credit_limit': 500000,
        'hq_daily_interest_rate': 0.001,
        'capex_cash_payment_ratio': 0.0,
        'finance_cost_allocation_method': 'credit_usage',
    })
    c.post('/api/simulate', json={'days': 1})

    s2 = c.get('/api/state').json()
    fin = s2.get('finance', {})
    _assert(str(fin.get('finance_cost_allocation_method')) == 'credit_usage', 'allocation method should persist')
    st = [x for x in s2['stores'] if x['store_id'] == 'F1'][0]
    _assert(float(st.get('finance_credit_used', 0.0)) > 0.0, 'store should track finance_credit_used')

    ledger_csv = c.get('/download/ledger').text
    rows = [r for r in csv.DictReader(io.StringIO(ledger_csv)) if (r.get('store_id') or '') == 'F1']
    _assert(len(rows) > 0, 'ledger rows for F1 should exist')
    last = rows[-1]
    _assert(float(last.get('finance_interest_allocated') or 0.0) >= 0.0, 'finance_interest_allocated should exist')
    _assert(float(last.get('finance_capex_financed') or 0.0) > 0.0, 'finance_capex_financed should be > 0')


def test_bi_productivity_and_rolling_budget_present() -> None:
    reset_data_files()
    c = TestClient(create_app())
    c.post('/api/reset')
    s = c.get('/api/state').json()
    sid = s['stations'][0]['station_id']
    c.post('/api/stores', json={'store_id': 'B1', 'name': 'B1', 'station_id': sid, 'build_days': 0})
    c.put('/api/stores/B1', json={'status': 'open'})
    c.put('/api/finance', json={'rolling_budget_window_days': 14})
    c.post('/api/simulate', json={'days': 2})

    s2 = c.get('/api/state').json()
    fin = s2.get('finance', {})
    rb = fin.get('rolling_budget', {})
    _assert(int(rb.get('window_days', 0)) == 14, 'rolling budget window should be 14')
    _assert('revenue_momentum_vs_prev_window' in rb, 'rolling budget should include momentum')

    prod = (s2.get('insights', {}) or {}).get('productivity', {})
    _assert(isinstance(prod.get('by_region', []), list), 'productivity.by_region should be list')
    _assert(isinstance(prod.get('trend_daily', []), list), 'productivity.trend_daily should be list')


def test_async_simulate_job_flow() -> None:
    reset_data_files()
    c = TestClient(create_app())
    c.post('/api/reset')
    r = c.post('/api/simulate/async', json={'days': 2})
    _assert(r.status_code == 200, 'async simulate create should return 200')
    j = r.json()
    job_id = str(j.get('job_id') or '')
    _assert(job_id.startswith('sim_'), 'job_id should be generated')

    final_status = ''
    for _ in range(50):
        s = c.get(f'/api/simulate/jobs/{job_id}').json()
        final_status = str(s.get('status') or '')
        if final_status in {'succeeded', 'failed', 'cancelled'}:
            break
        time.sleep(0.05)
    _assert(final_status == 'succeeded', f'async simulate should succeed, got {final_status}')


def test_auto_workforce_tuning_adjusts_shift_and_budget() -> None:
    reset_data_files()
    c = TestClient(create_app())
    c.post('/api/reset')
    s = c.get('/api/state').json()
    sid = s['stations'][0]['station_id']
    c.post('/api/stores', json={'store_id': 'AT1', 'name': 'AT1', 'station_id': sid, 'build_days': 0})
    c.put('/api/stores/AT1', json={
        'status': 'open',
        'workforce': {
            'planned_headcount': 12,
            'current_headcount': 6,
            'shifts_per_day': 2,
            'staffing_per_shift': 6,
            'recruiting_enabled': True,
            'recruiting_daily_budget': 0,
            'recruiting_lead_days': 1,
            'recruiting_hire_rate_per_100_budget': 0.5,
            'auto_schedule_enabled': True,
            'auto_recruit_budget_enabled': True,
            'auto_target_coverage': 0.9,
            'auto_productivity_floor': 250,
            'auto_recruit_budget_min': 100,
            'auto_recruit_budget_max': 2000,
        },
    })
    c.post('/api/simulate', json={'days': 1})
    s2 = c.get('/api/state').json()
    st = [x for x in s2['stores'] if x['store_id'] == 'AT1'][0]
    wf = st.get('workforce', {})
    _assert(int(wf.get('staffing_per_shift', 0)) == 5, 'auto schedule should move staffing_per_shift by one step')
    _assert(float(wf.get('recruiting_daily_budget', 0.0)) >= 100.0, 'auto recruit budget should be suggested')


def test_finance_structure_and_rate_scenario_compare() -> None:
    reset_data_files()
    c = TestClient(create_app())
    c.post('/api/reset')
    c.put('/api/finance', json={
        'hq_short_credit_limit': 300000,
        'hq_short_daily_interest_rate': 0.001,
        'hq_medium_credit_limit': 500000,
        'hq_medium_daily_interest_rate': 0.0004,
        'hq_credit_draw_mix_short_ratio': 0.8,
        'hq_auto_finance': True,
    })
    s = c.get('/api/state').json()
    fin = s.get('finance', {})
    _assert(float(fin.get('hq_short_credit_limit', 0.0)) == 300000.0, 'short limit should persist')
    _assert(float(fin.get('hq_medium_daily_interest_rate', 0.0)) == 0.0004, 'medium rate should persist')

    r = c.post('/api/finance/scenarios/compare', json={
        'days': 7,
        'scenarios': [
            {
                'name': 'short-heavy',
                'finance_patch': {
                    'hq_short_daily_interest_rate': 0.0012,
                    'hq_medium_daily_interest_rate': 0.00045,
                    'hq_credit_draw_mix_short_ratio': 0.9,
                },
            },
            {
                'name': 'medium-heavy',
                'finance_patch': {
                    'hq_short_daily_interest_rate': 0.0008,
                    'hq_medium_daily_interest_rate': 0.00035,
                    'hq_credit_draw_mix_short_ratio': 0.4,
                },
            },
        ],
    })
    _assert(r.status_code == 200, 'finance scenario compare should return 200')
    j = r.json()
    _assert(isinstance(j.get('scenarios'), list) and len(j.get('scenarios')) == 2, 'finance compare should include 2 scenarios')
    _assert('baseline' in j and 'total_finance_interest' in (j.get('baseline') or {}), 'baseline metrics should include finance interest')


def test_bi_decision_loop_suggest_backtest_apply() -> None:
    reset_data_files()
    c = TestClient(create_app())
    c.post('/api/reset')
    s = c.get('/api/state').json()
    sid = s['stations'][0]['station_id']
    c.post('/api/stores', json={'store_id': 'D1', 'name': 'D1', 'station_id': sid, 'build_days': 0})
    c.put('/api/stores/D1', json={
        'status': 'open',
        'workforce': {
            'planned_headcount': 10,
            'current_headcount': 4,
            'auto_schedule_enabled': False,
            'auto_recruit_budget_enabled': False,
        },
    })
    c.post('/api/simulate', json={'days': 2})

    r1 = c.post('/api/bi/actions/suggest', json={'limit': 10})
    _assert(r1.status_code == 200, 'bi suggest should return 200')
    actions = r1.json().get('actions') or []
    _assert(isinstance(actions, list) and len(actions) > 0, 'bi suggest should return actions')

    r2 = c.post('/api/bi/actions/backtest', json={'days': 7, 'actions': actions})
    _assert(r2.status_code == 200, 'bi backtest should return 200')
    j2 = r2.json()
    _assert('delta_vs_baseline' in j2, 'bi backtest should include delta')

    r3 = c.post('/api/bi/actions/apply', json={'actions': actions})
    _assert(r3.status_code == 200, 'bi apply should return 200')
    s2 = c.get('/api/state').json()
    st = [x for x in s2['stores'] if x['store_id'] == 'D1'][0]
    wf = st.get('workforce', {})
    _assert(bool(wf.get('auto_schedule_enabled', False)) or bool(wf.get('auto_recruit_budget_enabled', False)), 'apply should update workforce automation')




def test_bi_action_template_and_rollback() -> None:
    reset_data_files()
    c = TestClient(create_app())
    c.post('/api/reset')
    s = c.get('/api/state').json()
    sid = s['stations'][0]['station_id']
    c.post('/api/stores', json={'store_id': 'R1', 'name': 'R1', 'station_id': sid, 'build_days': 0})
    c.put('/api/stores/R1', json={
        'status': 'open',
        'workforce': {
            'planned_headcount': 10,
            'current_headcount': 4,
            'auto_schedule_enabled': False,
            'auto_recruit_budget_enabled': False,
        },
    })
    c.post('/api/simulate', json={'days': 2})

    r1 = c.post('/api/bi/actions/suggest', json={'limit': 10})
    _assert(r1.status_code == 200, 'bi suggest should return 200')
    actions = r1.json().get('actions') or []
    _assert(len(actions) > 0, 'bi suggest should provide actions')

    r2 = c.post('/api/bi/action-templates', json={'name': 'wf-pack', 'description': 'wf template', 'actions': actions})
    _assert(r2.status_code == 200, 'bi action template upsert should return 200')

    r3 = c.post('/api/bi/action-templates/wf-pack/apply', json={})
    _assert(r3.status_code == 200, 'bi action template apply should return 200')

    s2 = c.get('/api/state').json()
    checkpoints = (((s2.get('bi_actions') or {}).get('checkpoints')) or [])
    _assert(len(checkpoints) > 0, 'apply template should create checkpoints')

    st2 = [x for x in s2['stores'] if x['store_id'] == 'R1'][0]
    wf2 = st2.get('workforce', {})
    _assert(bool(wf2.get('auto_schedule_enabled', False)) or bool(wf2.get('auto_recruit_budget_enabled', False)), 'apply template should update workforce automation')

    cp_id = str(checkpoints[0].get('checkpoint_id') or '')
    _assert(bool(cp_id), 'checkpoint id should exist')
    r4 = c.post('/api/bi/actions/rollback', json={'checkpoint_id': cp_id})
    _assert(r4.status_code == 200, 'bi rollback should return 200')

    s3 = c.get('/api/state').json()
    st3 = [x for x in s3['stores'] if x['store_id'] == 'R1'][0]
    wf3 = st3.get('workforce', {})
    _assert(bool(wf3.get('auto_schedule_enabled', False)) is False and bool(wf3.get('auto_recruit_budget_enabled', False)) is False, 'rollback should restore workforce automation flags')

def main() -> None:
    tests = [
        test_workforce_shift_leave_fields,
        test_finance_allocation_method_credit_usage,
        test_bi_productivity_and_rolling_budget_present,
        test_async_simulate_job_flow,
        test_auto_workforce_tuning_adjusts_shift_and_budget,
        test_finance_structure_and_rate_scenario_compare,
        test_bi_decision_loop_suggest_backtest_apply,
        test_bi_action_template_and_rollback,
    ]
    for t in tests:
        t()
        print(f'OK  {t.__name__}')
    print(f'ALL OK ({len(tests)} tests)')


if __name__ == '__main__':
    main()
