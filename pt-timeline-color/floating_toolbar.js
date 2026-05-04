// floating_toolbar.js — Jira Timeline 頁面注入「啟用 / 重新整理」浮動 bar
// 樣式對齊 jira-people-view 的浮動鈕（Jira ADS 風）。

(() => {
  const STORAGE_POS = 'jpt-toolbar-pos';

  const isTimelinePage = () =>
    location.pathname.includes('/boards') &&
    (location.pathname.includes('timeline') ||
     location.search.includes('timeline') ||
     location.hash.includes('timeline') ||
     document.querySelector('[data-testid="software-board.timeline"]') ||
     document.querySelector('[data-testid="roadmap.timeline-table.main.scrollable-overlay.today-marker.container"]'));

  const getEnabled = () => new Promise(r => {
    chrome.storage.sync.get({ enabled: true }, (d) => r(d.enabled !== false));
  });
  const setEnabled = (v) => chrome.storage.sync.set({ enabled: !!v });
  const triggerRefresh = () => chrome.storage.local.set({ cacheBuster: Date.now() });

  // ─── Edge-snap 定位模型（吸上邊或右邊，沿邊自由）───
  // 儲存：{ side: 'right'|'top', ratio: 0..1 }
  //   side='right' → 貼右邊，ratio = 垂直位置 (top / maxTop)
  //   side='top'   → 貼上邊，ratio = 水平位置 (left / maxLeft)
  const EDGE_MARGIN = 8;
  const DEFAULT_POS = { side: 'right', ratio: 0.85 };

  // Cache 住目前 pos，避免 resize handler 每次 await storage（曾導致 race 漏 update）
  let cachedPos = DEFAULT_POS;

  const isValidPos = (p) => p && typeof p.ratio === 'number' && (p.side === 'right' || p.side === 'top');

  const savePos = (pos) => {
    cachedPos = pos;
    chrome.storage.sync.set({ [STORAGE_POS]: pos });
  };

  const placeBar = (bar, pos) => {
    const rect = bar.getBoundingClientRect();
    const w = rect.width || 60;
    const h = rect.height || 40;
    bar.style.left = 'auto';
    bar.style.right = 'auto';
    bar.style.top = 'auto';
    bar.style.bottom = 'auto';
    if (pos.side === 'top') {
      const maxLeft = Math.max(0, window.innerWidth - w);
      bar.style.top = EDGE_MARGIN + 'px';
      bar.style.left = Math.max(0, Math.min(maxLeft, pos.ratio * maxLeft)) + 'px';
    } else {
      const maxTop = Math.max(0, window.innerHeight - h);
      bar.style.right = EDGE_MARGIN + 'px';
      bar.style.top = Math.max(0, Math.min(maxTop, pos.ratio * maxTop)) + 'px';
    }
  };

  const loadCachedPos = () => new Promise(resolve => {
    chrome.storage.sync.get([STORAGE_POS], (data) => {
      cachedPos = isValidPos(data[STORAGE_POS]) ? data[STORAGE_POS] : DEFAULT_POS;
      resolve();
    });
  });

  const applyPos = async (bar) => {
    await loadCachedPos();
    placeBar(bar, cachedPos);
  };

  // resize handler：純同步，從 cache 讀，避免 await storage 的 race 漏 update
  const watchResize = (bar) => {
    let raf = 0;
    const handler = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (bar.classList.contains('dragging')) return;
        placeBar(bar, cachedPos);
      });
    };
    window.addEventListener('resize', handler);
    // 同時監聽 visualViewport（pinch zoom / DevTools 開合都會觸發）
    if (window.visualViewport) window.visualViewport.addEventListener('resize', handler);
  };

  // 從別處（popup / 別分頁）改 storage 時同步 cache
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[STORAGE_POS]) {
      const v = changes[STORAGE_POS].newValue;
      cachedPos = isValidPos(v) ? v : DEFAULT_POS;
    }
  });

  // 拖曳結束時：判斷貼哪一邊（上 / 右）
  const computeSnap = (rect) => {
    const w = rect.width || 60;
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

  const reflectEnabled = (bar, enabled) => {
    bar.classList.toggle('jpt-tb-on', enabled);
    bar.classList.toggle('jpt-tb-off', !enabled);
    const label = bar.querySelector('.jpt-tb-label');
    if (label) label.textContent = enabled ? '啟用中' : '已停用';
  };

  const flashStatus = (bar, msg, kind = 'ok') => {
    const tip = document.createElement('div');
    tip.className = `jpt-tb-flash jpt-tb-flash-${kind}`;
    tip.textContent = msg;
    bar.appendChild(tip);
    setTimeout(() => tip.classList.add('show'), 10);
    setTimeout(() => { tip.classList.remove('show'); setTimeout(() => tip.remove(), 200); }, 1500);
  };

  const makeInteractive = (bar) => {
    // 拖曳剛結束的旗標 — 抑制 mouseup 後的 click 事件，避免誤觸 toggle/refresh
    let dragJustEnded = false;

    // ─── 拖曳邏輯（僅限拖曳手把）— 拖曳時自由移動，放開時吸最近的邊（上 / 右）───
    const handle = bar.querySelector('.jpt-tb-handle');
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const startX = e.clientX, startY = e.clientY;
      const rect = bar.getBoundingClientRect();
      const initLeft = rect.left;
      const initTop = rect.top;
      let moved = false;

      const onMove = (em) => {
        const dx = em.clientX - startX, dy = em.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        bar.classList.add('dragging');
        bar.style.right = 'auto';
        bar.style.bottom = 'auto';
        bar.style.left = (initLeft + dx) + 'px';
        bar.style.top = (initTop + dy) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        bar.classList.remove('dragging');
        if (moved) {
          dragJustEnded = true;
          setTimeout(() => { dragJustEnded = false; }, 0);
          const pos = computeSnap(bar.getBoundingClientRect());
          bar.style.transition = 'top 0.2s ease, left 0.2s ease, right 0.2s ease, bottom 0.2s ease';
          placeBar(bar, pos);
          setTimeout(() => { bar.style.transition = ''; }, 220);
          savePos(pos);
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
      e.stopPropagation();
    });

    // ─── 點擊邏輯 ───
    bar.addEventListener('click', async (e) => {
      if (dragJustEnded) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const seg = e.target.closest('[data-jpt-action]');
      if (!seg) return;
      const action = seg.dataset.jptAction;
      if (action === 'toggle') {
        const next = !bar.classList.contains('jpt-tb-on');
        await setEnabled(next);
        reflectEnabled(bar, next);
      } else if (action === 'refresh') {
        if (!bar.classList.contains('jpt-tb-on')) {
          flashStatus(bar, '插件已停用，請先啟用', 'warn');
          return;
        }
        await triggerRefresh();
        flashStatus(bar, '已重新整理', 'ok');
      }
    });
  };

  const inject = async () => {
    if (document.getElementById('jpt-toolbar')) return;
    const bar = document.createElement('div');
    bar.id = 'jpt-toolbar';
    bar.title = '拖曳可移動位置';
    bar.innerHTML = `
      <div class="jpt-tb-handle" title="拖曳移動位置">⠿</div>
      <div class="jpt-tb-divider"></div>
      <div class="jpt-tb-seg" data-jpt-action="toggle" title="切換 PT/Milestone 染色與假日標示">
        <span class="jpt-tb-dot"></span>
        <span class="jpt-tb-label">啟用中</span>
      </div>
      <div class="jpt-tb-divider"></div>
      <div class="jpt-tb-seg jpt-tb-icon" data-jpt-action="refresh" title="改 Epic 日期後若沒立即更新，按此重新掃描">
        <span class="jpt-tb-refresh-ico">↻</span>
      </div>
    `;
    document.body.appendChild(bar);
    reflectEnabled(bar, await getEnabled());
    await applyPos(bar);
    makeInteractive(bar);
    watchResize(bar);

    // 同步：popup 也能改 enabled，這邊要跟上
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.enabled) {
        reflectEnabled(bar, changes.enabled.newValue !== false);
      }
    });
  };

  const remove = () => {
    const el = document.getElementById('jpt-toolbar');
    if (el) el.remove();
  };

  const sync = () => {
    if (isTimelinePage()) inject();
    else remove();
  };

  setTimeout(sync, 1500);
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(sync, 1500);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
