// timeline_color.js
// 在 Jira Timeline 把 Planning Task / Milestone 的時間軸條塊染色
//
// Jira Timeline DOM 結構（2026-08-26 改版後重新實測，取代 2026-05 那版）：
//   一個 issue = 一張 <table> 裡的一個 <tr>；key/summary/status/assignee/甘特圖
//   bar 全部是同一列的儲存格，不再有獨立的 list-item / chart-item 兩組虛擬列表
//   靠數字 ID 互相對應——直接在同一個 <tr> 裡找就好，見 getTimelineRows() /
//   extractIssueId() / extractIssueKey()。
//   key text: [data-testid="native-issue-table.common.ui.issue-cells.issue-key.issue-key-cell"]
//   bar:      [data-testid*="draggable-bar-"][data-testid$="-container"]
//             （testid 內容形如 ...draggable-bar-ari:cloud:jira:<uuid>:issue/<數字ID>-container）
// 這次改版詳情、逐項選擇器對照表見同目錄 UI_MIGRATION_2026-08.md。
//
// 設定來源：chrome.storage.sync（由 popup.html 寫入）
//   ptColor    Planning Task 顏色（預設 #6a9a23）
//   msColor    Milestone 顏色（預設 #FF8B00）
//   msDiamond  Milestone 是否顯示為菱形（預設 false）
//
// Debug：window.__jptDebug.setDebug(true) / .scan() / .cache / .clearCache()

