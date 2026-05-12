// teams.js — Atlassian Teams API 包裝
// 用來抓「該職種的完整成員名單」，補完 issues 抓不到的「完全沒派任務的人」
//
// API endpoints（session cookie 認證 OK）：
//   GET  /gateway/api/public/teams/v1/org/{orgId}/teams                    → 列所有 team
//   POST /gateway/api/public/teams/v1/org/{orgId}/teams/{tid}/members      → 列成員 (accountId)
//   GET  /rest/api/3/user?accountId={aid}                                  → 抓 displayName + avatar
//
// orgId 取得方式：暫時 hardcoded，未來可從 /gateway/api/me 動態抓

const JpvTeams = (() => {
  // Atlassian org UUID（從 /people redirect URL 解出）
  // TODO: 改成動態偵測，讓任何 tenant 都能用
  const ORG_ID = 'c238ce5d-556b-402e-b343-b69b3c241d75';
  // Jira base URL：teams.js 只在 content script 跑（manifest 設定），用 location.origin 即可
  // 同時讓擴充功能不綁定特定 tenant
  const JIRA_BASE = location.origin;
  const url = (path) => JIRA_BASE + path;

  // 從 team roster 內排除的 accountId（這些人雖在 team 但不算「實際成員」）
  // 例：PM 帳號只是用來加人，不該出現在繁忙人數統計裡
  const EXCLUDED_ACCOUNT_IDS = new Set([
    '712020:b8166c4f-7772-425d-865c-f7ecfb58625a',  // PM（用來加人，不算負載）
  ]);

  // cf[10773] role → Atlassian Team UUID 對映
  // 用來補完「該職種完整成員名單」（含完全沒派任務的人）
  // 注意：多個 role 可以對映到同一個 team UUID（many-to-one，例如 dev/backend 都在 System team）
  // 整合 layer 用 teamId 去 fetch roster 時要記得 dedup
  const ROLE_TO_TEAM_ID = {
    'plan':      'a6b8b3dd-4d92-4221-8de6-7ea7c39504c3',  // Plan
    'art':       'c86a5e93-ffaf-47b9-8f87-471f1059601a',  // Artist
    'anim':      '9847399b-4456-4a00-b88b-f7469e6faf46',  // Animator
    'engine':    '6bef859f-c876-4b00-926c-f08818bacc4c',  // Game Engineering
    'backend':   '0b561f77-4e08-4a12-a608-83c632c420b6',  // System（與 dev 同一隊）
    'math':      '80f8b934-4a71-49ab-b1e3-39f8baced1be',  // Math Design
    'data':      'e4302866-de32-4adc-bc06-2097504818d7',  // Data
    'qa':        'c38e2e7b-713c-49be-9d35-5df5f38db69e',  // Quality Engineering
    'dev':       '0b561f77-4e08-4a12-a608-83c632c420b6',  // System（與 backend 同一隊）
    'marketing': 'cf916cf3-bee4-4c88-87a1-ed45b2946205',  // Marketing
  };

  const teamIdForRole = (role) => ROLE_TO_TEAM_ID[role] || null;

  const listTeams = async () => {
    const res = await fetch(url(`/gateway/api/public/teams/v1/org/${ORG_ID}/teams`),
      { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`listTeams ${res.status}`);
    const data = await res.json();
    return (data.entities || []).map(t => ({
      id: t.teamId,
      name: t.displayName,
      description: t.description || '',
    }));
  };

  // POST /members 是分頁的，先做不分頁版（看實際團隊大小決定要不要 pagination）
  const getMembers = async (teamId) => {
    const endpoint = url(`/gateway/api/public/teams/v1/org/${ORG_ID}/teams/${teamId}/members`);
    const all = [];
    let cursor = null;
    for (let i = 0; i < 10; i++) { // 最多 10 頁，安全上限
      const body = cursor ? { after: cursor } : {};
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`getMembers ${res.status}`);
      const data = await res.json();
      for (const m of (data.results || [])) {
        all.push({ accountId: m.accountId });
      }
      if (!data.pageInfo?.hasNextPage) break;
      cursor = data.pageInfo.endCursor;
    }
    return all;
  };

  // 補上 displayName + avatar — 一次抓多個 accountId 用 bulk endpoint
  const enrichWithUserInfo = async (members) => {
    if (!members.length) return members;
    // /rest/api/3/user/bulk 一次最多 90 個 accountId
    const result = [...members];
    const idIndex = new Map();
    members.forEach((m, i) => idIndex.set(m.accountId, i));
    const chunks = [];
    for (let i = 0; i < members.length; i += 90) {
      chunks.push(members.slice(i, i + 90));
    }
    for (const chunk of chunks) {
      const params = chunk.map(m => 'accountId=' + encodeURIComponent(m.accountId)).join('&');
      try {
        const res = await fetch(url('/rest/api/3/user/bulk?' + params), { credentials: 'include' });
        if (!res.ok) continue;
        const data = await res.json();
        for (const u of (data.values || [])) {
          const idx = idIndex.get(u.accountId);
          if (idx != null) {
            result[idx].name = u.displayName;
            result[idx].avatar = u.avatarUrls?.['24x24'] || '';
          }
        }
      } catch (e) {
        console.warn('[jpv teams] bulk fetch failed', e);
      }
    }
    // fallback：bulk 失敗的人逐個用 /user?accountId= 補
    for (const m of result) {
      if (m.name) continue;
      try {
        const res = await fetch(url('/rest/api/3/user?accountId=' + encodeURIComponent(m.accountId)), { credentials: 'include' });
        if (res.ok) {
          const u = await res.json();
          m.name = u.displayName;
          m.avatar = u.avatarUrls?.['24x24'] || '';
        }
      } catch {}
    }
    return result;
  };

  // 一次性：抓 team 完整成員（含 displayName / avatar）
  const fetchRoster = async (teamId) => {
    const members = await getMembers(teamId);
    return enrichWithUserInfo(members);
  };

  // ─── Cache（chrome.storage.local；手動重整 only，不設 TTL）─────
  const cacheKey = (teamId) => `jpv:team:${teamId}`;

  const readCache = (teamId) => new Promise(resolve => {
    chrome.storage.local.get([cacheKey(teamId)], (data) => {
      const v = data[cacheKey(teamId)];
      resolve(v && Array.isArray(v.members) ? v : null);
    });
  });

  const writeCache = (teamId, members) => new Promise(resolve => {
    chrome.storage.local.set({
      [cacheKey(teamId)]: { members, cachedAt: Date.now() },
    }, resolve);
  });

  // 取 roster：優先用 cache，cache miss 才 API；force=true 強制重抓
  const getRoster = async (teamId, { force = false } = {}) => {
    if (!force) {
      const cached = await readCache(teamId);
      if (cached) return cached.members;
    }
    const fresh = await fetchRoster(teamId);
    await writeCache(teamId, fresh);
    return fresh;
  };

  // 給多個 role，dedup teamId 後一次抓回所有 roster
  // 回傳：Map<accountId, { accountId, name, avatar }>（部門合併名單）
  const getCombinedRosterForRoles = async (roles, opts = {}) => {
    const teamIds = new Set();
    for (const r of roles) {
      const tid = teamIdForRole(r);
      if (tid) teamIds.add(tid);
    }
    const out = new Map();
    for (const tid of teamIds) {
      try {
        const members = await getRoster(tid, opts);
        for (const m of members) {
          if (EXCLUDED_ACCOUNT_IDS.has(m.accountId)) continue;
          if (!out.has(m.accountId)) out.set(m.accountId, m);
        }
      } catch (e) {
        console.warn('[jpv teams] roster failed for team', tid, e);
      }
    }
    return out;
  };

  // popup 用：重抓所有 ROLE_TO_TEAM_ID 列出的 team roster，更新 cache
  // 回傳：{
  //   teamCount, totalMembers,
  //   added / removed: [{ name, teams: [roleLabels...] }]（diff 結果，含該人歸屬的職種 label）
  //   addedNames / removedNames: [name, ...]（向後相容欄位）
  //   isFirstFetch, refreshedAt, failures,
  // }
  const LAST_REFRESH_KEY = 'jpv:teams-last-refresh';

  const refreshAllRosters = async () => {
    const teamIds = [...new Set(Object.values(ROLE_TO_TEAM_ID).filter(Boolean))];

    // 反查表：teamId → [role labels...]
    // many-to-one：例如 dev / backend 同一隊（System），新增者 teams 會顯示 'dev/backend'
    const teamIdToRoles = {};
    for (const [role, tid] of Object.entries(ROLE_TO_TEAM_ID)) {
      if (!tid) continue;
      (teamIdToRoles[tid] ||= []).push(role);
    }
    const labelForTeamId = (tid) => (teamIdToRoles[tid] || []).join('/');

    // Step 1: 收集舊名單（cache）
    const oldMembers = new Map();      // accountId → name
    const oldTeamsByAid = new Map();   // accountId → Set<teamId>
    for (const tid of teamIds) {
      const cached = await readCache(tid);
      if (cached) {
        for (const m of cached.members) {
          if (EXCLUDED_ACCOUNT_IDS.has(m.accountId)) continue;
          if (!oldMembers.has(m.accountId)) oldMembers.set(m.accountId, m.name || m.accountId);
          if (!oldTeamsByAid.has(m.accountId)) oldTeamsByAid.set(m.accountId, new Set());
          oldTeamsByAid.get(m.accountId).add(tid);
        }
      }
    }
    const isFirstFetch = oldMembers.size === 0;

    // Step 2: 抓新名單
    const newMembers = new Map();
    const newTeamsByAid = new Map();
    const failures = [];
    for (const tid of teamIds) {
      try {
        const members = await fetchRoster(tid);
        await writeCache(tid, members);
        for (const m of members) {
          if (EXCLUDED_ACCOUNT_IDS.has(m.accountId)) continue;
          if (!newMembers.has(m.accountId)) newMembers.set(m.accountId, m.name || m.accountId);
          if (!newTeamsByAid.has(m.accountId)) newTeamsByAid.set(m.accountId, new Set());
          newTeamsByAid.get(m.accountId).add(tid);
        }
      } catch (e) {
        console.warn('[jpv teams] refresh failed for', tid, e);
        failures.push({ teamId: tid, error: e.message });
      }
    }

    // Step 3: diff（依 accountId 算，順便帶上該人歸屬的職種 label 給 popup 顯示）
    const added = [];
    const removed = [];
    for (const [aid, name] of newMembers) {
      if (oldMembers.has(aid)) continue;
      const teams = [...(newTeamsByAid.get(aid) || [])].map(labelForTeamId).filter(Boolean);
      added.push({ name, teams });
    }
    for (const [aid, name] of oldMembers) {
      if (newMembers.has(aid)) continue;
      const teams = [...(oldTeamsByAid.get(aid) || [])].map(labelForTeamId).filter(Boolean);
      removed.push({ name, teams });
    }

    const refreshedAt = Date.now();
    await new Promise(r => chrome.storage.local.set({ [LAST_REFRESH_KEY]: refreshedAt }, r));

    return {
      teamCount: teamIds.length,
      totalMembers: newMembers.size,
      added,
      removed,
      addedNames:   added.map(a => a.name),    // 向後相容
      removedNames: removed.map(r => r.name),
      isFirstFetch,
      refreshedAt,
      failures,
    };
  };

  const getLastRefreshAt = () => new Promise(resolve => {
    chrome.storage.local.get([LAST_REFRESH_KEY], (data) => resolve(data[LAST_REFRESH_KEY] || null));
  });

  return {
    listTeams, getMembers, enrichWithUserInfo, fetchRoster,
    getRoster, getCombinedRosterForRoles, refreshAllRosters, getLastRefreshAt,
    teamIdForRole, ROLE_TO_TEAM_ID, EXCLUDED_ACCOUNT_IDS, ORG_ID,
  };
})();
