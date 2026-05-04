# PT Timeline Color — 維護備忘

開發者用途，使用者不需閱讀。記錄當 Jira UI 改版時要去哪裡修。

---

## 易壞點 1：隱藏目前時段高亮

**位置**：`timeline_color.css`

```css
body.jpt-hide-current-month ._1kl7ia51._1s7zia51 {
  display: none !important;
}
```

`._1kl7ia51._1s7zia51` 是 Jira（Atlassian compiled-css）標記「目前月／週／季」column overlay 的雜湊 class，2026-05 抓到的。Jira UI 大改版後雜湊可能變動，此選擇器失效。

### 重新找的方法

任一 Jira Timeline 分頁 DevTools console：

```js
__jptDebug.findCurrentMonthClass()
```

會 print 出所有「絕對定位、寬度像 column、有半透明背景色」的元素 + class。挑 width 跟 height 對得上 timeline 全長的那一個，把 class 替換進 CSS。

或自己跑：

```js
[...document.querySelectorAll('div')]
  .filter(el => {
    const bg = getComputedStyle(el).backgroundColor;
    const r = el.getBoundingClientRect();
    return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
      && r.width > 100 && r.width < 400 && r.height > 200;
  })
  .map(el => ({ cls: el.className.toString(), bg: getComputedStyle(el).backgroundColor }))
```

---

## 易壞點 2：Bar / List-item 識別

**位置**：`timeline_color.js`

依賴 testid（穩定度比雜湊 class 高，但仍可能變）：

| 用途 | testid 模板 |
|------|-------------|
| List item（左欄一列） | `roadmap.timeline-table.components.list-item.container-<ID>` |
| Chart item（右欄 row 軌道） | `roadmap.timeline-table.components.chart-item.container-<ID>` |
| Bar 本體（彩色長條） | `roadmap.timeline-table-kit.ui.chart-item-content.date-content.bar.draggable-bar-<ID>-container` |
| Issue key 文字 | `roadmap.timeline-table-kit.ui.list-item-content.summary.key` |
| Issue summary 文字 | `roadmap.timeline-table-kit.ui.list-item-content.summary.title` |
| Today 藍線 | `roadmap.timeline-table.main.scrollable-overlay.today-marker.container` |
| 月份 header 列 | `roadmap.timeline-table.main.header.sub-header-default_header_row` |

`<ID>` 是 Jira 內部 numeric ID（非 issue key）。List 與 chart 透過 ID 對應。

---

## 易壞點 3：Milestone bar 內部結構

菱形模式靠這個結構：

```
[bar container]                    ← .jpt-ms-bar.jpt-ms-diamond
├─ [role="button"] css-ezcvrh      ← 隱藏（opacity: 0）
└─ css-omr7ee                      ← hover 標籤容器（保留）
```

如果 hover 看不到日期標籤，可能是 Jira 把標籤位置換到別處。CSS 規則：

```css
.jpt-ms-bar.jpt-ms-diamond > [role="button"] { opacity: 0 !important; }
```

只 hide 第一個直接子（可見 bar），保留其他 children（hover labels）。

---

## 易壞點 4：Epic 快速篩選 URL 參數

**位置**：`timeline_color.js` — `setUrlIssueParent()`

```
?issueParent=<numeric_id>
```

Jira 用此 URL 參數實作 Epic filter。透過 `history.pushState` + `popstate` event 觸發 Jira React router 重渲染。

如果 URL pattern 變動（例如改成 `?epic=<key>` 之類），需要更新此參數名。

---

## 易壞點 5：視圖模式偵測

**位置**：`timeline_color.js` — `getTimelineMode()`

```js
location.search.timeline ∈ { 'WEEKS', 'MONTHS', 'QUARTERS' }
```

從 URL `?timeline=...` 讀取。沒參數預設 `MONTHS`。Jira 切「週/月/季」按鈕會更新此 URL 參數。

如果 Jira 改用其他機制（例如 sessionStorage、不同 URL 鍵），需重新偵測。

---

## Console Debug Helpers

```js
__jptDebug.cache               // 看 issue type 快取
__jptDebug.clearCache()        // 清快取（reload 後重抓）
__jptDebug.scan()              // 手動觸發掃描
__jptDebug.setDebug(true)      // 開啟 console log（看哪個選擇器命中）
__jptDebug.drawHolidayStrips() // 重畫週末/假日 strip
__jptDebug.clearHolidayStrips()
__jptDebug.getTimelineMode()   // 'MONTHS' | 'WEEKS' | 'QUARTERS'
__jptDebug.computePxPerDay('MONTHS')   // 看當前模式的 px/day 計算
__jptDebug.findCurrentMonthClass()     // 找「目前時段」雜湊 class
__jptDebug.settings()          // 看當前設定
```

---

## 假日資料維護

`holidays_tw.js` 內含 2025/2026/2027 三年清單（依行政院人事行政總處公告）。
**每年底依當年公告更新隔年清單**。

格式：`YYYY-MM-DD` 字串，全部裝進 `TwHolidays` Set。

---

## 改版檢查清單

Jira UI 大改版後，依序測：

1. [ ] 開 Timeline 看 PT bar 有沒有變色 → testid 仍對 → 沒就改 SEL_LIST_ITEM 等
2. [ ] 切週/月/季視圖看 strip 對不對齊 → URL `?timeline=` 仍是這 3 值
3. [ ] 勾「隱藏目前時段」沒效果 → `._1kl7ia51._1s7zia51` class 變了，重新找
4. [ ] Milestone 菱形 hover 看不到日期 → bar 直接子結構變了
5. [ ] 專注模式展開 Epic 沒過濾 → `?issueParent=` URL 機制變了
