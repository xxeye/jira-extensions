// popup.js — 任務類型篩選設定，存入 chrome.storage.sync

// 主視圖（職種以人為主軸）的任務類型，附對應 cf[10773] 職種值
const MAIN_TYPES = [
  { key: 'Plan Story',     label: 'Plan Story',     role: 'plan' },
  { key: 'Art Story',      label: 'Art Story',      role: 'art' },
  { key: 'Anim Task',      label: 'Anim Task',      role: 'anim' },
  { key: 'Engine Task',    label: 'Engine Task',    role: 'engine' },
  { key: 'Backend Task',   label: 'Backend Task',   role: 'backend' },
  { key: 'Math Task',      label: 'Math Task',      role: 'math' },
  { key: 'Data Task',      label: 'Data Task',      role: 'data' },
  { key: 'QA Task',        label: 'QA Task',        role: 'qa' },
  { key: 'Dev Task',       label: 'Dev Task',       role: 'dev' },
  { key: 'MKT Story',      label: 'MKT Story',      role: 'marketing' },
];
const PT_TYPES = [
  { key: 'Planning Task',  label: 'Planning Task' },
];

const STORAGE_KEY          = 'jpv-types';            // 已勾的類型陣列（互斥：含 PT 或含主類型，不會同時）
const STORAGE_CAP          = 'jpv-cap';
const STORAGE_SHOW_PT_LOAD = 'jpv-show-pt-load';     // 主視圖模式下，是否顯示 PT 負載對比 bar

const DEFAULT_TYPES        = [];   // 預設 A 視角職種全不選，使用者按需勾
const DEFAULT_CAP          = 5;
const DEFAULT_SHOW_PT_LOAD = true; // 預設只開「PT 並行對比 bar」

const $ = (id) => document.getElementById(id);
const flashStatus = () => { const s = $('status'); s.classList.add('show'); setTimeout(() => s.classList.remove('show'), 1200); };

const isPtType = (k) => /planning task/i.test(k);

const load = () => new Promise(resolve => {
  chrome.storage.sync.get([STORAGE_KEY, STORAGE_CAP, STORAGE_SHOW_PT_LOAD], (data) => {
    resolve({
      types: Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : DEFAULT_TYPES,
      cap: Number.isFinite(data[STORAGE_CAP]) ? data[STORAGE_CAP] : DEFAULT_CAP,
      showPtLoad: typeof data[STORAGE_SHOW_PT_LOAD] === 'boolean' ? data[STORAGE_SHOW_PT_LOAD] : DEFAULT_SHOW_PT_LOAD,
    });
  });
});

const save = (selected) => new Promise(resolve => {
  chrome.storage.sync.set({ [STORAGE_KEY]: selected }, () => { flashStatus(); resolve(); });
});
const saveCap = (cap) => new Promise(resolve => {
  chrome.storage.sync.set({ [STORAGE_CAP]: cap }, () => { flashStatus(); resolve(); });
});
const saveShowPtLoad = (v) => new Promise(resolve => {
  chrome.storage.sync.set({ [STORAGE_SHOW_PT_LOAD]: v }, () => { flashStatus(); resolve(); });
});

const renderList = (containerId, defs, selected) => {
  const list = $(containerId);
  list.innerHTML = '';
  defs.forEach(t => {
    const wrap = document.createElement('div');
    wrap.className = 'row checkbox-row';
    wrap.innerHTML = `
      <label>
        <input type="checkbox" data-key="${t.key}" ${selected.includes(t.key) ? 'checked' : ''}>
        <span>${t.label}</span>
      </label>`;
    list.appendChild(wrap);
  });
};

