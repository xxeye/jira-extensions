# PT Timeline Color — 維護備忘

開發者用途，使用者不需閱讀。記錄當 Jira UI 改版時要去哪裡修。

> **2026-08-26 更新**：Jira Timeline 當天大改版（整個元件重寫，不是換皮），
> 下面所有選擇器都是改版後重新實測的最新版本。舊版（2026-05）的選擇器已經
> 全部作廢，不再列在這份文件裡；完整的新舊對照與改版脈絡見同目錄
> `UI_MIGRATION_2026-08.md`。

---

## 易壞點 1：Bar / Row 識別

**位置**：`timeline_color.js`（選擇器區塊，檔案最上方）

2026-08 改版後，Timeline 整個變成**一張 `<table>`**，一個 issue = 一個
`<tr>`，key/summary/bar 全部是同一列的儲存格 —— 不再是舊版兩組獨立
virtualized list 靠數字 ID 互相對應。

| 用途 | testid |
|------|--------|
| Issue key 文字（同時也是找到那張 table 的錨點） | `native-issue-table.common.ui.issue-cells.issue-key.issue-key-cell` |
| Bar 本體（彩色長條） | `[data-testid*="draggable-bar-"][data-testid$="-container"]`，內容形如 `...draggable-bar-ari:cloud:jira:<uuid>:issue/<數字ID>-container` |
| Hierarchy 展開/收合鈕 | `issue-table-hierarchy.ui.expand-button.expand-button` |

`getTimelineTable()` / `getTimelineRows()` 是找 table / 各列的統一入口，
`extractIssueId(row)` / `extractIssueKey(row)` 直接在同一個 `<tr>` 裡各自
找 bar（反推數字 id）跟 key cell（讀文字）。如果這組 testid 又變了：

```js
// 隨便找一個 bar，看它的 testid 長什麼樣子
document.querySelector('[data-testid*="draggable-bar-"]').getAttribute('data-testid')
// 隨便找一個 issue key cell
document.querySelector('a[aria-label*="未解決"], a[aria-label*="Open"]')
```

---

## 易壞點 2：隱藏目前時段高亮

**位置**：`timeline_color.js` — `applyCurrentPeriodHide()` + `timeline_color.css` 的 `.jpt-current-period-hidden`

2026-08 前是雜湊 class（`._1kl7ia51._1s7zia51`），改版後這格反而**有 testid
了**：`[data-testid^="timeline.chart-overlays.columns-overlay.column-"]`
這組欄位 overlay 裡，背景不透明的那一個就是目前高亮欄。JS 動態找到它加
`.jpt-current-period-hidden` class（不再是寫死選擇器的靜態 CSS 規則）。

### 重新找的方法

```js
__jptDebug.findCurrentPeriodColumn()   // 2026-08 改版後的新工具
```

列出所有 column-overlay，標出哪個背景不透明。如果哪天這組 testid 又不見了，
退回舊招（`__jptDebug.findCurrentMonthClass()` 還留著沒刪）：

```js
[...document.querySelectorAll('div')]
  .filter(el => {
    const bg = getComputedStyle(el).backgroundColor;
    const r = el.getBoundingClientRect();
    return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
      && r.width > 100 && r.width < 1200 && r.height > 200;
  })
  .map(el => ({ cls: el.className.toString(), testid: el.getAttribute('data-testid'), bg: getComputedStyle(el).backgroundColor }))
```

---

## 易壞點 3：Today marker / Header row 沒有 testid 保護

**位置**：`timeline_color.js` — `findTodayMarker()` / `getHeaderRow()`

2026-08 改版把這兩個原本有 testid 的元素都拿掉 testid 了，只能用結構/幾何
特徵抓：

- **today marker**：全頁掃 `<div>`，找「寬度 ≤4px + 高度 >300px + 有實色背景」
  的那個，抓到後 cache 住（元素被移出 DOM 才重新掃，避免每次呼叫都全頁掃一輪）。
- **header row**：`table thead tr` 的最後一個儲存格（工作/狀態/受託人在前面
  幾格，甘特圖表頭固定是最後一個）。

如果 `findTodayMarker()` 抓錯（例如抓到別的細長條），用 debug 工具檢查：

```js
__jptDebug.findTodayMarker()
```

回傳的元素應該貫穿整個 timeline 高度、顏色是今天線的實色藍。若寬高特徵
改變（例如 Jira 把線改粗），調整 `findTodayMarker()` 裡的 `r.width`/`r.height`
門檻。

---

