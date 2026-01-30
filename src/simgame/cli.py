from __future__ import annotations

import random
from pathlib import Path
from typing import Optional

from simgame.engine import EngineConfig, close_store, purchase_inventory, simulate_day
from simgame.models import PayrollPlan, RolePlan, ServiceLine, ServiceProject, Station, Store, GameState
from simgame.presets import apply_default_store_template
from simgame.reporting import compute_beq_for_store, format_money, print_last_day, print_store_month_to_date
from simgame.storage import append_ledger_csv, load_state, save_state, state_path


def _input_int(prompt: str, default: Optional[int] = None) -> Optional[int]:
    s = input(prompt).strip()
    if not s:
        return default
    try:
        return int(s)
    except ValueError:
        print("输入无效：请输入整数。")
        return None


def _input_float(prompt: str, default: Optional[float] = None) -> Optional[float]:
    s = input(prompt).strip()
    if not s:
        return default
    try:
        return float(s)
    except ValueError:
        print("输入无效：请输入数字。")
        return None


def _pick_store_id(state: GameState) -> Optional[str]:
    if not state.stores:
        print("暂无门店。")
        return None
    print("门店列表:")
    for sid, st in state.stores.items():
        print(f"- {sid}: {st.name}（站点 {st.station_id}，状态 {st.status}）")
    return input("选择门店ID: ").strip() or None


def _pick_station_id(state: GameState) -> Optional[str]:
    if not state.stations:
        print("暂无站点。")
        return None
    print("站点列表:")
    for sid, st in state.stations.items():
        print(f"- {sid}: {st.name}（加油车/日 {st.fuel_vehicles_per_day}，访客/日 {st.visitor_vehicles_per_day}）")
    return input("选择站点ID: ").strip() or None


def _default_state() -> GameState:
    # Seed with 1 station + 1 store, to make it runnable immediately.
    state = GameState()
    station = Station(station_id="S1", name="样例加油站", fuel_vehicles_per_day=700, visitor_vehicles_per_day=10)
    state.stations[station.station_id] = station

    store = Store(store_id="M1", name="样例汽服门店", station_id=station.station_id)
    store.status = "open"
    store.fixed_overhead_per_day = 200.0
    apply_default_store_template(store)

    # Inventory baseline
    from simgame.models import InventoryItem
    store.inventory["CHEM"] = InventoryItem(sku="CHEM", name="洗车液(升)", unit_cost=20.0, qty=200.0)
    store.inventory["OIL"] = InventoryItem(sku="OIL", name="机油(升)", unit_cost=35.0, qty=200.0)
    store.inventory["FILTER"] = InventoryItem(sku="FILTER", name="机滤(个)", unit_cost=25.0, qty=60.0)
    store.inventory["PATCH"] = InventoryItem(sku="PATCH", name="补胎胶片(个)", unit_cost=3.0, qty=300.0)
    store.inventory["WIPER_BLADE"] = InventoryItem(sku="WIPER_BLADE", name="雨刮条(根)", unit_cost=18.0, qty=120.0)

    state.stores[store.store_id] = store
    return state


def _apply_template_to_store(store: Store) -> None:
    apply_default_store_template(store)


def _print_state(state: GameState) -> None:
    print("\n------------------------------")
    print(f"第 {state.day} 天")
    print(f"现金: {format_money(state.cash)}")
    print(f"站点数: {len(state.stations)}  门店数: {len(state.stores)}")
    print("------------------------------\n")


def _cmd_station_config(state: GameState) -> None:
    sid = _pick_station_id(state)
    if not sid or sid not in state.stations:
        print("站点不存在。")
        return
    st = state.stations[sid]
    v = _input_int(f"加油车辆/日（当前 {st.fuel_vehicles_per_day}）: ", st.fuel_vehicles_per_day)
    if v is not None:
        st.fuel_vehicles_per_day = max(0, v)
    vv = _input_int(f"访客车辆/日（当前 {st.visitor_vehicles_per_day}）: ", st.visitor_vehicles_per_day)
    if vv is not None:
        st.visitor_vehicles_per_day = max(0, vv)
    vol = _input_float(f"波动系数0-1（当前 {st.traffic_volatility}）: ", st.traffic_volatility)
    if vol is not None:
        st.traffic_volatility = max(0.0, min(1.0, vol))


