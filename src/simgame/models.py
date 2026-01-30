from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


@dataclass
class Station:
    station_id: str
    name: str
    station_type: str = ""  # e.g. 城市站/高速站/乡镇站
    city: str = ""
    district: str = ""
    provider: str = ""
    map_x: float = 0.0
    map_y: float = 0.0
    fuel_vehicles_per_day: int = 600
    visitor_vehicles_per_day: int = 10
    traffic_volatility: float = 0.10


@dataclass
class ServiceLine:
    service_id: str
    name: str
    price: float
    conversion_from_fuel: float
    conversion_from_visitor: float
    capacity_per_day: int
    variable_cost_per_order: float

    category: str = "other"  # wash|maintenance|detailing|other
    parts_cost_ratio: float = 0.0
    variable_labor_per_order: float = 0.0

    # Optional: capacity derived from labor (e.g. tech hours)
    labor_role: Optional[str] = None
    labor_hours_per_order: float = 0.0

    # Optional: simple consumable usage
    consumable_sku: Optional[str] = None
    consumable_units_per_order: float = 0.0

    # Optional: for auto-service, split into projects (mix weights)
    project_mix: List[Tuple[str, float]] = field(default_factory=list)


@dataclass
class ServiceProject:
    project_id: str
    name: str
    price: float
    labor_hours: float
    variable_cost: float = 0.0  # non-inventory variable costs
    parts: Dict[str, float] = field(default_factory=dict)  # sku -> qty


@dataclass
class Asset:
    name: str
    capex: float
    useful_life_days: int
    in_service_day: int

    def depreciation_per_day(self) -> float:
        if self.useful_life_days <= 0:
            return 0.0
        return self.capex / float(self.useful_life_days)

    def depreciation_on_day(self, day: int) -> float:
        if day < self.in_service_day:
            return 0.0
        age = day - self.in_service_day
        if age >= self.useful_life_days:
            return 0.0
        return self.depreciation_per_day()


@dataclass
class InventoryItem:
    sku: str
    name: str
    unit_cost: float
    qty: float


@dataclass
class RolePlan:
    role: str
    headcount: int
    level: str = ""
    base_monthly: float = 0.0
    position_allowance: float = 0.0
    social_security_rate: float = 0.0
    housing_fund_rate: float = 0.0
    workdays_per_month: int = 26

    # Per-order piece rates by service_id
    piece_rate: Dict[str, float] = field(default_factory=dict)

    # Per-order piece rates by project_id (for auto-service)
    piece_rate_project: Dict[str, float] = field(default_factory=dict)

    # Commission rates (0-1)
    sales_commission_by_service: Dict[str, float] = field(default_factory=dict)  # revenue based
    gross_profit_commission_by_service: Dict[str, float] = field(default_factory=dict)
    gross_profit_commission_by_project: Dict[str, float] = field(default_factory=dict)

    # Monthly tier bonuses: list of (threshold_orders, bonus_amount)
    monthly_tier_bonus: List[Tuple[int, float]] = field(default_factory=list)

    # Profit share: applied on monthly operating profit (>=0)
    profit_share_rate: float = 0.0

    # Broad commission rates (0-1). These are optional, UI-friendly fields.
    labor_commission_rate: float = 0.0
    parts_commission_rate: float = 0.0
    sales_commission_rate: float = 0.0

    # Category commission (0-1). Base can be revenue or gross_profit.
    wash_commission_base: str = "revenue"  # revenue|gross_profit
    wash_commission_rate: float = 0.0
    maintenance_commission_base: str = "revenue"  # revenue|gross_profit
    maintenance_commission_rate: float = 0.0
    detailing_commission_base: str = "revenue"  # revenue|gross_profit
    detailing_commission_rate: float = 0.0

    # Parts commission base
    parts_commission_base: str = "revenue"  # revenue|gross_profit

    # Threshold/efficiency (optional)
    min_monthly_orders_threshold: int = 0
    overtime_pay_rate: float = 0.0

    def base_daily(self) -> float:
        wd = max(1, int(self.workdays_per_month))
        base = float(self.base_monthly) + float(self.position_allowance)
        # Employer contributions (approx)
        base *= 1.0 + max(0.0, float(self.social_security_rate)) + max(0.0, float(self.housing_fund_rate))
        return (base * max(0, int(self.headcount))) / float(wd)


@dataclass
class PayrollPlan:
    roles: Dict[str, RolePlan] = field(default_factory=dict)


@dataclass
class OnlineBizConfig:
    enabled: bool = True
    daily_orders_mean: float = 2.0
    daily_orders_std: float = 0.5
    avg_ticket: float = 200.0
    margin_rate: float = 0.15


@dataclass
class InsuranceBizConfig:
    enabled: bool = True
    daily_revenue_target: float = 128.4
    volatility: float = 0.10
    margin_rate: float = 0.20


@dataclass
class UsedCarBizConfig:
    enabled: bool = True
    monthly_deal_target: float = 1.56
    revenue_per_deal: float = 1200.0
    profit_per_deal: float = 600.0


@dataclass
class SupplyChainConfig:
    enabled: bool = True
    cost_reduction_rate: float = 0.03


@dataclass
class BizConfig:
    online: OnlineBizConfig = field(default_factory=OnlineBizConfig)
    insurance: InsuranceBizConfig = field(default_factory=InsuranceBizConfig)
    used_car: UsedCarBizConfig = field(default_factory=UsedCarBizConfig)
    supply_chain: SupplyChainConfig = field(default_factory=SupplyChainConfig)