## 易壞點 4：today-marker 在「欄正中央」（影響 strip 繪製）

`drawHolidayStrips` 用 `today.offsetLeft` 當作「今天」的錨點往兩邊外推。
**Jira 把 today-marker 放在今天那欄的正中央**（實測 ~47%），不是欄左緣。
所以 strip 的 `left` 必須 -0.5 day 才能對齊日期欄左緣（讓日期數字落在 strip 中央上方）：

```js
strip.style.left = `${todayParentX + (off - 0.5) * pxPerDay}px`;
```

如果哪天 Jira 改成把 today-marker 放在欄左緣 / 右緣，這 -0.5 偏移就要對應改掉。
驗證方法：開週末標示 → 看週六 / 日 strip 是不是剛好覆蓋「6」「日」那兩欄、
數字標籤是不是落在 strip 正中央上方。沒對齊就是 today-marker 位置變了。
（這條 2026-08 改版後邏輯沒變，只是錨點抓法變了，見易壞點 3。）

---

## 易壞點 5：視圖模式偵測（週/月/季）

**位置**：`timeline_color.js` — `getTimelineMode()`

2026-08 前讀 URL `?timeline=WEEKS|MONTHS|QUARTERS`；改版後 **URL 完全不帶
這個參數了**（純前端 state）。改成讀畫面上「週/月/季」三顆切換按鈕
（testid `aais-timeline-toolbar.ui.timeline-mode-switcher.expand-button`），
找目前背景不透明（= 被選中）的那顆，用按鈕文字（`MODE_BUTTON_LABELS`，中英
文都收）對應模式。

如果 Jira 改了按鈕的選中樣式（例如選中時改用文字顏色而非背景色區分），
`getTimelineMode()` 裡的「背景不透明」判斷要跟著換成新的視覺特徵。

```js
__jptDebug.getTimelineMode()   // 'MONTHS' | 'WEEKS' | 'QUARTERS'
```

---

## 易壞點 6：Milestone bar 內部結構

菱形模式靠這個結構：

```
[bar container]                    ← .jpt-ms-bar.jpt-ms-diamond
├─ [role="button"] css-ezcvrh      ← 隱藏（opacity: 0）
└─ css-xxxxxx                      ← hover 標籤容器（保留，class 每次重編譯都會變）
```

2026-08 改版**這條結構沒變**（實測仍是 `[role="button"]` 當第一個直接子），
是這次改版少數不用修的地方。如果 hover 看不到日期標籤，可能是 Jira 把標籤
位置換到別處。CSS 規則：

```css
.jpt-ms-bar.jpt-ms-diamond > [role="button"] { opacity: 0 !important; }
```

只 hide 第一個直接子（可見 bar），保留其他 children（hover labels）。

---

## 易壞點 7：（已移除）專注模式

2026-08-26 改版後重寫過一次（row-key diff 演算法，見 CHANGELOG.md 同日條目），
但現場實測 bug 太多（巢狀展開語意、虛擬化下的快照時機等都不穩），已於
2026-08-26 決定整段砍掉，相關程式碼 / popup UI 全部移除
（`handleFocusMutations` / `diffInsertedBlock` / `applyFocusVisibility` /
`SEL_HIERARCHY_EXPAND` / `.jpt-focus-hidden` / popup 的「專注模式」區塊 /
`focusMode` 設定欄位都已不存在）。

這個編號保留空位、不重新編號後面幾點，避免打亂本檔案與 checklist 裡舊有的
交叉引用。如果之後要重做專注模式，建議整個當新功能重新設計，不要接回這批
已刪除的程式碼。

---

## 易壞點 8：直接改 Jira React 控制的 DOM 文字

**症狀**：Timeline 開頁面就跳「我們這一端發生錯誤 Hash ZDVWD1」（或類似 hash）

**原因**：寫了 `el.textContent = ...` 在 Jira 用 React 渲染的 `<small>` / 標籤上 →
React 拿著 internal Text node 參考要 reconcile 時找不到原本的 child → 拋
「Failed to remove child」之類例外，整個 timeline 區塊掛掉。

**已知雷區**：
- bar 內結束日標籤 `<small>`（例：「May 21, 2026 (8 天)」）
- 任何 Jira 條塊 / issue row 內可見的 React 元素

**例外情況** — `stripDurationSuffix(bar)` 也是改 `<small>.textContent`，沒事？
因為它只在「菱形模式」hover 時跑，菱形那 `<small>` CSS `opacity: 0`，
React 沒收到 visible 變動 → 沒重渲染 → DOM 不會被反向 reconcile。
這是運氣好不是設計，新功能不要照搬這個模式。