def _cmd_add_station(state: GameState) -> None:
    sid = input("新站点ID（如 S2）: ").strip()
    if not sid:
        print("站点ID不能为空。")
        return
    if sid in state.stations:
        print("站点ID已存在。")
        return
    name = input("站点名称: ").strip() or sid
    fuel_in = _input_int("加油车辆/日: ", 600)
    if fuel_in is None:
        fuel_in = 600
    visitor_in = _input_int("访客车辆/日: ", 10)
    if visitor_in is None:
        visitor_in = 10
    vol_in = _input_float("波动系数0-1: ", 0.1)
    if vol_in is None:
        vol_in = 0.1

    fuel = int(fuel_in)
    visitor = int(visitor_in)
    vol = float(vol_in)
    state.stations[sid] = Station(
        station_id=sid,
        name=name,
        fuel_vehicles_per_day=max(0, fuel),
        visitor_vehicles_per_day=max(0, visitor),
        traffic_volatility=max(0.0, min(1.0, vol)),
    )


def _cmd_add_store(state: GameState) -> None:
    station_id = _pick_station_id(state)
    if not station_id or station_id not in state.stations:
        print("站点不存在。")
        return
    store_id = input("新门店ID（如 M2）: ").strip()
    if not store_id:
        print("门店ID不能为空。")
        return
    if store_id in state.stores:
        print("门店ID已存在。")
        return
    name = input("门店名称: ").strip() or store_id
    build_days = _input_int("建设期天数（0=立即开业）: ", 30)
    if build_days is None:
        return
    assert build_days is not None
    capex = _input_float("CAPEX总额（设备/装修等）: ", 120000.0)
    if capex is None:
        return
    assert capex is not None
    build_days_i = int(build_days)
    capex_f = float(capex)
    capex_spend_per_day = capex_f / max(1, build_days_i) if build_days_i > 0 else 0.0

    store = Store(store_id=store_id, name=name, station_id=station_id)
    if build_days_i > 0:
        store.status = "constructing"
        store.construction_days_remaining = build_days_i
        store.capex_total = capex_f
        store.capex_spend_per_day = float(capex_spend_per_day)
    else:
        store.status = "open"
        store.capex_total = capex_f
        # Put into service immediately
        from simgame.models import Asset

        store.assets.append(Asset(name=f"{store.name}-CAPEX", capex=capex_f, useful_life_days=5 * 365, in_service_day=state.day))

    store.fixed_overhead_per_day = 200.0
    store.strict_parts = True
    _apply_template_to_store(store)
    state.stores[store_id] = store
    print("已创建门店。建议下一步：配置服务线/薪酬/耗材。")


def _cmd_close_store(state: GameState) -> None:
    store_id = _pick_store_id(state)
    if not store_id or store_id not in state.stores:
        return
    store = state.stores[store_id]
    if store.status == "closed":
        print("该门店已关停。")
        return
    inv_rate = _input_float("库存清算回收率(0-1，默认0.3): ", 0.30)
    asset_rate = _input_float("资产处置回收率(0-1，默认0.1): ", 0.10)
    if inv_rate is None or asset_rate is None:
        return
    recovered = close_store(state, store_id=store_id, inventory_salvage_rate=inv_rate, asset_salvage_rate=asset_rate)
    print(f"已关停 {store.name}，回收现金 {format_money(recovered)}，现金余额 {format_money(state.cash)}")


