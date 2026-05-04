// render.js — 浮動視窗 + 月視圖 timeline 渲染

const JpvRender = (() => {
  const PX_PER_DAY = 28;            // 月視圖 ~28 px/day（接近 Jira 月視圖密度）
  const MIN_DAYS_BEFORE = 90;       // 今天往前最少 ~3 個月（資料更早會自動延伸）
  const MIN_DAYS_AFTER = 270;       // 今天往後最少 ~9 個月（資料更晚會自動延伸）
  const RANGE_BUFFER = 14;          // 資料延伸時兩端各加 14 天緩衝
  const ROW_H = 36;
  const cellIssuesMap = new WeakMap();   // cell DOM → 該段任務清單 + 日期範圍
  let tooltipEl = null;
  let tipHideTimer = null;

  let modalEl = null;

  // ─── 工具 ───────────────────────────────────
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const dayDiff = (a, b) => Math.round((b - a) / 86400000);
  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

  // 任務 bar 顏色 class
  const typeClass = (typeName) => {
    const n = (typeName || '').toLowerCase();
    if (n.includes('planning')) return 'jpv-pt';
    if (n.includes('plan')) return 'jpv-plan';
    if (n.includes('engine')) return 'jpv-eng';
    if (n.includes('backend') || n.includes('dev')) return 'jpv-eng';
    if (n.includes('art')) return 'jpv-art';
    if (n.includes('anim')) return 'jpv-anim';
    if (n.includes('math')) return 'jpv-math';
    if (n.includes('data')) return 'jpv-data';
    if (n.includes('qa')) return 'jpv-qa';
    return 'jpv-eng';
  };

  // 連續色階：count / cap 線性內插 HSL 紅色（pale pink → deep red）
  let HEAT_CAP = 5;
  const setHeatCap = (cap) => { HEAT_CAP = Math.max(1, cap || 5); };
  const cellColor = (count, capOverride) => {
    if (!count) return 'transparent';
    const cap = Math.max(1, capOverride || HEAT_CAP);
    const ratio = Math.min(1, count / cap);
    // hsl(0, sat%, lightness%) — 1 任務淡粉 → cap 任務深紅
    const lightness = 95 - ratio * 50;   // 95 → 45
    const saturation = 100 - ratio * 25; // 100 → 75
    return `hsl(0, ${saturation}%, ${lightness}%)`;
  };
  // PT 負載專用色階：綠 → 黃 → 紅（hue 120→60→0）
  // 跟 cellColor 比色階分布更廣，方便辨識 PT 負載的相對輕重
  const cellColorGYR = (count, capOverride) => {
    if (!count) return 'transparent';
    const cap = Math.max(1, capOverride || HEAT_CAP);
    const ratio = Math.min(1, count / cap);
    const hue = 120 - ratio * 120;       // 120(綠) → 0(紅)
    const saturation = 65 + ratio * 20;  // 65 → 85
    const lightness = 65 - ratio * 15;   // 65 → 50
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };

  // ─── 建立 Modal 骨架 ─────────────────────────
  const buildShell = (people, rangeStart, rangeEnd) => {
    const total = dayDiff(rangeStart, rangeEnd) + 1;
    const innerWidth = total * PX_PER_DAY;

    const m = document.createElement('div');
    m.id = 'jpv-modal';
    m.innerHTML = `
      <div class="jpv-overlay"></div>
      <div class="jpv-window">
        <div class="jpv-header">
          <span class="jpv-title">人力視圖</span>
          <span class="jpv-meta">${people.length} 人 · ${rangeStart.toISOString().slice(0,10)} ~ ${rangeEnd.toISOString().slice(0,10)}</span>
          <span class="jpv-spacer"></span>
          <button class="jpv-refresh" title="重新抓任務（從 Jira 取最新資料）">↻</button>
          <button class="jpv-close" title="關閉">✕</button>
        </div>
        <div class="jpv-body">
          <div class="jpv-left">
            <div class="jpv-left-header">人員</div>
            <div class="jpv-left-rows"></div>
          </div>
          <div class="jpv-resize" title="拖曳調整欄寬"></div>
          <div class="jpv-right">
            <div class="jpv-right-inner" style="width:${innerWidth}px"></div>
          </div>
        </div>
      </div>`;
    return m;
  };

  // 重新整理 callback — 由 content.js 透過 setRefreshHandler 設定
  let refreshHandler = null;
  const setRefreshHandler = (fn) => { refreshHandler = fn; };

  // ─── 月份 header ───────────────────────────
  const buildMonthHeader = (rangeStart, rangeEnd) => {
    const header = document.createElement('div');
    header.className = 'jpv-month-header';
    let cur = startOfMonth(rangeStart);
    while (cur <= rangeEnd) {
      const monthEnd = endOfMonth(cur);
      const segStart = cur < rangeStart ? rangeStart : cur;
      const segEnd = monthEnd > rangeEnd ? rangeEnd : monthEnd;
      const days = dayDiff(segStart, segEnd) + 1;
      const cell = document.createElement('div');
      cell.className = 'jpv-month-cell';
      cell.style.width = (days * PX_PER_DAY) + 'px';
      cell.textContent = `${cur.getFullYear()}/${String(cur.getMonth() + 1).padStart(2, '0')}`;
      header.appendChild(cell);
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    return header;
  };

  // ─── 今天藍線 ──────────────────────────────
  const buildTodayLine = (rangeStart, totalDays) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const offset = dayDiff(rangeStart, today);
    if (offset < 0 || offset > totalDays) return null;
    const line = document.createElement('div');
    line.className = 'jpv-today-line';
    line.style.left = (offset * PX_PER_DAY) + 'px';
    return line;
  };

  // ─── Heatmap track ─────────────────────────
  // 若任務集合（不只 count）改變，亦切段，讓 tooltip 顯示精確任務名單
  // colorFn(count, cap) — 自訂顏色函式，預設 cellColor（紅階）；PT 負載傳 cellColorGYR
  const buildHeatmapTrack = (issues, rangeStart, rangeEnd, totalDays, capOverride, colorFn = cellColor) => {
    const track = document.createElement('div');
    track.className = 'jpv-track jpv-track-person';
    const heat = document.createElement('div');
    heat.className = 'jpv-heatmap';
    heat.style.width = (totalDays * PX_PER_DAY) + 'px';

    const dailyMap = JpvData.dailyIssues(issues);
    let runSig = null;          // 任務 keys 排序後 join，當段識別碼
    let runIssues = [];
    let runDays = 0;
    let runStart = null;
    const flush = (endDate) => {
      if (runDays === 0) return;
      const cell = document.createElement('div');
      cell.className = 'jpv-heatmap-cell';
      cell.style.background = colorFn(runIssues.length, capOverride);
      cell.style.width = (runDays * PX_PER_DAY) + 'px';
      if (runIssues.length > 0) {
        const startStr = JpvData.isoDate(runStart);
        const endStr = JpvData.isoDate(endDate);
        const dateRange = startStr === endStr ? startStr : `${startStr} ~ ${endStr}`;
        cellIssuesMap.set(cell, { issues: runIssues, dateRange });
      }
      heat.appendChild(cell);
      runDays = 0;
    };
    let cur = new Date(rangeStart);
    let prev = new Date(rangeStart);
    while (cur <= rangeEnd) {
      const key = JpvData.isoDate(cur);
      const list = (dailyMap.get(key) || []).slice().sort((a, b) => a.key.localeCompare(b.key));
      const sig = list.map(i => i.key).join('|');
      if (sig !== runSig) {
        flush(prev);
        runSig = sig;
        runIssues = list;
        runStart = new Date(cur);
      }
      runDays++;
      prev = new Date(cur);
      cur.setDate(cur.getDate() + 1);
    }
    flush(prev);
    track.appendChild(heat);
    return track;
  };

  // ─── 任務 bar track ────────────────────────
  const buildTaskTrack = (iss, rangeStart) => {
    const track = document.createElement('div');
    track.className = 'jpv-track jpv-track-task';
    if (!iss.start || !iss.due) return track;
    const start = new Date(iss.start + 'T00:00:00');
    const end = new Date(iss.due + 'T00:00:00');
    if (isNaN(start) || isNaN(end) || end < start) return track;
    const left = dayDiff(rangeStart, start) * PX_PER_DAY;
    const width = (dayDiff(start, end) + 1) * PX_PER_DAY;
    const bar = document.createElement('div');
    bar.className = `jpv-task-bar ${typeClass(iss.typeName)}`;
    bar.style.left = left + 'px';
    bar.style.width = width + 'px';
    bar.title = `${iss.key} ${iss.summary}\n${iss.start} ~ ${iss.due}\n${iss.typeName} · ${iss.statusName}`
      + (iss.assigneeName ? `\n受託人：${iss.assigneeName}` : '')
      + (iss.parentKey ? `\nEpic: ${iss.parentKey} ${iss.parentSummary}` : '');
    bar.textContent = iss.summary;
    bar.addEventListener('click', () => {
      window.open(`${location.origin}/browse/${iss.key}`, '_blank');
    });
    track.appendChild(bar);
    return track;
  };

  // 計算時間軸範圍：以今天 ±MIN_DAYS_* 為下限，資料超出時自動延伸
  const computeRange = (issues) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let rangeStart = addDays(today, -MIN_DAYS_BEFORE);
    let rangeEnd = addDays(today, MIN_DAYS_AFTER);
    for (const iss of issues) {
      if (iss.start) {
        const s = new Date(iss.start + 'T00:00:00');
        if (!isNaN(s) && s < rangeStart) rangeStart = addDays(s, -RANGE_BUFFER);
      }
      if (iss.due) {
        const d = new Date(iss.due + 'T00:00:00');
        if (!isNaN(d) && d > rangeEnd) rangeEnd = addDays(d, RANGE_BUFFER);
      }
    }
    return { today, rangeStart, rangeEnd };
  };

  // ─── 開啟 Modal ────────────────────────────
  // opts.showPtLoad — 主視圖模式下，是否顯示 PT 負載對比 bar（與 PT 對應職種 section）
  // opts.teamRoster — Map<accountId, {name, avatar}> 從 Atlassian Teams 抓來的完整部門名單
  const open = (issues, opts = {}) => {
    close();
    const showPtLoad = opts.showPtLoad === true;
    const teamRoster = opts.teamRoster instanceof Map ? opts.teamRoster : new Map();
    // 拆 PT vs non-PT — header 顯示「主視圖人員數」（只算非 PT 任務的 assignee）
    const { pts, others } = JpvData.splitByPt(issues);
    const isPtOnly = others.length === 0 && pts.length > 0;
    let peopleNonPt = JpvData.groupByPerson(others);
    // 把 team roster 內「沒在 issues 出現過」的人補進 peopleNonPt（只佔位，issues 為空）
    // PT-only 模式不補完：那邊不渲染人員列，補進來只會讓 header「N 人」變誤導值
    if (teamRoster.size > 0 && !isPtOnly) {
      const existingIds = new Set(peopleNonPt.map(p => p.accountId));
      for (const [aid, info] of teamRoster) {
        if (!existingIds.has(aid)) {
          peopleNonPt.push({
            accountId: aid,
            name: info.name || aid,
            avatar: info.avatar || '',
            issues: [],
            dailyMap: new Map(),
            maxDaily: 0,
          });
        }
      }
      // 補完後重排：仍依 maxDaily 降冪，新加入的 maxDaily=0 會排最後
      peopleNonPt.sort((a, b) => {
        if (a.maxDaily !== b.maxDaily) return b.maxDaily - a.maxDaily;
        return (a.name || '').localeCompare(b.name || '');
      });
    }
    const { today, rangeStart, rangeEnd } = computeRange(issues);
    const totalDays = dayDiff(rangeStart, rangeEnd) + 1;

    modalEl = buildShell(peopleNonPt, rangeStart, rangeEnd);
    document.body.appendChild(modalEl);

    const leftRows = modalEl.querySelector('.jpv-left-rows');
    const rightInner = modalEl.querySelector('.jpv-right-inner');

    rightInner.appendChild(buildMonthHeader(rangeStart, rangeEnd));
    const todayLine = buildTodayLine(rangeStart, totalDays);
    if (todayLine) rightInner.appendChild(todayLine);

    // 注意：傳完整 issues 進去 groupByRoleAssignee（不是只給 pts），
    // 它內部會依非 PT 任務的類型推算 allowedRoles 來過濾 role group
    const roleGroups = JpvData.groupByRoleAssignee(issues);

    if (peopleNonPt.length === 0 && roleGroups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'jpv-empty';
      empty.textContent = '沒有符合條件的任務';
      modalEl.querySelector('.jpv-body').appendChild(empty);
    } else {
      // 模式判斷（isPtOnly 已在 open() 起頭算好）：
      // - PT-only：沒有非 PT 任務 + 有 PT → 只顯示 PT 區塊
      // - 主視圖（不顯示 PT）：有非 PT 任務 + 無 PT → 只顯示繁忙人數 + 主視圖
      // - 主視圖 + 顯示 PT 負載：兩者都有 → 上方 PT 並行 + 繁忙人數 + 主視圖
      if (isPtOnly) {
        // PT-only 模式
        renderPtSummary(pts, leftRows, rightInner, rangeStart, rangeEnd, totalDays);
        renderSectionHeader('pt', 'Planning Task — 以職種為主軸',
          `${roleGroups.length} 職種 · ${pts.length} 任務`,
          leftRows, rightInner);
        roleGroups.forEach((g, idx) => renderRoleGroup(g, leftRows, rightInner, rangeStart, rangeEnd, totalDays, idx));
      } else if (peopleNonPt.length > 0) {
        // 主視圖模式
        if (showPtLoad && pts.length > 0) {
          renderPtSummary(pts, leftRows, rightInner, rangeStart, rangeEnd, totalDays);
        }
        // 職種人力負載 + 個人 row
        renderSummary(others, peopleNonPt, leftRows, rightInner, rangeStart, rangeEnd, totalDays);
        peopleNonPt.forEach((p, idx) => renderPerson(p, leftRows, rightInner, rangeStart, rangeEnd, totalDays, idx));
      }
    }

    // 互動：關閉
    modalEl.querySelector('.jpv-close').addEventListener('click', close);
    modalEl.querySelector('.jpv-overlay').addEventListener('click', close);
    // 重整：呼叫 content.js 設定的 handler
    const refreshBtn = modalEl.querySelector('.jpv-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => {
      if (typeof refreshHandler === 'function') refreshHandler();
    });
    document.addEventListener('keydown', onKeyDown, true);

    // 初始捲動：把今天藍線置中
    requestAnimationFrame(() => {
      const right = modalEl.querySelector('.jpv-right');
      const todayOffset = dayDiff(rangeStart, today) * PX_PER_DAY;
      right.scrollLeft = Math.max(0, todayOffset - right.clientWidth / 3);
    });

    // 同步左右捲動（垂直）
    const leftScroll = modalEl.querySelector('.jpv-left-rows');
    const rightScroll = modalEl.querySelector('.jpv-right');
    rightScroll.addEventListener('scroll', () => { leftScroll.scrollTop = rightScroll.scrollTop; });
    leftScroll.addEventListener('scroll', () => { rightScroll.scrollTop = leftScroll.scrollTop; });

    // 拖拉調整左欄寬度
    setupResize(modalEl);

    // 自繪 tooltip（heatmap cell hover 時顯示完整任務清單，可捲動）
    setupTooltip(modalEl);
  };

  // ─── 自繪可捲動 Tooltip ──────────────────
  const setupTooltip = (root) => {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'jpv-tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);

    const showAt = (cell, evt) => {
      const data = cellIssuesMap.get(cell);
      if (!data) return;
      // 兩種 cell type：「任務清單」(issues) 或「人數分布」(breakdown)
      if (data.breakdown) {
        const b = data.breakdown;
        const lightAndIdleList = b.lightAndIdlePpl || [];
        const renderGroup = (cls, label, count, ppl, showCountInChip = true) => {
          if (count === 0) return '';
          const names = (ppl || []).map(p => {
            const numHtml = showCountInChip ? `<span class="jpv-tip-bd-num">${p.count}</span>` : '';
            return `<span class="jpv-tip-bd-person">${escapeHtml(p.name)} ${numHtml}</span>`;
          }).join('');
          return `<div class="jpv-tip-bd-row ${cls}">
            <div class="jpv-tip-bd-line"><span class="jpv-tip-bd-label">${label}</span><span class="jpv-tip-bd-count">${count} 人</span></div>
            <div class="jpv-tip-bd-people">${names}</div>
          </div>`;
        };
        tooltipEl.innerHTML = `
          <div class="jpv-tip-header">${data.deptSize} 人部門 <span class="jpv-tip-range">${escapeHtml(data.dateRange)}</span></div>
          <div class="jpv-tip-body jpv-tip-breakdown">
            ${renderGroup('over', '超載', b.over, b.overPpl)}
            ${renderGroup('full', '全載', b.full, b.fullPpl)}
            ${renderGroup('half', '半載', b.half, b.halfPpl)}
            ${renderGroup('idle', '輕載 / 空閒', lightAndIdleList.length, lightAndIdleList)}
          </div>`;
        tooltipEl.style.display = 'block';
        positionTooltip(evt);
        return;
      }
      // 判斷是不是 PT 並行 row 的 cell — 是的話加上提示
      const isPtSummary = cell.closest('.jpv-summary-pt') !== null;
      const isHighLoad = data.issues.length >= HEAT_CAP;
      const undoneCount = data.issues.filter(i => i.isPlanningTask && !i.hasRelates).length;
      const warningParts = [];
      if (isPtSummary && isHighLoad) {
        warningParts.push(`⚠️ 此段 Planning Task 並行密集`);
      }
      if (isPtSummary && undoneCount > 0) {
        warningParts.push(`📐 ${undoneCount} 個 Planning Task 尚未開立對應職種任務`);
      }
      const warningHtml = warningParts.length
        ? `<div class="jpv-tip-warning">${warningParts.map(escapeHtml).join('<br>')}</div>`
        : '';
      tooltipEl.innerHTML = `
        <div class="jpv-tip-header">${data.issues.length} 個任務 <span class="jpv-tip-range">${escapeHtml(data.dateRange)}</span></div>
        ${warningHtml}
        <div class="jpv-tip-body">
          ${data.issues.map(i => {
            const epic = i.parentSummary || i.parentKey || '—';
            const undoneMark = (i.isPlanningTask && !i.hasRelates) ? '<span class="jpv-tip-undone" title="尚未開立對應職種任務（同 Epic 內找不到對應的職種執行任務）">📐</span>' : '';
            return `<div class="jpv-tip-item ${(i.isPlanningTask && !i.hasRelates) ? 'is-undone' : ''}" title="${escapeHtml(i.key)}">
              ${undoneMark}
              <span class="jpv-tip-epic">${escapeHtml(epic)}</span>
              <span class="jpv-tip-sep">｜</span>
              <span class="jpv-tip-summary">${escapeHtml(i.summary)}</span>
            </div>`;
          }).join('')}
        </div>`;
      tooltipEl.style.display = 'block';
      positionTooltip(evt);
    };

    const positionTooltip = (e) => {
      const w = tooltipEl.offsetWidth;
      const h = tooltipEl.offsetHeight;
      const pad = 14;
      let x = e.clientX + pad;
      let y = e.clientY + pad;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
      if (y + h > window.innerHeight - 8) y = window.innerHeight - h - 8;
      if (y < 8) y = 8;
      tooltipEl.style.left = x + 'px';
      tooltipEl.style.top = y + 'px';
    };

    const scheduleHide = () => {
      clearTimeout(tipHideTimer);
      tipHideTimer = setTimeout(() => { if (tooltipEl) tooltipEl.style.display = 'none'; }, 120);
    };
    const cancelHide = () => clearTimeout(tipHideTimer);

    let lastCell = null;
    root.addEventListener('mouseover', (e) => {
      const cell = e.target.closest('.jpv-heatmap-cell');
      if (cell && cellIssuesMap.has(cell)) {
        cancelHide();
        // 只在進入「新 cell」時才重新定位，避免追逐滑鼠導致使用者滑不到 tooltip
        if (cell !== lastCell) {
          lastCell = cell;
          showAt(cell, e);
        }
      }
    });
    root.addEventListener('mouseout', (e) => {
      const cell = e.target.closest('.jpv-heatmap-cell');
      if (cell) {
        // 從 cell 離開（可能往 tooltip / 別 cell / 空白處）
        const to = e.relatedTarget;
        if (to && tooltipEl.contains(to)) return; // 進入 tooltip — tooltip 自己 enter handler 會接手
        scheduleHide();
        if (!to || !to.closest('.jpv-heatmap-cell')) lastCell = null;
      }
    });
    tooltipEl.addEventListener('mouseenter', cancelHide);
    tooltipEl.addEventListener('mouseleave', () => {
      tooltipEl.style.display = 'none';
    });
  };

  // ─── 左欄寬度拖拉 ────────────────────────
  const setupResize = (root) => {
    const handle = root.querySelector('.jpv-resize');
    const left = root.querySelector('.jpv-left');
    if (!handle || !left) return;
    let startX = 0;
    let startWidth = 0;
    const onMove = (e) => {
      const dx = e.clientX - startX;
      const w = Math.max(160, Math.min(600, startWidth + dx));
      left.style.flex = `0 0 ${w}px`;
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = left.getBoundingClientRect().width;
      handle.classList.add('dragging');
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  };

  // ─── Section Header（可收合）──────────────
  // 用 modalEl 上的 class 配 CSS rule 隱藏整個 section 的子元素，
  // 不直接動每列的 display，這樣內層 role row / task row 各自的折疊狀態能完整保留。
  const renderSectionHeader = (sectionKey, title, meta, leftRows, rightInner) => {
    const collapseClass = `jpv-section-${sectionKey}-collapsed`;
    const lh = document.createElement('div');
    lh.className = 'jpv-section-header collapsed';
    lh.dataset.sectionHeader = sectionKey;
    lh.innerHTML = `
      <span class="jpv-arrow">▶</span>
      <span class="jpv-section-title">${escapeHtml(title)}</span>
      <span class="jpv-section-meta">${escapeHtml(meta)}</span>
    `;
    leftRows.appendChild(lh);
    const rh = document.createElement('div');
    rh.className = 'jpv-section-header-track collapsed';
    rh.dataset.sectionHeader = sectionKey;
    rightInner.appendChild(rh);
    // 預設收合：給 modal 加上 collapse class，CSS 會隱藏對應 data-section 的所有後代
    modalEl.classList.add(collapseClass);
    lh.addEventListener('click', () => {
      const collapsing = !lh.classList.contains('collapsed');
      lh.classList.toggle('collapsed', collapsing);
      rh.classList.toggle('collapsed', collapsing);
      modalEl.classList.toggle(collapseClass, collapsing);
    });
  };

  // ─── PT 負載 row（頂部三條對比之一）──────────────
  // 統計所有 PT（去重，每筆 PT 只算一次）
  // 色階：綠→黃→紅，cap = 整體 peakDaily（動態），確保色階完整跑完
  const renderPtSummary = (pts, leftRows, rightInner, rangeStart, rangeEnd, totalDays) => {
    const totalDaily = JpvData.dailyIssues(pts);
    let peakDaily = 0;
    for (const list of totalDaily.values()) {
      if (list.length > peakDaily) peakDaily = list.length;
    }
    // 動態 cap：用整體 peak，最少 5（避免 peak=1 整片接近 hue 0 時失去意義）
    const ptCap = Math.max(5, peakDaily);

    const leftRow = document.createElement('div');
    leftRow.className = 'jpv-person-row jpv-summary-row jpv-summary-pt';
    leftRow.innerHTML = `
      <span class="jpv-arrow" style="visibility:hidden">▶</span>
      <span class="jpv-summary-icon">🔥</span>
      <span class="jpv-name">Planning Task 並行</span>
      <span class="jpv-summary-meta">最多同時 ${peakDaily} 個　·　共 ${pts.length} 個 Planning Task</span>
    `;
    leftRow.title = `每個 cell 顯示「該日同時進行中的 Planning Task 數」\n色階：綠（少）→ 黃 → 紅（多），動態 cap = ${ptCap}（=資料中的最大值）`;
    leftRows.appendChild(leftRow);

    const track = buildHeatmapTrack(pts, rangeStart, rangeEnd, totalDays, ptCap, cellColorGYR);
    track.classList.add('jpv-summary-row', 'jpv-summary-pt');
    rightInner.appendChild(track);
  };

  // ─── 職種 row（PT 兩層：職種 → 任務）───
  // 跟主視圖的「人 → 任務」結構對稱，只是分組維度從 assignee 換成 cf[10773] 對應職種
  const renderRoleGroup = (group, leftRows, rightInner, rangeStart, rangeEnd, totalDays, idx) => {
    const roleKey = `role-${idx}`;
    // 職種 cap：依任務數適度放大（避免一片紅看不出波形）
    const roleCap = Math.max(HEAT_CAP, Math.ceil(group.assignees.length * HEAT_CAP / 3));

    // ── L1：職種 row（visibility 由 modal 上的 .jpv-section-pt-collapsed class + CSS 控制）──
    const roleLeft = document.createElement('div');
    roleLeft.className = 'jpv-person-row jpv-role-row';
    roleLeft.dataset.section = 'pt';
    roleLeft.dataset.roleKey = roleKey;
    roleLeft.innerHTML = `
      <span class="jpv-arrow">▶</span>
      <span class="jpv-role-icon">🏷️</span>
      <span class="jpv-name">${escapeHtml(group.role)}</span>
      <span class="jpv-summary-meta">${group.assignees.length} 人 · 峰值 ${group.maxDaily} · ${group.issues.length} 任務</span>
    `;
    roleLeft.title = `對應職種：${group.role}\n色階上限 ${roleCap}（自動推算 = 受託人數 × cap / 3）`;
    leftRows.appendChild(roleLeft);

    const roleTrack = buildHeatmapTrack(group.issues, rangeStart, rangeEnd, totalDays, roleCap);
    roleTrack.classList.add('jpv-role-row');
    roleTrack.dataset.section = 'pt';
    roleTrack.dataset.roleKey = roleKey;
    rightInner.appendChild(roleTrack);

    // ── L2：個別任務 row（展開後一個 PT 一行）—— PT 專用樣式，前面加受託人頭像 ──
    const taskLeftEls = [];
    const taskRightEls = [];
    group.issues.forEach((iss, i) => {
      const isLast = i === group.issues.length - 1;
      const lr = document.createElement('div');
      lr.className = `jpv-task-row jpv-pt-task-row` + (isLast ? ' is-last' : '');
      lr.dataset.section = 'pt';
      lr.dataset.roleKey = roleKey;
      lr.style.display = 'none';
      const epicLabel = iss.parentSummary || iss.parentKey || '';
      const epicTitle = iss.parentKey ? `${iss.parentKey} ${iss.parentSummary}` : '';
      const avatarHtml = iss.assigneeAvatar
        ? `<img class="jpv-pt-assignee-avatar" src="${iss.assigneeAvatar}" alt="" title="${escapeHtml(iss.assigneeName || '未指派')}">`
        : `<span class="jpv-pt-assignee-avatar jpv-pt-avatar-empty" title="${escapeHtml(iss.assigneeName || '未指派')}"></span>`;
      lr.innerHTML = `
        ${avatarHtml}
        ${iss.parentKey ? `<span class="jpv-epic-chip" title="${escapeHtml(epicTitle)}">⚡ ${escapeHtml(epicLabel)}</span>` : ''}
        <span class="jpv-task-key">${iss.key}</span>
        <span class="jpv-task-summary">${escapeHtml(iss.summary)}</span>
      `;
      lr.title = `${iss.key} ${iss.summary}\n受託人：${iss.assigneeName || '未指派'}`
        + (iss.parentKey ? `\nEpic: ${iss.parentKey} ${iss.parentSummary}` : '');
      lr.addEventListener('click', () => window.open(`${location.origin}/browse/${iss.key}`, '_blank'));
      leftRows.appendChild(lr);
      taskLeftEls.push(lr);

      const rt = buildTaskTrack(iss, rangeStart);
      rt.classList.add('jpv-pt-task-row');
      rt.dataset.section = 'pt';
      rt.dataset.roleKey = roleKey;
      rt.style.display = 'none';
      rightInner.appendChild(rt);
      taskRightEls.push(rt);
    });

    // 職種列點開：展開該職種下所有 PT
    roleLeft.addEventListener('click', () => {
      const open = !roleLeft.classList.contains('expanded');
      roleLeft.classList.toggle('expanded', open);
      roleTrack.classList.toggle('expanded', open);
      taskLeftEls.forEach(el => el.style.display = open ? '' : 'none');
      taskRightEls.forEach(el => el.style.display = open ? '' : 'none');
    });
  };

  // ─── Summary row（職種繁忙人數分布 — 半載 / 全載 / 超載 三層）───
  // 改用「人」當基礎單位，避免任務數加總無法跨顆粒度比較
  // 該日 cell 顏色看「最嚴重一級」：超載(紅) > 全載(橘) > 半載(黃) > 空(透明)
  // 色階濃淡 = 該級別人數比例
  const renderSummary = (allIssues, people, leftRows, rightInner, rangeStart, rangeEnd, totalDays, sectionKey = 'main') => {
    const breakdown = computeBusyBreakdown(allIssues, people);
    const halfTh = Math.ceil(HEAT_CAP / 2);
    let totalPeak = { half: 0, full: 0, over: 0 };
    for (const b of breakdown.values()) {
      totalPeak.half = Math.max(totalPeak.half, b.half);
      totalPeak.full = Math.max(totalPeak.full, b.full);
      totalPeak.over = Math.max(totalPeak.over, b.over);
    }

    const leftRow = document.createElement('div');
    leftRow.className = 'jpv-person-row jpv-summary-row';
    leftRow.dataset.section = sectionKey;
    leftRow.innerHTML = `
      <span class="jpv-arrow" style="visibility:hidden">▶</span>
      <span class="jpv-summary-icon">📊</span>
      <span class="jpv-name">職種繁忙人數</span>
      <span class="jpv-summary-meta">峰值：超載 ${totalPeak.over} 人　·　全載 ${totalPeak.full} 人　·　半載 ${totalPeak.half} 人　·　部門 ${people.length} 人</span>
    `;
    leftRow.title = `該日部門有多少人處於各負載級別\n` +
      `半載：≥ ${halfTh} 個任務 (黃)\n` +
      `全載：= ${HEAT_CAP} 個任務 (橘)\n` +
      `超載：> ${HEAT_CAP} 個任務 (紅)\n` +
      `cell 顏色 = 最嚴重一級；濃淡 = 該級別人數佔部門比例\n` +
      `（cap = ${HEAT_CAP}，可在 popup 調整）`;
    leftRows.appendChild(leftRow);

    const track = buildBreakdownTrack(breakdown, people.length, rangeStart, rangeEnd, totalDays);
    track.classList.add('jpv-summary-row');
    track.dataset.section = sectionKey;
    rightInner.appendChild(track);
  };

  // 計算每日「半載 / 全載 / 超載 / 閒」人數 + 人員名單
  const computeBusyBreakdown = (allIssues, people) => {
    const halfTh = Math.ceil(HEAT_CAP / 2);
    const deptSize = people.length;
    // accountId → name 對照表
    const idToName = new Map();
    for (const p of people) idToName.set(p.accountId, p.name);
    // date → assigneeId → count
    const dailyByPerson = new Map();
    for (const iss of allIssues) {
      if (!iss.start || !iss.due) continue;
      const start = new Date(iss.start + 'T00:00:00');
      const end = new Date(iss.due + 'T00:00:00');
      if (isNaN(start) || isNaN(end) || end < start) continue;
      const cur = new Date(start);
      while (cur <= end) {
        const k = JpvData.isoDate(cur);
        if (!dailyByPerson.has(k)) dailyByPerson.set(k, new Map());
        const m = dailyByPerson.get(k);
        m.set(iss.assigneeId, (m.get(iss.assigneeId) || 0) + 1);
        cur.setDate(cur.getDate() + 1);
      }
    }
    const out = new Map();
    for (const [k, personMap] of dailyByPerson) {
      const halfPpl = [], fullPpl = [], overPpl = [], lightPpl = [];
      for (const [aid, count] of personMap) {
        const name = idToName.get(aid) || aid;
        const entry = { name, count };
        if (count > HEAT_CAP) overPpl.push(entry);
        else if (count === HEAT_CAP) fullPpl.push(entry);
        else if (count >= halfTh) halfPpl.push(entry);
        else lightPpl.push(entry);  // 有任務但 < halfTh
      }
      // 真空閒：完全無任務的部門成員（不在 personMap 內）
      const idlePpl = [];
      for (const p of people) {
        if (!personMap.has(p.accountId)) idlePpl.push({ name: p.name, count: 0 });
      }
      // 「輕載/空閒」合併：先空閒、後輕載（依輕載任務數降冪）
      lightPpl.sort((a, b) => b.count - a.count);
      const lightAndIdlePpl = [...idlePpl, ...lightPpl];
      [halfPpl, fullPpl, overPpl].forEach(arr => arr.sort((a, b) => b.count - a.count));
      const busy = personMap.size;
      out.set(k, {
        half: halfPpl.length, full: fullPpl.length, over: overPpl.length,
        idle: deptSize - busy, busy,
        halfPpl, fullPpl, overPpl,
        lightAndIdlePpl,
      });
    }
    return out;
  };

  // 用 breakdown 畫 track（顏色看最嚴重級別 + 濃淡看比例）
  const buildBreakdownTrack = (breakdown, deptSize, rangeStart, rangeEnd, totalDays) => {
    const track = document.createElement('div');
    track.className = 'jpv-track jpv-track-person';
    const heat = document.createElement('div');
    heat.className = 'jpv-heatmap';
    heat.style.width = (totalDays * PX_PER_DAY) + 'px';

    const colorOf = (b) => {
      if (!b || (b.half + b.full + b.over) === 0) return 'transparent';
      const safeSize = Math.max(1, deptSize);
      if (b.over > 0) {
        const r = Math.min(1, b.over / safeSize);
        return `hsl(0, 80%, ${68 - r * 28}%)`;       // 紅
      }
      if (b.full > 0) {
        const r = Math.min(1, b.full / safeSize);
        return `hsl(28, 78%, ${68 - r * 22}%)`;      // 橘
      }
      const r = Math.min(1, b.half / safeSize);
      return `hsl(48, 75%, ${72 - r * 18}%)`;        // 黃
    };
    const sigOf = (b) => b ? `${b.half}|${b.full}|${b.over}` : '0|0|0';

    let runSig = null;
    let runDays = 0;
    let runStart = null;
    let runBreakdown = null;
    const flush = (endDate) => {
      if (runDays === 0) return;
      const cell = document.createElement('div');
      cell.className = 'jpv-heatmap-cell';
      cell.style.background = colorOf(runBreakdown);
      cell.style.width = (runDays * PX_PER_DAY) + 'px';
      if (runBreakdown && (runBreakdown.half + runBreakdown.full + runBreakdown.over > 0)) {
        const startStr = JpvData.isoDate(runStart);
        const endStr = JpvData.isoDate(endDate);
        const dateRange = startStr === endStr ? startStr : `${startStr} ~ ${endStr}`;
        cellIssuesMap.set(cell, { breakdown: runBreakdown, dateRange, deptSize });
      }
      heat.appendChild(cell);
      runDays = 0;
    };
    let cur = new Date(rangeStart);
    let prev = new Date(rangeStart);
    while (cur <= rangeEnd) {
      const k = JpvData.isoDate(cur);
      const b = breakdown.get(k) || null;
      const sig = sigOf(b);
      if (sig !== runSig) {
        flush(prev);
        runSig = sig;
        runBreakdown = b;
        runStart = new Date(cur);
      }
      runDays++;
      prev = new Date(cur);
      cur.setDate(cur.getDate() + 1);
    }
    flush(prev);
    track.appendChild(heat);
    return track;
  };

  const renderPerson = (p, leftRows, rightInner, rangeStart, rangeEnd, totalDays, idx = 0, sectionKey = 'main') => {
    const zebra = idx % 2 === 0 ? 'jpv-zebra-a' : 'jpv-zebra-b';
    // 左欄 — 人員列
    const leftPersonRow = document.createElement('div');
    leftPersonRow.className = `jpv-person-row ${zebra}`;
    leftPersonRow.dataset.section = sectionKey;
    leftPersonRow.innerHTML = `
      <span class="jpv-arrow">▶</span>
      ${p.avatar ? `<img class="jpv-avatar" src="${p.avatar}" alt="">` : '<span class="jpv-avatar"></span>'}
      <span class="jpv-name">${escapeHtml(p.name)}</span>
      <span style="margin-left:auto;color:#8C9BAB;font-size:11px">${p.issues.length}</span>
    `;
    leftRows.appendChild(leftPersonRow);

    // 右欄 — heatmap track
    const heatTrack = buildHeatmapTrack(p.issues, rangeStart, rangeEnd, totalDays);
    heatTrack.classList.add(zebra);
    heatTrack.dataset.section = sectionKey;
    rightInner.appendChild(heatTrack);

    // 子任務（預設收合）
    const childLeft = [];
    const childRight = [];
    p.issues.forEach((iss, i) => {
      const isLast = i === p.issues.length - 1;
      const lr = document.createElement('div');
      lr.className = `jpv-task-row ${zebra}` + (isLast ? ' is-last' : '');
      lr.dataset.section = sectionKey;
      lr.style.display = 'none';
      const epicLabel = iss.parentSummary || iss.parentKey || '';
      const epicTitle = iss.parentKey ? `${iss.parentKey} ${iss.parentSummary}` : '';
      lr.innerHTML = `
        ${iss.typeIconUrl ? `<img class="jpv-type-icon" src="${iss.typeIconUrl}" alt="">` : ''}
        ${iss.parentKey ? `<span class="jpv-epic-chip" title="${escapeHtml(epicTitle)}">⚡ ${escapeHtml(epicLabel)}</span>` : ''}
        <span class="jpv-task-key">${iss.key}</span>
        <span class="jpv-task-summary">${escapeHtml(iss.summary)}</span>
      `;
      lr.addEventListener('click', () => window.open(`${location.origin}/browse/${iss.key}`, '_blank'));
      leftRows.appendChild(lr);
      childLeft.push(lr);

      const rt = buildTaskTrack(iss, rangeStart);
      rt.classList.add(zebra);
      rt.dataset.section = sectionKey;
      rt.style.display = 'none';
      rightInner.appendChild(rt);
      childRight.push(rt);
    });

    leftPersonRow.addEventListener('click', () => {
      const open = !leftPersonRow.classList.contains('expanded');
      leftPersonRow.classList.toggle('expanded', open);
      heatTrack.classList.toggle('expanded', open);
      childLeft.forEach(el => el.style.display = open ? '' : 'none');
      childRight.forEach(el => el.style.display = open ? '' : 'none');
    });
  };

  const close = () => {
    if (!modalEl) return;
    modalEl.remove();
    modalEl = null;
    if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
    document.removeEventListener('keydown', onKeyDown, true);
  };

  // 鍵盤：Esc 關閉、←→ 捲動時間軸
  const SCROLL_STEP = PX_PER_DAY * 7;     // 一週
  const SCROLL_BIG = PX_PER_DAY * 30;     // 一個月（Shift）
  const onKeyDown = (e) => {
    if (!modalEl) return;
    // 輸入框內全放行（讓使用者能正常輸入文字）
    const t = e.target;
    if (t && (t.matches?.('input, textarea, [contenteditable="true"]') ||
              t.closest?.('input, textarea, [contenteditable="true"]'))) return;
    // 修飾鍵組合（Ctrl+C 複製、Ctrl+F 找等）放行
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    if (e.key === 'Escape') {
      close();
      e.stopImmediatePropagation();
      return;
    }
    // ←/→：jpv 自己捲時間軸
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const right = modalEl.querySelector('.jpv-right');
      if (right) {
        const step = e.shiftKey ? SCROLL_BIG : SCROLL_STEP;
        right.scrollLeft += (e.key === 'ArrowLeft' ? -step : step);
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    // 其他單鍵 shortcut（Jira 的 c / / / ? / j / k / g... 等）— 全攔下避免背景誤觸
    // 條件：印字字元（e.key.length === 1）或常見 shortcut 鍵
    if (e.key.length === 1 || ['Tab', 'Enter', 'F1'].includes(e.key)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  // ─── Loading / Error 狀態 ────────────────────
  const showLoading = () => {
    close();
    const m = document.createElement('div');
    m.id = 'jpv-modal';
    m.innerHTML = `
      <div class="jpv-overlay"></div>
      <div class="jpv-window">
        <div class="jpv-header">
          <span class="jpv-title">人力視圖</span>
          <span class="jpv-meta">載入中…</span>
          <span class="jpv-spacer"></span>
          <button class="jpv-close" title="關閉">✕</button>
        </div>
        <div class="jpv-body">
          <div class="jpv-loading">抓取任務中…</div>
        </div>
      </div>`;
    document.body.appendChild(m);
    modalEl = m;
    m.querySelector('.jpv-close').addEventListener('click', close);
    m.querySelector('.jpv-overlay').addEventListener('click', close);
    document.addEventListener('keydown', onKeyDown, true);
  };

  const showError = (msg) => {
    if (!modalEl) showLoading();
    const body = modalEl.querySelector('.jpv-body');
    body.innerHTML = `<div class="jpv-error">⚠️ ${escapeHtml(msg)}</div>`;
  };

  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return { open, close, showLoading, showError, setHeatCap, setRefreshHandler };
})();
