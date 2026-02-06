export interface Station {
  station_id: string;
  name: string;
  station_type?: string;
  city?: string;
  district?: string;
  provider?: string;
  map_x?: number;
  map_y?: number;
  fuel_vehicles_per_day: number;
  visitor_vehicles_per_day: number;
  traffic_volatility: number;
}

export interface Store {
  store_id: string;
  name: string;
  station_id: string;
  city?: string;
  district?: string;
  provider?: string;
  status: 'planning' | 'constructing' | 'open' | 'closed';
  build_days: number;
  operation_start_day?: number;
  traffic_conversion_rate?: number;
  local_competition_intensity?: number;
  attractiveness_index?: number;
  mitigation?: {
    use_emergency_power?: boolean;
    emergency_capacity_multiplier?: number;
    emergency_variable_cost_multiplier?: number;
    emergency_daily_cost?: number;
    use_promo_boost?: boolean;
    promo_traffic_boost?: number;
    promo_conversion_boost?: number;
    promo_daily_cost?: number;
    use_overtime_capacity?: boolean;
    overtime_capacity_boost?: number;
    overtime_daily_cost?: number;
  };
  auto_replenishment_enabled?: boolean;
  replenishment_rules?: Array<{
    sku: string;
    name?: string;
    enabled?: boolean;
    reorder_point?: number;
    safety_stock?: number;
    target_stock?: number;
    lead_time_days?: number;
    unit_cost?: number;
  }>;
  pending_inbounds?: Array<{
    sku: string;
    name?: string;
    qty: number;
    unit_cost: number;
    order_day: number;
    arrive_day: number;
  }>;
  workforce?: {
    planned_headcount?: number;
    current_headcount?: number;
    training_level?: number;
    daily_turnover_rate?: number;
    recruiting_enabled?: boolean;
    recruiting_daily_budget?: number;
    recruiting_lead_days?: number;
    recruiting_hire_rate_per_100_budget?: number;
    shifts_per_day?: number;
    staffing_per_shift?: number;
    shift_hours?: number;
    overtime_shift_enabled?: boolean;
    overtime_shift_extra_capacity?: number;
    overtime_shift_daily_cost?: number;
    skill_by_category?: {
      wash?: number;
      maintenance?: number;
      detailing?: number;
      other?: number;
    };
    shift_allocation_by_category?: {
      wash?: number;
      maintenance?: number;
      detailing?: number;
      other?: number;
    };
    skill_by_role?: {
      技师?: number;
      店长?: number;
      销售?: number;
      客服?: number;
    };
    shift_allocation_by_role?: {
      技师?: number;
      店长?: number;
      销售?: number;
      客服?: number;
    };
  };
  pending_hires?: Array<{
    qty: number;
    order_day: number;
    arrive_day: number;
  }>;
  labor_hour_price?: number;
  capex_total: number;
  capex_useful_life_days: number;
  construction_days_remaining: number;
  capex_spend_per_day?: number;
  fixed_overhead_per_day: number;
  strict_parts?: boolean; // mapped from 'on' or undefined
  cash_balance: number; // Simulated derived field
  inventory: InventoryItem[];
  assets: Asset[];
  services: ServiceLine[];
  projects: ServiceProject[];
  roles: PayrollRole[];

  // Derived from backend
  today?: {
    day: number;
    revenue: number;
    operating_profit: number;
    net_cashflow: number;
    revenue_by_category?: Record<string, number>;
    status: string;
  };
  payroll_preview?: Array<{
    role: string;
    level?: string;
    headcount: number;
    fixed: number;
    wash_commission: number;
    maintenance_commission: number;
    detailing_commission: number;
    sales_commission: number;
    labor_commission?: number;
    parts_commission?: number;
    total: number;
  }>;
  beq_orders_per_day?: number;
  payback_days_30d?: number;
}

export interface InventoryItem {
  sku: string;
  name: string;
  unit_cost: number;
  qty: number;
}

export interface Asset {
  index: number;
  asset_name: string;
  capex: number;
  useful_life_days: number;
  in_service_day: number;
}

export interface ServiceLine {
  service_id: string;
  name: string;
  category?: 'wash' | 'maintenance' | 'detailing' | 'other';
  price: number;
  conversion_from_fuel: number;
  conversion_from_visitor: number;
  capacity_per_day: number;
  variable_cost_per_order: number;
  parts_cost_ratio?: number;
  variable_labor_per_order?: number;
  labor_role?: string;
  labor_hours_per_order?: number;
  consumable_sku?: string;
  consumable_units_per_order?: number;
  project_mix_json?: string; 
}

