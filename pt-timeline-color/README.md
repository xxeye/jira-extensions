# PT Timeline Color

Jira Timeline 視覺強化插件 — 為 Planning Task / Milestone / Epic 加上區別色與形狀，並標出週末與台灣國定假日。

---

## 安裝

1. 解壓 `pt-timeline-color.zip` 到任意資料夾
2. `chrome://extensions/` → 開「開發人員模式」→「載入未封裝項目」→ 選該資料夾

---

## 功能

### Planning Task — 條塊上色 / 鎖定

所有 Planning Task 類型的 bar 染成自訂色，與一般任務區隔。顏色可自訂（色票或 HEX）。

可勾選「鎖定拖曳與拉長」防止誤動 PT 日期；鎖定狀態下從左欄任務名開啟側欄。

![PT 上色](screenshots/01-pt-color.png)
> **截圖**：Timeline 上一段 PT bar 顯示自訂色（綠）。

---

### Milestone — 顏色 / 菱形 / 鎖定 / 進度

- **自訂顏色**
- **菱形顯示** — bar 改為位於 due 日的菱形，自動鎖定時間條前後拉長，僅保留時間塊拖動功能。
- **鎖定前後拉長** — 只能整塊拖動，避免拉成區間
- **relates-to 進度** — 自動依 issue link `relates to` 計算並標示 `3/11 27%`

![Milestone 菱形與進度](screenshots/02-milestone-diamond-progress.png)
> **截圖**：菱形 Milestone 上標示 `X/Y NN%`，挑一個有 3~10 筆 relates-to 的最有畫面。

![Milestone hover 日期](screenshots/03-milestone-diamond-hover.png)
> **截圖**：滑鼠 hover 菱形時 Jira 日期標籤跳出的瞬間。

---

### Epic — 虛線框

依自定欄位 `customfield_10919` 標記為「啟用」的 Epic，bar 改為虛線外框，
方便在 Timeline 上一眼分辨需要被特別關注或追蹤的 Epic。

![Epic 虛線框](screenshots/04-epic-stripe.png)
> **截圖**：Timeline 上一個 Epic 顯示虛線外框 bar，最好同時露出底下幾筆子任務（PT/Task）作為對照。

---

### 時間軸介面

- **方向鍵捲動** — `←` `→` 平移、`Shift+←/→` 跨大段
- **隱藏目前時段高亮** — 移除 Jira 預設的當月／當週／當季半透明色塊（今天藍線保留）
- **週末標示** — 六、日欄位淡灰
- **台灣國定假日標示** — 依行政院人事行政總處公告，內建 2025–2027

![當期高亮 ON vs OFF](screenshots/05-hide-current-period.png)
> **截圖**：左右並排 — 左側「Jira 預設半透明色塊蓋住當月」、右側「色塊消失但今天藍線還在」。月視圖最明顯。

![週末與假日 strip](screenshots/06-weekend-holiday-strips.png)
> **截圖**：週視圖，畫面內含一個連假（端午／中秋／春節）— 同時看到週末灰底 + 連假橘底連成一片。

---

### 專注模式

展開任一 Epic 時自動開啟快速篩選。讓畫面只剩該 Epic 與其子任務；收合或關閉時還原。

![專注模式展開前後](screenshots/07-focus-mode.png)
> **截圖**：兩張對比 — 展開 Epic 前（滿頁雜任務）vs 展開後（只剩該 Epic + 子任務）。

---

## 設定面板

![Popup 設定面板](screenshots/00-popup-overview.png)
> **截圖**：插件 popup 全貌（總開關 → 各功能區塊 → 底部「立即重新整理」/「重設預設」按鈕）。
