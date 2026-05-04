# Jira People View

人力視圖插件 — 把 Jira Timeline 的「以任務為主軸」翻轉為「以人為主軸」，每人一條 heatmap 看誰在什麼時段最忙，展開可看該人手上所有任務。

---

## 安裝

1. 解壓 `jira-people-view.zip` 到任意資料夾
2. `chrome://extensions/` → 開「開發人員模式」→「載入未封裝項目」→ 選該資料夾
3. 進到任一 Jira Timeline 頁面，右下角會出現「人力視圖」按鈕

---

## 功能

### Heatmap 工作量視覺化

每人一條色帶，沿時間軸顯示同日重疊任務數。任務越多顏色越深（5 階：透明 → 淡粉 → 粉 → 橘紅 → 深紅）。

![Heatmap 主畫面](screenshots/01-heatmap.png)
> **截圖**：浮動視窗開啟後的初始畫面，數位人員的 heatmap 條帶。

---

### 展開看任務細節

點人名箭頭展開 → 該人所有任務以 bar 排列，按 issue type 上色（PT 綠、Engine 藍、Math 黃、Art 紫、Anim 粉、Math 黃、Data 青、QA 橘）。任務 bar 上文字為 summary，hover 看完整資訊，點擊開新分頁到該 issue。

![展開人員看任務](screenshots/02-expand-tasks.png)
> **截圖**：點某人箭頭展開後，下方顯示該人所有任務 bar 的樣子。

---

### 任務類型篩選

點工具列插件圖示開啟 popup，可勾選要納入計算的任務類型（10 種：Planning Task / Plan Story / Art Story / Anim Task / Engine Task / Backend Task / Math Task / Data Task / QA Task / Dev Task）。預設全選。

![Popup 設定面板](screenshots/03-popup.png)
> **截圖**：popup 設定面板的全貌。

---

### 自動篩選規則

固定排除：
- 已完成 / 已關閉的任務（綠色狀態）
- 沒指派人的任務
- Subtask / Milestone / Config / Bug / Epic

時間軸範圍：今天前 3 個月 ~ 後 9 個月，初始捲動位置自動置中於今天藍線。

---

## 設定不生效時

| 症狀 | 怎麼辦 |
|------|--------|
| 看不到「人力視圖」按鈕 | 確認你在 Jira Timeline 頁面（不是 Backlog 或 Board）；F5 重整 |
| 開啟後沒人 | popup 確認有勾任務類型；目前 Jira 是否真有符合條件的任務 |
| 任務 bar 沒顯示 | 該任務沒填 Start date 或 due date — 不影響 heatmap，但展開列看不到 bar |

仍有問題請聯絡維護者。
