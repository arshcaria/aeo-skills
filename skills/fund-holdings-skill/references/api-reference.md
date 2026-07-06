# API 接口参考

## 数据源

天天基金 (fund.eastmoney.com / fundf10.eastmoney.com)

## 接口 1：基金持仓明细

### 请求

```
GET https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={基金代码}&topline=500&year={年份}&month=&rt={随机数}
```

### 参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `type` | 固定 `jjcc`（基金持仓） | `jjcc` |
| `code` | 基金代码 | `004685` |
| `topline` | 返回条数上限，设为 500 确保获取全部 | `500` |
| `year` | 年份 | `2025` |
| `month` | 月份（不传则返回该年所有季度） | 空 |
| `rt` | 随机数，防缓存 | `0.123456` |

### 响应格式

```javascript
var apidata={
  content:"<div class='box'>
    <div class='boxitem w790'>
      <h4 class='t'>
        <label class='left'>
          <a title='基金名称'>基金名称</a>
          &nbsp;&nbsp;2025年4季度股票投资明细
        </label>
        <label class='right lab2 xq505'>
          来源：天天基金  截止于：<font class='px12'>2025-12-31</font>
        </label>
      </h4>
      <table class='w782 comm tzxq t2'>
        <thead>
          <tr>
            <th>序号</th>
            <th>股票代码</th>
            <th>股票名称</th>
            <th>相关资讯</th>
            <th>占净值比例</th>
            <th>持股数(万股)</th>
            <th>持仓市值(万元)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td><a href='...'>603808</a></td>
            <td class='tol'><a href='...'>歌力思</a></td>
            <td class='xglj'>...</td>
            <td class='tor'>1.07%</td>
            <td class='tor'>196.31</td>
            <td class='tor'>1,672.56</td>
          </tr>
          ...
        </tbody>
      </table>
    </div>
  </div>"
}
```

### 解析要点

1. **编码**：UTF-8（重要：不是 GB2312/GBK）
2. **JS 变量提取**：content 字段为 JS 字符串，含转义字符（`\"` → `"`, `\/` → `/`）
3. **报告期识别**：从 `<h4>` 标题中的"X年Y季度"或日期文本判断
4. **数据行**：每个 `<tr>` 含 7+ 个 `<td>`，第 4 个为链接列（跳过），其余为数据
5. **多表格**：同一年可能返回多个报告期（Q1/Q2/Q3/Q4），按 `<h4>` 分割

### 报告期类型

| 日期 | 类型 | 持仓披露 |
|------|------|---------|
| 03-31 | 一季报 | 仅前十大 |
| 06-30 | 中报/半年报 | **完整持仓** |
| 09-30 | 三季报 | 仅前十大 |
| 12-31 | 年报 | **完整持仓** |

> 本脚本仅保留半年报和年报（完整持仓）。

---

## 接口 2：基金规模变动

### 请求

```
GET https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=gmbd&code={基金代码}
```

### 响应格式

```javascript
var gmbd_apidata={
  content:"<table class='w782 comm gmbd'>
    <thead>
      <tr>
        <th>日期</th>
        <th>期间申购（亿份）</th>
        <th>期间赎回（亿份）</th>
        <th>期末总份额（亿份）</th>
        <th>期末净资产（亿元）</th>
        <th>净资产变动率</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>2025-12-31</td>
        <td class='tor'>---</td>
        <td class='tor'>0.02</td>
        <td class='tor'>2.35</td>
        <td class='tor'>15.64</td>
        <td class='tor'>9.20%</td>
      </tr>
      ...
    </tbody>
  </table>"
}
```

### 字段说明

| 列 | 字段 | 说明 |
|----|------|------|
| 0 | 日期 | YYYY-MM-DD |
| 1 | 期间申购（亿份） | `---` 表示无数据 |
| 2 | 期间赎回（亿份） | |
| 3 | 期末总份额（亿份） | |
| 4 | **期末净资产（亿元）** | 即基金 AUM |
| 5 | 净资产变动率 | 百分比字符串 |

> 本脚本使用第 4 列（期末净资产）作为基金总规模。

---

## 请求头

```python
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://fundf10.eastmoney.com/'
}
```

> 缺少 Referer 可能导致请求被拒绝。
