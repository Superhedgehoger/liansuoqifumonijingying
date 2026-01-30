from __future__ import annotations

from simgame.models import PayrollPlan, RolePlan, ServiceLine, ServiceProject, Store


def apply_default_store_template(store: Store) -> None:
    """Apply a runnable default template to a store.

    This is shared by CLI and WebUI.
    """

    store.fixed_overhead_per_day = store.fixed_overhead_per_day or 200.0
    store.strict_parts = True

    # Service lines
    store.service_lines["AUTO_WASH"] = ServiceLine(
        service_id="AUTO_WASH",
        name="自动洗车",
        category="wash",
        price=30.0,
        conversion_from_fuel=0.05,
        conversion_from_visitor=0.10,
        capacity_per_day=250,
        variable_cost_per_order=3.0,
        parts_cost_ratio=0.0,
        variable_labor_per_order=0.3,
        consumable_sku="CHEM",
        consumable_units_per_order=0.05,
    )
    store.service_lines["MANUAL_WASH"] = ServiceLine(
        service_id="MANUAL_WASH",
        name="人工洗车",
        category="wash",
        price=45.0,
        conversion_from_fuel=0.03,
        conversion_from_visitor=0.06,
        capacity_per_day=80,
        variable_cost_per_order=5.0,
        parts_cost_ratio=0.0,
        variable_labor_per_order=3.0,
        consumable_sku="CHEM",
        consumable_units_per_order=0.10,
    )

    # Projects (auto service)
    store.projects["OIL_CHANGE"] = ServiceProject(
        project_id="OIL_CHANGE",
        name="换机油",
        price=299.0,
        labor_hours=0.8,
        variable_cost=5.0,
        parts={"OIL": 4.0, "FILTER": 1.0},
    )
    store.projects["TIRE_REPAIR"] = ServiceProject(
        project_id="TIRE_REPAIR",
        name="补胎",
        price=80.0,
        labor_hours=0.5,
        variable_cost=2.0,
        parts={"PATCH": 1.0},
    )
    store.projects["WIPER"] = ServiceProject(
        project_id="WIPER",
        name="更换雨刮",
        price=120.0,
        labor_hours=0.2,
        variable_cost=1.0,
        parts={"WIPER_BLADE": 2.0},
    )
    store.service_lines["AUTO_SERVICE"] = ServiceLine(
        service_id="AUTO_SERVICE",
        name="综合汽服",
        category="maintenance",
        price=200.0,
        conversion_from_fuel=0.01,
        conversion_from_visitor=0.02,
        capacity_per_day=30,
        variable_cost_per_order=1.0,
        parts_cost_ratio=0.55,
        variable_labor_per_order=0.0,
        labor_role="技师",
        labor_hours_per_order=0.6,
        project_mix=[("OIL_CHANGE", 0.45), ("TIRE_REPAIR", 0.35), ("WIPER", 0.20)],
    )

    # Payroll
    store.payroll = PayrollPlan(
        roles={
            "店长": RolePlan(role="店长", headcount=1, base_monthly=8000.0, profit_share_rate=0.03),
            "洗车员": RolePlan(
                role="洗车员",
                headcount=3,
                base_monthly=4500.0,
                piece_rate={"MANUAL_WASH": 4.0, "AUTO_WASH": 0.5},
                monthly_tier_bonus=[(1500, 300.0), (2200, 600.0)],
            ),
            "技师": RolePlan(
                role="技师",
                headcount=2,
                base_monthly=7000.0,
                piece_rate_project={"OIL_CHANGE": 25.0, "TIRE_REPAIR": 10.0, "WIPER": 8.0},
                gross_profit_commission_by_service={"AUTO_SERVICE": 0.05},
            ),
            "前台": RolePlan(
                role="前台",
                headcount=1,
                base_monthly=4500.0,
                sales_commission_by_service={"AUTO_WASH": 0.01, "MANUAL_WASH": 0.01, "AUTO_SERVICE": 0.008},
            ),
        }
    )