def _cmd_config_service_lines(state: GameState) -> None:
    store_id = _pick_store_id(state)
    if not store_id or store_id not in state.stores:
        print("门店不存在。")
        return
    store = state.stores[store_id]

    print("\n1) 添加/覆盖服务线  2) 修改服务线  3) 删除服务线")
    sub = input("选择: ").strip()
    if sub == "1":
        sid = input("服务线ID（如 AUTO_WASH）: ").strip()
        if not sid:
            return
        name = input("名称: ").strip() or sid
        price = _input_float("客单价: ", 30.0)
        conv_f = _input_float("加油车转化率(0-1): ", 0.05)
        conv_v = _input_float("访客转化率(0-1): ", 0.10)
        cap = _input_int("日最大产能(单): ", 100)
        vc = _input_float("单笔变动成本(耗材/水电等): ", 3.0)
        plr = _input_float("材料/配件成本率(0-1，综合汽服可用): ", 0.0)
        vl = _input_float("单笔人工变动成本(用于BEQ，可选): ", 0.0)
        sku = input("耗材SKU（可空）: ").strip() or None
        units = _input_float("每单耗材用量（可空）: ", 0.0)
        if price is None or conv_f is None or conv_v is None or cap is None or vc is None or plr is None or vl is None or units is None:
            return

        price_f = float(price)
        conv_f_f = float(conv_f)
        conv_v_f = float(conv_v)
        cap_i = int(cap)
        vc_f = float(vc)
        plr_f = float(plr)
        vl_f = float(vl)
        units_f = float(units)
        store.service_lines[sid] = ServiceLine(
            service_id=sid,
            name=name,
            price=price_f,
            conversion_from_fuel=max(0.0, min(1.0, conv_f_f)),
            conversion_from_visitor=max(0.0, min(1.0, conv_v_f)),
            capacity_per_day=max(0, cap_i),
            variable_cost_per_order=max(0.0, vc_f),
            parts_cost_ratio=max(0.0, min(1.0, plr_f)),
            variable_labor_per_order=max(0.0, vl_f),
            consumable_sku=sku,
            consumable_units_per_order=max(0.0, units_f),
        )
        print("已保存服务线。")
        return

    if sub == "2":
        if not store.service_lines:
            print("该门店暂无服务线。")
            return
        print("服务线:")
        for sid, line in store.service_lines.items():
            print(f"- {sid}: {line.name} 价{line.price} 转化(油/访){line.conversion_from_fuel}/{line.conversion_from_visitor} 产能{line.capacity_per_day}")
        sid = input("选择服务线ID: ").strip()
        line = store.service_lines.get(sid)
        if not line:
            print("服务线不存在。")
            return
        p = _input_float(f"客单价（当前 {line.price}）: ", line.price)
        if p is not None:
            line.price = max(0.0, p)
        cf = _input_float(f"加油转化率（当前 {line.conversion_from_fuel}）: ", line.conversion_from_fuel)
        if cf is not None:
            line.conversion_from_fuel = max(0.0, min(1.0, cf))
        cv = _input_float(f"访客转化率（当前 {line.conversion_from_visitor}）: ", line.conversion_from_visitor)
        if cv is not None:
            line.conversion_from_visitor = max(0.0, min(1.0, cv))
        cap = _input_int(f"日产能（当前 {line.capacity_per_day}）: ", line.capacity_per_day)
        if cap is not None:
            line.capacity_per_day = max(0, cap)
        vc = _input_float(f"单笔变动成本（当前 {line.variable_cost_per_order}）: ", line.variable_cost_per_order)
        if vc is not None:
            line.variable_cost_per_order = max(0.0, vc)
        plr = _input_float(f"材料成本率（当前 {line.parts_cost_ratio}）: ", line.parts_cost_ratio)
        if plr is not None:
            line.parts_cost_ratio = max(0.0, min(1.0, plr))
        vl = _input_float(f"单笔人工变动成本（当前 {line.variable_labor_per_order}）: ", line.variable_labor_per_order)
        if vl is not None:
            line.variable_labor_per_order = max(0.0, vl)
        sku = input(f"耗材SKU（当前 {line.consumable_sku or ''}，回车保持）: ").strip()
        if sku:
            line.consumable_sku = sku
        units = _input_float(f"每单耗材用量（当前 {line.consumable_units_per_order}）: ", line.consumable_units_per_order)
        if units is not None:
            line.consumable_units_per_order = max(0.0, units)
        print("已更新服务线。")
        return

    if sub == "3":
        sid = input("要删除的服务线ID: ").strip()
        if sid in store.service_lines:
            del store.service_lines[sid]
            print("已删除。")
        else:
            print("服务线不存在。")


