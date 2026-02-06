# 更新日志

## 0.7.4

- 完成 P2 收口并启动 P3：
  - 人力生命周期基础：编制/在岗/培训、日流失、招聘预算与提前期（pending hires）
  - 总部融资基础：`hq_credit_limit`、`hq_daily_interest_rate`、`hq_auto_finance`、自动还款
  - BI 预警基础：现金、授信占用、人手缺口、安全库存预警（`insights.alerts`）
- 新增 API：`PUT /api/finance`
- P3-next：新增班次排班参数（班次数/每班配置/加班班次），接入产能因子计算
- P3-next：新增技能矩阵与业态分配（`skill_by_category` / `shift_allocation_by_category`），服务线产能按业态细分
- P3-next：新增岗位技能/岗位班次分配（`skill_by_role` / `shift_allocation_by_role`），对 `labor_role` 服务线做精细产能修正
- 审计增强：日流水新增 `workforce_breakdown_json`，记录人力产能分解快照
- 预算扩展：`/api/finance` 支持月度预算目标，`finance.budget_mtd` 返回当月进度与 MTD 实际
- 日流水增强：新增人力与补货/对冲相关审计字段

## 0.7.3

- 完成 P2 中期能力：
  - 事件对冲动作：应急供电 / 临时促销 / 加班扩容（`mitigation`）
  - 自动补货：触发点 + 安全库存 + 目标库存 + 提前期（replenishment rules + pending inbounds）
  - 选址可达性：`distance_mode=road_proxy|road_graph|euclidean`，`road_graph` 支持 `graph_k_neighbors`
- 账本增强：新增 `mitigation_cost`、`mitigation_actions_json`、`replenishment_cost`、`replenishment_orders_json`、`inbound_arrivals_json`
- API 增加：`POST /api/stores/{store_id}/replenishment/rules`、`DELETE /api/stores/{store_id}/replenishment/rules/{sku}`
- 新增回归脚本：`tools/test_p2_midterm.py`（3 项）

## 0.7.2

- 完成 P1 策略能力：新增选址推荐 API（`/api/site-recommendations`）与前端策略实验页（`/strategy`）
- 新增竞品分流参数：门店支持 `local_competition_intensity` 与 `attractiveness_index`，并接入订单计算
- 新增场景对比 API（`/api/scenarios/compare`）：同初始状态并行仿真，返回 baseline 与场景 delta 指标
- P2-1 进展：选址推荐支持 `distance_mode=road_proxy|euclidean`，默认 `road_proxy`
- P2-2 进展：新增 `distance_mode=road_graph`（站点图最短路近似）与 `graph_k_neighbors` 参数，推荐结果增加 `distance_confidence` 与 `score_breakdown`

## 0.7.1

- 新增随机事件系统：事件模板/生效事件/历史记录，支持 scope（global/站点/门店）、持续时间与 cooldown
- 引擎支持可复现随机：state 持久化 `rng_seed` + `rng_state`，分段多次 simulate 也保持一致
- 账本增强：`data/ledger.csv` 增加 `store_closed`、各倍率字段与 `event_summary_json` 便于审计回放
- API 增加事件管理端点：seed 设置、模板增删改、手动注入、事件查询
- 前端新增 `事件管理` 页面：模板 CRUD、注入、active/history 展示
- 新增最小测试脚本：`tools/test_events.py`

## 0.6.10

- 薪酬提成口径升级：洗车/维保/洗美提成支持按“收入/毛利”，配件提成支持按“配件收入/配件毛利”
- 新增工时提成口径：按项目“工时收入占比”拆分工时收入并计提，门店支持配置 `labor_hour_price`
- 账本字段扩展：`data/ledger.csv` 追加毛利/分类/项目/工时/配件等分解字段，提升工资预览与导出准确性
- 工资导出增强：`/download/payroll` 增加工时提成/配件提成列，并按口径计算
- 前端配置补齐：门店概览可编辑工时单价；薪酬角色支持选择各类提成“口径”

## 0.6.6

- 站点属性增加类型：`station_type`
- 总览看板：按钮文案“导出游戏存档”改为“导出模拟数据”（直连下载 state.json）
- 地图分析：支持热力图/卫星图切换，站点按 类型/地市/片区/服务商 分组筛选，点击列表或图钉可居中定位并查看详细面板

## 0.6.7

- 修复回归：地图分析 > 站点网络，点击 marker 必定显示站点信息弹窗，并支持默认展示/关闭/切换
- 弹窗内容补齐：站点标题/ID/今日营收/净盈亏/状态 + 查看详情按钮

## 0.6.8

- 模拟控制增强：支持回退 1-365 天与重置模拟数据（基于每日快照 snapshots）

## 0.6.9

- 新增经营看板指标：门店今日营收/净盈亏、BEQ(单/日)、30日回本(天)
- 报表页导出改为真实下载：`/download/ledger`、`/download/payroll`
- 新增 JSON API 文档：`API-JSON.md`

## 0.6.5

- 薪酬提成细分：按业态收入计提“洗车/维保/洗美”提成（基于服务线 category）
- 服务线增加 `category` 字段（wash/maintenance/detailing/other），前端新增/编辑服务线可选择

## 0.6.4

- 新增“全量 state 刷新”模式的门店详情操作接口：服务线/项目/资产/库存采购/薪酬角色（新增/删除/保存）
- 站点/门店增加分组字段：地市/片区/服务商（可在前端填写并通过 API 存档）
- 门店增加开始运营时间 `operation_start_day`，以及门店级客流转化倍率 `traffic_conversion_rate`（会影响订单量）
- 前端门店详情页各 Tab 的新增/删除/保存已接到后端 API（modal 表单可用）

## 0.6.3

- 新增后端 JSON API（给 `simulator/` 前端用）：`/api/state`、`/api/simulate`、`/api/stations/*`、`/api/stores/*`
- Web 后端增加 CORS（开发时允许 Vite 访问）
- 新前端接入 API：新增 `simulator/services/api.ts`，并在 `simulator/App.tsx` 用后端替换原本的本地 mock dispatch（站点/开店/模拟）
- Vite 增加代理：`/api`、`/download` -> `http://127.0.0.1:8000`
- 数据模型补齐前端字段（如 `build_days`、`cash_balance`、更细的薪酬字段），并写入/读取 `data/state.json`

## 0.6.2

- WebUI 增强：站点/门店/服务线/项目/薪酬/资产等可编辑
- 报表页支持筛选并展示订单 JSON

## 0.6.1

- 增加 `data/state.json` 自动存档与 `data/ledger.csv` 流水导出
- 增加一键启动 WebUI（并打开默认浏览器）