export interface ServiceProject {
  project_id: string;
  name: string;
  price: number;
  labor_hours: number;
  variable_cost?: number;
  parts_json?: string;
}

export interface PayrollRole {
  role: string;
  level: string; // e.g., "Senior", "Junior", "L1"
  headcount: number;
  // Fixed Compensation
  base_monthly: number;
  position_allowance: number; // 岗位津贴
  social_security_rate: number; // 社保缴纳比例 (Employer side)
  housing_fund_rate: number; // 公积金缴纳比例 (Employer side)
  // Variable Incentives
  labor_commission_rate: number; // 工时提成 %
  parts_commission_rate: number; // 配件提成 %
  parts_commission_base?: 'revenue' | 'gross_profit';
  sales_commission_rate: number; // 销售提成 %
  wash_commission_base?: 'revenue' | 'gross_profit';
  wash_commission_rate?: number; // 洗车提成 %
  maintenance_commission_base?: 'revenue' | 'gross_profit';
  maintenance_commission_rate?: number; // 维保提成 %
  detailing_commission_base?: 'revenue' | 'gross_profit';
  detailing_commission_rate?: number; // 洗美提成 %
  profit_share_rate?: number; // 利润分红 %
  // Efficiency
  min_monthly_orders_threshold?: number; // 保底单量
  overtime_pay_rate?: number; // 加班费率
}

export interface SimulationState {
  day: number;
  cash: number;
  finance?: {
    hq_credit_limit: number;
    hq_credit_used: number;
    hq_daily_interest_rate: number;
    hq_auto_finance: boolean;
    budget_monthly_revenue_target?: number;
    budget_monthly_profit_target?: number;
    budget_monthly_cashflow_target?: number;
    budget_mtd?: {
      month_start_day: number;
      month_end_day: number;
      day_in_month: number;
      progress: number;
      revenue: number;
      profit: number;
      cashflow: number;
    };
  };
  insights?: {
    alerts: Array<{ level: string; code: string; message: string }>;
  };
  stations: Station[];
  stores: Store[];
  ledger: LedgerEntry[];

  events?: {
    rng_seed: number;
    templates: EventTemplate[];
    active: ActiveEvent[];
    history: EventHistoryRecord[];
  };
}

export type EventScope = 'global' | 'station' | 'store';

export interface EventTemplate {
  template_id: string;
  name: string;
  event_type: string;
  enabled: boolean;
  daily_probability: number;
  duration_days_min: number;
  duration_days_max: number;
  cooldown_days: number;
  intensity_min: number;
  intensity_max: number;
  scope: EventScope;
  target_strategy?: 'random_one' | 'all';
  store_closed?: boolean;
  traffic_multiplier_min?: number;
  traffic_multiplier_max?: number;
  conversion_multiplier_min?: number;
  conversion_multiplier_max?: number;
  capacity_multiplier_min?: number;
  capacity_multiplier_max?: number;
  variable_cost_multiplier_min?: number;
  variable_cost_multiplier_max?: number;
}

export interface ActiveEvent {
  event_id: string;
  template_id: string;
  name: string;
  event_type: string;
  scope: EventScope;
  target_id: string;
  start_day: number;
  end_day: number;
  intensity: number;
  store_closed: boolean;
  traffic_multiplier: number;
  conversion_multiplier: number;
  capacity_multiplier: number;
  variable_cost_multiplier: number;
}

export interface EventHistoryRecord extends ActiveEvent {
  created_day: number;
}

export interface LedgerEntry {
  day: number;
  store_id: string;
  category: string;
  amount: number;
  description: string;
  revenue?: number;
  operating_profit?: number;
  net_cashflow?: number;
  status?: string;
}

export interface SiteRecommendation {
  station_id: string;
  station_name: string;
  city?: string;
  district?: string;
  provider?: string;
  demand_index: number;
  nearest_open_distance: number;
  covered_by_existing: boolean;
  uncovered_demand: number;
  recommendation_score: number;
  distance_confidence?: number;
  already_has_open_store: boolean;
  score_breakdown?: {
    demand_component: number;
    coverage_component: number;
  };
}

export interface ScenarioMetrics {
  days: number;
  end_day: number;
  end_cash: number;
  total_revenue: number;
  total_operating_profit: number;
  total_net_cashflow: number;
  avg_daily_orders: number;
  open_store_count: number;
}

export interface ScenarioCompareResult {
  days: number;
  seed?: number;
  baseline: ScenarioMetrics;
  scenarios: Array<{
    name: string;
    metrics: ScenarioMetrics;
    delta_vs_baseline: {
      total_revenue: number;
      total_operating_profit: number;
      total_net_cashflow: number;
      avg_daily_orders: number;
    };
  }>;
}
