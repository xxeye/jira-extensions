// data.js — JQL 建構、抓取、依 assignee 分組、heatmap 聚合

const JpvData = (() => {
  const FIELD_START = 'customfield_10015'; // Jira Cloud Start Date
  const FIELD_ROLE  = 'customfield_10773'; // 對應職種（多選 — plan/art/data/...）

  // 任務類型 → cf[10773] 對應職種值（給「主視圖 + 顯示相關 PT 負載」模式用）
  const TYPE_TO_ROLE = {
    'Plan Story':    'plan',
    'Art Story':     'art',
    'Anim Task':     'anim',
    'Engine Task':   'engine',
    'Backend Task':  'backend',
    'Math Task':     'math',
    'Data Task':     'data',
    'QA Task':       'qa',
    'Dev Task':      'dev',
    'MKT Story':     'marketing',
  };

  // 反向：cf[10773] role → 對應的執行任務類型陣列（同職種多個 issuetype 都算）
  const ROLE_TO_TYPES = {
    'plan':      ['Plan Story', 'Plan Subtask'],
    'art':       ['Art Story', 'Art Subtask'],
    'anim':      ['Anim Task', 'Anim Subtask'],
    'engine':    ['Engine Task', 'Engine Subtask'],
    'backend':   ['Backend Task', 'Backend Subtask'],
    'math':      ['Math Task', 'Math Subtask'],
    'data':      ['Data Task', 'Data Subtask'],
    'qa':        ['QA Task', 'QA Subtask'],
    'dev':       ['Dev Task', 'Dev Subtask'],
    'marketing': ['MKT Story'],
  };

  // 從 summary 抽 T 階段前綴（如 "T1_專案代號" → "T1"）
  const STAGE_RE = /^T(\d+)[_\s]/;
  const extractStage = (summary) => {
    const m = (summary || '').match(STAGE_RE);
    return m ? `T${m[1]}` : null;
  };

  // 建 JQL
  // selectedTypes：勾選的任務類型陣列（互斥：含 PT 或含主類型，不會混）
  // opts.showPtLoad：主視圖模式下，是否額外抓相關職種的 PT（給對比 bar 用）
  //
  // 三種情境：
  // 1) 只勾 Planning Task → 抓全部 PT（無職種過濾）
  // 2) 只勾主類型 → 只抓該些類型
  // 3) 勾主類型 + showPtLoad → 抓該些類型 + cf[10773] in (對應職種) 的 PT
  const buildJql = (selectedTypes, opts = {}) => {
    if (!selectedTypes.length) return null;
    const showPtLoad = opts.showPtLoad === true;
    const isPlanningOnly = selectedTypes.length >= 1
      && selectedTypes.every(t => /planning task/i.test(t));
    const baseFilter = 'assignee is not EMPTY AND statusCategory in ("To Do", "In Progress")';

    if (isPlanningOnly) {
      return `${baseFilter} AND issuetype = "Planning Task" ORDER BY assignee ASC`;
    }

    const nonPtTypes = selectedTypes.filter(t => !/planning task/i.test(t));
    const typeClauses = [
      `issuetype in (${nonPtTypes.map(t => `"${t}"`).join(',')})`,
    ];

    if (showPtLoad) {
      const roles = nonPtTypes.map(t => TYPE_TO_ROLE[t]).filter(Boolean);
      if (roles.length) {
        const rolesStr = roles.map(r => `"${r}"`).join(',');
        typeClauses.push(`(issuetype = "Planning Task" AND cf[10773] in (${rolesStr}))`);
      }
    }
    return `${baseFilter} AND (${typeClauses.join(' OR ')}) ORDER BY assignee ASC`;
  };

  // 從 issue 物件抽要的欄位
  const normalizeIssue = (iss) => {
    const f = iss.fields || {};
    const a = f.assignee || {};
    const p = f.parent || null;
    const roleField = f[FIELD_ROLE];
    const roles = Array.isArray(roleField)
      ? roleField.map(r => r?.value || r?.name).filter(Boolean)
      : [];
    // PT 是否已透過「relates to」拆出對應執行任務（regex 比對 type name，例：自訂排序前綴 01_Relates）
    const links = Array.isArray(f.issuelinks) ? f.issuelinks : [];
    const hasRelates = links.some(lk => /relates/i.test(lk?.type?.name || ''));
    return {
      key: iss.key,
      summary: f.summary || '',
      typeName: (f.issuetype && f.issuetype.name) || 'Unknown',
      typeIconUrl: (f.issuetype && f.issuetype.iconUrl) || '',
      statusName: (f.status && f.status.name) || '',
      statusCat: (f.status && f.status.statusCategory && f.status.statusCategory.key) || '',
      start: f[FIELD_START] || null, // 'YYYY-MM-DD' 或 null
      due: f.duedate || null,
      assigneeId: a.accountId || '__none__',
      assigneeName: a.displayName || '未指派',
      assigneeAvatar: (a.avatarUrls && a.avatarUrls['24x24']) || '',
      parentKey: p ? p.key : null,
      parentSummary: p && p.fields ? (p.fields.summary || '') : '',
      parentTypeName: p && p.fields && p.fields.issuetype ? p.fields.issuetype.name : '',
      stage: extractStage(f.summary),  // T 階段前綴（給 PT 拆解推算用）
      roles,            // PT 用：對應職種多選
      hasRelates,       // PT 用：是否已拆出 relates 對應任務（literal-OR-inferred 經 inferPtSplit 補完）
    };
  };

  // 推算 PT 是否「已拆」— 用業務規則 (同 Epic + 同 T 階段 + 對應職種任務存在) 模擬 automation
  // 比 issuelinks relates 更貼近實際 workflow，因為主管不一定會手動加 relates 連結
  // 假設：只要該 Epic 下有對應職種對應階段的執行任務開出來，就視為「已拆」
  const inferPtSplit = (issues) => {
    // 索引：epicKey|stage|typeName → 該組合下的執行任務數
    const idx = new Map();
    for (const iss of issues) {
      if (isPlanningTask(iss)) continue;
      if (!iss.stage || !iss.parentKey) continue;
      const k = `${iss.parentKey}|${iss.stage}|${iss.typeName}`;
      idx.set(k, (idx.get(k) || 0) + 1);
    }
    for (const iss of issues) {
      if (!isPlanningTask(iss)) continue;
      let inferredSplit = false;
      if (iss.parentKey && iss.stage && iss.roles && iss.roles.length) {
        for (const role of iss.roles) {
          const types = ROLE_TO_TYPES[role] || [];
          for (const typeName of types) {
            if ((idx.get(`${iss.parentKey}|${iss.stage}|${typeName}`) || 0) > 0) {
              inferredSplit = true;
              break;
            }
          }
          if (inferredSplit) break;
        }
      }
      iss.inferredSplit = inferredSplit;
      // hasRelates 改為 literal-OR-inferred，render 端不用改
      iss.hasRelates = iss.hasRelates || inferredSplit;
    }
  };

  // 抓全部任務
  // opts: { showPtLoad: boolean }
  const fetchAll = async (selectedTypes, opts = {}) => {
    const jql = buildJql(selectedTypes, opts);
    if (!jql) return [];
    const fields = [
      'summary', 'issuetype', 'status', 'assignee',
      'duedate', FIELD_START, 'parent', FIELD_ROLE,
      'issuelinks',  // 用來判斷 PT 是否已拆出 relates（literal）
    ];
    const raw = await JiraApi.searchByJql(jql, fields);
    const issues = raw.map(normalizeIssue);
    inferPtSplit(issues);   // 用業務規則推算「同 Epic + 同 T 階段 + 對應職種任務」存在
    return issues;
  };

  const isPlanningTask = (iss) => /planning task/i.test(iss.typeName);

  // PT 專用：以「對應職種 → 受託人 → 任務」三層分組
  // 一個 PT 可掛多個職種，會在每個有 match 的職種下出現一次
  // 自動依 issues 中存在的非 PT 任務類型，推算出「相關職種」白名單
  // - 若 issues 完全沒有非 PT 任務（PT-only 模式）→ 不過濾，全部 role 都顯示
  // - 若有非 PT 任務（主視圖 + showPtLoad 模式）→ 只顯示對應職種的 role group
  // 回傳 [{role, issues, dailyMap, maxDaily, assignees: [...]}]
  const groupByRoleAssignee = (issues) => {
    const pts = issues.filter(isPlanningTask);
    // 推算 allowedRoles：對應 issues 中存在的非 PT 任務類型
    const nonPtTypes = new Set(issues.filter(i => !isPlanningTask(i)).map(i => i.typeName));
    const allowedRoles = new Set();
    nonPtTypes.forEach(t => {
      const r = TYPE_TO_ROLE[t];
      if (r) allowedRoles.add(r);
    });
    const useFilter = allowedRoles.size > 0; // PT-only 模式時 false → 顯示全部

    const roleMap = new Map();
    for (const iss of pts) {
      const tags = iss.roles && iss.roles.length ? iss.roles : ['未分類'];
      for (const role of tags) {
        if (useFilter && !allowedRoles.has(role)) continue;
        if (!roleMap.has(role)) {
          roleMap.set(role, { role, issues: [], assigneeMap: new Map() });
        }
        const grp = roleMap.get(role);
        grp.issues.push(iss);
        if (!grp.assigneeMap.has(iss.assigneeId)) {
          grp.assigneeMap.set(iss.assigneeId, {
            accountId: iss.assigneeId,
            name: iss.assigneeName,
            avatar: iss.assigneeAvatar,
            issues: [],
          });
        }
        grp.assigneeMap.get(iss.assigneeId).issues.push(iss);
      }
    }
    const out = [];
    for (const grp of roleMap.values()) {
      grp.issues = sortByDue(grp.issues);
      grp.dailyMap = dailyIssues(grp.issues);
      grp.maxDaily = 0;
      for (const list of grp.dailyMap.values()) {
        if (list.length > grp.maxDaily) grp.maxDaily = list.length;
      }
      grp.assignees = [...grp.assigneeMap.values()];
      for (const a of grp.assignees) {
        a.dailyMap = dailyIssues(a.issues);
        a.maxDaily = 0;
        for (const list of a.dailyMap.values()) {
          if (list.length > a.maxDaily) a.maxDaily = list.length;
        }
      }
      grp.assignees.sort((a, b) => {
        if (a.maxDaily !== b.maxDaily) return b.maxDaily - a.maxDaily;
        return a.name.localeCompare(b.name);
      });
      delete grp.assigneeMap;
      out.push(grp);
    }
    return out.sort((a, b) => {
      if (a.maxDaily !== b.maxDaily) return b.maxDaily - a.maxDaily;
      return a.role.localeCompare(b.role);
    });
  };

  // 切割 PT vs 非 PT — 用於把 PT 從主視圖移到職種視圖
  const splitByPt = (issues) => {
    const pts = [];
    const others = [];
    for (const iss of issues) {
      if (isPlanningTask(iss)) pts.push(iss);
      else others.push(iss);
    }
    return { pts, others };
  };

  // 任務依 due asc 排（沒填 due 的丟最後）
  const sortByDue = (issues) => issues.slice().sort((a, b) => {
    if (!a.due && !b.due) return 0;
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due.localeCompare(b.due);
  });

  // 依 assignee 分組；同時計算 maxDaily + dailyMap 緩存，並依工作量排序（最忙在上）
  const groupByPerson = (issues) => {
    const map = new Map();
    for (const iss of issues) {
      if (!map.has(iss.assigneeId)) {
        map.set(iss.assigneeId, {
          accountId: iss.assigneeId,
          name: iss.assigneeName,
          avatar: iss.assigneeAvatar,
          issues: [],
        });
      }
      map.get(iss.assigneeId).issues.push(iss);
    }
    const people = [...map.values()];
    for (const p of people) {
      p.issues = sortByDue(p.issues);
      p.dailyMap = dailyIssues(p.issues);
      p.maxDaily = 0;
      for (const list of p.dailyMap.values()) {
        if (list.length > p.maxDaily) p.maxDaily = list.length;
      }
    }
    return people.sort((a, b) => {
      if (a.maxDaily !== b.maxDaily) return b.maxDaily - a.maxDaily;
      return a.name.localeCompare(b.name);
    });
  };

  // 計算每人每日佔用的任務清單
  // 回傳 Map<dateStr, [{key, summary, typeName, parentKey, parentSummary, hasRelates}]>
  const dailyIssues = (issues) => {
    const map = new Map();
    for (const iss of issues) {
      if (!iss.start || !iss.due) continue;
      const start = new Date(iss.start + 'T00:00:00');
      const end = new Date(iss.due + 'T00:00:00');
      if (isNaN(start) || isNaN(end) || end < start) continue;
      const cur = new Date(start);
      while (cur <= end) {
        const k = isoDate(cur);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push({
          key: iss.key,
          summary: iss.summary,
          typeName: iss.typeName,
          parentKey: iss.parentKey,
          parentSummary: iss.parentSummary,
          hasRelates: iss.hasRelates,   // PT 用：是否已拆解
          isPlanningTask: isPlanningTask(iss),
        });
        cur.setDate(cur.getDate() + 1);
      }
    }
    return map;
  };

  const isoDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  return { buildJql, fetchAll, groupByPerson, dailyIssues, isoDate,
           groupByRoleAssignee, splitByPt, isPlanningTask };
})();
