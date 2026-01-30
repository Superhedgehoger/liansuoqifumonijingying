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
  stations: Station[];
  stores: Store[];
  ledger: LedgerEntry[];
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
