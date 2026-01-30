import { SimulationState } from '../types';

export const initialMockState: SimulationState = {
  day: 45,
  cash: 124500,
  stations: [
    {
      station_id: "S1",
      name: "市中心枢纽站",
      station_type: "城市站",
      city: "上海",
      district: "静安",
      provider: "服务商A",
      map_x: 45,
      map_y: 42,
      fuel_vehicles_per_day: 1200,
      visitor_vehicles_per_day: 100,
      traffic_volatility: 0.1
    },
    {
      station_id: "S2",
      name: "高速42号出口",
      station_type: "高速站",
      city: "上海",
      district: "青浦",
      provider: "服务商B",
      map_x: 68,
      map_y: 60,
      fuel_vehicles_per_day: 2500,
      visitor_vehicles_per_day: 50,
      traffic_volatility: 0.2
    }
  ],
  stores: [
    {
      store_id: "M1",
      name: "市中心汽修旗舰店",
      station_id: "S1",
      city: "上海",
      district: "静安",
      provider: "服务商A",
      status: "open",
      build_days: 30,
      operation_start_day: 1,
      traffic_conversion_rate: 1.0,
      capex_total: 150000,
      capex_useful_life_days: 3650,
      construction_days_remaining: 0,
      fixed_overhead_per_day: 200,
      strict_parts: true,
      cash_balance: 14200,
      inventory: [
        { sku: "OIL-syn-5w30", name: "全合成机油 5w30", unit_cost: 12, qty: 150 },
        { sku: "FIL-001", name: "通用机滤", unit_cost: 3, qty: 200 }
      ],
      assets: [
        { index: 0, asset_name: "举升机 A", capex: 5000, useful_life_days: 3650, in_service_day: 1 },
        { index: 1, asset_name: "举升机 B", capex: 5000, useful_life_days: 3650, in_service_day: 1 }
      ],
      services: [
        { 
          service_id: "WASH_AUTO", name: "自动洗车", price: 12, 
          category: "wash",
          conversion_from_fuel: 0.15, conversion_from_visitor: 0.05, 
          capacity_per_day: 200, variable_cost_per_order: 1.5 
        },
        { 
          service_id: "OIL_CHANGE", name: "全套换油保养", price: 45, 
          category: "maintenance",
          conversion_from_fuel: 0.02, conversion_from_visitor: 0.1, 
          capacity_per_day: 20, variable_cost_per_order: 15,
          labor_role: "Technician", labor_hours_per_order: 0.5
        }
      ],
      projects: [
        { project_id: "P1", name: "发动机深度清洁", price: 100, labor_hours: 1.5, variable_cost: 10 }
      ],
      roles: [
        { 
          role: "店长", level: "M2", headcount: 1, 
          base_monthly: 6000, position_allowance: 1500,
          social_security_rate: 0.3, housing_fund_rate: 0.12,
          labor_commission_rate: 0, parts_commission_rate: 0, sales_commission_rate: 0.02,
          wash_commission_rate: 0.01, maintenance_commission_rate: 0.02, detailing_commission_rate: 0.0,
          profit_share_rate: 0.05 
        },
        { 
          role: "高级技师", level: "T3", headcount: 2, 
          base_monthly: 3500, position_allowance: 500,
          social_security_rate: 0.3, housing_fund_rate: 0.12,
          labor_commission_rate: 0.4, parts_commission_rate: 0.05, sales_commission_rate: 0.01,
          wash_commission_rate: 0.0, maintenance_commission_rate: 0.03, detailing_commission_rate: 0.01,
          min_monthly_orders_threshold: 50
        },
        { 
          role: "学徒", level: "T1", headcount: 2, 
          base_monthly: 2200, position_allowance: 200,
          social_security_rate: 0.3, housing_fund_rate: 0,
          labor_commission_rate: 0.15, parts_commission_rate: 0, sales_commission_rate: 0,
          wash_commission_rate: 0.01, maintenance_commission_rate: 0.0, detailing_commission_rate: 0.0
        }
      ]
    },
    {
      store_id: "M2",
      name: "高速快修点",
      station_id: "S2",
      city: "上海",
      district: "青浦",
      provider: "服务商B",
      status: "constructing",
      build_days: 45,
      operation_start_day: 1,
      traffic_conversion_rate: 1.0,
      capex_total: 200000,
      capex_useful_life_days: 3650,
      construction_days_remaining: 12,
      fixed_overhead_per_day: 150,
      cash_balance: -50000,
      inventory: [],
      assets: [],
      services: [],
      projects: [],
      roles: []
    }
  ],
  ledger: Array.from({ length: 20 }, (_, i) => ({
    day: 45 - i,
    store_id: "M1",
    category: i % 2 === 0 ? "收入" : "支出",
    amount: i % 2 === 0 ? 3500 + (Math.random() * 500) : -1200 - (Math.random() * 200),
    description: i % 2 === 0 ? "当日营业额" : "库存补充"
  }))
};
