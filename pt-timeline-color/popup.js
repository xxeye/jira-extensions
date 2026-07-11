// popup.js — 設定面板邏輯（chrome.storage.sync 持久化）
// 注意：「啟用 toggle」與「立即重新整理」已搬至頁面浮動 toolbar（floating_toolbar.js）

const DEFAULTS = {
  enabled:           true,
  ptColor:           '#6a9a23',
  msColor:           '#FF8B00',
  msDiamond:         true,
  msShowProgress:    true,
  ptLockDrag:        true,
  ptTargetEndShade:  false,
  epicStripe:        false,
  epicLockDrag:      true,
  hideCurrentMonth:  true,
  hideIssueKey:      false,
  showWeekends:      true,
  showHolidays:      true,
  showWorkingDays:   true,
  focusMode:         false,
};

const $ = (id) => document.getElementById(id);
const els = {
  pt:               $('pt-color'),
  ptText:           $('pt-color-text'),
  ms:               $('ms-color'),
  msText:           $('ms-color-text'),
  diamond:          $('ms-diamond'),
  msShowProgress:   $('ms-show-progress'),
  ptLockDrag:       $('pt-lock-drag'),
  ptTargetEndShade: $('pt-target-end-shade'),
  epicStripe:       $('epic-stripe'),
  epicLockDrag:     $('epic-lock-drag'),
  hideCurrentMonth: $('hide-current-month'),
  hideIssueKey:     $('hide-issue-key'),
  showWeekends:     $('show-weekends'),
  showHolidays:     $('show-holidays'),
  showWorkingDays:  $('show-working-days'),
  focusMode:        $('focus-mode'),
  reset:            $('reset'),
  status:           $('status'),
};

let saveTimer = null;
const showStatus = (msg) => {
  els.status.textContent = msg;
  els.status.classList.add('show');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => els.status.classList.remove('show'), 1500);
};

const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(v);

const load = async () => {
  const cfg = { ...DEFAULTS, ...await chrome.storage.sync.get(DEFAULTS) };
  els.pt.value      = cfg.ptColor;
  els.ptText.value  = cfg.ptColor;
  els.ms.value      = cfg.msColor;
  els.msText.value  = cfg.msColor;
  els.diamond.checked          = !!cfg.msDiamond;
  els.msShowProgress.checked   = !!cfg.msShowProgress;
  els.ptLockDrag.checked       = !!cfg.ptLockDrag;
  els.ptTargetEndShade.checked = !!cfg.ptTargetEndShade;
  els.epicStripe.checked       = !!cfg.epicStripe;
  els.epicLockDrag.checked     = !!cfg.epicLockDrag;
  els.hideCurrentMonth.checked = !!cfg.hideCurrentMonth;
  els.hideIssueKey.checked     = !!cfg.hideIssueKey;
  els.showWeekends.checked     = !!cfg.showWeekends;
  els.showHolidays.checked     = !!cfg.showHolidays;
  els.showWorkingDays.checked  = !!cfg.showWorkingDays;
  els.focusMode.checked        = !!cfg.focusMode;
};

const writeSettings = async () => {
  // 注意：enabled 不在這裡寫，由浮動 toolbar 管理（避免互相覆蓋）
  await chrome.storage.sync.set({
    ptColor:          els.pt.value,
    msColor:          els.ms.value,
    msDiamond:        els.diamond.checked,
    msShowProgress:   els.msShowProgress.checked,
    ptLockDrag:       els.ptLockDrag.checked,
    ptTargetEndShade: els.ptTargetEndShade.checked,
    epicStripe:       els.epicStripe.checked,
    epicLockDrag:     els.epicLockDrag.checked,
    hideCurrentMonth: els.hideCurrentMonth.checked,
    hideIssueKey:     els.hideIssueKey.checked,
    showWeekends:     els.showWeekends.checked,
    showHolidays:     els.showHolidays.checked,
    showWorkingDays:  els.showWorkingDays.checked,
    focusMode:        els.focusMode.checked,
  });
  showStatus('已儲存');
};

// debounce 寫入 — 拖色盤時 input 事件連發，直寫會撞 storage.sync 的
// MAX_WRITE_OPERATIONS_PER_MINUTE（120 次/分）配額，之後寫入靜默失敗
let saveDebounceTimer = null;
const save = () => {
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(writeSettings, 250);
};

// color picker → hex 同步
els.pt.addEventListener('input', () => { els.ptText.value = els.pt.value; save(); });
els.ms.addEventListener('input', () => { els.msText.value = els.ms.value; save(); });

// hex 文字 → color picker 同步
els.ptText.addEventListener('input', () => {
  const v = els.ptText.value.trim().toLowerCase();
  if (isHex(v)) { els.pt.value = v; save(); }
});
els.msText.addEventListener('input', () => {
  const v = els.msText.value.trim().toLowerCase();
  if (isHex(v)) { els.ms.value = v; save(); }
});

// Checkboxes are low-frequency writes. Do not debounce them: closing the popup
// destroys pending timers and would silently lose the final setting change.
els.diamond.addEventListener('change', writeSettings);
els.msShowProgress.addEventListener('change', writeSettings);
els.ptLockDrag.addEventListener('change', writeSettings);
els.ptTargetEndShade.addEventListener('change', writeSettings);
els.epicStripe.addEventListener('change', writeSettings);
els.epicLockDrag.addEventListener('change', writeSettings);
els.hideCurrentMonth.addEventListener('change', writeSettings);
els.hideIssueKey.addEventListener('change', writeSettings);
els.showWeekends.addEventListener('change', writeSettings);
els.showHolidays.addEventListener('change', writeSettings);
els.showWorkingDays.addEventListener('change', writeSettings);
els.focusMode.addEventListener('change', writeSettings);

els.reset.addEventListener('click', async () => {
  clearTimeout(saveDebounceTimer);   // 取消排隊中的舊值寫入，避免蓋掉 reset
  // enabled 由浮動 toolbar 管理 — reset 不能把使用者剛停用的狀態悄悄改回啟用
  const { enabled, ...rest } = DEFAULTS;
  await chrome.storage.sync.set(rest);
  await load();
  showStatus('已重設');
});

load();
