# jira-extensions

> 一組 Chrome 擴充功能，配套 Jira Cloud Timeline 視覺化、人力檢視、API 監控。

## 包含的插件

| 插件 | 功能 | 文件 |
|------|------|------|
| **pt-timeline-color** | Timeline 視覺強化 — PT/Milestone 染色、菱形、進度徽章、相依性線優化、浮動操作 bar、專注模式 | [docs/pt-timeline-color.md](docs/pt-timeline-color.md) |
| **jira-people-view** | 以人為主軸的工作量 heatmap，展開可看每人任務排程 | [docs/jira-people-view.md](docs/jira-people-view.md) |
| **template-expander** | Slot 22 筆 PT/Milestone 模板一鍵展開（含 Blocks 連結、避假日、甘特預覽） | — |
| **api-monitor** | 被動監聽 `webRequest`，統計 Jira REST 點數、429/503、熱點端點 | — |

四個插件**各自獨立**，要哪個就裝哪個。

---

## 安裝

### 方法 A — 從 Releases 下載 ZIP（推薦）

1. 到 [Releases 頁面](https://github.com/xxeye/jira-extensions/releases)
2. 找最新版本，下載對應插件的 `*.zip`
3. 解壓到任意資料夾（**之後別刪**，Chrome 會持續讀這個資料夾）
4. 開啟 `chrome://extensions/`
5. 右上角開啟「**開發人員模式**」
6. 點「**載入未封裝項目**」→ 選剛才解壓的資料夾

### 方法 B — git clone（給開發者 / 想跟最新版的）

```bash
git clone https://github.com/xxeye/jira-extensions.git
cd jira-extensions
```

然後 `chrome://extensions/` → 開發人員模式 → 載入未封裝項目 → 選你要的插件子資料夾（例如 `pt-timeline-color/`）。

---

## 更新

### 從 Releases 安裝的人

1. 到 [Releases](https://github.com/xxeye/jira-extensions/releases) 下載新版 ZIP
2. **覆蓋**舊資料夾（不要先刪、直接解壓覆蓋）
3. 回到 `chrome://extensions/` → 對該插件點 ↻
4. 已開的 Jira 分頁會自動重整（背景 service worker 處理）

### git clone 的人

```bash
cd jira-extensions
git pull
```

然後 `chrome://extensions/` → 對更新到的插件點 ↻ 即可。

---

## 開發

各插件原始碼直接在對應子資料夾。改完 → `chrome://extensions/` 點 ↻ → 自動 reload Jira 分頁。

開發 / debug 時若想保留 Jira 分頁狀態（不被擴充功能 reload 自動重整覆蓋），把 `pt-timeline-color/background.js` 或 `jira-people-view/background.js` 內 `const AUTO_RELOAD = true;` 改 `false` 後重新載入擴充。

---

## 回報問題

開 [Issue](https://github.com/xxeye/jira-extensions/issues) 或聯絡維護者。
