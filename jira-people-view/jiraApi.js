// jiraApi.js — Jira REST API（借用 session cookie + XSRF token）
// 此插件唯讀。基於 pt-timeline-color/jiraApi.js 擴充 searchByJql。

const JiraApi = (() => {
  const baseUrl = () => `${location.protocol}//${location.host}`;

  const getXsrfToken = () => {
    const m = document.cookie.match(/atlassian\.xsrf\.token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };

  const headers = () => ({
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  });

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // 單筆查詢（fallback；建議用 batch）
  const getIssue = async (key, fields = ['issuetype']) => {
    const url = `${baseUrl()}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields.join(',')}`;
    const res = await fetch(url, { credentials: 'include', headers: headers() });
    if (!res.ok) throw new Error(`getIssue ${key} → ${res.status}`);
    return res.json();
  };

  // 批次查詢：一次 N 筆，省 round trip
  // 用 /rest/api/3/search/jql（POST）— 新版 API
  const searchByKeys = async (keys, fields = ['issuetype']) => {
    if (!keys.length) return [];
    const jql = `key in (${keys.map(k => `"${k}"`).join(',')})`;
    const res = await fetch(`${baseUrl()}/rest/api/3/search/jql`, {
      method: 'POST',
      credentials: 'include',
      headers: headers(),
      body: JSON.stringify({ jql, fields, maxResults: keys.length }),
    });
    if (!res.ok) throw new Error(`searchByKeys → ${res.status}`);
    const data = await res.json();
    return data.issues || [];
  };

  // 任意 JQL（POST /rest/api/3/search/jql 新版 API），自動處理 nextPageToken 分頁
  const searchByJql = async (jql, fields, { pageSize = 100, pageLimit = 20 } = {}) => {
    const all = [];
    let nextPageToken = null;
    for (let i = 0; i < pageLimit; i++) {
      const body = { jql, fields, maxResults: pageSize };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      const res = await fetch(`${baseUrl()}/rest/api/3/search/jql`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`searchByJql → ${res.status}: ${await res.text()}`);
      const data = await res.json();
      all.push(...(data.issues || []));
      nextPageToken = data.nextPageToken;
      if (!nextPageToken || data.isLast) break;
    }
    return all;
  };

  return { getIssue, searchByKeys, searchByJql, sleep };
})();
