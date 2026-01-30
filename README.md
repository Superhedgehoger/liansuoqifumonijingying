# 加油站汽服门店模拟（CLI）

一个轻量的命令行“模拟经营”小项目（v0.6.0）：模拟加油站汽服门店（自动洗车/人工洗车/综合汽服占位），重点跑通建设期CAPEX、折旧、耗材库存、薪酬体系、盈亏平衡（BEQ）。

## 运行

要求：Python 3.10+（更低版本通常也可）。

```bash
python run.py
```

## 一键启动（推荐）

- 后端 API + 新前端（两个窗口 + 自动打开浏览器）：双击 `start_dev.bat`
- 默认启动：双击 `start.bat`

## 新前端（React/Vite）

前端代码在：`simulator/`。已接入后端 JSON API（`/api/*`），建议开发模式运行：

1) 启动后端：

```bat
python web_run.py
```

2) 启动前端：

```bat
cd /d C:\Users\DJY\Documents\OpencodePJ\连锁汽服经营模拟\simulator
npm install
npm run dev
```

3) 打开前端页面：

- `http://127.0.0.1:3000/`

说明：Vite 已配置代理，将 `/api` 与 `/download` 转发到后端 `http://127.0.0.1:8000`。

## 表单路由（导入/导出/运维）

后端提供一个不依赖旧 WebUI 模板的简单表单页面：

- `http://127.0.0.1:8000/ops`

支持上传替换 `state.json` / `ledger.csv`（会自动备份），以及一键模拟/重置。

## 测试建议

1) 双击 `start_dev.bat`
2) 在前端依次测试：
   - 站点：新增/编辑（地市/片区/服务商）/删除
   - 门店：新建（开始运营日、客流转化倍率）
   - 门店详情页：
     - 概览配置：保存
     - 服务线：新增/编辑/删除
     - 项目：新增/删除
     - 库存：采购入库
     - 固定资产：新增/删除
     - 薪酬：新增岗位/删除岗位（人数变化）
   - 模拟：过一天/过一周
3) 对照 `data/state.json` 与 `data/ledger.csv` 是否有变化

## 运行后在哪里查看

- 终端输出：每次选择 `过一天（日结）` 会打印当天日报
- 存档文件：`data/state.json`（自动保存，下一次启动会自动读取）
- 流水导出：`data/ledger.csv`（每过一天追加一行/店/天的明细，可用 Excel 打开）

后端 API 会写入同一份 `data/state.json` 与 `data/ledger.csv`。

如果出现中文乱码，可尝试在 Windows 终端先执行：

```bat
chcp 65001
python -X utf8 run.py
```

## 玩法（菜单）

- 站点：新增/配置加油车辆与访客车辆（日流量+波动）
- 门店：新增门店（可设置建设期天数与CAPEX）
- 服务线：配置自动洗车/人工洗车等参数（价格、转化率、产能、成本）
- 库存：采购耗材并在订单发生时扣减
- 薪酬：配置角色底薪、计件、阶梯奖、利润提成（按月结算）
- 过一天：出日报，记录收入、成本、经营利润、净现金流
- 报表：月累计、盈亏平衡（BEQ）

## 文档

- `C:\Users\DJY\Documents\OpencodePJ\连锁汽服经营模拟\最小升级方案-加油站汽服.md`
- `C:\Users\DJY\Documents\OpencodePJ\连锁汽服经营模拟\规划-加油站汽服连锁.md`
- `C:\Users\DJY\Documents\OpencodePJ\连锁汽服经营模拟\开源参考-连锁经营.md`
