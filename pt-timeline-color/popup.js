// popup.js — 設定面板邏輯（chrome.storage.sync 持久化）
// 注意：「啟用 toggle」與「立即重新整理」已搬至頁面浮動 toolbar（floating_toolbar.js）

const DEFAULTS = {
  enabled:           true,
  ptColor:           '#6a9a23',
  msColor:           '#FF8B00',
  msDiamond:         false,
  msShowProgress:    false,
  epicStripe:        false,
  hideCurrentMonth:  false,
  showWeekends:      false,
  showHolidays:      false,
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
  epicStripe:       $('epic-stripe'),
  hideCurrentMonth: $('hide-current-month'),
  showWeekends:     $('show-weekends'),
  showHolidays:     $('show-holidays'),
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
  els.epicStripe.checked       = !!cfg.epicStripe;
  els.hideCurrentMonth.checked = !!cfg.hideCurrentMonth;
  els.showWeekends.checked     = !!cfg.showWeekends;
  els.showHolidays.checked     = !!cfg.showHolidays;
  els.focusMode.checked        = !!cfg.focusMode;
};

const save = async () => {
  // 注意：enabled 不在這裡寫，由浮動 toolbar 管理（避免互相覆蓋）
  await chrome.storage.sync.set({
    ptColor:          els.pt.value,
    msColor:          els.ms.value,
    msDiamond:        els.diamond.checked,
    msShowProgress:   els.msShowProgress.checked,
    epicStripe:       els.epicStripe.checked,
    hideCurrentMonth: els.hideCurrentMonth.checked,
    showWeekends:     els.showWeekends.checked,
    showHolidays:     els.showHolidays.checked,
    focusMode:        els.focusMode.checked,
  });
  showStatus('已儲存');
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

els.diamond.addEventListener('change', save);
els.msShowProgress.addEventListener('change', save);
els.epicStripe.addEventListener('change', save);
els.hideCurrentMonth.addEventListener('change', save);
els.showWeekends.addEventListener('change', save);
els.showHolidays.addEventListener('change', save);
els.focusMode.addEventListener('change', save);

els.reset.addEventListener('click', async () => {
  await chrome.storage.sync.set(DEFAULTS);
  await load();
  showStatus('已重設');
});

load();