// 反映「主視圖 vs PT 視圖」互斥狀態到 UI（greyed out）
const reflectExclusion = (selected) => {
  const hasMain = selected.some(k => !isPtType(k));
  const hasPt   = selected.some(k =>  isPtType(k));

  // 主視圖 section：當 PT 已勾，主類型 disable
  $('types-section').classList.toggle('disabled', hasPt);
  $('types-list').querySelectorAll('input').forEach(cb => cb.disabled = hasPt);
  // 「顯示 PT 負載」checkbox：在主視圖模式才有意義；PT 模式時 disable
  $('show-pt-load').disabled = hasPt;
  $('show-pt-load-row').classList.toggle('disabled', hasPt);

  // PT section：當主類型已勾，PT disable
  $('pt-section').classList.toggle('disabled', hasMain);
  $('pt-list').querySelectorAll('input').forEach(cb => cb.disabled = hasMain);
};

const render = (selected, showPtLoad) => {
  renderList('types-list', MAIN_TYPES, selected);
  renderList('pt-list', PT_TYPES, selected);
  $('show-pt-load').checked = showPtLoad;
  reflectExclusion(selected);

  const collectAndSave = async () => {
    const all = [
      ...$('types-list').querySelectorAll('input:checked'),
      ...$('pt-list').querySelectorAll('input:checked'),
    ].map(el => el.dataset.key);
    await save(all);
    reflectExclusion(all);
  };
  document.querySelectorAll('#types-list input, #pt-list input').forEach(cb => {
    cb.addEventListener('change', collectAndSave);
  });

  $('show-pt-load').addEventListener('change', async (e) => {
    await saveShowPtLoad(e.target.checked);
  });
};

// ─── 部門名單區塊 ─────────────────────────────────
// popup 跨 origin 呼叫 Atlassian gateway 會 403，所有 API 委託 content script 代跑
let teamNameById = new Map();