def _cmd_purchase_consumables(state: GameState) -> None:
    store_id = _pick_store_id(state)
    if not store_id or store_id not in state.stores:
        print("门店不存在。")
        return
    sku = input("SKU（如 CHEM/OIL/FILTER）: ").strip()
    if not sku:
        return
    name = input("名称: ").strip() or sku
    unit_cost = _input_float("单价: ", 20.0)
    qty = _input_float("数量: ", 10.0)
    if unit_cost is None or qty is None:
        return
    paid = purchase_inventory(state, store_id=store_id, sku=sku, name=name, unit_cost=unit_cost, qty=qty)
    if paid <= 0:
        print("采购失败：现金不足或参数无效。")
        return
    print(f"已采购，支出 {format_money(paid)}。现金余额 {format_money(state.cash)}")


def _cmd_payroll_config(state: GameState) -> None:
    store_id = _pick_store_id(state)
    if not store_id or store_id not in state.stores:
        print("门店不存在。")
        return
    store = state.stores[store_id]
    print("\n1) 新增/覆盖角色  2) 修改角色  3) 删除角色")
    sub = input("选择: ").strip()

    if sub == "1":
        role = input("角色名（店长/洗车员/技师等）: ").strip()
        if not role:
            return
        headcount = _input_int("编制人数: ", 1)
        base = _input_float("底薪/月（可为0）: ", 0.0)
        wd = _input_int("月出勤天数（默认26）: ", 26)
        ps = _input_float("利润提成比例（仅月末发放，0-1，可空）: ", 0.0)
        if headcount is None or base is None or wd is None or ps is None:
            return
        assert headcount is not None and base is not None and wd is not None and ps is not None
        headcount_i = int(headcount)
        base_f = float(base)
        wd_i = int(wd)
        ps_f = float(ps)
        rp = RolePlan(role=role, headcount=max(0, headcount_i), base_monthly=max(0.0, base_f), workdays_per_month=max(1, wd_i))
        rp.profit_share_rate = max(0.0, min(1.0, ps_f))

        # Piece rates
        if store.service_lines:
            print("按单计件（可空）")
            for sid in store.service_lines.keys():
                rate = _input_float(f"- {sid} 每单计件: ", 0.0)
                if rate is None:
                    continue
                if rate > 0:
                    rp.piece_rate[sid] = float(rate)

        if store.projects:
            print("按项目计件（综合汽服，可空）")
            for pid in store.projects.keys():
                rate = _input_float(f"- {pid} 每单计件: ", 0.0)
                if rate is None:
                    continue
                if rate > 0:
                    rp.piece_rate_project[pid] = float(rate)

        if store.service_lines:
            print("销售提成（按收入，0-1，可空）")
            for sid in store.service_lines.keys():
                r = _input_float(f"- {sid} 收入提成率: ", 0.0)
                if r is None:
                    continue
                if r > 0:
                    rp.sales_commission_by_service[sid] = max(0.0, min(1.0, float(r)))

            print("毛利提成（按毛利，0-1，可空）")
            for sid in store.service_lines.keys():
                r = _input_float(f"- {sid} 毛利提成率: ", 0.0)
                if r is None:
                    continue
                if r > 0:
                    rp.gross_profit_commission_by_service[sid] = max(0.0, min(1.0, float(r)))

        if store.projects:
            print("项目毛利提成（按项目毛利，0-1，可空）")
            for pid in store.projects.keys():
                r = _input_float(f"- {pid} 毛利提成率: ", 0.0)
                if r is None:
                    continue
                if r > 0:
                    rp.gross_profit_commission_by_project[pid] = max(0.0, min(1.0, float(r)))

        # Tier bonuses (simple)
        print("阶梯奖金（按月总单量，最多两档；可回车跳过）")
        t1 = _input_int("- 档1阈值(单): ", 0)
        b1 = _input_float("- 档1奖金(元): ", 0.0)
        t2 = _input_int("- 档2阈值(单): ", 0)
        b2 = _input_float("- 档2奖金(元): ", 0.0)
        for t, b in ((t1, b1), (t2, b2)):
            if t and b and t > 0 and b > 0:
                rp.monthly_tier_bonus.append((int(t), float(b)))

        store.payroll.roles[role] = rp
        print("已保存角色方案。")
        return

    if sub == "2":
        if not store.payroll.roles:
            print("该门店暂无薪酬角色。")
            return
        print("角色:")
        for r, rp in store.payroll.roles.items():
            print(f"- {r}: 人数{rp.headcount} 底薪/月{rp.base_monthly} 利润提成{rp.profit_share_rate}")
        role = input("选择角色名: ").strip()
        rp = store.payroll.roles.get(role)
        if not rp:
            print("角色不存在。")
            return
        hc = _input_int(f"编制人数（当前 {rp.headcount}）: ", rp.headcount)
        if hc is not None:
            rp.headcount = max(0, hc)
        base = _input_float(f"底薪/月（当前 {rp.base_monthly}）: ", rp.base_monthly)
        if base is not None:
            rp.base_monthly = max(0.0, base)
        ps = _input_float(f"利润提成（当前 {rp.profit_share_rate}）: ", rp.profit_share_rate)
        if ps is not None:
            rp.profit_share_rate = max(0.0, min(1.0, ps))
        print("已更新。")
        return

    if sub == "3":
        role = input("要删除的角色名: ").strip()
        if role in store.payroll.roles:
            del store.payroll.roles[role]
            print("已删除。")
        else:
            print("角色不存在。")


