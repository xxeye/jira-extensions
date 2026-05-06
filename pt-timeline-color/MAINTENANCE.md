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

## 易壞點 5：today-marker 在「欄正中央」（影響 strip 繪製）

`drawHolidayStrips` 用 `today.offsetLeft` 當作「今天」的錨點往兩邊外推。
**Jira 把 today-marker 放在今天那欄的正中央**（實測 ~47%），不是欄左緣。
所以 strip 的 `left` 必須 -0.5 day 才能對齊日期欄左緣（讓日期數字落在 strip 中央上方）：

```js
strip.style.left = `${todayParentX + (off - 0.5) * pxPerDay}px`;
```

如果哪天 Jira 改成把 today-marker 放在欄左緣 / 右緣，這 -0.5 偏移就要對應改掉。
驗證方法：開週末標示 → 看週六 / 日 strip 是不是剛好覆蓋「6」「日」那兩欄、
數字標籤是不是落在 strip 正中央上方。沒對齊就是 today-marker 位置變了。

---

## 易壞點 6：視圖模式偵測

**位置**：`timeline_color.js` — `getTimelineMode()`

```js
location.search.timeline ∈ { 'WEEKS', 'MONTHS', 'QUARTERS' }
```

從 URL `?timeline=...` 讀取。沒參數預設 `MONTHS`。Jira 切「週/月/季」按鈕會更新此 URL 參數。

如果 Jira 改用其他機制（例如 sessionStorage、不同 URL 鍵），需重新偵測。

---

## 易壞點 7：直接改 Jira React 控制的 DOM 文字

**症狀**：Timeline 開頁面就跳「我們這一端發生錯誤 Hash ZDVWD1」（或類似 hash）

**原因**：寫了 `el.textContent = ...` 在 Jira 用 React 渲染的 `<small>` / 標籤上 →
React 拿著 internal Text node 參考要 reconcile 時找不到原本的 child → 拋
「Failed to remove child」之類例外，整個 timeline 區塊掛掉。

**已知雷區**：
- bar 內結束日標籤 `<small>`（例：「May 21, 2026 (8 天)」）
- 任何 Jira 條塊 / list-item 內可見的 React 元素

**例外情況** — `stripDurationSuffix(bar)` 也是改 `<small>.textContent`，沒事？
因為它只在「菱形模式」hover 時跑，菱形那 `<small>` CSS `opacity: 0`，
React 沒收到 visible 變動 → 沒重渲染 → DOM 不會被反向 reconcile。
這是運氣好不是設計，新功能不要照搬這個模式。

**正確做法**：
- 想顯示額外資訊 → body-level 浮動元素（像 `#jpt-hover-tip` / `#jpt-wd-overlay`）
- 用 BCR 貼齊原元素位置即可，完全不碰 Jira DOM
- 視覺要當下跟拖拉更新 → rAF loop 每 frame 重算

---

## 易壞點 8：Atlassian `--ds-*` token 名變動

**位置**：`timeline_color.css`（多處 `var(--ds-xxx, fallback)`）

Jira 用 Atlassian Design System tokens 做主題切換。我們依賴的 token 名（一個都別少）：

| Token | 用途 |
|-------|------|
| `--ds-surface-raised` | toolbar 背景 |
| `--ds-surface-overlay` | hover tip / flash 背景 |
| `--ds-text` / `--ds-text-subtle` / `--ds-text-subtlest` | 各層級文字 |
| `--ds-text-success` / `--ds-text-warning` / `--ds-text-information` / `--ds-text-accent-blue` | 強調色文字 |
| `--ds-background-success` / `--ds-background-warning` / `--ds-background-information` / `--ds-background-neutral` | 強調色徽章背景 |
| `--ds-background-neutral-hovered` / `--ds-background-neutral-subtle-hovered` | hover 微亮 |
| `--ds-icon-success` / `--ds-icon-disabled` | 狀態指示燈 |
| `--ds-border` / `--ds-border-warning` | 邊框 |
| `--ds-shadow-overlay` | hover tip 陰影 |

每個都帶 fallback 值（dark 主題的原值），Jira 沒給該 token → 退回 dark 樣式（不破現狀）。

**症狀**：切 Light 主題後某 surface 仍是 dark 色塊 → 對應 token 名被 Atlassian 改了或還沒給 light 對應值。

**檢查**：DevTools console
```js
getComputedStyle(document.documentElement).getPropertyValue('--ds-surface-raised')
```
回空字串 = token 名失效，需翻 [Atlassian DS tokens 文件](https://atlassian.design/foundations/color-new/) 找新名替換。

---

## 易壞點 9：`html[data-color-mode]` 屬性名

**位置**：`timeline_color.js` — `applyThemeClass`

Jira Cloud 把使用者選的主題寫到 `<html data-color-mode="light|dark|auto">`。
此屬性 Atlassian 公開記載（developer.atlassian.com/.../design-tokens-and-theming/），但若哪天改名（例如 `data-theme`），主題偵測會永遠停在 dark。

**檢查**：console `document.documentElement.getAttribute('data-color-mode')` 應回 `light` / `dark` / `auto`。

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
3. [ ] 週末/假日 strip 沒對到日期欄（往左或右整體偏 0.5 day）→ today-marker 位置改了，調整 `(off - 0.5)` 偏移
4. [ ] 勾「隱藏目前時段」沒效果 → `._1kl7ia51._1s7zia51` class 變了，重新找
5. [ ] Milestone 菱形 hover 看不到日期 → bar 直接子結構變了
6. [ ] 專注模式展開 Epic 沒過濾 → `?issueParent=` URL 機制變了
7. [ ] PT 鎖定無效（仍可拖曳）→ Jira drag listener 改成非 mousedown 觸發（試 pointerdown）