// 找一個開著的 Atlassian 分頁，發訊息給它的 content script
const askContentScript = async (action, payload = {}) => {
  const tabs = await new Promise(r => chrome.tabs.query({ url: 'https://*.atlassian.net/*' }, r));
  if (!tabs.length) throw new Error('沒有開啟 Atlassian 分頁，請先打開 Jira 後再操作');
  const tab = tabs[0];
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, { action, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error('content script 沒回應，請重整 Jira 分頁。' + chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
};

const renderRosterMap = () => {
  const tbl = $('roster-map');
  if (!tbl) return;
  const rows = Object.entries(JpvTeams.ROLE_TO_TEAM_ID).map(([role, tid]) => {
    const teamName = tid ? (teamNameById.get(tid) || '(team id: ' + tid.slice(0, 8) + '...)') : '— 未對映 —';
    return `<tr><td class="role-col">${role}</td><td class="arrow-col">→</td><td>${teamName}</td></tr>`;
  });
  tbl.innerHTML = rows.join('');
};

const ensureTeamNames = async () => {
  if (teamNameById.size > 0) return;
  try {
    const { teams } = await askContentScript('jpv:listTeams');
    teamNameById = new Map((teams || []).map(t => [t.id, t.name]));
  } catch (e) {
    console.warn('[jpv popup] listTeams failed', e);
  }
};

const fmtTime = (ts) => {
  if (!ts) return '從未';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `今天 ${hh}:${mm}`;
  const M = d.getMonth() + 1;
  const D = d.getDate();
  return `${M}/${D} ${hh}:${mm}`;
};

const showLastRefreshTime = async () => {
  const ts = await JpvTeams.getLastRefreshAt();
  const lr = $('last-refresh');
  if (lr) lr.textContent = '上次更新：' + fmtTime(ts);
};

// 「名字 (職種)」格式；多隊用 / 串接，例如 dev/backend 共一隊時 → "Alice (dev/backend)"
const formatPerson = (p) => (p && p.teams && p.teams.length) ? `${p.name} (${p.teams.join('/')})` : (p?.name || '');

const showRefreshResult = (status, result) => {
  // 優先用新欄位 added/removed（帶 team label），舊版退回 addedNames/removedNames
  const added   = result.added   || (result.addedNames   || []).map(name => ({ name, teams: [] }));
  const removed = result.removed || (result.removedNames || []).map(name => ({ name, teams: [] }));

  const parts = [];
  if (result.isFirstFetch) {
    parts.push(`✅ 首次抓取`);
  } else if (added.length === 0 && removed.length === 0) {
    parts.push(`✅ 無變化`);
  } else {
    parts.push(`✅ 已更新`);
    if (added.length)   parts.push(`新增 ${added.length} 人 (${added.map(formatPerson).join(', ')})`);
    if (removed.length) parts.push(`移除 ${removed.length} 人 (${removed.map(formatPerson).join(', ')})`);
  }
  parts.push(`共 ${result.totalMembers} 人 / ${result.teamCount} 隊`);
  status.textContent = parts.join('　·　');
  status.title = parts.join('\n');
  status.style.color = (added.length || removed.length || result.isFirstFetch) ? '#4BCE97' : 'var(--text-dim)';
};

// 偵測有沒有開著的 Atlassian 分頁，決定按鈕能不能用
const hasJiraTab = async () => {
  const tabs = await new Promise(r => chrome.tabs.query({ url: 'https://*.atlassian.net/*' }, r));
  return tabs.length > 0;
};

const setupRoster = async () => {
  // details 第一次展開時抓 team 名稱
  const details = document.querySelector('details.roster-info');
  if (details) {
    details.addEventListener('toggle', async () => {
      if (details.open && teamNameById.size === 0) {
        await ensureTeamNames();
        renderRosterMap();
      }
    });
  }
  // 先用 teamId 速渲一次（沒 team 名也能看到對映）
  renderRosterMap();

  // 顯示上次更新時間
  showLastRefreshTime();

  // 重抓按鈕
  const btn = $('refresh-teams');
  const status = $('roster-status');

  // 沒開 Jira 分頁就整個 section 灰掉（跟 A/B 互斥邏輯一樣）
  const rosterSection = $('roster-section');
  const refreshAvailability = async () => {
    const ok = await hasJiraTab();
    btn.disabled = !ok;
    rosterSection.classList.toggle('disabled', !ok);
    if (!ok) {
      btn.title = '請先在 Chrome 開啟任一 Jira 分頁';
      status.textContent = '⚠️ 請先打開任一 Jira 分頁';
      status.style.color = 'var(--text-dim)';
    } else {
      btn.title = '';
    }
  };
  await refreshAvailability();
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.textContent = '抓取中…';
    status.style.color = 'var(--text-dim)';
    try {
      const result = await askContentScript('jpv:refreshTeams');
      if (result.totalMembers === 0 && (result.failures || []).length > 0) {
        const firstErr = result.failures[0]?.error || 'unknown';
        throw new Error(`${result.failures.length} 個 team 抓取失敗（${firstErr}）— cache 已保留`);
      }
      showRefreshResult(status, result);
      showLastRefreshTime();
      await ensureTeamNames();
      renderRosterMap();
    } catch (e) {
      status.textContent = '❌ ' + e.message;
      status.style.color = '#FF8E40';
    } finally {
      // 重新檢查 availability（剛剛動作期間使用者可能關掉 Jira 分頁）
      await refreshAvailability();
    }
  });
};

(async () => {
  const { types, cap, showPtLoad } = await load();
  render(types, showPtLoad);
  setupRoster();
  $('cap').value = cap;

  $('cap').addEventListener('change', async (e) => {
    let v = parseInt(e.target.value, 10);
    if (!Number.isFinite(v) || v < 1) v = 1;
    if (v > 20) v = 20;
    e.target.value = v;
    await saveCap(v);
  });

  $('select-all').addEventListener('click', async () => {
    await save(DEFAULT_TYPES);
    render(DEFAULT_TYPES, showPtLoad);
  });
  $('select-none').addEventListener('click', async () => {
    await save([]);
    render([], showPtLoad);
  });
})();
