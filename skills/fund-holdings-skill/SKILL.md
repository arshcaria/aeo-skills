---
name: fund-holdings-history
summary: "获取公募基金历年半年报/年报完整持仓并输出为Excel"
description: |
  通过天天基金(eastmoney) API获取任意公募基金的历年持仓数据，
  自动筛选半年报(6/30)和年报(12/31)的完整持仓明细，
  并结合基金规模数据计算资产构成（股票/其他资产占比），
  输出为结构化Excel文件（每期一个Sheet + 概览Sheet）。
read_when:
  - 用户要求获取基金的历年持仓/持仓明细/完整持仓
  - 用户要求导出基金半年报或年报持仓数据
  - 用户要求分析基金的资产构成或仓位变化
  - 用户要求获取基金的完整持仓（而非仅前十大重仓）
---

# 基金历史持仓获取工具

## 用途

获取任意公募基金的历年**半年报（6/30）和年报（12/31）完整持仓明细**，并输出为结构化 Excel。

## 核心能力

1. **持仓明细**：通过天天基金 `FundArchivesDatas.aspx?type=jjcc` API 获取各年所有报告期的持仓
2. **自动筛选**：只保留半年报和年报（完整持仓），剔除季报（仅前十大）
3. **基金规模**：通过 `type=gmbd` API 获取各季度末基金净资产（AUM）
4. **资产构成**：计算股票持仓占比、其他资产（债券/现金等）占比
5. **持仓市值占比**：新增计算列 = 个股持仓市值 / 该期股票持仓总市值，解决原始"占净值比例"为 0 的问题
6. **Excel 输出**：每个报告期一个独立 Sheet + 一个概览 Sheet

## 使用方法

```bash
# 基本用法（交互式输入基金代码）
python scripts/fetch_fund_holdings.py

# 指定基金代码
python scripts/fetch_fund_holdings.py --code 004685

# 指定基金代码和输出路径
python scripts/fetch_fund_holdings.py --code 004685 --output ./output.xlsx

# 指定起始年份（默认2018）
python scripts/fetch_fund_holdings.py --code 004685 --start-year 2020
```

## 输出说明

### 持仓概览 Sheet

| 列 | 说明 |
|---|---|
| 报告期 | YYYY-MM-DD |
| 报告类型 | 年报 / 中报/半年报 |
| 股票数 | 该期持仓股票数量 |
| 基金总规模(亿元) | 期末净资产（来自 gmbd API） |
| 股票持仓(亿元) | 股票持仓市值合计 |
| 股票占比(%) | 股票 / 总规模 |
| 其他资产(亿元) | 总规模 − 股票 |
| 其他占比(%) | 其他 / 总规模 |
| 第一大重仓 | 按持仓市值排序的第一名 |
| 第一大占比(%) | 占股票持仓比例 |
| 前十大占比(%) | 占股票持仓比例 |

### 各报告期 Sheet

每个半年报/年报对应一个独立 Sheet，列：

| 列 | 说明 |
|---|---|
| 序号 | 按持仓市值降序排列 |
| 股票代码 | 如 603808 |
| 股票名称 | 如 歌力思 |
| 占净值比例(%) | 基金报告原始值（占基金净值） |
| 持仓市值占比(%) | 计算值 = 个股市值 / 股票总市值 × 100 |
| 持股数(万股) | |
| 持仓市值(万元) | |

## 技术细节

### 数据源

- **持仓数据**：`https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={CODE}&topline=500&year={YEAR}`
  - 返回 JS 变量 `var apidata={ content:"<HTML>" }`
  - 编码为 UTF-8（非 GB2312）
  - 每个报告期包含一个 `<h4>` 标题 + `<table>` 表格
  - `topline=500` 确保获取全部持仓（默认仅前 10）
- **基金规模**：`https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=gmbd&code={CODE}`
  - 返回 `var gmbd_apidata={ content:"<HTML>" }`
  - 含各季度末的总份额和净资产（亿元）

### 编码注意

- API 返回 UTF-8 编码，**不是 GB2312/GBK**
- Windows 终端可能无法正确显示中文，但 Excel 文件中数据正确

### 依赖

- Python 3.7+
- openpyxl（自动安装）
- 无其他第三方依赖（使用标准库 urllib）

## 限制

- 仅支持天天基金有数据的基金代码
- 早期基金可能无半年报持仓数据（如 2018 年新成立基金）
- 持仓市值合计可能略小于基金规模（因四舍五入或微量持仓未显示）
- "其他资产"为基金总规模减去股票持仓的差值，包含债券、现金、应收等，无法进一步拆分

## 参考文档

- [API 接口说明](references/api-reference.md)
- [数据字段说明](references/data-fields.md)