def _cmd_reports(state: GameState) -> None:
    print("\n1) 查看最后一天  2) 查看门店月累计  3) 查看门店盈亏平衡(BEQ)")
    sub = input("选择: ").strip()
    if sub == "1":
        print_last_day(state)
        return
    if sub == "2":
        store_id = _pick_store_id(state)
        if not store_id or store_id not in state.stores:
            return
        print_store_month_to_date(state.stores[store_id])
        return
    if sub == "3":
        store_id = _pick_store_id(state)
        if not store_id or store_id not in state.stores:
            return
        store = state.stores[store_id]
        day_depr = 0.0
        for a in store.assets:
            day_depr += a.depreciation_on_day(state.day)
        beq, per = compute_beq_for_store(store, day_depr=day_depr)
        print(f"\n=== {store.name} 盈亏平衡(BEQ) ===")
        if beq == float("inf"):
            print("无法计算：贡献毛利<=0 或无服务线。")
            return
        print(f"门店（粗略）BEQ: {beq:.1f} 单/日")
        if per:
            print("按服务线（假设全靠该服务线覆盖固定成本）的 BEQ:")
            for sid, v in per.items():
                print(f"- {sid}: {v:.1f} 单/日")
        return


def _cmd_site_selection_placeholder(_: GameState) -> None:
    print("\n=== 选址/扩张（轻量版）===")
    print("按站点加油车流量做简单排序（不含GIS/覆盖约束）。")


def _cmd_recommend_sites(state: GameState) -> None:
    if not state.stations:
        print("暂无站点。")
        return
    print("\n站点推荐（按加油车辆/日降序）:")
    ranked = sorted(state.stations.values(), key=lambda s: s.fuel_vehicles_per_day, reverse=True)
    for s in ranked:
        # Small heuristic: expected wash orders per day using default conversion
        expected = s.fuel_vehicles_per_day * 0.05
        print(f"- {s.station_id} {s.name}: 加油{ s.fuel_vehicles_per_day }/日  预估自动洗车订单≈{expected:.1f}/日")