(() => {
  let DEBUG = false;
  const TYPE_CACHE_KEY = 'jpt:type-cache:v4';     // 永久（issue type 不可改），跨 F5/路由保留
  // dataCache schema 從 v4 改 v5：移除 hasDates、新增 epicHighlight（依 customfield_10919）
  // v5 → v6：relates 內加 typeIconUrl / typeName（給 Milestone tooltip 顯示議題類型圖示）
  // v6 → v7：每筆 issue 新增 startDate / dueDate（給 Milestone hover 顯示 relates 的日期範圍）
  const DATA_CACHE_KEY = 'jpt:data-cache:v7';
  const LEGACY_KEYS    = ['jpt:issuetype-cache:v3', 'jpt:data-cache:v4', 'jpt:data-cache:v5', 'jpt:data-cache:v6'];

  // 預設設定（fallback；popup 未設過時用）
  // 註：msLockEdges / arrowScroll 已固化為預設行為，不再可設定（避免使用者誤關造成 bug）
  const DEFAULTS = {
    enabled:           true,         // 主開關：所有渲染入口會 gate on 這個值（由浮動 toolbar 切換）
    ptColor:           '#6a9a23',    // Planning Task bar 底色
    msColor:           '#FF8B00',    // Milestone bar 底色（含菱形模式時的填色）
    msDiamond:         true,         // Milestone 改顯示為菱形（位於 due 時間點）
    msShowProgress:    true,         // Milestone bar 上加進度徽章（relates to 子任務完成數 / 百分比）
    ptLockDrag:        true,         // Prevent PT drag and resize.
    ptTargetEndShade:  false,        // Darken the Target end -> Due segment.
    epicStripe:        false,        // Epic 依自定欄位（customfield_10919=啟用）顯示為虛線框
    epicLockDrag:      true,         // 鎖定 Epic 的拖曳與兩端拉長（防誤動）
    hideCurrentMonth:  true,         // 隱藏 Jira 內建「目前時段」整欄背景高亮（保留今天藍線）
    hideIssueKey:      false,        // 隱藏左欄 issue key 文字（如 ABC-1234）
    showWeekends:      true,         // 時間軸標示週末（六、日）背景條
    showHolidays:      true,         // 時間軸標示台灣國定假日背景條
    showWorkingDays:   true,         // Hover / 拖拉 bar 時，結束日標籤右側顯示工作天數（扣除週末與國定假日）
  };
  let settings = { ...DEFAULTS };

  // 染色標記類
  const PT_CLASS         = 'jpt-pt-bar';
  const MS_CLASS         = 'jpt-ms-bar';
  const DIA_CLASS        = 'jpt-ms-diamond';
  const EPIC_HIGHLIGHT_CLASS = 'jpt-epic-highlight';
  const EPIC_BAR_CLASS   = 'jpt-epic-bar';      // 標記所有 Epic（不分有無 highlight），給 lock-drag 用
  const PROGRESS_CLASS   = 'jpt-ms-progress';
  const PT_TARGET_SHADE_CLASS = 'jpt-pt-target-end-shade';
  const ALL_CLASSES = [PT_CLASS, MS_CLASS, DIA_CLASS, EPIC_HIGHLIGHT_CLASS, EPIC_BAR_CLASS, PT_TARGET_SHADE_CLASS];

  const TYPE_TO_CLASS = {
    'Planning Task': PT_CLASS,
    'Milestone':     MS_CLASS,
  };

  // Epic 類型名稱：Jira 內建類型會依站台語系本地化
  // ('Epic' = 英文站台 / '大型工作' = 繁中站台)
  const EPIC_TYPE_NAMES = new Set(['Epic', '大型工作']);

  // Jira 自訂欄位（依專案而定）
  const FIELD_ROLE            = 'customfield_10773';   // 職種（多選 — 對應 plan/art/data/...）
  const FIELD_EPIC_HIGHLIGHT  = 'customfield_10919';   // Epic 是否要顯示為虛線框（單選，"啟用" 才畫）
  const FIELD_START_DATE      = 'customfield_10015';   // Jira Cloud Start Date（給 Milestone hover 顯示日期範圍）
  const FIELD_TARGET_END      = 'customfield_10023'; // Target end date

  // ─── 選擇器（2026-08 Jira Timeline 改版後重新對應）──────
  // 舊版：list-item / chart-item 各自帶數字 ID 的獨立 testid，靠 ID 互相對應。
  // 新版：整個 Timeline 變成一張 <table>，一個 issue = 一個 <tr>，
  //       key/summary/bar 都是同一個 <tr> 裡的儲存格，不再需要 ID 對應，
  //       直接在同一列裡找就好。
  const SEL_KEY = '[data-testid="native-issue-table.common.ui.issue-cells.issue-key.issue-key-cell"]';
  const SEL_BAR_CONTAINER = '[data-testid*="draggable-bar-"][data-testid$="-container"]';

  // 找目前 Timeline 用的那張 table：優先用 issue key cell 反查（最準），
  // 找不到（頁面還沒渲染完）就退回抓頁面上第一張有 <thead> 的 table。
  const getTimelineTable = () =>
    document.querySelector(SEL_KEY)?.closest('table')
    || document.querySelector('table:has(thead)')
    || document.querySelector('table');

  const getTimelineRows = () => {
    const table = getTimelineTable();
    return table ? [...table.querySelectorAll('tbody tr')] : [];
  };

  // bar 的 data-testid 現在長這樣（前綴沒變，但 <ID> 從純數字換成完整 ARI）：
  //   roadmap.timeline-table-kit.ui.chart-item-content.date-content.bar.draggable-bar-ari:cloud:jira:<uuid>:issue/<數字ID>-container
  // 我們只在乎結尾的數字 issue id，用「結尾符合」選取器直接比對，不用管中間的 uuid。
  const extractIssueIdFromBar = (bar) => {
    const m = (bar?.getAttribute('data-testid') || '').match(/issue\/(\d+)-container$/);
    return m ? m[1] : null;
  };
  const findBarById = (id) => document.querySelector(`[data-testid$="issue/${id}-container"]`);

  // ─── Cache（拆兩層 — 大幅減少 API 呼叫）─────────────────
  //
  //   typeCache：Map<key, type>
  //     - issue type 一旦建立永不變動 → 整個 session 不過期
  //     - 持久化到 sessionStorage，跨 F5 / SPA 路由保留
  //
  //   dataCache：Map<key, { epicHighlight, progress, roles, relates, ts }>
  //     - 這些資料用途單純（epicHighlight → Epic 虛線、progress/relates → Milestone hover、
  //       roles → PT hover），都不是即時性高的資訊
  //     - TTL 拉長到 1 小時，搭配兩個即時觸發點兜底：
  //       (1) 使用者拖 bar 改日期 → mouseup 偵測 + 主動失效該筆
  //       (2) 浮動 toolbar 的「↻ 重新整理」按鈕（清整個 cache 強制重抓）
  //     - 持久化到 sessionStorage：F5 / SPA 路由若資料還新鮮就不重抓
  //
  // 結果：每小時一輪定期更新（而不是每分鐘）+ F5/路由不重抓 + 編輯與重整有立即反映
  const DATA_TTL_MS = 3_600_000;        // 1 小時
  const TTL_JITTER_MS = 5 * 60_000;     // ±5 分鐘抖動，避免大家同時過期造成 fetch 風暴
  const typeCache = new Map();
  const dataCache = new Map();
  const pending   = new Set();

  // 載入兩層 cache（typeCache 永久 / dataCache 帶 ts，過期就丟）
  try {
    const tc = JSON.parse(sessionStorage.getItem(TYPE_CACHE_KEY) || '{}');
    for (const [k, v] of Object.entries(tc)) typeCache.set(k, v);
    const dc = JSON.parse(sessionStorage.getItem(DATA_CACHE_KEY) || '{}');
    const now = Date.now();
    for (const [k, v] of Object.entries(dc)) {
      if (v && v.ts && (now - v.ts) < DATA_TTL_MS + TTL_JITTER_MS) dataCache.set(k, v);
    }
    for (const oldKey of LEGACY_KEYS) sessionStorage.removeItem(oldKey);
  } catch {}

  const persistTypeCache = () => {
    try { sessionStorage.setItem(TYPE_CACHE_KEY, JSON.stringify(Object.fromEntries(typeCache))); } catch {}
  };
  // 節流持久化 dataCache（避免每筆 fetch 都寫入 sessionStorage）
  let dataCachePersistTimer = null;
  const persistDataCache = () => {
    if (dataCachePersistTimer) return;
    dataCachePersistTimer = setTimeout(() => {
      dataCachePersistTimer = null;
      try { sessionStorage.setItem(DATA_CACHE_KEY, JSON.stringify(Object.fromEntries(dataCache))); } catch {}
    }, 1000);
  };

  // entry 有效 = 在 [TTL - jitter, TTL + jitter] 隨機門檻內仍新鮮
  // 這樣同一批寫入的 entries 不會同一秒一起過期（避免 fetch 風暴）
  const isDataFresh = (entry) => {
    if (!entry || !entry.ts) return false;
    const age = Date.now() - entry.ts;
    // 用 entry 自帶的 jitter 偏移（每筆寫入時隨機，不要呼叫時才隨機）
    const jitter = entry._jitter || 0;
    return age < (DATA_TTL_MS + jitter);
  };
  // 「需要 fetch」= type 沒抓過 OR 動態資料過期
  const needsFetch = (key) => {
    const entry = dataCache.get(key);
    if (!typeCache.has(key) || !isDataFresh(entry)) return true;
    return settings.ptTargetEndShade
      && typeCache.get(key) === 'Planning Task'
      && !Object.prototype.hasOwnProperty.call(entry || {}, 'targetEndDate');
  };

  // ─── 設定：套到 :root CSS 變數 + body class ─────────
  const applyCssVars = () => {
    const r = document.documentElement.style;
    r.setProperty('--jpt-pt-color', settings.ptColor);
    r.setProperty('--jpt-ms-color', settings.msColor);
    // CSS 效果類 class 全部 gate on settings.enabled — 停用時務必同步移除
    document.body?.classList.toggle('jpt-hide-current-month', !!settings.hideCurrentMonth && !!settings.enabled);
    document.body?.classList.toggle('jpt-hide-issue-key', !!settings.hideIssueKey && !!settings.enabled);
    // Milestone 鎖定前後拉長 — 固化為預設行為，但只在啟用時生效
    document.body?.classList.toggle('jpt-ms-lock-edges', !!settings.enabled);
    // Planning Task 鎖定拖曳/拉長 — 由 popup 設定控制
    document.body?.classList.toggle('jpt-pt-lock-drag', !!settings.ptLockDrag && !!settings.enabled);
    // Epic 鎖定拖曳/拉長
    document.body?.classList.toggle('jpt-epic-lock-drag', !!settings.epicLockDrag && !!settings.enabled);
    // 「目前時段」高亮：不是靜態 CSS 規則了，設定一變就重新找一次目標欄位
    try { applyCurrentPeriodHide(); } catch {}
  };

  // ─── 週末/假日 strip 渲染（universal：支援週/月/季 view）───
  const STRIP_CLASS = 'jpt-cal-strip';

  // 2026-08 改版後這兩個 testid 都消失了，改用結構/幾何特徵抓：
  //   header row → table 的 <thead><tr>，最後一個儲存格就是甘特圖表頭
  //   （工作/狀態/受託人在前面幾格，甘特圖表頭固定是最後一個）
  //   today marker → 全頁掃 <div>，找「窄（≤4px）+ 高（>300px）+ 實色背景」的
  //   那個（原本的 testid 保護沒了，抓到後 cache 住，元素被移出 DOM 才重新掃，
  //   避免每次呼叫都全頁掃一輪 div）
  const getHeaderRow = () => {
    const headerTr = getTimelineTable()?.querySelector('thead tr');
    return headerTr ? headerTr.lastElementChild : null;
  };

  let cachedTodayMarker = null;
  const findTodayMarker = () => {
    if (cachedTodayMarker && cachedTodayMarker.isConnected) return cachedTodayMarker;
    cachedTodayMarker = [...document.querySelectorAll('div')].find(el => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.width > 4 || r.height < 300) return false;
      const bg = getComputedStyle(el).backgroundColor;
      return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    }) || null;
    return cachedTodayMarker;
  };

  // ─── 隱藏「目前時段」高亮（2026-08 改版後重新對應）──────
  // 舊版純 CSS 寫死雜湊 class：body.jpt-hide-current-month ._1kl7ia51._1s7zia51
  // 新版沒有雜湊 class 可預先寫死了，但這次改版意外地讓這格「有 testid 了」：
  // 一組 [data-testid^="timeline.chart-overlays.columns-overlay.column-N"]
  // 裡，背景不透明的那一個就是目前高亮的月/週/季欄。用 JS 動態找到它，直接在
  // 該元素上加 class 蓋掉背景（取代原本寫死選擇器的 CSS 規則）。
  const SEL_COLUMN_OVERLAY = '[data-testid^="timeline.chart-overlays.columns-overlay.column-"]';
  const CURRENT_PERIOD_HIDE_CLASS = 'jpt-current-period-hidden';
  // 實測發現：同一個 column-N testid 在 DOM 裡其實有「兩份」——一份活在
  // <thead> 底下（尺寸只有 header cell 高，通常background transparent，
  // 是虛擬化/複用機制留下的殘影節點）、另一份活在 table 外層的
  // chart-overlays.container（真正貫穿 header+body 整欄高度的那個，才是
  // 畫面上實際看得到的高亮）。哪一份「目前是非透明」會隨著虛擬化/捲動變化，
  // 舊版「找到第一個非透明的就 break」的寫法，遇到捲動那個瞬間可能剛好抓到
  // thead 那份短命的殘影，把 hide class 蓋在錯的節點上，結果真正畫在畫面上
  // 的欄位反而沒被隱藏——使用者看到的就是「標頭那格看起來被處理過，但下面
  // 整欄的高亮還在」。改成不 break、每次重新整理全部符合條件的節點，並且
  // 每次都先清掉舊的 hide class 再重算，才不會被虛擬化的殘影節點誤導。
  const applyCurrentPeriodHide = () => {
    document.querySelectorAll(`.${CURRENT_PERIOD_HIDE_CLASS}`).forEach(el => el.classList.remove(CURRENT_PERIOD_HIDE_CLASS));
    if (!settings.enabled || !settings.hideCurrentMonth) return;
    for (const col of document.querySelectorAll(SEL_COLUMN_OVERLAY)) {
      const bg = getComputedStyle(col).backgroundColor;
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        col.classList.add(CURRENT_PERIOD_HIDE_CLASS);
      }
    }
  };

  const MONTH_NAMES = {
    January:1, February:2, March:3, April:4, May:5, June:6,
    July:7, August:8, September:9, October:10, November:11, December:12,
  };
  const parseMonthLabel = (text) => {
    if (!text) return null;
    const m = text.trim().match(/^([A-Z][a-z]+)(?:\s+'(\d{2}))?$/);
    if (!m) return null;
    const month = MONTH_NAMES[m[1]];
    if (!month) return null;
    const year = m[2] ? 2000 + parseInt(m[2], 10) : new Date().getFullYear();
    return { year, month };
  };
  const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

  // 舊版讀 URL ?timeline=WEEKS|MONTHS|QUARTERS；2026-08 改版後 URL 不再帶這個
  // 參數（純前端 state，實測切視圖 URL 完全不變），改成讀「週/月/季」三顆切換
  // 按鈕，找目前背景不透明（= 被選中）的那顆，用按鈕文字對應模式。
  // 文字依站台語系而定，中英文都收（比照 EPIC_TYPE_NAMES 的雙語處理方式）。
  const MODE_BUTTON_LABELS = {
    '週': 'WEEKS', '周': 'WEEKS', 'Weeks': 'WEEKS', 'Week': 'WEEKS',
    '月': 'MONTHS', 'Months': 'MONTHS', 'Month': 'MONTHS',
    '季': 'QUARTERS', 'Quarters': 'QUARTERS', 'Quarter': 'QUARTERS',
  };
  const SEL_MODE_SWITCHER_BUTTON = '[data-testid="aais-timeline-toolbar.ui.timeline-mode-switcher.expand-button"]';
  const getTimelineMode = () => {
    for (const b of document.querySelectorAll(SEL_MODE_SWITCHER_BUTTON)) {
      const bg = getComputedStyle(b).backgroundColor;
      if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue;   // 沒被選中
      const label = MODE_BUTTON_LABELS[b.textContent.trim()];
      if (label) return label;
    }
    return 'MONTHS';  // 找不到就退回月視圖（維持舊版預設行為）
  };

  // 從第一個能解析的 header cell 算出 px-per-day
  const computePxPerDay = (mode) => {
    const headerRow = getHeaderRow();
    if (!headerRow) return null;
    const cells = [];
    headerRow.querySelectorAll('div').forEach(d => {
      const small = d.querySelector('small');
      if (!small) return;
      const r = d.getBoundingClientRect();
      if (r.width < 30 || r.width > 1200) return;
      cells.push({ el: d, text: small.textContent?.trim() || '', rect: r });
    });
    if (!cells.length) return null;

    const sample = cells[0];
    let unitDays;
    if (mode === 'WEEKS')      unitDays = 7;
    else if (mode === 'QUARTERS') unitDays = 91;  // 近似平均
    else {
      // MONTHS：解析年月，用該月實際天數
      const parsed = parseMonthLabel(sample.text);
      unitDays = parsed ? daysInMonth(parsed.year, parsed.month) : 30;
    }
    return { pxPerDay: sample.rect.width / unitDays, cells };
  };

  let lastStripSig = '';
  const drawHolidayStrips = () => {
    // 目前時段高亮跟週末/假日 strip 都是「每輪 timeline 幾何變動就要重算」的
    // 同一類工作，改版後兩者的錨點都不穩了，收在同一個入口一起處理。
    try { applyCurrentPeriodHide(); } catch {}
    const today = findTodayMarker();
    if (!today) return;
    const parent = today.parentElement;

    const wantWeekends = !!settings.showWeekends;
    const wantHolidays = !!settings.showHolidays;
    if (!wantWeekends && !wantHolidays) {
      // 全域清除，不只清 parent 底下的——見下方主流程註解，parent 這個參考
      // 會隨虛擬化換人，只清當下這份會漏掉舊 parent 底下的殘留 strip。
      document.querySelectorAll(`.${STRIP_CLASS}`).forEach(el => el.remove());
      lastStripSig = '';
      return;
    }

    const mode = getTimelineMode();
    const computed = computePxPerDay(mode);
    if (!computed) return;
    const { pxPerDay, cells } = computed;

    // 用 today-marker 的 offsetLeft（parent-relative）作為今天的錨點
    const todayParentX = today.offsetLeft;
    const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);

    // 計算可見的 day offset 範圍（first cell 開始 ~ last cell 結束）
    const parentRect = parent.getBoundingClientRect();
    const firstCell = cells[0].rect;
    const lastCell = cells[cells.length - 1].rect;
    const firstParentX = firstCell.x - parentRect.x;
    const lastParentEndX = (lastCell.x + lastCell.width) - parentRect.x;
    const startOffset = Math.floor((firstParentX - todayParentX) / pxPerDay);
    const endOffset   = Math.ceil ((lastParentEndX - todayParentX) / pxPerDay);

    // signature：mode + cell 寬 + today 位置 + 範圍 + 選項
    const sig = `${mode}|${cells.length}|${cells[0].rect.width.toFixed(1)}|${todayParentX}|${startOffset}|${endOffset}|${wantWeekends?1:0}${wantHolidays?1:0}`;
    if (sig === lastStripSig && document.querySelector(`.${STRIP_CLASS}`)) return;
    lastStripSig = sig;

    // 實測：today-marker 是用幾何特徵動態掃出來、加了快取的（findTodayMarker），
    // 一旦舊的快取節點被虛擬化機制回收/替換，today.parentElement 也會換成
    // 「另一份」節點（跟 column-overlay 的殘影問題同一個成因：這層 overlay
    // 容器本身也會被複製/回收）。舊寫法只清「這次的 parent」底下的 strip，
    // 换過 parent 後，舊 parent 底下那些 strip 就變成永遠沒人清的孤兒，越積
    // 越多（實測一次找到 358 個），而且很多孤兒剛好卡在過期的捲動位置，會
    // 跟目前畫面上的 bar 疊在一起，看起來像是「層級蓋到時間塊上面」。改成
    // 全域清除，確保每次重畫前，畫面上真的只剩「這一輪」畫的 strip。
    document.querySelectorAll(`.${STRIP_CLASS}`).forEach(el => el.remove());

    const frag = document.createDocumentFragment();
    for (let off = startOffset; off <= endOffset; off++) {
      const d = new Date(todayDate);
      d.setDate(d.getDate() + off);
      const dow = d.getDay();
      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const isHoliday = TwHolidays.has(ds);
      const isWeekend = (dow === 0 || dow === 6);

      let cls = null;
      if (isHoliday && wantHolidays) cls = 'jpt-cal-holiday';
      else if (isWeekend && wantWeekends) cls = 'jpt-cal-weekend';
      if (!cls) continue;

      const strip = document.createElement('div');
      strip.className = `${STRIP_CLASS} ${cls}`;
      // today-marker 落在今天那欄的正中央（實測 ~47%）→ off * pxPerDay 起點
      // 等於每欄的「中央」。所以 strip 的左緣要再往左退 0.5 天，整段才會落在
      // 「日期欄左緣到右緣」上，數字標籤剛好落在 strip 上方正中央。
      strip.style.left = `${todayParentX + (off - 0.5) * pxPerDay}px`;
      strip.style.width = `${pxPerDay}px`;
      frag.appendChild(strip);
    }
    parent.appendChild(frag);
  };

  const clearHolidayStrips = () => {
    // 同上：全域清除，不要只看目前這個 today 節點的 parent（可能已經不是
    // 當初畫 strip 時的那份節點了）。
    document.querySelectorAll(`.${STRIP_CLASS}`).forEach(el => el.remove());
    lastStripSig = '';
  };

  // ─── 方向鍵左右捲動時間軸 ─────────────────────────
  // capture 階段攔截，避免 Jira row-navigation 接走方向鍵
  const SCROLL_STEP = 200;     // 一次 ~ 一週（月視圖）
  const SCROLL_BIG  = 800;     // Shift 修飾鍵
  const onArrowKey = (e) => {
    if (!settings.enabled) return;  // 方向鍵捲動已固化為預設行為
    if (!isTimelinePage()) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    // jira-people-view modal 開著時不搶方向鍵（讓它自己捲自己的時間軸）
    if (document.getElementById('jpv-modal')) return;
    // 在輸入框內不攔截
    const t = e.target;
    if (t && (t.matches?.('input, textarea, [contenteditable="true"]') ||
              t.closest?.('input, textarea, [contenteditable="true"]'))) return;
    // 修飾鍵（除 Shift）放行給瀏覽器/Jira
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    // 舊 testid「sr-timeline」2026-08 改版後也消失了，實測新版捲動容器換成
    // scroll-container.scroll-container。
    const scroller = document.querySelector('[data-testid="scroll-container.scroll-container"]');
    if (!scroller) return;

    const step = e.shiftKey ? SCROLL_BIG : SCROLL_STEP;
    const dir  = e.key === 'ArrowLeft' ? -1 : 1;
    scroller.scrollLeft += step * dir;
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener('keydown', onArrowKey, true);  // capture 階段

  // ─── 載入設定 + 監聽變動 ────────────────────────────
  const loadSettings = async () => {
    try {
      const cfg = await chrome.storage.sync.get(DEFAULTS);
      settings = { ...DEFAULTS, ...cfg };
    } catch (e) {
      // chrome.storage 可能因頁面 sandbox 不可用，fallback 預設值
      settings = { ...DEFAULTS };
    }
    applyCssVars();
    rerenderAll();
  };

  try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area === 'sync') {
        if (changes.enabled !== undefined) settings.enabled = changes.enabled.newValue !== false;
        if (changes.ptColor)    settings.ptColor    = changes.ptColor.newValue    ?? DEFAULTS.ptColor;
        if (changes.msColor)    settings.msColor    = changes.msColor.newValue    ?? DEFAULTS.msColor;
        if (changes.msDiamond)  settings.msDiamond  = !!(changes.msDiamond.newValue);
        // msLockEdges 已固化為預設行為，不再從 storage 讀取
        if (changes.msShowProgress !== undefined) settings.msShowProgress = !!(changes.msShowProgress.newValue);
        if (changes.ptLockDrag !== undefined) settings.ptLockDrag = !!(changes.ptLockDrag.newValue);
        if (changes.ptTargetEndShade !== undefined) settings.ptTargetEndShade = !!(changes.ptTargetEndShade.newValue);
        if (changes.epicLockDrag !== undefined) settings.epicLockDrag = !!(changes.epicLockDrag.newValue);
        if (changes.epicStripe) settings.epicStripe = !!(changes.epicStripe.newValue);
        if (changes.hideCurrentMonth) settings.hideCurrentMonth = !!(changes.hideCurrentMonth.newValue);
        if (changes.hideIssueKey !== undefined) settings.hideIssueKey = !!(changes.hideIssueKey.newValue);
        if (changes.showWeekends !== undefined) settings.showWeekends = !!(changes.showWeekends.newValue);
        if (changes.showHolidays !== undefined) settings.showHolidays = !!(changes.showHolidays.newValue);
        if (changes.showWorkingDays !== undefined) settings.showWorkingDays = !!(changes.showWorkingDays.newValue);
        // arrowScroll 已固化為預設行為，不再從 storage 讀取
        applyCssVars();
        if (changes.enabled !== undefined) {
          // 開關切換 → 重新評估啟用 + 強制重渲染（防 F5 後狀態卡住）
          updateActivation();
          if (settings.enabled) { rerenderAll(); drawHolidayStrips(); }
        } else if (settings.enabled) {
          // 其他設定變動只在啟用時重渲染；停用時不能因任意 storage 寫入觸發畫面
          // （例如 jpt-toolbar-pos 拖曳會寫 storage，但不該重畫畫面）
          rerenderAll(); drawHolidayStrips();
          if (changes.ptTargetEndShade !== undefined && settings.ptTargetEndShade) scheduleScan();
        }
      } else if (area === 'local' && changes.cacheBuster) {
        // 「立即重新整理」按鈕：清快取，重新 fetch + render
        // 停用狀態下：cacheBuster 應該已被浮動 toolbar 攔截，這裡再加一層防呆
        if (!settings.enabled) return;
        typeCache.clear();
        dataCache.clear();
        try {
          sessionStorage.removeItem(TYPE_CACHE_KEY);
          sessionStorage.removeItem(DATA_CACHE_KEY);
        } catch {}
        document.querySelectorAll(`.${PT_CLASS}, .${MS_CLASS}, .${DIA_CLASS}, .${EPIC_HIGHLIGHT_CLASS}`).forEach(el => {
          el.classList.remove(...ALL_CLASSES);
        });
        scheduleScan();
      }
    });
  } catch {}

  // ─── 抽 ID / Key ────────────────────────────────────
  // row 現在就是 <tr>：key 直接在同一列裡找；id 則從同一列裡的 bar 反推
  // （bar 不一定存在——例如任務沒填日期就不會有 bar，這時 id 會是 null，
  //   跟舊版「這個 issue 沒東西可上色」的行為一致）。
  // findBarById 定義移到檔案上方的選擇器區塊，跟 extractIssueIdFromBar 放一起。
  const extractIssueId = (row) => extractIssueIdFromBar(row.querySelector(SEL_BAR_CONTAINER));
  const extractIssueKey = (row) => {
    const keyEl = row.querySelector(SEL_KEY);
    return keyEl?.textContent?.trim() || null;
  };

  // ─── Milestone 進度 badge ──────────────────────────
  const progressColorTier = (pct) => {
    if (pct >= 100) return 'jpt-ms-progress-done';
    if (pct >= 50)  return 'jpt-ms-progress-mid';
    if (pct >  0)   return 'jpt-ms-progress-low';
    return 'jpt-ms-progress-zero';
  };

  const formatDueMonthDay = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${Number(m[2])}/${Number(m[3])}` : '';
  };

  const renderProgressBadge = (bar, progress, dueDate) => {
    const existing = bar.querySelector(`:scope > .${PROGRESS_CLASS}`);
    const dueText = formatDueMonthDay(dueDate);
    // 完成度與 Due date 各自可顯示；兩者都沒有或設定關閉才清掉 badge。
    const hasProgress = progress
      && Number.isFinite(progress.pct)
      && Number.isFinite(progress.total)
      && progress.total > 0
      && Number.isFinite(progress.done)
      && Number.isFinite(progress.wip);
    if ((!hasProgress && !dueText) || !settings.msShowProgress) {
      existing?.remove();
      return;
    }
    // 分子 = 已開始的任務數（done + wip）；% 數仍以「進行中算半分」計算
    const progressText = hasProgress
      ? `${progress.done + progress.wip}/${progress.total} ${progress.pct}%`
      : '';
    const text = [progressText, dueText ? `DUE ${dueText}` : ''].filter(Boolean).join(' · ');
    const progressTitle = !hasProgress
      ? ''
      : progress.wip > 0
        ? `${progress.done} 完成 + ${progress.wip} 進行中（半分） / ${progress.total} 總共 = ${progress.pct}%`
        : `${progress.done} 完成 / ${progress.total} 總共 = ${progress.pct}%`;
    const title = [progressTitle, dueText ? `Due date：${dueDate}` : ''].filter(Boolean).join('；');
    const tier = hasProgress ? progressColorTier(progress.pct) : 'jpt-ms-progress-zero';
    // 冪等：內容/色階一致就不動 DOM（避免 MutationObserver 雪球）
    if (existing && existing.textContent === text && existing.classList.contains(tier) && existing.title === title) {
      return;
    }
    if (existing) existing.remove();
    const span = document.createElement('span');
    span.className = `${PROGRESS_CLASS} ${tier}`;
    span.textContent = text;
    span.title = title;
    bar.appendChild(span);
  };
  // ─── 套色到單一 bar ──────────────────────────────────
  // 冪等實作：先算出目標 class set，再跟 bar 現有 class 比對，差異才動 DOM。
  // 之前無條件 remove(...ALL_CLASSES) + add 會在新一輪掃描期間短暫露出 Jira
  // 預設樣式（捲動時尤其明顯），現在 class 沒變就完全不寫入。
  // badge 透過 renderProgressBadge 冪等處理（只在內容改變時才動 DOM）。
  const parseDateOnlyMs = (value) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  };

  const renderPtTargetEndShade = (bar, data) => {
    const clear = () => {
      bar.classList.remove(PT_TARGET_SHADE_CLASS);
      bar.style.removeProperty('--jpt-target-end-ratio');
    };
    if (!settings.ptTargetEndShade || !data) { clear(); return; }
    const start = parseDateOnlyMs(data.startDate);
    const target = parseDateOnlyMs(data.targetEndDate);
    const due = parseDateOnlyMs(data.dueDate);
    if (![start, target, due].every(Number.isFinite) || !(start <= target && target <= due)) {
      clear();
      return;
    }
    const dayMs = 86_400_000;
    const totalDays = Math.floor((due - start) / dayMs) + 1;
    const targetOffsetDays = Math.floor((target - start) / dayMs);
    const ratio = Math.max(0, Math.min(1, targetOffsetDays / totalDays));
    bar.style.setProperty('--jpt-target-end-ratio', `${(ratio * 100).toFixed(3)}%`);
    bar.classList.add(PT_TARGET_SHADE_CLASS);
  };
  const applyColor = (issueId, issueKey) => {
    if (!settings.enabled) return;  // 防呆：停用時絕不上色（含已排隊的 scan timer）
    if (!typeCache.has(issueKey)) return;  // 還沒抓過 type，等 fetch 完才上色
    const type = typeCache.get(issueKey);
    const data = dataCache.get(issueKey) || { epicHighlight: false, progress: null };
    const bar = findBarById(issueId);
    if (!bar) return;

    // 目標狀態
    const cls = type ? TYPE_TO_CLASS[type] : null;
    const isMs = cls === MS_CLASS;
    const isEpic = !cls && type && EPIC_TYPE_NAMES.has(type);
    const wantPT      = cls === PT_CLASS;
    const wantMS      = isMs;
    const wantDIA     = isMs && !!settings.msDiamond;
    const wantEpicBar = !!isEpic;   // 所有 Epic 都標 jpt-epic-bar，給 lock-drag CSS 用
    const wantEpic    = isEpic && !!settings.epicStripe && !!data.epicHighlight;

    const cl = bar.classList;
    if (cl.contains(PT_CLASS)             !== wantPT)      cl.toggle(PT_CLASS, wantPT);
    if (cl.contains(MS_CLASS)             !== wantMS)      cl.toggle(MS_CLASS, wantMS);
    if (cl.contains(DIA_CLASS)            !== wantDIA)     cl.toggle(DIA_CLASS, wantDIA);
    if (cl.contains(EPIC_BAR_CLASS)       !== wantEpicBar) cl.toggle(EPIC_BAR_CLASS, wantEpicBar);
    if (cl.contains(EPIC_HIGHLIGHT_CLASS) !== wantEpic)    cl.toggle(EPIC_HIGHLIGHT_CLASS, wantEpic);

    // Milestone 才顯示 badge；其他類型清掉（renderProgressBadge 自身冪等）
    renderPtTargetEndShade(bar, wantPT ? data : null);
    renderProgressBadge(bar, isMs ? data.progress : null, isMs ? data.dueDate : null);
  };

  // ─── 全頁重渲染（settings 變動時呼叫）──────────────
  const rerenderAll = () => {
    if (!settings.enabled) return;  // 防呆：停用時絕不上色
    getTimelineRows().forEach(row => {
      const id = extractIssueId(row);
      const key = extractIssueKey(row);
      if (id && key) applyColor(id, key);
    });
  };

  // ─── 從 issuelinks 算 Milestone relates 完成度 ─────
  // Jira API 回的 issuelinks 直接帶 outwardIssue/inwardIssue.fields.status
  // 一次 batch fetch 就拿到所有資料，無需第二輪查。
  // 「relates to」link 類型偵測：可能是 `Relates`、`01_Relates`（客製排序前綴）等。
  // 用 regex 容錯，所有以「relates」結尾／開頭的 link type 都算。
  const RELATES_RE = /relates/i;
  const isRelatesLink = (link) => RELATES_RE.test(link?.type?.name || '');

  const computeMsProgress = (issuelinks) => {
    if (!Array.isArray(issuelinks)) return null;
    let total = 0, done = 0, wip = 0;
    for (const link of issuelinks) {
      if (!isRelatesLink(link)) continue;
      const peer = link.outwardIssue || link.inwardIssue;
      if (!peer) continue;
      total++;
      const cat = peer.fields?.status?.statusCategory?.key;
      if (cat === 'done') done++;
      else if (cat === 'indeterminate') wip++;
    }
    if (total === 0) return null;
    // 進行中算半分
    const score = done + wip * 0.5;
    const pct = Math.round(score * 100 / total);
    return { total, done, wip, pct };
  };

  // 從 issuelinks 抽出 relates 任務清單（給 hover tooltip 用）
  // typeIconUrl / typeName：用來在 tooltip 每列前面顯示議題類型圖示，一眼辨識任務類型
  // （Story / Task / Bug / Sub-task / Planning Task ...）
  // Apply at fetch time and again at render time so cached lists cannot retain an old order.
  const RELATES_STATUS_ORDER = { indeterminate: 0, new: 1, done: 2 };
  const sortRelatesList = (items) => items.slice().sort((a, b) => {
    const statusOrder = (RELATES_STATUS_ORDER[a.statusCat] ?? 0) - (RELATES_STATUS_ORDER[b.statusCat] ?? 0);
    if (statusOrder !== 0) return statusOrder;
    const typeOrder = (a.typeName || '').localeCompare(b.typeName || '', undefined, { numeric: true, sensitivity: 'base' });
    if (typeOrder !== 0) return typeOrder;
    const summaryOrder = (a.summary || '').localeCompare(b.summary || '', undefined, { numeric: true, sensitivity: 'base' });
    return summaryOrder !== 0
      ? summaryOrder
      : (a.key || '').localeCompare(b.key || '', undefined, { numeric: true, sensitivity: 'base' });
  });

  const computeRelatesList = (issuelinks) => {
    if (!Array.isArray(issuelinks)) return [];
    const list = [];
    for (const link of issuelinks) {
      if (!isRelatesLink(link)) continue;
      const peer = link.outwardIssue || link.inwardIssue;
      if (!peer) continue;
      const itype = peer.fields?.issuetype || {};
      list.push({
        key: peer.key,
        summary: peer.fields?.summary || '',
        statusName: peer.fields?.status?.name || '',
        statusCat: peer.fields?.status?.statusCategory?.key || '',
        typeIconUrl: itype.iconUrl || '',
        typeName: itype.name || '',
      });
    }
    return sortRelatesList(list);
  };

  // ─── 批次查 issue 資料 ─────────────────────────────
  // - 一律抓 issuetype / 日期（type 之後永久 cache、日期短 TTL）
  // - issuelinks 只在 msShowProgress 開啟時才抓（response size 大幅縮小）
  // Epic 高亮欄位可能是 string / 單選 object / 多選 array — 容錯三種形式
  const isEpicHighlightOn = (raw) => {
    if (!raw) return false;
    if (typeof raw === 'string') return raw === '啟用';
    if (Array.isArray(raw)) return raw.some(o => o?.value === '啟用' || o?.name === '啟用');
    if (typeof raw === 'object') return raw.value === '啟用' || raw.name === '啟用';
    return false;
  };

  const BATCH_SIZE = 50;
  // API 持續失敗（session 過期 401 / infra 5xx）時的退避 — 沒有這個的話，
  // 失敗的 key 不會進 cache，needsFetch 永遠 true，MutationObserver → scheduleScan
  // 會每 300ms 重發同一批失敗請求無限重打
  let fetchBackoffUntil = 0;
  const FETCH_BACKOFF_MS = 60000;
  const fetchTypes = async (keys) => {
    if (!keys.length) return;
    if (Date.now() < fetchBackoffUntil) return;
    keys.forEach(k => pending.add(k));
    try {
      // 一律抓 cf[10773] 職種（給 PT hover）+ cf[10919] Epic 高亮旗標 + issuelinks（給 progress badge / Milestone hover）
      //      + duedate / cf[10015] Start Date（給 Milestone hover 顯示每筆 relates 的日期範圍）
      const includeTargetEnd = settings.ptTargetEndShade;
      const fields = ['issuetype', FIELD_ROLE, FIELD_EPIC_HIGHLIGHT, FIELD_START_DATE, 'duedate', 'issuelinks'];
      if (includeTargetEnd) fields.push(FIELD_TARGET_END);
      const issues = await JiraApi.searchByKeys(keys, fields);
      const now = Date.now();
      const seen = new Set();
      // 每筆給一個 ±jitter 範圍內隨機偏移 → 避免同批寫入同步過期造成 fetch 風暴
      const jitter = () => Math.round((Math.random() * 2 - 1) * TTL_JITTER_MS);
      for (const issue of issues) {
        const f = issue.fields || {};
        const type = f.issuetype?.name || null;
        const epicHighlight = isEpicHighlightOn(f[FIELD_EPIC_HIGHLIGHT]);
        // 職種 cf[10773] 是多選 — [{value: 'data', id: '10657'}, ...]
        const roleField = f[FIELD_ROLE];
        const roles = Array.isArray(roleField)
          ? roleField.map(r => r?.value || r?.name).filter(Boolean)
          : [];
        const progress = (type === 'Milestone') ? computeMsProgress(f.issuelinks) : null;
        const relates = (type === 'Milestone') ? computeRelatesList(f.issuelinks) : [];
        // 任務自身的起訖日期（'YYYY-MM-DD' 或 null）— Milestone hover 用該筆 relates 對應 issue 的 dataCache 查
        const startDate = f[FIELD_START_DATE] || null;
        const dueDate   = f.duedate || null;
        const rawTargetEnd = f[FIELD_TARGET_END];
        const targetEndDate = includeTargetEnd
          ? (typeof rawTargetEnd === 'string' ? rawTargetEnd : (rawTargetEnd?.value || null))
          : undefined;
        if (type !== null) typeCache.set(issue.key, type);
        dataCache.set(issue.key, {
          epicHighlight, progress, roles, relates, startDate, dueDate,
          ...(includeTargetEnd ? { targetEndDate } : {}),
          ts: now, _jitter: jitter(),
        });
        seen.add(issue.key);
      }
      // 沒回傳的 key（已封存 / 權限不足）也標個空快取免得反覆重試
      for (const k of keys) {
        if (seen.has(k)) continue;
        if (!typeCache.has(k)) typeCache.set(k, null);
        dataCache.set(k, {
          epicHighlight: false, progress: null, roles: [], relates: [], startDate: null, dueDate: null,
          ...(includeTargetEnd ? { targetEndDate: null } : {}),
          ts: now, _jitter: jitter(),
        });
      }
      persistTypeCache();
      persistDataCache();
      fetchBackoffUntil = 0;
    } catch (e) {
      fetchBackoffUntil = Date.now() + FETCH_BACKOFF_MS;
      console.warn('[jpt] fetchTypes failed — 暫停補抓 60s', e);
    } finally {
      keys.forEach(k => pending.delete(k));
    }
  };

  // ─── 主掃描（debounce）────────────────────────────
  let scanTimer = null;
  let scanRetryTimer = null;
  const scheduleScan = () => {
    if (scanTimer) return;
    scanTimer = setTimeout(async () => { scanTimer = null; await scan(); }, 300);
  };

  const scan = async () => {
    if (!settings.enabled) return;  // 防呆：停用時不掃描（含 cacheBuster / 殘留 timer）
    const listItems = getTimelineRows();
    if (DEBUG) console.log(`[jpt] scan: ${listItems.length} rows`);
    if (!listItems.length) {
      // F5 後 Jira 渲染慢、或 filter 套用時 DOM 暫時空 — 排程一次延遲重試
      if (!scanRetryTimer) {
        scanRetryTimer = setTimeout(() => {
          scanRetryTimer = null;
          scheduleScan();
          drawHolidayStrips();
        }, 1500);
      }
      return;
    }

    const idByKey = new Map();
    for (const item of listItems) {
      const id = extractIssueId(item);
      const key = extractIssueKey(item);
      if (id && key) {
        idByKey.set(key, id);
        idToKey.set(id, key);   // 給 hover tooltip 用（從 bar testid 反查 key）
      }
    }

    // 套已快取（type 有 + data fresh 的；type 有但 data 過期也先用舊資料上色，
    // 避免 60 秒過期那一刻 bar 短暫失色，後面 fetch 完會 re-apply）
    for (const [key, id] of idByKey) {
      if (typeCache.has(key)) applyColor(id, key);
    }

    // 排 fetch：type 沒抓過 OR data 過期
    const unknown = [...idByKey.keys()].filter(k => needsFetch(k) && !pending.has(k));
    if (!unknown.length) return;
    if (DEBUG) console.log(`[jpt] fetching ${unknown.length} keys (typeMiss=${unknown.filter(k => !typeCache.has(k)).length}, dataStale=${unknown.filter(k => typeCache.has(k)).length})`);

    for (let i = 0; i < unknown.length; i += BATCH_SIZE) {
      const batch = unknown.slice(i, i + BATCH_SIZE);
      await fetchTypes(batch);
      for (const k of batch) {
        const id = idByKey.get(k);
        if (id) applyColor(id, k);
      }
      if (i + BATCH_SIZE < unknown.length) await JiraApi.sleep(120);
    }
  };

  // ─── Timeline 頁面偵測 + 啟用/停用切換 ──────────────
  // 只在 timeline 頁啟用 DOM observer 與 scan，省掉其他頁面的渲染損耗。
  // 判定與 floating_toolbar.js 共用同一份（該檔先載入並掛在 window 上），
  // 避免兩處條件不同步造成「toolbar 有出現但染色沒啟用」。
  const isTimelinePage = () =>
    typeof window.__jptIsTimelinePage === 'function'
      ? window.__jptIsTimelinePage()
      : location.pathname.includes('/timeline');

  // ─── Hover tooltip：bar 滑入顯示職種 / Milestone relates 任務 ─────
  // 設計：tooltip 永遠在 bar **上方** 顯示（必要時翻到下方），避免遮到 Jira 原生
  //       的左右日期標籤（May 25, 2026 那種會出現在 bar 左右兩側）
  const idToKey = new Map();   // 由 scan() 維護：numeric id → issue key
  let hoverTipEl = null;
  let hoverTipHideTimer = null;
  let lazyFetchTimer = null;          // Milestone hover 補抓 peer 起訖日的 debounce timer
  const LAZY_FETCH_DELAY_MS = 400;    // 滑鼠停留 > 400ms 才打 API 補抓（避免滑鼠掃過大量 milestone 連續打 API）

  const STATUS_ICON = { done: '✓', indeterminate: '◐', new: '○' };

  const ensureHoverTip = () => {
    if (hoverTipEl) return hoverTipEl;
    hoverTipEl = document.createElement('div');
    hoverTipEl.id = 'jpt-hover-tip';
    hoverTipEl.style.display = 'none';
    document.body.appendChild(hoverTipEl);
    hoverTipEl.addEventListener('mouseenter', () => clearTimeout(hoverTipHideTimer));
    hoverTipEl.addEventListener('mouseleave', () => { hoverTipEl.style.display = 'none'; });
    return hoverTipEl;
  };

  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // 'YYYY-MM-DD' → 'M/D'；空值回 '-'
  const fmtMonthDay = (iso) => {
    if (!iso) return '-';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return '-';
    return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
  };
  // 「起 ~ 訖」字串；任一沒填補 '-'，都沒填顯示 '- ~ -'
  const fmtDateRange = (start, due) => `${fmtMonthDay(start)} ~ ${fmtMonthDay(due)}`;

  const buildTipHtml = (type, data) => {
    if (type === 'Planning Task') {
      if (!data.roles?.length) return null;
      return `<div class="jpt-tip-row"><span class="jpt-tip-label">職種</span><span class="jpt-tip-roles">${data.roles.map(r => `<span class="jpt-tip-role-chip">${escapeHtml(r)}</span>`).join('')}</span></div>`;
    }
    if (type === 'Milestone') {
      if (!data.relates?.length) return null;
      const relates = sortRelatesList(data.relates);
      const done = relates.filter(r => r.statusCat === 'done').length;
      const wip  = relates.filter(r => r.statusCat === 'indeterminate').length;
      const total = relates.length;
      return `
        <div class="jpt-tip-header">Relates to · ${done}／${total} 完成${wip ? `（含 ${wip} 進行中）` : ''}</div>
        <div class="jpt-tip-body">
          ${relates.map(r => {
            // 每筆 relates 任務的 start/due 日期，需從 dataCache 查（issuelinks 不會回 peer 的日期）
            // 沒抓過或抓不到 → fmtMonthDay 自動回 '-'
            const peer = dataCache.get(r.key);
            const dateRange = fmtDateRange(peer?.startDate, peer?.dueDate);
            return `
            <div class="jpt-tip-item jpt-tip-${escapeHtml(r.statusCat || 'new')}">
              <span class="jpt-tip-status">${STATUS_ICON[r.statusCat] || '·'}</span>
              ${r.typeIconUrl ? `<img class="jpt-tip-type-icon" src="${escapeHtml(r.typeIconUrl)}" alt="${escapeHtml(r.typeName)}" title="${escapeHtml(r.typeName)}">` : '<span class="jpt-tip-type-icon jpt-tip-type-icon-empty"></span>'}
              <span class="jpt-tip-daterange" title="${escapeHtml(r.key)}">${escapeHtml(dateRange)}</span>
              <span class="jpt-tip-summary">${escapeHtml(r.summary)}</span>
            </div>`;
          }).join('')}
        </div>`;
    }
    return null;
  };

  const positionTipAboveBar = (bar) => {
    const r = bar.getBoundingClientRect();
    const t = hoverTipEl.getBoundingClientRect();
    const GAP = 10;
    let top = r.top - t.height - GAP;
    if (top < 8) top = r.bottom + GAP;     // 上方放不下 → 改放下方
    let left = r.left + r.width / 2 - t.width / 2;
    if (left < 8) left = 8;
    if (left + t.width > window.innerWidth - 8) left = window.innerWidth - t.width - 8;
    hoverTipEl.style.left = left + 'px';
    hoverTipEl.style.top = top + 'px';
  };

  // tooltip 顯示期間的目標 bar — 捲動時要跟著 bar 重新定位（不然 tip 留在原地脫節）
  let hoverTipBar = null;
  let tipScrollRaf = 0;
  document.addEventListener('scroll', () => {
    if (!hoverTipEl || hoverTipEl.style.display !== 'block' || !hoverTipBar) return;
    if (tipScrollRaf) return;
    tipScrollRaf = requestAnimationFrame(() => {
      tipScrollRaf = 0;
      if (!hoverTipEl || hoverTipEl.style.display !== 'block' || !hoverTipBar) return;
      // bar 被 virtualizer 卸載 → tip 沒東西可跟，直接收
      if (!hoverTipBar.isConnected) { hoverTipEl.style.display = 'none'; hoverTipBar = null; return; }
      positionTipAboveBar(hoverTipBar);
    });
  }, true);   // capture：Jira timeline 的捲動發生在內層 scroller，不冒泡到 document

  const showHoverTip = (bar, key) => {
    if (!settings.enabled) return;
    const type = typeCache.get(key);
    if (!type) return;
    const data = dataCache.get(key) || {};
    const html = buildTipHtml(type, data);
    if (!html) return;
    const tip = ensureHoverTip();
    clearTimeout(hoverTipHideTimer);
    tip.innerHTML = html;
    tip.dataset.key = key;   // 標記是哪個任務的 tip — lazy 補抓完才知道要不要更新
    tip.className = `jpt-hover-tip-${type === 'Planning Task' ? 'pt' : 'ms'}`;
    tip.style.display = 'block';
    hoverTipBar = bar;
    // 等下一個 frame 拿正確尺寸再定位
    requestAnimationFrame(() => positionTipAboveBar(bar));

    // Milestone：補抓尚未在 dataCache 的 relates 任務（issuelinks 不會回 peer 的起訖日，
    // 必須對每個 relates key 個別查）。先 debounce — 滑鼠掃過不打 API，真的停留才打。
    // 完成後若 tip 還在顯示同一個 milestone 才更新 HTML。
    clearTimeout(lazyFetchTimer);
    if (type === 'Milestone' && Array.isArray(data.relates) && data.relates.length) {
      const missing = data.relates.map(r => r.key).filter(k => k && !dataCache.has(k) && !pending.has(k));
      if (missing.length) {
        lazyFetchTimer = setTimeout(async () => {
          // 起跑前再 check 一次 — 滑鼠已離開或換 bar 就不打
          if (!hoverTipEl || hoverTipEl.style.display !== 'block' || hoverTipEl.dataset.key !== key) return;
          for (let i = 0; i < missing.length; i += BATCH_SIZE) {
            await fetchTypes(missing.slice(i, i + BATCH_SIZE));
          }
          if (hoverTipEl && hoverTipEl.style.display === 'block' && hoverTipEl.dataset.key === key) {
            const fresh = dataCache.get(key) || data;
            hoverTipEl.innerHTML = buildTipHtml(type, fresh) || hoverTipEl.innerHTML;
            requestAnimationFrame(() => positionTipAboveBar(bar));
          }
        }, LAZY_FETCH_DELAY_MS);
      }
    }
  };

  const hideHoverTip = () => {
    if (!hoverTipEl) return;
    clearTimeout(hoverTipHideTimer);
    clearTimeout(lazyFetchTimer);   // 滑鼠離開 → 取消還沒打的 peer 起訖日補抓
    hoverTipHideTimer = setTimeout(() => { hoverTipEl.style.display = 'none'; hoverTipBar = null; }, 150);
  };

  // 砍掉 Milestone 結束日標籤的「(N 天)」時長後綴 — 時間點不需顯示時長
  // 文字部分隱藏 CSS 做不到，用 JS：hover 時等 Jira 渲染完 label 再 mutate text
  const stripDurationSuffix = (bar) => {
    const labels = bar.querySelectorAll('small');
    labels.forEach(s => {
      const t = s.textContent || '';
      const cleaned = t.replace(/\s*\(\s*\d+\s*天\s*\)\s*$/, '').replace(/\s*\(\s*\d+\s*days?\s*\)\s*$/i, '');
      if (cleaned !== t) s.textContent = cleaned;
    });
  };

  // ─── 工作天數標籤（hover / 拖拉時 append 到結束日 label）─────────
  // Jira 的 hover/drag label 文字模板：
  //   靜態：「May 21, 2026 (8 天)」  → 8 天為總天數（含頭含尾）
  //   拖拉：「Jun 22, 2026 (+17 天)」→ 17 天為相對 delta
  //
  // 我們不解析 label 文字日期（語系變動會壞），改用 bar 幾何對應 today-marker 算 day offset：
  //   today-marker.offsetLeft（以及 BCR.left + 半寬）≈ 今天那欄的中央
  //   bar.BCR.left  = 起始日欄中央（Jira 條塊 center-to-center 慣例）
  //   bar.BCR.right = 結束日欄中央
  //   day_offset = round((x - todayCenterX) / pxPerDay)
  // 工作天 = start ~ end 區間內排除週六/日 + TwHolidays 的天數。
  const ymdStr = (d) =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  const countWorkingDays = (start, end) => {
    let count = 0;
    const d = new Date(start); d.setHours(0,0,0,0);
    const stop = new Date(end); stop.setHours(0,0,0,0);
    while (d <= stop) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6 && !TwHolidays.has(ymdStr(d))) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  };

  // Jira 在 bar 內顯示的日期 label（hover/drag 時可見）— locale-aware 解析
  // 試過英文 (May 23, 2026) / 中文 (2026年5月23日) / ISO (2026-05-23)，都不中就回 null
  const FULL_MONTH_NAMES = {
    Jan:1, January:1, Feb:2, February:2, Mar:3, March:3, Apr:4, April:4, May:5,
    Jun:6, June:6, Jul:7, July:7, Aug:8, August:8, Sep:9, September:9, Sept:9,
    Oct:10, October:10, Nov:11, November:11, Dec:12, December:12,
  };
  const parseLabelDate = (text) => {
    if (!text) return null;
    // 英文：May 23, 2026 / Sep. 5, 2026
    let m = text.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})/);
    if (m) {
      const month = FULL_MONTH_NAMES[m[1]];
      if (month) return new Date(parseInt(m[3], 10), month - 1, parseInt(m[2], 10));
    }
    // 中文：2026年5月23日 / 2026/5/23
    m = text.match(/(\d{4})[年/](\d{1,2})[月/](\d{1,2})日?/);
    if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    // ISO：2026-05-23
    m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    return null;
  };

  // 用 label 文字當權威來源 — geometry 在長距離下會 subpixel round 漂半天，
  // 結果每隔幾天就 ±1 工作天的 bug。label 是 Jira 自己印出的「N 天」與起訖日，可信。
  const computeBarDayRange = (bar) => {
    const smalls = [...bar.querySelectorAll('small')]
      .map(s => ({ s, r: s.getBoundingClientRect(), text: (s.textContent || '').trim() }))
      .filter(x => x.r.width > 0)
      .sort((a, b) => a.r.left - b.r.left);
    if (!smalls.length) return null;

    let startDate = null;
    let endDate = null;
    let absoluteCount = null;
    for (const x of smalls) {
      const d = parseLabelDate(x.text);
      if (!d) continue;
      // 含「(N 天)」沒帶正負號 → 結束日 + 絕對天數
      const mAbs = x.text.match(/\(\s*(\d+)\s*(?:天|days?)\s*\)/i);
      if (mAbs && !x.text.match(/\(\s*[+\-]\d+/)) {
        endDate = d;
        absoluteCount = parseInt(mAbs[1], 10);
        continue;
      }
      // 純日期（無天數括號）→ 起始日（左側 small 通常是這個）
      if (!startDate) startDate = d;
      else endDate = d;
    }

    if (startDate && absoluteCount) {
      const end = endDate || (() => { const e = new Date(startDate); e.setDate(e.getDate() + absoluteCount - 1); return e; })();
      return { start: startDate, end };
    }
    if (startDate && endDate) return { start: startDate, end: endDate };
    if (endDate && absoluteCount) {
      const start = new Date(endDate); start.setDate(start.getDate() - absoluteCount + 1);
      return { start, end: endDate };
    }

    // ── 後備：label 解析失敗（語系沒命中 / 拖拉中只剩「+N 天」delta）
    //    回頭用 bar 幾何推 — 已知會 ±1 漂，但總比沒有強
    const today = findTodayMarker();
    if (!today) return null;
    const computed = computePxPerDay(getTimelineMode());
    if (!computed) return null;
    const { pxPerDay } = computed;
    const tr = today.getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    if (!br.width) return null;
    const todayCenterX = tr.left + tr.width / 2;
    const startOff = Math.round((br.left - todayCenterX) / pxPerDay);
    const count = Math.max(1, Math.round(br.width / pxPerDay) + 1);
    const endOff = startOff + count - 1;
    const t0 = new Date(); t0.setHours(0,0,0,0);
    const start = new Date(t0); start.setDate(start.getDate() + startOff);
    const end   = new Date(t0); end.setDate(end.getDate() + endOff);
    return { start, end };
  };

  // 浮動 overlay：不碰 Jira `<small>` 的 textContent（會撞 React reconciler 拋
  // 「DOM 與 vDOM 不一致」例外讓整個 timeline 掛掉）。改用 body-level <span>
  // 靠 BCR 貼在 bar 結束日標籤右邊 — 純視覺，不污染 Jira DOM。
  const WD_DURATION_RE = /\(\s*[+\-]?\d+\s*(?:天|days?)\s*\)/i;
  let wdOverlayEl = null;
  let wdRafId = null;
  let wdActiveBar = null;

  const ensureWdOverlay = () => {
    if (wdOverlayEl && document.body.contains(wdOverlayEl)) return wdOverlayEl;
    wdOverlayEl = document.createElement('span');
    wdOverlayEl.id = 'jpt-wd-overlay';
    wdOverlayEl.style.display = 'none';
    document.body.appendChild(wdOverlayEl);
    return wdOverlayEl;
  };

  // 找 bar 內最右邊那個有「(N 天) / (+N 天)」字樣的 <small>（結束日標籤）
  const findEndDateLabel = (bar) => {
    const smalls = bar.querySelectorAll('small');
    let best = null, bestRight = -Infinity;
    for (const s of smalls) {
      if (!WD_DURATION_RE.test(s.textContent || '')) continue;
      const r = s.getBoundingClientRect();
      if (!r.width) continue;
      if (r.right > bestRight) { bestRight = r.right; best = s; }
    }
    return best;
  };

  const updateWdOverlay = () => {
    wdRafId = null;
    const bar = wdActiveBar;
    if (!bar || !document.body.contains(bar)) { hideWdOverlay(); return; }
    if (!settings.enabled || !settings.showWorkingDays) { hideWdOverlay(); return; }
    const small = findEndDateLabel(bar);
    if (!small) { hideWdOverlay(); return; }
    const range = computeBarDayRange(bar);
    if (!range) { hideWdOverlay(); return; }
    const wd = countWorkingDays(range.start, range.end);
    const overlay = ensureWdOverlay();
    const text = `(工作天 ${wd} 天)`;
    if (overlay.textContent !== text) overlay.textContent = text;
    const sr = small.getBoundingClientRect();
    overlay.style.display = '';
    // 對齊原 label 垂直中心（CSS 配 transform: translateY(-50%) 用）
    overlay.style.top = `${sr.top + sr.height / 2}px`;
    // 貼在原 label 右邊；用 BCR 即時貼齊（拖拉時也能跟）
    overlay.style.left = `${sr.right + 4}px`;
  };

  const hideWdOverlay = () => {
    if (wdOverlayEl) wdOverlayEl.style.display = 'none';
  };

  // 拖拉時 Jira 持續 re-render label，用 rAF loop 持續更新 overlay 位置與工作天數
  const startWdLoop = (bar) => {
    if (!settings.showWorkingDays) return;
    if (bar.classList.contains(DIA_CLASS)) return;  // 菱形是時間點，沒區間意義
    wdActiveBar = bar;
    if (wdRafId) cancelAnimationFrame(wdRafId);
    const tick = () => {
      if (wdActiveBar !== bar) return;  // 換 bar 或停了
      updateWdOverlay();
      wdRafId = requestAnimationFrame(tick);
    };
    wdRafId = requestAnimationFrame(tick);
  };

  const stopWdLoop = () => {
    wdActiveBar = null;
    if (wdRafId) { cancelAnimationFrame(wdRafId); wdRafId = null; }
    hideWdOverlay();
  };

  document.addEventListener('mouseover', (e) => {
    if (!settings.enabled) return;
    const bar = e.target.closest?.(SEL_BAR_CONTAINER);
    if (!bar) return;
    const id = extractIssueIdFromBar(bar);
    if (!id) return;
    const key = idToKey.get(id);
    if (!key) return;
    showHoverTip(bar, key);
    // Milestone 菱形 → 砍掉「(N 天)」後綴。等下個 frame 讓 Jira 先渲染 label
    if (bar.classList.contains('jpt-ms-diamond')) {
      requestAnimationFrame(() => requestAnimationFrame(() => stripDurationSuffix(bar)));
    }
    // 工作天數 — 啟動 overlay rAF loop（持續貼在結束日 label 右邊，跟拖拉更新）
    // 拖拉中滑過別的 bar 時不切換 wdActiveBar，避免 overlay 跑去別條
    if (settings.showWorkingDays && !bar.classList.contains('jpt-ms-diamond') && !wdDragLocked) {
      startWdLoop(bar);
    }
  }, true);

  // ─── 偵測「使用者拖完 bar 改日期」→ 主動失效該 issue 的 cache，下次 scan 重抓 ─
  // bar 拖拉時：mousedown on bar → mousemove → mouseup（座標可能變了）
  // 這邊不嚴謹判斷成功與否，只要 mouseup 跟 mousedown 距離 > 4px 就視為可能改了日期
  let dragStart = null;
  let wdDragLocked = false;  // 拖拉中：mouseout 不收 overlay（cursor 常離開 bar 範圍）
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;   // 只攔左鍵 — 右鍵選單 / 中鍵不該被鎖定邏輯吞掉
    const bar = e.target.closest?.('[data-testid*="draggable-bar-"][data-testid$="-container"]');
    if (!bar) { dragStart = null; return; }
    // 鎖定 PT / Epic 拖曳：在 capture phase 攔下 mousedown，Jira 的 drag listener 收不到。
    // 副作用：click-to-open 側欄也會失效（Jira 內部用 mousedown 啟動 click 流程）。
    // 鎖定狀態下用左欄任務名開啟側欄替代。
    if (settings.enabled && (
      (settings.ptLockDrag   && bar.classList.contains(PT_CLASS)) ||
      (settings.epicLockDrag && bar.classList.contains(EPIC_BAR_CLASS))
    )) {
      e.stopPropagation();
      e.preventDefault();
      dragStart = null;
      return;
    }
    const id = extractIssueIdFromBar(bar);
    if (!id) return;
    dragStart = { x: e.clientX, y: e.clientY, id, key: idToKey.get(id) };
    // 鎖住 wd overlay：這段期間 cursor 可能滑出 bar（resize / 整段拖），都要保留 overlay
    wdDragLocked = true;
  }, true);
  // 防 mouseup 落在視窗外造成 wdDragLocked 永遠卡 true（之後 hover 全失效）
  // window.blur / pagehide 都重置；正常拖拉內 mouseup 也會清乾淨
  window.addEventListener('blur', () => {
    if (wdDragLocked) { wdDragLocked = false; stopWdLoop(); }
  });

  document.addEventListener('mouseup', (e) => {
    const wasDragging = wdDragLocked;
    wdDragLocked = false;
    // 拖完若 cursor 已不在原 bar 上 → 收 overlay；還在的話留著等下次 mouseout
    if (wasDragging && wdActiveBar) {
      const onBar = e.target?.closest?.('[data-testid*="draggable-bar-"][data-testid$="-container"]') === wdActiveBar;
      if (!onBar) stopWdLoop();
    }
    if (!dragStart) return;
    const moved = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
    const { key } = dragStart;
    dragStart = null;
    if (moved < 4 || !key) return;
    // 拖過 → 失效該 issue 的 dataCache，等下次 scan 重抓拿到新日期
    dataCache.delete(key);
    persistDataCache();
    if (DEBUG) console.log('[jpt] invalidated cache after drag:', key);
    // 給 Jira 一點時間把 PUT request 送出去 + 回來
    setTimeout(() => scheduleScan(), 1500);
  }, true);

  document.addEventListener('mouseout', (e) => {
    const bar = e.target.closest?.('[data-testid*="draggable-bar-"][data-testid$="-container"]');
    if (!bar) return;
    // 拖拉中不收 working-day overlay（cursor 常滑出 bar；mouseup 才決定收/留）
    // 滑出 bar（且沒進到我們自己的 hover tooltip）→ 停 working-day overlay
    if (!wdDragLocked && (!e.relatedTarget || !bar.contains(e.relatedTarget))) stopWdLoop();
    // 從 bar 滑進 tooltip 時不收：tooltip 自己 enter handler 會接手
    if (hoverTipEl && e.relatedTarget && hoverTipEl.contains(e.relatedTarget)) return;
    hideHoverTip();
  }, true);

  let domObserver = null;
  // 對「新加入」的 list-item 立即從 cache 套色（不等 300ms scheduleScan debounce）。
  // 捲動時 Jira virtualizer 不停加/刪 list-item，新進場的 bar 若等 debounce 才上色，
  // 中間會短暫露出 Jira 預設樣式 → A 類閃爍主因之一。
  // Jira virtualizer 對 list-item（左欄）跟 bar（右欄 chart-item）的 DOM 進出
  // 不一定同 batch — Epic 預設色比較顯眼，bar 進場若沒立刻套色就會閃實心。
  // 兩條路徑都攔：list-item 進場 → 從 list-item 解 id/key；bar 進場 → 經 idToKey 反查。
  const applyCachedColorToAddedItems = (mutations) => {
    if (!settings.enabled) return;
    if (!mutations) return;  // startActive 首次手動呼叫沒帶參數 → 走全頁 scan 即可
    // 新版每個 issue 是同一張 table 裡的 <tr>，MutationObserver 觀察整個
    // document.body，用「屬於同一張 timeline table」限定，避免誤吃頁面上
    // 其他不相關的 <tr>（例如彈出視窗裡剛好也有表格）。
    const table = getTimelineTable();
    if (!table) return;
    const isOurRow = (n) => n.tagName === 'TR' && n.closest('table') === table;
    const addedItems = new Set();
    const addedBars  = new Set();
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (isOurRow(node)) addedItems.add(node);
        node.querySelectorAll?.('tr').forEach(n => { if (isOurRow(n)) addedItems.add(n); });
        if (node.matches?.(SEL_BAR_CONTAINER)) addedBars.add(node);
        node.querySelectorAll?.(SEL_BAR_CONTAINER).forEach(b => addedBars.add(b));
      }
    }
    for (const item of addedItems) {
      const id = extractIssueId(item);
      const key = extractIssueKey(item);
      if (id && key && typeCache.has(key)) applyColor(id, key);
    }
    for (const bar of addedBars) {
      const id = extractIssueIdFromBar(bar);
      if (!id) continue;
      const key = idToKey.get(id);  // 之前 scan 過就有；首次見的 issue 等 fetch 完才上色
      if (key && typeCache.has(key)) applyColor(id, key);
    }
  };
  // drawHolidayStrips 內含 getBoundingClientRect（強制 reflow），不能每個 mutation
  // batch 都直接跑 — 捲動/拖曳期間 Jira virtualizer 高頻觸發，會變效能熱點
  let stripTimer = null;
  const scheduleDrawHolidayStrips = () => {
    if (stripTimer) return;
    stripTimer = setTimeout(() => { stripTimer = null; drawHolidayStrips(); }, 200);
  };
  const onMutation = (mutations) => {
    applyCachedColorToAddedItems(mutations);
    scheduleScan();
    scheduleDrawHolidayStrips();
  };
  const startActive = () => {
    if (domObserver) return;
    if (DEBUG) console.log('[jpt] activate (timeline page)');
    document.body?.classList.add('jpt-active');   // 啟用時加入 — CSS 用此 gate 控制隱藏 dep line 等
    // SPA 路由切走再回來時，stopActive 拿掉的 gated class（hide-current-month、
    // hide-issue-key、lock-drag 等）必須在這裡重新套回，否則會卡到使用者下次手動
    // toggle 設定才回來。曾發生「離開時間軸再回來，隱藏目前時段高亮失效」就是這個。
    applyCssVars();
    onMutation();
    domObserver = new MutationObserver(onMutation);
    domObserver.observe(document.body, { childList: true, subtree: true });
  };
  const stopActive = () => {
    if (DEBUG) console.log('[jpt] deactivate');
    document.body?.classList.remove(
      'jpt-active',
      'jpt-hide-current-month',
      'jpt-hide-issue-key',
      'jpt-ms-lock-edges',
      'jpt-pt-lock-drag',
      'jpt-epic-lock-drag',
    );
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    // 取消已排隊但尚未執行的 timer，避免它們在 stopActive 之後跑回頭重畫
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    if (scanRetryTimer) { clearTimeout(scanRetryTimer); scanRetryTimer = null; }
    if (stripTimer) { clearTimeout(stripTimer); stripTimer = null; }
    // 即使 observer 沒在跑，也要把殘留的 class / badge 清乾淨（停用時務必收尾）
    document.querySelectorAll(`.${PT_CLASS}, .${MS_CLASS}, .${DIA_CLASS}, .${EPIC_HIGHLIGHT_CLASS}`).forEach(el => {
      el.classList.remove(...ALL_CLASSES);
    });
    document.querySelectorAll(`.${PROGRESS_CLASS}`).forEach(el => el.remove());
    if (hoverTipEl) hoverTipEl.style.display = 'none';
    stopWdLoop();
    clearHolidayStrips();
  };
  const updateActivation = () => {
    if (settings.enabled && isTimelinePage()) startActive();
    else stopActive();
  };

  // ─── Light / Dark 主題偵測 ─────────────────────────
  // Jira 把使用者選的主題寫到 <html data-color-mode="light|dark|auto">
  // （Atlassian Design System 機制，see developer.atlassian.com/.../design-tokens-and-theming/）
  // 我們把結果 mirror 到 body.jpt-theme-light / .jpt-theme-dark，讓 CSS override 用
  // 大多數 surface 已經改用 --ds-* tokens 自動切，這個 class 主要給半透明強調色 override 用
  const applyThemeClass = () => {
    const mode = document.documentElement.getAttribute('data-color-mode') || 'auto';
    const resolved = mode === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
    document.body.classList.toggle('jpt-theme-light', resolved === 'light');
    document.body.classList.toggle('jpt-theme-dark',  resolved !== 'light');
  };

  // ─── 初始化 ────────────────────────────────────────
  const init = async () => {
    await loadSettings();

    applyThemeClass();
    new MutationObserver(applyThemeClass).observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-color-mode'],
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyThemeClass);

    // 初始啟用判斷（延 1.5s 等 Jira SPA 渲染完）
    setTimeout(updateActivation, 1500);

    // SPA 路由偵測：每 500ms 檢查 URL 改變
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(updateActivation, 1500);
      }
    }, 500);
  };

  // ─── Debug ─────────────────────────────────────────
  window.__jptDebug = {
    typeCache, dataCache, pending,
    scan, rerenderAll, settings: () => ({ ...settings }),
    drawHolidayStrips, clearHolidayStrips, computePxPerDay, getTimelineMode,
    setDebug: (v) => { DEBUG = !!v; console.log('[jpt] DEBUG =', DEBUG); },
    cacheStats: () => ({
      types: typeCache.size,
      dataEntries: dataCache.size,
      dataFresh: [...dataCache.values()].filter(isDataFresh).length,
      pending: pending.size,
    }),
    clearCache: () => {
      typeCache.clear();
      dataCache.clear();
      sessionStorage.removeItem(TYPE_CACHE_KEY);
      sessionStorage.removeItem(DATA_CACHE_KEY);
      document.querySelectorAll(`.${PT_CLASS}, .${MS_CLASS}, .${DIA_CLASS}, .${EPIC_HIGHLIGHT_CLASS}`).forEach(el => {
        el.classList.remove(...ALL_CLASSES);
      });
      console.log('[jpt] both caches cleared');
    },
    // 舊版（2026-05 之前）用這個重新找「當月份高亮欄」的雜湊 class。
    // 2026-08 改版後這格已經有 testid 了（見 findCurrentPeriodColumn），
    // 這支留著備用 — 萬一哪天 testid 又被拿掉，還能回頭用這招掃。
    findCurrentMonthClass: () => {
      const result = [...document.querySelectorAll('div')]
        .filter(el => {
          const bg = getComputedStyle(el).backgroundColor;
          const r = el.getBoundingClientRect();
          return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
            && r.width > 100 && r.width < 400 && r.height > 200;
        })
        .map(el => ({ cls: el.className.toString(), bg: getComputedStyle(el).backgroundColor, w: el.getBoundingClientRect().width.toFixed(0) }));
      console.table(result);
      return result;
    },
    // 2026-08 改版後的等價工具：直接列出所有 column-overlay，標出哪個背景不透明
    findCurrentPeriodColumn: () => {
      const result = [...document.querySelectorAll(SEL_COLUMN_OVERLAY)].map(el => {
        const r = el.getBoundingClientRect();
        return { testid: el.getAttribute('data-testid'), bg: getComputedStyle(el).backgroundColor, w: Math.round(r.width) };
      });
      console.table(result);
      return result;
    },
    findTodayMarker,
    getTimelineTable,
    getTimelineRows: () => getTimelineRows().length,
  };

  init();
})();
