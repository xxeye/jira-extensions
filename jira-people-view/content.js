// content.js — 在 Jira Timeline 頁面注入「人力視圖」按鈕

(() => {
  const STORAGE_KEY = 'jpv-types';
  const STORAGE_CAP = 'jpv-cap';
  const STORAGE_BTN_POS = 'jpv-button-pos';
  const STORAGE_SHOW_PT_LOAD = 'jpv-show-pt-load';
  const DEFAULT_TYPES = [];           // 預設 A 視角全不勾，使用者按需開啟
  const DEFAULT_CAP = 5;
  const DEFAULT_SHOW_PT_LOAD = true;  // 預設只開「PT 並行對比 bar」

  const isTimelinePage = () =>
    location.pathname.includes('/boards') &&
    (location.pathname.includes('timeline') ||
     location.search.includes('timeline') ||
     location.hash.includes('timeline') ||
     document.querySelector('[data-testid="software-board.timeline"]') ||
     document.querySelector('[data-testid="roadmap.timeline-table.main.scrollable-overlay.today-marker.container"]'));

  const getSettings = () => new Promise(resolve => {
    chrome.storage.sync.get([STORAGE_KEY, STORAGE_CAP, STORAGE_BTN_POS, STORAGE_SHOW_PT_LOAD], (data) => {
      resolve({
        types: Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : DEFAULT_TYPES,
        cap: Number.isFinite(data[STORAGE_CAP]) ? data[STORAGE_CAP] : DEFAULT_CAP,
        btnPos: data[STORAGE_BTN_POS] || null,
        showPtLoad: typeof data[STORAGE_SHOW_PT_LOAD] === 'boolean' ? data[STORAGE_SHOW_PT_LOAD] : DEFAULT_SHOW_PT_LOAD,
      });
    });
  });

  // 推算「應該抓哪些 team roster」— 從勾選類型對映出 cf[10773] role
  const rolesFromTypes = (types) => {
    const TYPE_TO_ROLE = {
      'Plan Story': 'plan', 'Art Story': 'art', 'Anim Task': 'anim',
      'Engine Task': 'engine', 'Backend Task': 'backend', 'Math Task': 'math',
      'Data Task': 'data', 'QA Task': 'qa', 'Dev Task': 'dev', 'MKT Story': 'marketing',
    };
    const out = new Set();
    for (const t of types) {
      if (TYPE_TO_ROLE[t]) out.add(TYPE_TO_ROLE[t]);
    }
    return [...out];
  };

  const launchView = async () => {
    JpvRender.showLoading();
    try {
      const { types, cap, showPtLoad } = await getSettings();
      if (!types.length) {
        JpvRender.showError('未選擇任何任務類型，請先到插件設定勾選');
        return;
      }
      JpvRender.setHeatCap(cap);
      // team roster 用 cache（cache miss 才打 API），手動重抓走 popup 設定
      const [issues, teamRoster] = await Promise.all([
        JpvData.fetchAll(types, { showPtLoad }),
        JpvTeams.getCombinedRosterForRoles(rolesFromTypes(types)),
      ]);
      JpvRender.open(issues, { showPtLoad, teamRoster });
    } catch (err) {
      console.error('[jira-people-view]', err);
      JpvRender.showError(err.message || String(err));
    }
  };
  // ↻ 按鈕 = 重抓任務（team roster 走 popup 重抓）
  JpvRender.setRefreshHandler(launchView);

  // popup → content script 訊息：popup 因 chrome-extension:// 跨 origin POST 會被
  // Atlassian gateway 擋（403），改由 content script 在 atlassian.net page 內代為呼叫
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'jpv:refreshTeams') {
      JpvTeams.refreshAllRosters()
        .then(result => sendResponse(result))
        .catch(e => sendResponse({ error: e.message || String(e) }));
      return true;   // async response
    }
    if (msg && msg.action === 'jpv:listTeams') {
      JpvTeams.listTeams()
        .then(teams => sendResponse({ teams }))
        .catch(e => sendResponse({ error: e.message || String(e) }));
      return true;
    }
    return false;
  });

  // ─── Edge-snap 定位模型（吸上邊或右邊，沿邊自由）───
  const EDGE_MARGIN = 8;
  const DEFAULT_POS = { side: 'right', ratio: 0.78 };

  // Cache 住目前 pos，避免 resize handler 每次 await storage（曾導致 race 漏 update）
  let cachedPos = DEFAULT_POS;

  const isValidPos = (p) => p && typeof p.ratio === 'number' && (p.side === 'right' || p.side === 'top');

  const savePos = (pos) => {
    cachedPos = pos;
    chrome.storage.sync.set({ [STORAGE_BTN_POS]: pos });
  };

  const placeBtn = (btn, pos) => {
    const rect = btn.getBoundingClientRect();
    const w = rect.width || 40;
    const h = rect.height || 40;
    btn.style.left = 'auto';
    btn.style.right = 'auto';
    btn.style.top = 'auto';
    btn.style.bottom = 'auto';
    if (pos.side === 'top') {
      const maxLeft = Math.max(0, window.innerWidth - w);
      btn.style.top = EDGE_MARGIN + 'px';
      btn.style.left = Math.max(0, Math.min(maxLeft, pos.ratio * maxLeft)) + 'px';
    } else {
      const maxTop = Math.max(0, window.innerHeight - h);
      btn.style.right = EDGE_MARGIN + 'px';
      btn.style.top = Math.max(0, Math.min(maxTop, pos.ratio * maxTop)) + 'px';
    }
  };

  const loadCachedPos = () => new Promise(resolve => {
    chrome.storage.sync.get([STORAGE_BTN_POS], (data) => {
      cachedPos = isValidPos(data[STORAGE_BTN_POS]) ? data[STORAGE_BTN_POS] : DEFAULT_POS;
      resolve();
    });
  });

  const applyPos = async (btn) => {
    await loadCachedPos();
    placeBtn(btn, cachedPos);
  };

  const watchResize = (btn) => {
    let raf = 0;
    const handler = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (btn.classList.contains('dragging')) return;
        placeBtn(btn, cachedPos);
      });
    };
    window.addEventListener('resize', handler);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', handler);
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[STORAGE_BTN_POS]) {
      const v = changes[STORAGE_BTN_POS].newValue;
      cachedPos = isValidPos(v) ? v : DEFAULT_POS;
    }
  });

  const computeSnap = (rect) => {
    const w = rect.width || 40;
    const h = rect.height || 40;
    const distTop = Math.max(0, rect.top);
    const distRight = Math.max(0, window.innerWidth - rect.right);
    if (distTop < distRight) {
      const maxLeft = Math.max(1, window.innerWidth - w);
      return { side: 'top', ratio: Math.max(0, Math.min(maxLeft, rect.left)) / maxLeft };
    }
    const maxTop = Math.max(1, window.innerHeight - h);
    return { side: 'right', ratio: Math.max(0, Math.min(maxTop, rect.top)) / maxTop };
  };

  const makeInteractive = (btn) => {
    // 拖曳剛結束的旗標 — 抑制 mouseup 後的 click，避免誤觸開啟視窗
    let dragJustEnded = false;

    // ─── 拖曳邏輯（僅限拖曳手把）— 拖曳時自由移動，放開時吸最近的邊（上 / 右）───
    const handle = btn.querySelector('.jpv-launch-handle');
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = btn.getBoundingClientRect();
      const initLeft = rect.left;
      const initTop = rect.top;
      let moved = false;

      const onMove = (em) => {
        const dx = em.clientX - startX;
        const dy = em.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        btn.classList.add('dragging');
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
        btn.style.left = (initLeft + dx) + 'px';
        btn.style.top = (initTop + dy) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        btn.classList.remove('dragging');
        if (moved) {
          dragJustEnded = true;
          setTimeout(() => { dragJustEnded = false; }, 0);
          const pos = computeSnap(btn.getBoundingClientRect());
          btn.style.transition = 'top 0.2s ease, left 0.2s ease, right 0.2s ease, bottom 0.2s ease';
          placeBtn(btn, pos);
          setTimeout(() => { btn.style.transition = ''; }, 220);
          savePos(pos);
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
      e.stopPropagation();
    });

    // ─── 點擊邏輯（手把以外的區域才觸發）───
    btn.addEventListener('click', (e) => {
      if (dragJustEnded) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.target.closest('.jpv-launch-handle')) return;
      launchView();
    });
  };

  const injectButton = () => {
    if (document.getElementById('jpv-launch')) return;
    const btn = document.createElement('div');
    btn.id = 'jpv-launch';
    btn.title = '開啟人力視圖';
    btn.innerHTML = `
      <span class="jpv-launch-handle" title="拖曳移動位置">⠿</span>
      <span class="jpv-launch-icon">▦</span>人力視圖
    `;
    document.body.appendChild(btn);
    applyPos(btn);
    makeInteractive(btn);
    watchResize(btn);
  };

  const removeButton = () => {
    const el = document.getElementById('jpv-launch');
    if (el) el.remove();
  };

  const sync = () => {
    if (isTimelinePage()) injectButton();
    else removeButton();
  };

  const init = () => {
    setTimeout(sync, 1500);
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(sync, 1500);
      }
    }).observe(document.body, { childList: true, subtree: true });
  };

  init();
})();
