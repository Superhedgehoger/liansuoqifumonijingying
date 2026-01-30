from __future__ import annotations

from typing import Dict, Tuple

from simgame.models import GameState, ServiceLine, Store


def format_money(x: float) -> str:
    return f"{x:,.2f}"


def compute_beq_for_store(store: Store, day_depr: float) -> Tuple[float, Dict[str, float]]:
    """Return (store_beq_orders_per_day, per_service_beq).

    For simplicity, store BEQ uses blended unit contribution weighted by current prices,
    but if multiple service lines exist, per-service BEQ is also reported.
    """

    fixed_cost = _fixed_cost_per_day(store, day_depr)

    per: Dict[str, float] = {}
    contributions = []
    for sid, line in store.service_lines.items():
        contrib = _unit_contribution(line)
        if contrib > 0:
            per[sid] = fixed_cost / contrib
            contributions.append(contrib)

    if not contributions:
        return float("inf"), per

    blended = sum(contributions) / float(len(contributions))
    if blended <= 0:
        return float("inf"), per
    return fixed_cost / blended, per


def _unit_contribution(line: ServiceLine) -> float:
    return float(line.price) - float(line.variable_cost_per_order) - float(line.variable_labor_per_order) - (
        float(line.price) * float(line.parts_cost_ratio)
    )


def _fixed_cost_per_day(store: Store, day_depr: float) -> float:
    base_daily = 0.0
    for rp in store.payroll.roles.values():
        base_daily += rp.base_daily()
    return base_daily + float(day_depr) + float(store.fixed_overhead_per_day)


def print_last_day(state: GameState) -> None:
    if not state.ledger:
        print("暂无数据。")
        return
    dr = state.ledger[-1]
    print(f"\n=== 第 {dr.day} 天（日结）===")
    print(f"现金余额: {format_money(state.cash)}")
    print(f"总收入: {format_money(dr.total_revenue)}  总经营利润: {format_money(dr.total_operating_profit)}  总净现金流: {format_money(dr.total_net_cashflow)}")
    for sr in dr.store_results:
        print(f"\n[{sr.store_name}] 状态: {sr.status}")
        if sr.status != "open":
            if sr.cash_out:
                print(f"建设/其他支出: {format_money(sr.cash_out)}")
            continue
        print(f"车流(加油/访客): {sr.fuel_traffic}/{sr.visitor_traffic}")
        if sr.orders_by_service:
            for sid, n in sr.orders_by_service.items():
                print(f"- {sid}: {n} 单")
        if sr.orders_by_project:
            print("项目:")
            for pid, n in sr.orders_by_project.items():
                print(f"- {pid}: {n} 单")
        print(
            "  ".join(
                [
                    f"收入 {format_money(sr.revenue)}",
                    f"变动成本 {format_money(sr.variable_cost)}",
                    f"人工 {format_money(sr.labor_cost)}",
                    f"折旧 {format_money(sr.depreciation_cost)}",
                    f"固定费 {format_money(sr.fixed_overhead)}",
                    f"经营利润 {format_money(sr.operating_profit)}",
                    f"净现金流 {format_money(sr.net_cashflow)}",
                ]
            )
        )


def print_store_month_to_date(store: Store) -> None:
    print(f"\n=== {store.name}（月累计）===")
    print(f"收入: {format_money(store.mtd_revenue)}")
    print(f"变动成本: {format_money(store.mtd_variable_cost)}  配件/材料: {format_money(store.mtd_parts_cogs)}")
    print(f"人工: {format_money(store.mtd_labor_cost)}  折旧: {format_money(store.mtd_depr_cost)}  固定费: {format_money(store.mtd_fixed_overhead)}")
    print(f"经营利润: {format_money(store.mtd_operating_profit)}")
    print(f"现金流入: {format_money(store.mtd_cash_in)}  现金流出: {format_money(store.mtd_cash_out)}")
    if store.mtd_orders_by_service:
        print("订单数:")
        for sid, n in store.mtd_orders_by_service.items():
            print(f"- {sid}: {n}")