@dataclass
class RentConfig:
    monthly_cost: float = 15000.0
    allocation_strategy: str = "daily"  # daily


@dataclass
class UtilitiesConfig:
    water_cost_per_wash: float = 1.5
    elec_daily_base: float = 50.0
    elec_cost_per_wash: float = 0.8
    elec_cost_per_maint: float = 2.0


@dataclass
class OpexConfig:
    rent: RentConfig = field(default_factory=RentConfig)
    utilities: UtilitiesConfig = field(default_factory=UtilitiesConfig)


@dataclass
class Store:
    store_id: str
    name: str
    station_id: str

    # Grouping
    city: str = ""
    district: str = ""
    provider: str = ""

    status: str = "planning"  # planning|constructing|open|closed
    build_days_total: int = 0
    operation_start_day: int = 1
    traffic_conversion_rate: float = 1.0
    construction_days_remaining: int = 0

    # Labor pricing for "labor revenue proportion" on projects
    labor_hour_price: float = 120.0
    capex_total: float = 0.0
    capex_spend_per_day: float = 0.0
    capex_useful_life_days: int = 5 * 365

    cash_balance: float = 0.0

    fixed_overhead_per_day: float = 0.0
    service_lines: Dict[str, ServiceLine] = field(default_factory=dict)
    projects: Dict[str, ServiceProject] = field(default_factory=dict)
    inventory: Dict[str, InventoryItem] = field(default_factory=dict)
    assets: List[Asset] = field(default_factory=list)
    payroll: PayrollPlan = field(default_factory=PayrollPlan)

    # Value-added businesses & cost reduction configs
    biz_config: BizConfig = field(default_factory=BizConfig)

    # Operating expenses
    opex_config: OpexConfig = field(default_factory=OpexConfig)

    # If true, projects must be fulfilled with inventory parts; otherwise fallback to cost ratio.
    strict_parts: bool = True

    # Internal monthly trackers
    mtd_orders_by_service: Dict[str, int] = field(default_factory=dict)
    mtd_orders_by_project: Dict[str, int] = field(default_factory=dict)
    mtd_revenue: float = 0.0
    mtd_variable_cost: float = 0.0
    mtd_parts_cogs: float = 0.0
    mtd_labor_cost: float = 0.0
    mtd_depr_cost: float = 0.0
    mtd_fixed_overhead: float = 0.0
    mtd_operating_profit: float = 0.0
    mtd_cash_in: float = 0.0
    mtd_cash_out: float = 0.0

    def reset_month_trackers(self) -> None:
        self.mtd_orders_by_service = {}
        self.mtd_orders_by_project = {}
        self.mtd_revenue = 0.0
        self.mtd_variable_cost = 0.0
        self.mtd_parts_cogs = 0.0
        self.mtd_labor_cost = 0.0
        self.mtd_depr_cost = 0.0
        self.mtd_fixed_overhead = 0.0
        self.mtd_operating_profit = 0.0
        self.mtd_cash_in = 0.0
        self.mtd_cash_out = 0.0


@dataclass
class DayStoreResult:
    store_id: str
    store_name: str
    station_id: str
    status: str

    fuel_traffic: int = 0
    visitor_traffic: int = 0
    orders_by_service: Dict[str, int] = field(default_factory=dict)
    orders_by_project: Dict[str, int] = field(default_factory=dict)

    revenue_by_service: Dict[str, float] = field(default_factory=dict)
    gross_profit_by_service: Dict[str, float] = field(default_factory=dict)
    gross_profit_by_project: Dict[str, float] = field(default_factory=dict)

    # Extra breakdowns (used by exports/UI)
    revenue_by_category: Dict[str, float] = field(default_factory=dict)
    gross_profit_by_category: Dict[str, float] = field(default_factory=dict)
    parts_cogs_by_project: Dict[str, float] = field(default_factory=dict)
    labor_revenue: float = 0.0
    parts_revenue: float = 0.0
    parts_gross_profit: float = 0.0

    # Value-added streams
    rev_online: float = 0.0
    gp_online: float = 0.0
    rev_insurance: float = 0.0
    gp_insurance: float = 0.0
    rev_used_car: float = 0.0
    gp_used_car: float = 0.0
    count_used_car: int = 0

    # OPEX
    cost_rent: float = 0.0
    cost_water: float = 0.0
    cost_elec: float = 0.0
    revenue: float = 0.0
    variable_cost: float = 0.0
    parts_cogs: float = 0.0
    labor_cost: float = 0.0
    depreciation_cost: float = 0.0
    fixed_overhead: float = 0.0
    operating_profit: float = 0.0

    cash_in: float = 0.0
    cash_out: float = 0.0
    net_cashflow: float = 0.0


@dataclass
class DayResult:
    day: int
    store_results: List[DayStoreResult] = field(default_factory=list)

    total_revenue: float = 0.0
    total_operating_profit: float = 0.0
    total_net_cashflow: float = 0.0


@dataclass
class GameState:
    day: int = 1
    cash: float = 200_000.0

    stations: Dict[str, Station] = field(default_factory=dict)
    stores: Dict[str, Store] = field(default_factory=dict)
    ledger: List[DayResult] = field(default_factory=list)

    def month_day_index(self, month_len: int) -> int:
        # 1..month_len
        return ((self.day - 1) % month_len) + 1