**正確做法**：
- 想顯示額外資訊 → body-level 浮動元素（像 `#jpt-hover-tip` / `#jpt-wd-overlay`）
- 用 BCR 貼齊原元素位置即可，完全不碰 Jira DOM
- 視覺要當下跟拖拉更新 → rAF loop 每 frame 重算

---

## 易壞點 9：Atlassian `--ds-*` token 名變動

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
2026-08 改版後實測這組 token 全部還在，不受這次改版影響。

**症狀**：切 Light 主題後某 surface 仍是 dark 色塊 → 對應 token 名被 Atlassian 改了或還沒給 light 對應值。

**檢查**：DevTools console
```js
getComputedStyle(document.documentElement).getPropertyValue('--ds-surface-raised')
```
回空字串 = token 名失效，需翻 [Atlassian DS tokens 文件](https://atlassian.design/foundations/color-new/) 找新名替換。

---

## 易壞點 10：`html[data-color-mode]` 屬性名

**位置**：`timeline_color.js` — `applyThemeClass`

Jira Cloud 把使用者選的主題寫到 `<html data-color-mode="light|dark|auto">`。
此屬性 Atlassian 公開記載（developer.atlassian.com/.../design-tokens-and-theming/），但若哪天改名（例如 `data-theme`），主題偵測會永遠停在 dark。
2026-08 改版後實測這個屬性沒變。

**檢查**：console `document.documentElement.getAttribute('data-color-mode')` 應回 `light` / `dark` / `auto`。

---

## 易壞點 11：方向鍵捲動容器

**位置**：`timeline_color.js` — `onArrowKey` 裡的 `scroller`

舊 testid `sr-timeline` 2026-08 改版後消失了，實測換成
`[data-testid="scroll-container.scroll-container"]`。如果方向鍵捲動失效，
先確認這個 testid 還在。

---

## Console Debug Helpers

```js
__jptDebug.cache                      // 看 issue type 快取
__jptDebug.clearCache()               // 清快取（reload 後重抓）
__jptDebug.scan()                     // 手動觸發掃描
__jptDebug.setDebug(true)             // 開啟 console log（看哪個選擇器命中）
__jptDebug.drawHolidayStrips()        // 重畫週末/假日 strip
__jptDebug.clearHolidayStrips()
__jptDebug.getTimelineMode()          // 'MONTHS' | 'WEEKS' | 'QUARTERS'
__jptDebug.computePxPerDay('MONTHS')  // 看當前模式的 px/day 計算
__jptDebug.findCurrentMonthClass()    // 舊版（雜湊 class）找法，備用
__jptDebug.findCurrentPeriodColumn()  // 2026-08 新版找法：列出 column-overlay
__jptDebug.findTodayMarker()          // 2026-08 新版找法：today marker 元素
__jptDebug.getTimelineTable()         // 目前抓到的 timeline table 元素
__jptDebug.getTimelineRows()          // 目前抓到幾列（數字）
__jptDebug.settings()                 // 看當前設定
```

---

## 假日資料維護

`holidays_tw.js` 內含 2025/2026/2027 三年清單（依行政院人事行政總處公告）。
**每年底依當年公告更新隔年清單**。

格式：`YYYY-MM-DD` 字串，全部裝進 `TwHolidays` Set。

---

## 改版檢查清單

Jira UI 大改版後，依序測：

1. [ ] 開 Timeline 看 PT bar 有沒有變色 → `SEL_KEY` / bar testid 仍對 → 沒就用易壞點 1 的方法重找
2. [ ] 切週/月/季視圖看 strip 對不對齊 → `aais-timeline-toolbar` 按鈕 testid 跟選中樣式仍對（見易壞點 5）
3. [ ] 週末/假日 strip 沒對到日期欄（往左或右整體偏 0.5 day）→ today-marker 位置改了，調整 `(off - 0.5)` 偏移
4. [ ] 勾「隱藏目前時段」沒效果 → `column-overlay` testid 或背景色判斷失效，重新找（易壞點 2）
5. [ ] Milestone 菱形 hover 看不到日期 → bar 直接子結構變了（易壞點 6）
6. [ ] （專注模式已移除，2026-08-26 —見易壞點 7，這項不用再測）
7. [ ] PT 鎖定無效（仍可拖曳）→ Jira drag listener 改成非 mousedown 觸發（試 pointerdown）
8. [ ] 方向鍵捲動失效 → `scroll-container.scroll-container` testid 變了（易壞點 11）