def _cmd_open_store_from_template(state: GameState) -> None:
    station_id = _pick_station_id(state)
    if not station_id or station_id not in state.stations:
        print("站点不存在。")
        return
    store_id = input("新门店ID（如 M100）: ").strip()
    if not store_id:
        return
    if store_id in state.stores:
        print("门店ID已存在。")
        return
    name = input("门店名称: ").strip() or store_id
    build_days = _input_int("建设期天数（0=立即开业）: ", 30)
    if build_days is None:
        return
    capex = _input_float("CAPEX总额（设备/装修等）: ", 150000.0)
    if capex is None:
        return
    build_days_i = int(build_days)
    capex_f = float(capex)

    store = Store(store_id=store_id, name=name, station_id=station_id)
    store.fixed_overhead_per_day = 200.0
    store.strict_parts = True
    _apply_template_to_store(store)

    if build_days_i > 0:
        store.status = "constructing"
        store.construction_days_remaining = build_days_i
        store.capex_total = capex_f
        store.capex_spend_per_day = capex_f / max(1, build_days_i)
    else:
        store.status = "open"
        store.capex_total = capex_f
        from simgame.models import Asset

        store.assets.append(Asset(name=f"{store.name}-CAPEX", capex=capex_f, useful_life_days=5 * 365, in_service_day=state.day))

    state.stores[store_id] = store
    print("已用模板创建门店。")


def _cmd_chain_menu(state: GameState) -> None:
    print("\n1) 查看推荐站点  2) 用模板在站点开店")
    sub = input("选择: ").strip()
    if sub == "1":
        _cmd_recommend_sites(state)
    elif sub == "2":
        _cmd_open_store_from_template(state)
    else:
        print("无效选项。")


def _autosave(state: GameState) -> None:
    try:
        save_state(state)
    except Exception as e:
        print(f"保存失败：{e}")


def _autoload_or_new() -> GameState:
    p = state_path()
    if p.exists():
        try:
            st = load_state(p)
            return st
        except Exception as e:
            print(f"读取存档失败：{e}。将创建新档。")
    return _default_state()


def main() -> int:
    random.seed()
    cfg = EngineConfig(month_len_days=30)
    state = _autoload_or_new()

    print("加油站汽服门店模拟（CLI）")
    print("核心：建设期CAPEX/折旧/耗材库存/薪酬体系/盈亏平衡（BEQ）。\n")

    while True:
        _print_state(state)
        print("1) 新增站点")
        print("2) 配置站点流量")
        print("3) 新增门店（支持建设期）")
        print("4) 配置服务线（自动洗车/人工洗车/综合汽服占位）")
        print("5) 采购耗材/库存")
        print("6) 配置薪酬方案")
        print("7) 过一天（日结）")
        print("8) 报表/BEQ")
        print("9) 选址/扩张推荐")
        print("10) 关店/处置")
        print("11) 保存存档")
        print("0) 退出")

        try:
            choice = input("选择: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n再见。")
            return 0

        if choice == "1":
            _cmd_add_station(state)
        elif choice == "2":
            _cmd_station_config(state)
        elif choice == "3":
            _cmd_add_store(state)
        elif choice == "4":
            _cmd_config_service_lines(state)
        elif choice == "5":
            _cmd_purchase_consumables(state)
        elif choice == "6":
            _cmd_payroll_config(state)
        elif choice == "7":
            dr = simulate_day(state, cfg)
            try:
                append_ledger_csv(dr)
            except Exception as e:
                print(f"导出ledger失败：{e}")
            _autosave(state)
            print_last_day(state)
        elif choice == "8":
            _cmd_reports(state)
        elif choice == "9":
            _cmd_site_selection_placeholder(state)
            _cmd_chain_menu(state)
            _autosave(state)
        elif choice == "10":
            _cmd_close_store(state)
            _autosave(state)
        elif choice == "11":
            _autosave(state)
        elif choice == "0":
            _autosave(state)
            print("再见。")
            return 0
        else:
            print("无效选项：请输入 0-11。")
