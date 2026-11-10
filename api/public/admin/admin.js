function resolvePublicBase() {
  const path = window.location.pathname || '';
  const match = path.match(/^(.*?)\/admin(?:\/.*)?$/);
  if (match) return match[1] || '';
  const host = (window.location.hostname || '').replace(/^www\./, '');
  if (host === 'khisedigital.info') return '/kdspozr';
  return '';
}

const BASE = resolvePublicBase();
const API = `${BASE}/api/v1/platform`;

function loadSession() {
  try {
    const raw = localStorage.getItem('platformAdminSession') || sessionStorage.getItem('platformKey');
    if (!raw) return { username: '', password: '' };
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw);
      return {
        username: parsed.username || '',
        password: parsed.password || '',
      };
    }
    // Legacy: password-only sessionStorage key
    return { username: '', password: raw };
  } catch {
    return { username: '', password: '' };
  }
}

function saveSession(username, password) {
  localStorage.setItem('platformAdminSession', JSON.stringify({ username, password }));
  sessionStorage.removeItem('platformKey');
}

function clearSession() {
  localStorage.removeItem('platformAdminSession');
  sessionStorage.removeItem('platformKey');
}

let session = loadSession();
let platformUser = session.username;
let platformKey = session.password;
let tenants = [];
let plans = [];
let products = [];
let units = [];
let businessTypes = [];
let masterCategories = [];
let masterBrands = [];
let masterProducts = [];
let selectedCatalogTab = sessionStorage.getItem('catalogTab') || 'products';
let selectedCatalogBusinessTypeId = sessionStorage.getItem('catalogBusinessTypeId') || '';
// Clear stale Kirana-only product filter so Clothing/Gifting catalogs are visible.
if (sessionStorage.getItem('catalogFilterVersion') !== '3') {
  sessionStorage.setItem('catalogFilterVersion', '3');
  // Prefer products view in the redesigned catalog.
  if (selectedCatalogTab === 'types' || !selectedCatalogTab) selectedCatalogTab = 'products';
  sessionStorage.setItem('catalogTab', selectedCatalogTab);
}
let selectedSubTab = sessionStorage.getItem('subTab') || 'plans';
let selectedTenantId = '';
let catalogMeta = null;
let priceEditMode = false;
let selectedProductIds = new Set();

const PRODUCT_TABLE_COLS = 12;

const $ = (id) => document.getElementById(id);

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const tablePaging = {};

function ensureTablePager(tbodyId) {
  const tbody = $(tbodyId);
  if (!tbody) return null;
  const table = tbody.closest('table');
  const wrap = tbody.closest('.table-wrap') || table?.parentElement || tbody.parentElement;
  if (!wrap || !wrap.parentElement) return null;
  let pager = wrap.parentElement.querySelector(`[data-pager-for="${tbodyId}"]`);
  if (!pager) {
    pager = document.createElement('div');
    pager.className = 'table-pager';
    pager.dataset.pagerFor = tbodyId;
    wrap.insertAdjacentElement('afterend', pager);
  }
  return pager;
}

function clearTablePager(tbodyId) {
  const pager = document.querySelector(`[data-pager-for="${tbodyId}"]`);
  if (pager) pager.innerHTML = '';
}

/**
 * Client-side pagination for admin tables.
 * @param {string} key stable key for page state
 * @param {object} opts
 */
function renderPagedTable(key, opts) {
  const tbodyId = opts.tbodyId;
  const rows = opts.rows || [];
  const pageSize = opts.pageSize || PAGE_SIZE_DEFAULT;
  const colspan = opts.colspan || 6;
  const emptyHtml = opts.emptyHtml || `<tr><td colspan="${colspan}" class="empty">No data</td></tr>`;
  const renderRow = opts.renderRow;
  const resetPage = !!opts.resetPage;

  const tbody = $(tbodyId);
  if (!tbody) return;

  if (!tablePaging[key] || resetPage) {
    tablePaging[key] = {
      page: 1,
      pageSize,
      tbodyId,
      rows,
      colspan,
      emptyHtml,
      renderRow,
    };
  } else {
    const prev = tablePaging[key];
    tablePaging[key] = {
      ...prev,
      pageSize: prev.pageSize || pageSize,
      tbodyId,
      rows,
      colspan,
      emptyHtml,
      renderRow,
    };
  }

  const state = tablePaging[key];
  if (!rows.length) {
    tbody.innerHTML = emptyHtml;
    clearTablePager(tbodyId);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;
  if (state.page < 1) state.page = 1;

  const start = (state.page - 1) * state.pageSize;
  const slice = rows.slice(start, start + state.pageSize);
  tbody.innerHTML = slice.map(renderRow).join('');
  enhanceAdminUi(tbody);

  const pager = ensureTablePager(tbodyId);
  if (!pager) return;

  const from = start + 1;
  const to = Math.min(start + state.pageSize, rows.length);
  pager.innerHTML = `
    <div class="pager-info">Showing ${from}–${to} of ${rows.length}</div>
    <div class="pager-controls">
      <label>Per page
        <select data-pager-size>
          ${PAGE_SIZE_OPTIONS.map((n) =>
            `<option value="${n}" ${n === state.pageSize ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="secondary" data-pager-prev title="Previous page" ${state.page <= 1 ? 'disabled' : ''}>Prev</button>
      <span class="pager-page">Page ${state.page} / ${totalPages}</span>
      <button type="button" class="secondary" data-pager-next title="Next page" ${state.page >= totalPages ? 'disabled' : ''}>Next</button>
    </div>
  `;

  const prevBtn = pager.querySelector('[data-pager-prev]');
  const nextBtn = pager.querySelector('[data-pager-next]');
  const sizeSel = pager.querySelector('[data-pager-size]');
  if (prevBtn) {
    prevBtn.onclick = () => {
      state.page -= 1;
      renderPagedTable(key, state);
    };
  }
  if (nextBtn) {
    nextBtn.onclick = () => {
      state.page += 1;
      renderPagedTable(key, state);
    };
  }
  if (sizeSel) {
    sizeSel.onchange = (e) => {
      state.pageSize = Number(e.target.value) || PAGE_SIZE_DEFAULT;
      state.page = 1;
      renderPagedTable(key, state);
    };
  }
}

function showAlert(msg, type = 'success') {
  const el = $('globalAlert');
  el.textContent = msg;
  el.className = `alert ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-platform-key': platformKey,
      ...(platformUser ? { 'x-platform-user': platformUser } : {}),
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      clearSession();
      platformKey = '';
      platformUser = '';
      throw new Error('Invalid username or password. Use PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD from api/.env.');
    }
    throw new Error(json.error?.message || res.statusText || 'Request failed');
  }
  return json.data;
}

function badge(status) {
  return `<span class="badge ${status}">${status}</span>`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}

function toInputDate(d) {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Inline SVG icons — no external font dependency */
const ACTION_ICONS = {
  edit: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  delete: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
  manage: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>',
  key: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M11 12l9-9 3 3-2 2-2-2-2 2"/><circle cx="7.5" cy="15.5" r="1.5" fill="currentColor" stroke="none"/></svg>',
  box: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg>',
};

/** Compact icon action button for table rows */
function actionIconFor(action, icon) {
  if (icon && ACTION_ICONS[icon]) return ACTION_ICONS[icon];
  if (String(action).includes('delete')) return ACTION_ICONS.delete;
  if (String(action).includes('reset') || String(action).includes('password')) return ACTION_ICONS.key;
  if (String(action) === 'tenant-products') return ACTION_ICONS.box;
  return ACTION_ICONS.edit;
}

function actionBtn(action, id, { icon, title, danger = false, disabled = false } = {}) {
  const cls = danger ? 'icon-btn danger' : 'icon-btn secondary';
  const svg = actionIconFor(action, icon);
  return `<button type="button" class="${cls}" data-action="${esc(action)}" data-id="${esc(id)}" title="${esc(title || '')}" aria-label="${esc(title || '')}" ${disabled ? 'disabled' : ''}>${svg}</button>`;
}

function rowActions(...buttons) {
  return `<div class="row-actions">${buttons.join('')}</div>`;
}

/** Ensure every button has a hover tooltip (title). */
function ensureButtonTitles(root = document) {
  root.querySelectorAll('button').forEach((btn) => {
    if (btn.getAttribute('title')) return;
    if (btn.classList.contains('ss-trigger') || btn.classList.contains('ss-option')) return;
    const label = (btn.getAttribute('aria-label') || btn.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (label) btn.setAttribute('title', label);
  });
}

/**
 * Compact searchable dropdown for <select>.
 * Keeps the native select in sync so existing $('id').value code still works.
 */
function enhanceSearchableSelect(selectEl) {
  if (!selectEl || selectEl.tagName !== 'SELECT') return;
  if (selectEl.hasAttribute('data-pager-size') || selectEl.closest('[data-pager-size]')) return;
  if (selectEl.classList.contains('hidden') || selectEl.getAttribute('aria-hidden') === 'true') return;
  if (selectEl.multiple) return;

  if (selectEl._ssApi) {
    selectEl._ssApi.refresh();
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'ss-wrap';
  selectEl.parentNode.insertBefore(wrap, selectEl);
  wrap.appendChild(selectEl);
  selectEl.classList.add('ss-native');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ss-trigger';
  trigger.innerHTML = '<span class="ss-trigger-label"></span><span class="ss-trigger-caret" aria-hidden="true">▾</span>';
  const labelEl = trigger.querySelector('.ss-trigger-label');

  const panel = document.createElement('div');
  panel.className = 'ss-panel';
  panel.innerHTML = `
    <input type="search" class="ss-search" placeholder="Search..." autocomplete="off" />
    <div class="ss-options" role="listbox"></div>
  `;
  const searchInput = panel.querySelector('.ss-search');
  const optionsEl = panel.querySelector('.ss-options');

  wrap.appendChild(trigger);
  wrap.appendChild(panel);

  let open = false;

  function selectedText() {
    const opt = selectEl.options[selectEl.selectedIndex];
    return opt ? opt.textContent : (selectEl.getAttribute('data-placeholder') || 'Select...');
  }

  function syncTrigger() {
    labelEl.textContent = selectedText();
    trigger.disabled = !!selectEl.disabled;
    trigger.title = labelEl.textContent;
  }

  function close() {
    open = false;
    wrap.classList.remove('open');
    searchInput.value = '';
  }

  function renderOptions(filter = '') {
    const q = filter.trim().toLowerCase();
    const opts = [...selectEl.options];
    const matched = opts.filter((o) => !q || o.textContent.toLowerCase().includes(q));
    if (!matched.length) {
      optionsEl.innerHTML = '<div class="ss-empty">No matches</div>';
      return;
    }
    optionsEl.innerHTML = matched.map((o) => {
      const selected = o.value === selectEl.value;
      return `<button type="button" class="ss-option${selected ? ' active' : ''}" role="option" data-value="${esc(o.value)}" aria-selected="${selected ? 'true' : 'false'}" title="${esc(o.textContent)}">${esc(o.textContent)}</button>`;
    }).join('');
  }

  function openPanel() {
    if (selectEl.disabled) return;
    document.querySelectorAll('.ss-wrap.open').forEach((w) => {
      if (w !== wrap) w.classList.remove('open');
    });
    open = true;
    wrap.classList.add('open');
    renderOptions('');
    searchInput.focus();
  }

  function pick(value) {
    if (selectEl.value !== value) {
      selectEl.value = value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      selectEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    syncTrigger();
    close();
  }

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    if (open) close();
    else openPanel();
  });

  searchInput.addEventListener('input', () => renderOptions(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      trigger.focus();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = optionsEl.querySelector('.ss-option');
      if (first) pick(first.getAttribute('data-value') || '');
    }
  });

  optionsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.ss-option');
    if (!btn) return;
    pick(btn.getAttribute('data-value') || '');
  });

  function onDocPointer(e) {
    if (!open) return;
    if (!wrap.contains(e.target)) close();
  }
  document.addEventListener('mousedown', onDocPointer);

  const mo = new MutationObserver(() => {
    syncTrigger();
    if (open) renderOptions(searchInput.value);
  });
  mo.observe(selectEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

  selectEl.addEventListener('change', syncTrigger);

  selectEl._ssApi = {
    refresh() {
      syncTrigger();
      if (open) renderOptions(searchInput.value);
    },
    destroy() {
      document.removeEventListener('mousedown', onDocPointer);
      mo.disconnect();
      wrap.parentNode.insertBefore(selectEl, wrap);
      selectEl.classList.remove('ss-native');
      wrap.remove();
      delete selectEl._ssApi;
    },
  };

  syncTrigger();
}

function enhanceSearchableSelects(root = document) {
  root.querySelectorAll('select').forEach((sel) => enhanceSearchableSelect(sel));
}

function enhanceAdminUi(root = document) {
  enhanceSearchableSelects(root);
  ensureButtonTitles(root);
}

function inlineLoadingHtml(message = 'Loading…', block = false) {
  const cls = block ? 'inline-loading block' : 'inline-loading';
  return `<div class="${cls}" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>${esc(message)}</span></div>`;
}

function setButtonLoading(btn, loading, loadingLabel) {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.idleText) btn.dataset.idleText = btn.textContent;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.textContent = loadingLabel || 'Please wait…';
  } else {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    if (btn.dataset.idleText) {
      btn.textContent = btn.dataset.idleText;
      delete btn.dataset.idleText;
    }
  }
}

function getPlanById(id) {
  return plans.find((p) => p.id === id);
}

function activePlans() {
  return plans.filter((p) => p.status === 'active');
}

function planOptionsHtml(selectedId) {
  return activePlans()
    .map((p) => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${p.name} (${p.code})</option>`)
    .join('');
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function computeEndDatePreview(plan, subscriptionYears) {
  if (!plan) return '';
  const now = new Date();
  if (plan.isTrial) {
    return `Trial ends: ${fmtDate(addDays(now, plan.trialDays))} (${plan.trialDays} days)`;
  }
  const years = Number(subscriptionYears);
  if (!years) return 'Enter subscription years';
  return `Subscription ends: ${fmtDate(addYears(now, years))}`;
}

function bindPlanFields(prefix, initialYears) {
  const planSel = $(`${prefix}_planId`);
  const yearsWrap = $(`${prefix}_yearsWrap`);
  const yearsInput = $(`${prefix}_subscriptionYears`);
  const preview = $(`${prefix}_endPreview`);
  const limits = $(`${prefix}_limits`);

  function refresh() {
    const plan = getPlanById(planSel.value);
    if (!plan) {
      yearsWrap.classList.add('hidden');
      preview.textContent = '';
      limits.textContent = '';
      return;
    }
    limits.textContent = `Limits: ${plan.maxBranches} branches, ${plan.maxUsers} users`;
    if (plan.isTrial) {
      yearsWrap.classList.add('hidden');
      preview.textContent = computeEndDatePreview(plan);
    } else {
      yearsWrap.classList.remove('hidden');
      if (!yearsInput.value) yearsInput.value = initialYears || 1;
      preview.textContent = computeEndDatePreview(plan, yearsInput.value);
    }
  }

  planSel.onchange = refresh;
  if (yearsInput) yearsInput.oninput = () => {
    preview.textContent = computeEndDatePreview(getPlanById(planSel.value), yearsInput.value);
  };
  refresh();
}

function openModal(title, bodyHtml, onSave, options = {}) {
  const root = $('modalRoot');
  root.className = 'modal-backdrop';
  const saveLabel = options.saveLabel || 'Save';
  root.innerHTML = `
    <div class="modal ${options.wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>${title}</h3>
        <button type="button" class="modal-close" id="modalClose" title="Close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body" id="modalBody">
        <div id="modalAlert" class="alert error hidden" style="margin:0 0 12px"></div>
        ${bodyHtml}
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary" id="modalCancel" title="Cancel and close">Cancel</button>
        <button type="button" id="modalSave" title="${esc(saveLabel)}">${saveLabel}</button>
      </div>
    </div>`;
  const close = () => {
    root.className = 'hidden';
    root.innerHTML = '';
  };
  const showModalError = (msg) => {
    const el = $('modalAlert');
    if (!el) {
      showAlert(msg, 'error');
      return;
    }
    el.textContent = msg || 'Something went wrong';
    el.classList.remove('hidden');
    el.scrollIntoView({ block: 'nearest' });
  };
  $('modalCancel').onclick = close;
  $('modalClose').onclick = close;
  enhanceAdminUi(root);
  root.onclick = (e) => {
    if (e.target === root) close();
  };
  $('modalSave').onclick = async () => {
    const saveBtn = $('modalSave');
    const cancelBtn = $('modalCancel');
    const closeBtn = $('modalClose');
    const alertEl = $('modalAlert');
    if (alertEl) {
      alertEl.classList.add('hidden');
      alertEl.textContent = '';
    }
    const loadingLabel = options.loadingLabel || `${saveLabel}…`;
    setButtonLoading(saveBtn, true, loadingLabel);
    if (cancelBtn) cancelBtn.disabled = true;
    if (closeBtn) closeBtn.disabled = true;
    try {
      await onSave();
      close();
    } catch (e) {
      showModalError(e.message || 'Request failed');
    } finally {
      setButtonLoading(saveBtn, false);
      if (cancelBtn) cancelBtn.disabled = false;
      if (closeBtn) closeBtn.disabled = false;
    }
  };
}

function daysUntil(date) {
  if (!date) return null;
  const end = new Date(date);
  const now = new Date();
  end.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.round((end - now) / 86400000);
}

function subscriptionEndDate(t) {
  return t.isTrialPlan ? t.trialEndsAt : t.subscriptionEndsAt;
}

function attentionBadge(t) {
  const end = subscriptionEndDate(t);
  const days = daysUntil(end);
  if (days == null) return '<span class="badge inactive">no end date</span>';
  if (days < 0) return `<span class="badge expired">expired ${Math.abs(days)}d</span>`;
  if (days <= 30) return `<span class="badge expiring">${days}d left</span>`;
  return `<span class="days-left">${days}d left</span>`;
}

async function login(options = {}) {
  const silent = options.silent === true;
  platformUser = ($('adminUsername')?.value || platformUser || '').trim();
  platformKey = ($('adminPassword')?.value || platformKey || '').trim();
  if (!platformUser || !platformKey) {
    document.documentElement.classList.remove('has-admin-session');
    $('loginView').classList.remove('hidden');
    $('appView').classList.add('hidden');
    $('loginError').textContent = 'Enter username and password from the server api/.env';
    $('loginError').classList.remove('hidden');
    return;
  }
  $('loginError').classList.add('hidden');

  // Show app immediately when restoring a session so refresh does not flash login.
  if (silent || document.documentElement.classList.contains('has-admin-session')) {
    document.documentElement.classList.add('has-admin-session');
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    if ($('adminEmail') && !$('adminEmail').textContent) {
      $('adminEmail').textContent = platformUser;
    }
  }

  const btn = $('loginBtn');
  if (btn && !silent) {
    btn.disabled = true;
    btn.textContent = 'Signing in…';
  }
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: platformUser, password: platformKey }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error?.message || 'Invalid username or password');
    }
    const data = json.data || {};
    saveSession(platformUser, platformKey);
    document.documentElement.classList.add('has-admin-session');
    $('adminEmail').textContent = data.email || platformUser;
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    // Restore last tab immediately so refresh never flashes/resets to dashboard.
    switchTab(getSavedTab(), true);
    try {
      await Promise.all([loadDashboard(), loadPlans(), loadBusinessTypes(), loadUnits(), loadTenants()]);
      // Re-apply after loads in case a loader toggled UI; never force dashboard.
      switchTab(getSavedTab(), true);
    } catch (loadErr) {
      showAlert(loadErr.message || 'Signed in, but some data failed to load', 'error');
      switchTab(getSavedTab(), true);
    }
  } catch (e) {
    clearSession();
    document.documentElement.classList.remove('has-admin-session');
    platformKey = '';
    platformUser = '';
    $('loginView').classList.remove('hidden');
    $('appView').classList.add('hidden');
    $('loginError').textContent = e.message;
    $('loginError').classList.remove('hidden');
  } finally {
    if (btn && !silent) {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  }
}

function fillStatusFilters(statuses) {
  ['tenantStatusFilter', 'subStatusFilter'].forEach((id) => {
    const statusSel = $(id);
    if (!statusSel) return;
    const cur = statusSel.value;
    const existing = new Set([...statusSel.options].map((o) => o.value));
    (statuses || []).forEach((s) => {
      if (!existing.has(s)) statusSel.innerHTML += `<option value="${s}">${s}</option>`;
    });
    if (cur) statusSel.value = cur;
  });
}

async function loadDashboard() {
  const data = await api('/dashboard');
  if (!tenants.length) {
    try { tenants = await api('/tenants'); } catch (_) { /* ignore */ }
  }
  const activePlansCount = plans.filter((p) => p.status === 'active').length;
  const attention = tenants.filter((t) => {
    if (t.status === 'deleted') return false;
    const days = daysUntil(subscriptionEndDate(t));
    return days != null && days <= 30;
  }).sort((a, b) => (daysUntil(subscriptionEndDate(a)) ?? 999) - (daysUntil(subscriptionEndDate(b)) ?? 999));

  $('statsGrid').innerHTML = `
    <div class="stat"><div class="lbl">Total clients</div><div class="num">${data.totalTenants}</div></div>
    ${Object.entries(data.byStatus || {}).map(([k, v]) => `<div class="stat"><div class="lbl">${k}</div><div class="num">${v}</div></div>`).join('')}
    <div class="stat"><div class="lbl">Active plans</div><div class="num">${activePlansCount || Object.keys(data.byPlan || {}).length}</div></div>
    <div class="stat"><div class="lbl">Need attention</div><div class="num">${attention.length}</div></div>
  `;
  fillStatusFilters(data.statuses);

  const tbody = $('dashboardExpiringTable');
  if (!tbody) return;
  renderPagedTable('dashboardExpiring', {
    tbodyId: 'dashboardExpiringTable',
    rows: attention,
    pageSize: 10,
    colspan: 6,
    resetPage: true,
    emptyHtml: '<tr><td colspan="6" class="empty">No expiring or expired subscriptions</td></tr>',
    renderRow: (t) => `
      <tr>
        <td><strong>${esc(t.name)}</strong><br><small class="type-code">${esc(t.slug)}</small></td>
        <td>${badge(t.status)}</td>
        <td>${esc(t.planName || '—')}</td>
        <td>${fmtDate(subscriptionEndDate(t))}</td>
        <td>${attentionBadge(t)}</td>
        <td>${rowActions(
          actionBtn('edit-tenant', t.id, { icon: 'manage', title: 'Manage' }),
        )}</td>
      </tr>`,
  });
}

function switchSubTab(tab, persist = true) {
  selectedSubTab = tab === 'client-subs' ? 'client-subs' : 'plans';
  if (persist) sessionStorage.setItem('subTab', selectedSubTab);
  document.querySelectorAll('.sub-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.subTab === selectedSubTab);
  });
  const plansPanel = $('sub-panel-plans');
  const clientsPanel = $('sub-panel-client-subs');
  if (plansPanel) plansPanel.classList.toggle('hidden', selectedSubTab !== 'plans');
  if (clientsPanel) clientsPanel.classList.toggle('hidden', selectedSubTab !== 'client-subs');
  if (selectedSubTab === 'plans') loadPlans();
  if (selectedSubTab === 'client-subs') loadClientSubscriptions();
}

async function loadClientSubscriptions() {
  const params = new URLSearchParams();
  const search = $('subClientSearch')?.value?.trim();
  const status = $('subStatusFilter')?.value;
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  const rows = await api(`/tenants?${params.toString()}`);
  const tbody = $('clientSubsTable');
  const summary = $('subsSummary');
  if (!tbody) return;

  let active = 0, trial = 0, expiring = 0, expired = 0;
  rows.forEach((t) => {
    if (t.status === 'active') active += 1;
    if (t.status === 'trial') trial += 1;
    const days = daysUntil(subscriptionEndDate(t));
    if (days != null && days < 0) expired += 1;
    else if (days != null && days <= 30) expiring += 1;
  });
  if (summary) {
    summary.innerHTML = `
      <div class="subs-stat"><div class="lbl">Clients</div><div class="num">${rows.length}</div></div>
      <div class="subs-stat ok"><div class="lbl">Active</div><div class="num">${active}</div></div>
      <div class="subs-stat"><div class="lbl">Trial</div><div class="num">${trial}</div></div>
      <div class="subs-stat warn"><div class="lbl">Expiring ≤30d</div><div class="num">${expiring}</div></div>
      <div class="subs-stat bad"><div class="lbl">Expired</div><div class="num">${expired}</div></div>
    `;
  }

  renderPagedTable('clientSubs', {
    tbodyId: 'clientSubsTable',
    rows,
    colspan: 8,
    resetPage: true,
    emptyHtml: '<tr><td colspan="8" class="empty">No clients found</td></tr>',
    renderRow: (t) => {
    const days = daysUntil(subscriptionEndDate(t));
    let daysClass = '';
    let daysLabel = '—';
    if (days != null) {
      if (days < 0) { daysClass = 'bad'; daysLabel = `Expired ${Math.abs(days)}d`; }
      else if (days <= 30) { daysClass = 'warn'; daysLabel = `${days}d left`; }
      else { daysClass = 'ok'; daysLabel = `${days}d left`; }
    }
    return `
      <tr>
        <td><strong>${esc(t.name)}</strong><br><small class="type-code">${esc(t.slug)}</small></td>
        <td>${badge(t.status)}</td>
        <td>${esc(t.planName || '—')}<br><small style="color:var(--muted)">${t.maxBranches} br / ${t.maxUsers} users</small></td>
        <td>${t.subscriptionYears || '—'}</td>
        <td>${fmtDate(t.trialEndsAt)}</td>
        <td>${fmtDate(t.subscriptionEndsAt)}</td>
        <td><span class="days-pill ${daysClass}">${daysLabel}</span><br>${attentionBadge(t)}</td>
        <td>
            ${rowActions(
              actionBtn('edit-tenant', t.id, { icon: 'manage', title: 'Manage' }),
            )}
        </td>
      </tr>`;
  },
  });
}

async function loadPlans() {
  plans = await api('/plans');
  const grid = $('plansGrid');
  const summary = $('plansSummary');
  const active = plans.filter((p) => p.status === 'active').length;
  const trial = plans.filter((p) => p.isTrial).length;
  const paid = plans.filter((p) => !p.isTrial).length;
  if (summary) {
    summary.innerHTML = `
      <div class="subs-stat"><div class="lbl">Total plans</div><div class="num">${plans.length}</div></div>
      <div class="subs-stat ok"><div class="lbl">Active</div><div class="num">${active}</div></div>
      <div class="subs-stat"><div class="lbl">Trial</div><div class="num">${trial}</div></div>
      <div class="subs-stat"><div class="lbl">Paid</div><div class="num">${paid}</div></div>
    `;
  }
  if (grid) {
    if (!plans.length) {
      grid.innerHTML = '<div class="plans-empty">No plans yet. Create a trial or paid plan to get started.</div>';
    } else {
      grid.innerHTML = plans.map((p) => `
        <article class="plan-card ${p.isTrial ? 'trial' : 'paid'} ${p.status !== 'active' ? 'inactive' : ''}">
          <div class="plan-card-top">
            <div>
              <h3>${esc(p.name)}</h3>
              <span class="type-code">${esc(p.code)}</span>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
              <span class="plan-type-pill ${p.isTrial ? 'trial' : 'paid'}">${p.isTrial ? 'Trial' : 'Paid'}</span>
              ${badge(p.status)}
            </div>
          </div>
          <p class="desc">${esc(p.description || (p.isTrial ? `${p.trialDays || 0}-day trial plan` : 'Paid subscription plan'))}</p>
          <div class="plan-meta">
            <div class="meta-item"><span>Branches</span><strong>${p.maxBranches}</strong></div>
            <div class="meta-item"><span>Users</span><strong>${p.maxUsers}</strong></div>
            <div class="meta-item"><span>Trial days</span><strong>${p.isTrial ? (p.trialDays || 0) : '—'}</strong></div>
            <div class="meta-item"><span>Sort</span><strong>${p.sortOrder ?? 0}</strong></div>
          </div>
          <div class="plan-card-actions">
            ${rowActions(
              actionBtn('edit-plan', p.id, { icon: 'edit', title: 'Edit' }),
              actionBtn('delete-plan', p.id, { icon: 'delete', title: 'Delete', danger: true }),
            )}
          </div>
        </article>`).join('');
    }
  }
  if ($('plansTable')) {
    renderPagedTable('plans', {
      tbodyId: 'plansTable',
      rows: plans,
      colspan: 7,
      resetPage: true,
      emptyHtml: '<tr><td colspan="7" class="empty">No plans yet. Create one.</td></tr>',
      renderRow: (p) => `
        <tr>
          <td><strong>${esc(p.name)}</strong><br><small style="color:var(--muted)"><code>${esc(p.code)}</code></small></td>
          <td>${p.maxBranches}</td>
          <td>${p.maxUsers}</td>
          <td>${p.isTrial ? 'Trial' : 'Paid'}</td>
          <td>${p.isTrial ? p.trialDays : '—'}</td>
          <td>${badge(p.status)}</td>
          <td>
            ${rowActions(
              actionBtn('edit-plan', p.id, { icon: 'edit', title: 'Edit' }),
              actionBtn('delete-plan', p.id, { icon: 'delete', title: 'Delete', danger: true }),
            )}
          </td>
        </tr>`,
    });
  }
  const planSel = $('tenantPlanFilter');
  if (planSel) {
    const cur = planSel.value;
    planSel.innerHTML = '<option value="">All plans</option>' +
      plans.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    if (cur) planSel.value = cur;
    enhanceSearchableSelect(planSel);
  }
}

function createPlanModal() {
  openModal('New subscription plan', `
    <div class="grid-2">
      <div class="field"><label>Plan name *</label><input id="pl_name" /></div>
      <div class="field"><label>Code *</label><input id="pl_code" placeholder="basic" /></div>
      <div class="field"><label>Max branches</label><input id="pl_maxBranches" type="number" value="1" /></div>
      <div class="field"><label>Max users</label><input id="pl_maxUsers" type="number" value="5" /></div>
      <div class="field"><label>Sort order</label><input id="pl_sortOrder" type="number" value="0" /></div>
      <div class="field"><label>Status</label><select id="pl_status"><option value="active">active</option><option value="inactive">inactive</option></select></div>
    </div>
    <div class="field"><label>Description</label><textarea id="pl_description" rows="2"></textarea></div>
    <div class="field"><label><input type="checkbox" id="pl_isTrial" /> Trial plan</label></div>
    <div class="field hidden" id="pl_trialWrap"><label>Trial days *</label><input id="pl_trialDays" type="number" value="14" /></div>
  `, async () => {
    const isTrial = $('pl_isTrial').checked;
    await api('/plans', {
      method: 'POST',
      body: JSON.stringify({
        name: $('pl_name').value.trim(),
        code: $('pl_code').value.trim(),
        description: $('pl_description').value.trim() || undefined,
        maxBranches: Number($('pl_maxBranches').value) || 1,
        maxUsers: Number($('pl_maxUsers').value) || 5,
        isTrial,
        trialDays: isTrial ? Number($('pl_trialDays').value) : undefined,
        status: $('pl_status').value,
        sortOrder: Number($('pl_sortOrder').value) || 0,
      }),
    });
    showAlert('Plan created');
    await loadPlans();
    await loadDashboard();
  });
  const trialCb = $('pl_isTrial');
  const trialWrap = $('pl_trialWrap');
  trialCb.onchange = () => {
    trialWrap.classList.toggle('hidden', !trialCb.checked);
  };
  trialCb.onchange();
}

function editPlan(id) {
  const p = plans.find((x) => x.id === id);
  if (!p) return;
  openModal('Edit subscription plan', `
    <div class="grid-2">
      <div class="field"><label>Plan name *</label><input id="pl_name" value="${p.name}" /></div>
      <div class="field"><label>Code *</label><input id="pl_code" value="${p.code}" /></div>
      <div class="field"><label>Max branches</label><input id="pl_maxBranches" type="number" value="${p.maxBranches}" /></div>
      <div class="field"><label>Max users</label><input id="pl_maxUsers" type="number" value="${p.maxUsers}" /></div>
      <div class="field"><label>Sort order</label><input id="pl_sortOrder" type="number" value="${p.sortOrder}" /></div>
      <div class="field"><label>Status</label><select id="pl_status"><option value="active" ${p.status === 'active' ? 'selected' : ''}>active</option><option value="inactive" ${p.status === 'inactive' ? 'selected' : ''}>inactive</option></select></div>
    </div>
    <div class="field"><label>Description</label><textarea id="pl_description" rows="2">${p.description || ''}</textarea></div>
    <div class="field"><label><input type="checkbox" id="pl_isTrial" ${p.isTrial ? 'checked' : ''} /> Trial plan</label></div>
    <div class="field hidden" id="pl_trialWrap"><label>Trial days *</label><input id="pl_trialDays" type="number" value="${p.trialDays || 14}" /></div>
  `, async () => {
    const isTrial = $('pl_isTrial').checked;
    await api(`/plans/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: $('pl_name').value.trim(),
        code: $('pl_code').value.trim(),
        description: $('pl_description').value.trim() || null,
        maxBranches: Number($('pl_maxBranches').value),
        maxUsers: Number($('pl_maxUsers').value),
        isTrial,
        trialDays: isTrial ? Number($('pl_trialDays').value) : null,
        status: $('pl_status').value,
        sortOrder: Number($('pl_sortOrder').value),
      }),
    });
    showAlert('Plan updated');
    await loadPlans();
    await loadDashboard();
  });
  const trialCb = $('pl_isTrial');
  const trialWrap = $('pl_trialWrap');
  trialCb.onchange = () => {
    trialWrap.classList.toggle('hidden', !trialCb.checked);
  };
  trialCb.onchange();
}

async function deletePlan(id) {
  const p = plans.find((x) => x.id === id);
  if (!p || !confirm(`Delete plan "${p.name}"?`)) return;
  const result = await api(`/plans/${id}`, { method: 'DELETE' });
  showAlert(result.message || 'Plan deleted');
  await loadPlans();
  await loadDashboard();
}

function activeBusinessTypes() {
  return businessTypes.filter((b) => b.status === 'active');
}

function businessTypeOptionsHtml(selectedId, emptyLabel = '— None —') {
  const opts = emptyLabel ? `<option value="">${emptyLabel}</option>` : '';
  return opts + activeBusinessTypes()
    .map((b) => `<option value="${b.id}" ${b.id === selectedId ? 'selected' : ''}>${esc(b.name)} (${esc(b.code)})</option>`)
    .join('');
}

function getBusinessTypeById(id) {
  return businessTypes.find((b) => b.id === id);
}

function fillBusinessTypeSelects() {
  const selects = [
    ['catalogBusinessTypeSelect', 'Select business type...'],
    ['catalogBrandTypeSelect', 'Select business type...'],
    ['catalogProductTypeSelect', 'Select business type...'],
  ];
  for (const [id] of selects) {
    const el = $(id);
    if (!el) continue;
    el.innerHTML = '<option value="">Select business type...</option>' +
      businessTypes.map((b) => `<option value="${b.id}">${esc(b.name)} (${esc(b.code)}) — ${b.productCount ?? 0} products</option>`).join('');
    if (selectedCatalogBusinessTypeId && businessTypes.some((b) => b.id === selectedCatalogBusinessTypeId)) {
      el.value = selectedCatalogBusinessTypeId;
    } else {
      el.value = '';
    }
  }
}

function getCatalogBusinessTypeId() {
  return selectedCatalogBusinessTypeId
    || $('catalogBusinessTypeSelect')?.value
    || $('catalogBrandTypeSelect')?.value
    || $('catalogProductTypeSelect')?.value
    || '';
}

function saveCatalogState() {
  sessionStorage.setItem('catalogTab', selectedCatalogTab);
  if (selectedCatalogBusinessTypeId) {
    sessionStorage.setItem('catalogBusinessTypeId', selectedCatalogBusinessTypeId);
  } else {
    sessionStorage.removeItem('catalogBusinessTypeId');
  }
}

function syncHiddenCatalogSelects() {
  ['catalogBusinessTypeSelect', 'catalogBrandTypeSelect', 'catalogProductTypeSelect'].forEach((id) => {
    const el = $(id);
    if (el) el.value = selectedCatalogBusinessTypeId || '';
  });
}

function updateCatalogContext() {
  const bt = getBusinessTypeById(selectedCatalogBusinessTypeId);
  const title = $('catalogContextTitle');
  const desc = $('catalogContextDesc');
  const stats = $('catalogContextStats');
  const actions = $('catalogContextActions');
  const body = $('catalogWorkspaceBody');
  const empty = $('catalogEmptyState');

  if (!bt) {
    if (title) title.textContent = 'Select a shop type';
    if (desc) {
      desc.textContent = businessTypes.length
        ? 'Choose a business type on the left to manage its categories, brands, and product templates.'
        : 'Create your first business type to start building the master catalog.';
    }
    if (stats) {
      stats.classList.add('hidden');
      stats.innerHTML = '';
    }
    if (actions) actions.classList.add('hidden');
    if (body) body.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
    if ($('createMasterCategoryBtn')) $('createMasterCategoryBtn').disabled = true;
    if ($('importMasterCategoriesBtn')) $('importMasterCategoriesBtn').disabled = true;
    if ($('createMasterBrandBtn')) $('createMasterBrandBtn').disabled = true;
    if ($('importMasterBrandsBtn')) $('importMasterBrandsBtn').disabled = true;
    if ($('createMasterProductBtn')) $('createMasterProductBtn').disabled = true;
    if ($('importCatalogProductsBtn')) $('importCatalogProductsBtn').disabled = true;
    if ($('importOpenFoodMasterBtn')) $('importOpenFoodMasterBtn').disabled = true;
    return;
  }

  if (title) title.textContent = bt.name;
  if (desc) {
    desc.textContent = bt.description
      || `Templates for ${bt.name} shops. Categories, brands, and products here can be imported into client catalogs.`;
  }
  if (stats) {
    stats.classList.remove('hidden');
    stats.innerHTML = `
      <span class="catalog-stat">Code <strong>${esc(bt.code)}</strong></span>
      <span class="catalog-stat">Categories <strong>${bt.categoryCount ?? 0}</strong></span>
      <span class="catalog-stat">Brands <strong>${bt.brandCount ?? 0}</strong></span>
      <span class="catalog-stat">Products <strong>${bt.productCount ?? 0}</strong></span>
      <span class="catalog-stat">${badge(bt.status)}</span>
    `;
  }
  if (actions) actions.classList.remove('hidden');
  if (body) body.classList.remove('hidden');
  if (empty) empty.classList.add('hidden');
  if ($('createMasterCategoryBtn')) $('createMasterCategoryBtn').disabled = false;
  if ($('importMasterCategoriesBtn')) $('importMasterCategoriesBtn').disabled = false;
  if ($('createMasterBrandBtn')) $('createMasterBrandBtn').disabled = false;
  if ($('importMasterBrandsBtn')) $('importMasterBrandsBtn').disabled = false;
  if ($('createMasterProductBtn')) $('createMasterProductBtn').disabled = false;
  if ($('importCatalogProductsBtn')) $('importCatalogProductsBtn').disabled = false;
  if ($('importOpenFoodMasterBtn')) $('importOpenFoodMasterBtn').disabled = false;
}

function updateCatalogChips() {
  updateCatalogContext();
}

function renderCatalogTypeList() {
  const list = $('catalogTypeList');
  if (!list) return;
  if (!businessTypes.length) {
    list.innerHTML = '<div class="catalog-type-empty">No shop types yet.<br>Click <strong>+ New</strong> to create one.</div>';
    return;
  }
  list.innerHTML = businessTypes.map((b) => `
    <button type="button" class="catalog-type-item ${b.id === selectedCatalogBusinessTypeId ? 'active' : ''}" data-type-id="${b.id}" title="Open ${esc(b.name)} catalog">
      <span class="type-name">${esc(b.name)}</span>
      <span class="type-meta">
        <span>${b.categoryCount ?? 0} cat</span>
        <span>${b.brandCount ?? 0} brands</span>
        <span>${b.productCount ?? 0} products</span>
      </span>
    </button>
  `).join('');
}

function selectCatalogBusinessType(id, opts = {}) {
  const { persist = true, reload = true } = opts;
  selectedCatalogBusinessTypeId = id || '';
  syncHiddenCatalogSelects();
  if (persist) saveCatalogState();
  renderCatalogTypeList();
  updateCatalogContext();
  if (!reload) return;
  if (!selectedCatalogBusinessTypeId) return;
  if (selectedCatalogTab === 'types') selectedCatalogTab = 'products';
  switchCatalogTab(selectedCatalogTab, persist);
}

function switchCatalogTab(tab, persist = true) {
  const tabs = ['categories', 'brands', 'products'];
  if (tab === 'types') tab = 'products';
  if (!tabs.includes(tab)) tab = 'products';
  selectedCatalogTab = tab;
  document.querySelectorAll('.catalog-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.catalogTab === tab);
  });
  tabs.forEach((t) => {
    const panel = $(`catalog-panel-${t}`);
    if (panel) panel.classList.toggle('hidden', t !== tab);
  });
  if (persist) saveCatalogState();
  updateCatalogContext();
  if (!selectedCatalogBusinessTypeId) return;
  if (tab === 'categories') loadMasterCategories();
  if (tab === 'brands') loadMasterBrands();
  if (tab === 'products') {
    fillCatalogProductCategorySelect(selectedCatalogBusinessTypeId, true)
      .then(() => loadCatalogProducts());
  }
}

function openCatalogForType(id, tab = 'products') {
  selectedCatalogBusinessTypeId = id;
  syncHiddenCatalogSelects();
  saveCatalogState();
  switchTab('business-types');
  selectCatalogBusinessType(id, { persist: true, reload: false });
  switchCatalogTab(tab);
}

function bindBusinessTypePreview(prefix) {
  const sel = $(`${prefix}_businessTypeId`);
  const preview = $(`${prefix}_catalogPreview`);
  if (!sel || !preview) return;
  const refresh = () => {
    const bt = getBusinessTypeById(sel.value);
    if (!bt) {
      preview.textContent = '';
      return;
    }
    preview.textContent = `Will preload ${bt.categoryCount} categor${bt.categoryCount === 1 ? 'y' : 'ies'} and ${bt.productCount} product${bt.productCount === 1 ? '' : 's'} for this shop.`;
  };
  sel.onchange = refresh;
  refresh();
}

async function loadBusinessTypes() {
  const list = $('catalogTypeList');
  if (list && !list.children.length) {
    list.innerHTML = inlineLoadingHtml('Loading shop types…', true);
  }
  businessTypes = await api('/business-types');
  fillBusinessTypeSelects();
  if (!selectedCatalogBusinessTypeId && businessTypes.length) {
    const preferred = businessTypes.find((b) => b.code === 'clothing')
      || businessTypes.find((b) => b.code === 'gifting')
      || businessTypes.find((b) => (b.productCount || 0) > 0)
      || businessTypes[0];
    selectedCatalogBusinessTypeId = preferred.id;
    saveCatalogState();
  }
  if (selectedCatalogBusinessTypeId && !businessTypes.some((b) => b.id === selectedCatalogBusinessTypeId)) {
    selectedCatalogBusinessTypeId = businessTypes[0]?.id || '';
    saveCatalogState();
  }
  syncHiddenCatalogSelects();
  renderCatalogTypeList();
  updateCatalogContext();

  if (selectedCatalogBusinessTypeId) {
    if (selectedCatalogTab === 'types') selectedCatalogTab = 'products';
    switchCatalogTab(selectedCatalogTab, false);
  }
}

async function fillCatalogProductCategorySelect(businessTypeId, keepValue = true) {
  const sel = $('catalogProductCategorySelect');
  if (!sel) return;
  const prev = keepValue ? sel.value : '';
  if (!businessTypeId) {
    sel.innerHTML = '<option value="">All categories</option>';
    sel.disabled = true;
    enhanceSearchableSelect(sel);
    return;
  }
  sel.disabled = false;
  try {
    const cats = await api(`/master-categories?${new URLSearchParams({ businessTypeId }).toString()}`);
    sel.innerHTML = '<option value="">All categories</option>' +
      (cats || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    else sel.value = '';
  } catch {
    sel.innerHTML = '<option value="">All categories</option>';
    sel.value = '';
  }
  enhanceSearchableSelect(sel);
}

async function loadCatalogProducts() {
  const tbody = $('catalogProductsTable');
  if (!tbody) return;
  const businessTypeId = selectedCatalogBusinessTypeId || getCatalogBusinessTypeId();
  updateCatalogContext();
  if (!businessTypeId) {
    masterProducts = [];
    renderPagedTable('catalogProducts', {
      tbodyId: 'catalogProductsTable',
      rows: [],
      colspan: 9,
      resetPage: true,
      emptyHtml: '<tr><td colspan="9" class="empty">Select a shop type on the left to browse product templates.</td></tr>',
      renderRow: () => '',
    });
    return;
  }

  renderPagedTable('catalogProducts', {
    tbodyId: 'catalogProductsTable',
    rows: [],
    colspan: 9,
    emptyHtml: `<tr><td colspan="9" class="empty">${inlineLoadingHtml('Loading products…', true)}</td></tr>`,
    renderRow: () => '',
  });

  const params = new URLSearchParams();
  const categoryId = $('catalogProductCategorySelect')?.value;
  const search = $('catalogProductSearch')?.value?.trim();
  params.set('businessTypeId', businessTypeId);
  if (categoryId) params.set('categoryId', categoryId);
  if (search) params.set('search', search);

  try {
    masterProducts = await api(`/master-products?${params.toString()}`);
  } catch (e) {
    masterProducts = [];
    renderPagedTable('catalogProducts', {
      tbodyId: 'catalogProductsTable',
      rows: [],
      colspan: 9,
      emptyHtml: `<tr><td colspan="9" class="empty">${esc(e.message || 'Could not load products')}</td></tr>`,
      renderRow: () => '',
    });
    return;
  }

  const filterName = getBusinessTypeById(businessTypeId)?.name;
  const catName = $('catalogProductCategorySelect')?.selectedOptions?.[0]?.textContent;
  const catLabel = categoryId && catName && catName !== 'All categories' ? catName : '';
  const hint = $('catalogProductsHint');
  if (hint) {
    const scope = [filterName, catLabel].filter(Boolean).join(' · ');
    hint.innerHTML = !masterProducts.length
      ? (scope ? `No product templates for <strong>${esc(scope)}</strong>.` : 'No product templates yet.')
      : `Showing <strong>${masterProducts.length}</strong> product(s)${scope ? ` for <strong>${esc(scope)}</strong>` : ''}.`;
  }
  renderPagedTable('catalogProducts', {
    tbodyId: 'catalogProductsTable',
    rows: masterProducts,
    colspan: 9,
    resetPage: true,
    emptyHtml: `<tr><td colspan="9" class="empty">No product templates${filterName || catLabel ? ` for ${esc([filterName, catLabel].filter(Boolean).join(' · '))}` : ''} yet. Add one or import from Excel.</td></tr>`,
    renderRow: (p) => `
    <tr>
      <td>
        <strong>${esc(p.name)}</strong>
        ${(p.variants || []).some((v) => v.size) ? `<br><small style="color:var(--muted)">${esc((p.variants || []).map((v) => v.size).filter(Boolean).join(', '))}</small>` : ''}
        ${p.description ? `<br><small style="color:var(--muted)">${esc(p.description)}</small>` : ''}
      </td>
      <td>${p.nameMr ? esc(p.nameMr) : '<span style="color:var(--muted)">—</span>'}</td>
      <td>${esc(p.category?.name || '—')}</td>
      <td>${esc(p.brand?.name || '—')}</td>
      <td><span class="type-code">${esc(p.sku || '—')}</span></td>
      <td><span class="type-code">${esc(p.uomCode)}</span></td>
      <td><strong>${Number(p.sellingPrice).toFixed(2)}</strong></td>
      <td>${badge(p.status)}</td>
      <td>
        <div class="row-actions">
        ${rowActions(
          actionBtn('edit-mprod', p.id, { icon: 'edit', title: 'Edit' }),
          actionBtn('delete-mprod', p.id, { icon: 'delete', title: 'Delete', danger: true }),
        )}
        </div>
      </td>
    </tr>`,
  });
}

async function loadBusinessTypeProducts() {
  return loadCatalogProducts();
}

async function loadMasterCategories() {
  const tbody = $('masterCategoriesTable');
  const btn = $('createMasterCategoryBtn');
  const businessTypeId = getCatalogBusinessTypeId();
  if (btn) btn.disabled = !businessTypeId;
  if (!tbody) return;
  updateCatalogChips();
  if ($('importMasterCategoriesBtn')) $('importMasterCategoriesBtn').disabled = !businessTypeId;
  if (!businessTypeId) {
    masterCategories = [];
    renderPagedTable('masterCategories', {
      tbodyId: 'masterCategoriesTable',
      rows: [],
      colspan: 5,
      resetPage: true,
      emptyHtml: '<tr><td colspan="5" class="empty">Select a shop type on the left to manage its categories.</td></tr>',
      renderRow: () => '',
    });
    return;
  }
  selectedCatalogBusinessTypeId = businessTypeId;
  saveCatalogState();
  const params = new URLSearchParams({ businessTypeId });
  masterCategories = await api(`/master-categories?${params.toString()}`);
  renderPagedTable('masterCategories', {
    tbodyId: 'masterCategoriesTable',
    rows: masterCategories,
    colspan: 5,
    resetPage: true,
    emptyHtml: '<tr><td colspan="5" class="empty">No categories for this type. Add your first category.</td></tr>',
    renderRow: (c) => `
    <tr>
      <td>
        <strong>${esc(c.name)}</strong>
        ${c.description ? `<br><small style="color:var(--muted)">${esc(c.description)}</small>` : ''}
      </td>
      <td>${c.nameMr ? esc(c.nameMr) : '<span style="color:var(--muted)">—</span>'}</td>
      <td>${c.sortOrder}</td>
      <td>${badge(c.status)}</td>
      <td>
        <div class="row-actions">
        ${rowActions(
          actionBtn('edit-mcat', c.id, { icon: 'edit', title: 'Edit' }),
          actionBtn('delete-mcat', c.id, { icon: 'delete', title: 'Delete', danger: true }),
        )}
        </div>
      </td>
    </tr>`,
  });
}

async function loadMasterProducts() {
  return loadCatalogProducts();
}

function createBusinessTypeModal() {
  openModal('Create Business Type', `
    <div class="grid-2">
      <div class="field"><label>Name *</label><input id="bt_name" placeholder="Kirana / Grocery Store" /></div>
      <div class="field"><label>Code *</label><input id="bt_code" placeholder="kirana" /></div>
      <div class="field"><label>Sort order</label><input id="bt_sortOrder" type="number" value="0" /></div>
      <div class="field"><label>Status</label><select id="bt_status"><option value="active">active</option><option value="inactive">inactive</option></select></div>
    </div>
    <div class="field"><label>Description</label><textarea id="bt_description" rows="2"></textarea></div>
  `, async () => {
    await api('/business-types', {
      method: 'POST',
      body: JSON.stringify({
        name: $('bt_name').value.trim(),
        code: $('bt_code').value.trim(),
        description: $('bt_description').value.trim() || undefined,
        sortOrder: Number($('bt_sortOrder').value) || 0,
        status: $('bt_status').value,
      }),
    });
    showAlert('Business type created');
    await loadBusinessTypes();
  });
}

function editBusinessType(id) {
  const b = businessTypes.find((x) => x.id === id);
  if (!b) return;
  openModal('Edit Business Type', `
    <div class="grid-2">
      <div class="field"><label>Name *</label><input id="bt_name" value="${esc(b.name)}" /></div>
      <div class="field"><label>Code *</label><input id="bt_code" value="${esc(b.code)}" /></div>
      <div class="field"><label>Sort order</label><input id="bt_sortOrder" type="number" value="${b.sortOrder}" /></div>
      <div class="field"><label>Status</label><select id="bt_status"><option value="active" ${b.status === 'active' ? 'selected' : ''}>active</option><option value="inactive" ${b.status === 'inactive' ? 'selected' : ''}>inactive</option></select></div>
    </div>
    <div class="field"><label>Description</label><textarea id="bt_description" rows="2">${esc(b.description || '')}</textarea></div>
  `, async () => {
    await api(`/business-types/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: $('bt_name').value.trim(),
        code: $('bt_code').value.trim(),
        description: $('bt_description').value.trim() || null,
        sortOrder: Number($('bt_sortOrder').value),
        status: $('bt_status').value,
      }),
    });
    showAlert('Business type updated');
    await loadBusinessTypes();
  });
}

async function deleteBusinessType(id) {
  const b = businessTypes.find((x) => x.id === id);
  if (!b || !confirm(`Delete business type "${b.name}"?`)) return;
  const result = await api(`/business-types/${id}`, { method: 'DELETE' });
  showAlert(result.message || 'Business type deleted');
  await loadBusinessTypes();
}

function manageCategoriesForType(id) {
  openCatalogForType(id, 'categories');
}

function manageProductsForType(id) {
  openCatalogForType(id, 'products');
}

function createMasterProductFromTypeModal() {
  const businessTypeId = getCatalogBusinessTypeId() || $('catalogProductTypeSelect')?.value;
  if (businessTypeId) {
    $('catalogProductTypeSelect').value = businessTypeId;
    selectedCatalogBusinessTypeId = businessTypeId;
    saveCatalogState();
  }
  createMasterProductModal();
}

function createMasterCategoryModal() {
  const businessTypeId = getCatalogBusinessTypeId();
  if (!businessTypeId) {
    showAlert('Select a business type first', 'error');
    return;
  }
  openModal('Add Category', `
    <div class="grid-2">
      <div class="field"><label>Category name *</label><input id="mc_name" /></div>
      <div class="field"><label>Marathi name</label><input id="mc_nameMr" placeholder="मराठी नाव" /></div>
    </div>
    <div class="field"><label>Description</label><textarea id="mc_description" rows="2"></textarea></div>
    <div class="grid-2">
      <div class="field"><label>Sort order</label><input id="mc_sortOrder" type="number" value="0" /></div>
      <div class="field"><label>Status</label><select id="mc_status"><option value="active">active</option><option value="inactive">inactive</option></select></div>
    </div>
  `, async () => {
    await api('/master-categories', {
      method: 'POST',
      body: JSON.stringify({
        businessTypeId,
        name: $('mc_name').value.trim(),
        nameMr: $('mc_nameMr').value.trim() || undefined,
        description: $('mc_description').value.trim() || undefined,
        sortOrder: Number($('mc_sortOrder').value) || 0,
        status: $('mc_status').value,
      }),
    });
    showAlert('Category created');
    await loadBusinessTypes();
    await loadMasterCategories();
    if (selectedCatalogTab === 'products') await loadCatalogProducts();
  });
}

function editMasterCategory(id) {
  const c = masterCategories.find((x) => x.id === id);
  if (!c) return;
  openModal('Edit Category', `
    <div class="grid-2">
      <div class="field"><label>Category name *</label><input id="mc_name" value="${esc(c.name)}" /></div>
      <div class="field"><label>Marathi name</label><input id="mc_nameMr" value="${esc(c.nameMr || '')}" placeholder="मराठी नाव" /></div>
    </div>
    <div class="field"><label>Description</label><textarea id="mc_description" rows="2">${esc(c.description || '')}</textarea></div>
    <div class="grid-2">
      <div class="field"><label>Sort order</label><input id="mc_sortOrder" type="number" value="${c.sortOrder}" /></div>
      <div class="field"><label>Status</label><select id="mc_status"><option value="active" ${c.status === 'active' ? 'selected' : ''}>active</option><option value="inactive" ${c.status === 'inactive' ? 'selected' : ''}>inactive</option></select></div>
    </div>
  `, async () => {
    await api(`/master-categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: $('mc_name').value.trim(),
        nameMr: $('mc_nameMr').value.trim() || null,
        description: $('mc_description').value.trim() || null,
        sortOrder: Number($('mc_sortOrder').value),
        status: $('mc_status').value,
      }),
    });
    showAlert('Category updated');
    await loadBusinessTypes();
    await loadMasterCategories();
    if (selectedCatalogTab === 'products') await loadCatalogProducts();
  });
}

async function deleteMasterCategory(id) {
  const c = masterCategories.find((x) => x.id === id);
  if (!c || !confirm(`Delete category "${c.name}"?`)) return;
  await api(`/master-categories/${id}`, { method: 'DELETE' });
  showAlert('Category deleted');
  await loadBusinessTypes();
  await loadMasterCategories();
  if (selectedCatalogTab === 'products') await loadCatalogProducts();
}

async function loadMasterBrands() {
  const tbody = $('masterBrandsTable');
  const btn = $('createMasterBrandBtn');
  const businessTypeId = $('catalogBrandTypeSelect')?.value || getCatalogBusinessTypeId();
  if (btn) btn.disabled = !businessTypeId;
  if ($('importMasterBrandsBtn')) $('importMasterBrandsBtn').disabled = !businessTypeId;
  if (!tbody) return;
  updateCatalogChips();
  if (!businessTypeId) {
    masterBrands = [];
    renderPagedTable('masterBrands', {
      tbodyId: 'masterBrandsTable',
      rows: [],
      colspan: 5,
      resetPage: true,
      emptyHtml: '<tr><td colspan="5" class="empty">Select a shop type on the left to manage its brands.</td></tr>',
      renderRow: () => '',
    });
    return;
  }
  selectedCatalogBusinessTypeId = businessTypeId;
  if ($('catalogBusinessTypeSelect')) $('catalogBusinessTypeSelect').value = businessTypeId;
  saveCatalogState();
  const params = new URLSearchParams({ businessTypeId });
  masterBrands = await api(`/master-brands?${params.toString()}`);
  renderPagedTable('masterBrands', {
    tbodyId: 'masterBrandsTable',
    rows: masterBrands,
    colspan: 5,
    resetPage: true,
    emptyHtml: '<tr><td colspan="5" class="empty">No brands for this type. Add your first brand.</td></tr>',
    renderRow: (b) => `
    <tr>
      <td>
        <strong>${esc(b.name)}</strong>
        ${b.description ? `<br><small style="color:var(--muted)">${esc(b.description)}</small>` : ''}
      </td>
      <td>${b.nameMr ? esc(b.nameMr) : '<span style="color:var(--muted)">—</span>'}</td>
      <td>${b.sortOrder}</td>
      <td>${badge(b.status)}</td>
      <td>
        <div class="row-actions">
        ${rowActions(
          actionBtn('edit-mbrand', b.id, { icon: 'edit', title: 'Edit' }),
          actionBtn('delete-mbrand', b.id, { icon: 'delete', title: 'Delete', danger: true }),
        )}
        </div>
      </td>
    </tr>`,
  });
}

function createMasterBrandModal() {
  const businessTypeId = $('catalogBrandTypeSelect')?.value || getCatalogBusinessTypeId();
  if (!businessTypeId) {
    showAlert('Select a business type first', 'error');
    return;
  }
  openModal('Add Brand', `
    <div class="grid-2">
      <div class="field"><label>Brand name *</label><input id="mb_name" /></div>
      <div class="field"><label>Marathi name</label><input id="mb_nameMr" placeholder="मराठी नाव" /></div>
    </div>
    <div class="field"><label>Description</label><textarea id="mb_description" rows="2"></textarea></div>
    <div class="grid-2">
      <div class="field"><label>Sort order</label><input id="mb_sortOrder" type="number" value="0" /></div>
      <div class="field"><label>Status</label><select id="mb_status"><option value="active">active</option><option value="inactive">inactive</option></select></div>
    </div>
  `, async () => {
    await api('/master-brands', {
      method: 'POST',
      body: JSON.stringify({
        businessTypeId,
        name: $('mb_name').value.trim(),
        nameMr: $('mb_nameMr').value.trim() || undefined,
        description: $('mb_description').value.trim() || undefined,
        sortOrder: Number($('mb_sortOrder').value) || 0,
        status: $('mb_status').value,
      }),
    });
    showAlert('Brand created');
    await loadBusinessTypes();
    await loadMasterBrands();
    if (selectedCatalogTab === 'products') await loadCatalogProducts();
  });
}

function editMasterBrand(id) {
  const b = masterBrands.find((x) => x.id === id);
  if (!b) return;
  openModal('Edit Brand', `
    <div class="grid-2">
      <div class="field"><label>Brand name *</label><input id="mb_name" value="${esc(b.name)}" /></div>
      <div class="field"><label>Marathi name</label><input id="mb_nameMr" value="${esc(b.nameMr || '')}" placeholder="मराठी नाव" /></div>
    </div>
    <div class="field"><label>Description</label><textarea id="mb_description" rows="2">${esc(b.description || '')}</textarea></div>
    <div class="grid-2">
      <div class="field"><label>Sort order</label><input id="mb_sortOrder" type="number" value="${b.sortOrder}" /></div>
      <div class="field"><label>Status</label><select id="mb_status"><option value="active" ${b.status === 'active' ? 'selected' : ''}>active</option><option value="inactive" ${b.status === 'inactive' ? 'selected' : ''}>inactive</option></select></div>
    </div>
  `, async () => {
    await api(`/master-brands/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: $('mb_name').value.trim(),
        nameMr: $('mb_nameMr').value.trim() || null,
        description: $('mb_description').value.trim() || null,
        sortOrder: Number($('mb_sortOrder').value),
        status: $('mb_status').value,
      }),
    });
    showAlert('Brand updated');
    await loadBusinessTypes();
    await loadMasterBrands();
    if (selectedCatalogTab === 'products') await loadCatalogProducts();
  });
}

async function deleteMasterBrand(id) {
  const b = masterBrands.find((x) => x.id === id);
  if (!b || !confirm(`Delete brand "${b.name}"?`)) return;
  await api(`/master-brands/${id}`, { method: 'DELETE' });
  showAlert('Brand deleted');
  await loadBusinessTypes();
  await loadMasterBrands();
  if (selectedCatalogTab === 'products') await loadCatalogProducts();
}

function manageBrandsForType(id) {
  openCatalogForType(id, 'brands');
}

function masterProductFormHtml(initial = {}) {
  const btId = initial.businessTypeId || $('catalogProductTypeSelect')?.value || getCatalogBusinessTypeId() || '';
  const cats = masterCategories.filter((c) => c.businessTypeId === btId || c.businessTypeId === initial.businessTypeId);

  return `
    <div class="grid-2">
      <div class="field"><label>Business type *</label>
        <select id="mp_businessTypeId">${businessTypeOptionsHtml(btId, 'Select...')}</select>
      </div>
      <div class="field"><label>Category</label>
        <select id="mp_categoryId">${optionList(cats, initial.categoryId, '— None —')}</select>
      </div>
      <div class="field"><label>Product name *</label><input id="mp_name" value="${esc(initial.name || '')}" /></div>
      <div class="field"><label>Marathi name</label><input id="mp_nameMr" value="${esc(initial.nameMr || '')}" placeholder="मराठी नाव" /></div>
      <div class="field"><label>Selling price</label><input id="mp_sellingPrice" type="number" step="0.01" value="${initial.sellingPrice ?? 0}" /></div>
      <div class="field"><label>Status</label>
        <select id="mp_status">
          <option value="active" ${initial.status === 'active' || !initial.status ? 'selected' : ''}>active</option>
          <option value="inactive" ${initial.status === 'inactive' ? 'selected' : ''}>inactive</option>
        </select>
      </div>
    </div>
    <p class="hint">Master catalog items use price 0 by default. Clients set their own selling price after import.</p>
  `;
}

function collectMasterProductForm() {
  const num = (id) => {
    const v = $(id).value.trim();
    return v === '' ? 0 : Number(v);
  };
  return {
    businessTypeId: $('mp_businessTypeId').value,
    categoryId: $('mp_categoryId').value || null,
    brandId: null,
    name: $('mp_name').value.trim(),
    nameMr: $('mp_nameMr').value.trim() || null,
    description: undefined,
    uomCode: 'pcs',
    sellingPrice: num('mp_sellingPrice'),
    costPrice: 0,
    mrp: undefined,
    sku: undefined,
    barcode: undefined,
    sortOrder: 0,
    status: $('mp_status').value,
  };
}

async function refreshMasterProductCategories(businessTypeId) {
  if (!businessTypeId) {
    masterCategories = [];
    return;
  }
  const params = new URLSearchParams({ businessTypeId });
  masterCategories = await api(`/master-categories?${params.toString()}`);
}

async function refreshMasterProductBrands(businessTypeId) {
  if (!businessTypeId) {
    masterBrands = [];
    return;
  }
  const params = new URLSearchParams({ businessTypeId });
  masterBrands = await api(`/master-brands?${params.toString()}`);
}

function bindMasterProductBrandAdd() {
  const btn = $('mp_addBrand');
  if (!btn) return;
  btn.onclick = async () => {
    const businessTypeId = $('mp_businessTypeId')?.value;
    if (!businessTypeId) {
      showAlert('Select a business type first', 'error');
      return;
    }
    const name = prompt('New brand name:');
    if (!name?.trim()) return;
    try {
      const created = await api('/master-brands', {
        method: 'POST',
        body: JSON.stringify({ businessTypeId, name: name.trim() }),
      });
      masterBrands = [...masterBrands.filter((b) => b.id !== created.id), created];
      appendSelectOption($('mp_brandId'), created, true);
      showAlert(`Brand "${created.name}" added`);
    } catch (e) {
      showAlert(e.message, 'error');
    }
  };
}

function bindMasterProductBusinessTypeChange() {
  const sel = $('mp_businessTypeId');
  const catSel = $('mp_categoryId');
  const brandSel = $('mp_brandId');
  if (!sel || !catSel) return;
  sel.onchange = async () => {
    await Promise.all([
      refreshMasterProductCategories(sel.value),
      refreshMasterProductBrands(sel.value),
    ]);
    catSel.innerHTML = optionList(masterCategories, null, '— None —');
    if (brandSel) brandSel.innerHTML = optionList(masterBrands, null, '— None —');
    enhanceSearchableSelect(catSel);
    if (brandSel) enhanceSearchableSelect(brandSel);
  };
  bindMasterProductBrandAdd();
}

async function createMasterProductModal() {
  if (!units.length) await loadUnits();
  const btId = $('catalogProductTypeSelect')?.value || getCatalogBusinessTypeId() || '';
  if (btId) {
    await Promise.all([
      refreshMasterProductCategories(btId),
      refreshMasterProductBrands(btId),
    ]);
  }
  openModal('Add Product Master', masterProductFormHtml(), async () => {
    const body = collectMasterProductForm();
    if (!body.businessTypeId) throw new Error('Business type is required');
    if (!body.name) throw new Error('Product name is required');
    await api('/master-products', { method: 'POST', body: JSON.stringify(body) });
    showAlert('Product master created');
    await loadBusinessTypes();
    await loadCatalogProducts();
    if (selectedCatalogTab === 'categories') await loadMasterCategories();
    if (selectedCatalogTab === 'brands') await loadMasterBrands();
  });
  bindMasterProductBusinessTypeChange();
}

let openFoodRows = [];

const OFF_FIELDS = 'code,product_name,product_name_en,product_name_mr,generic_name,generic_name_en,brands,quantity,categories_tags,countries_tags';
const OFF_FOOD_HOSTS = ['https://world.openfoodfacts.org', 'https://in.openfoodfacts.org'];
const OFF_CATEGORY_HOSTS = [
  OFF_FOOD_HOSTS,
  ['https://world.openbeautyfacts.org', 'https://in.openbeautyfacts.org'],
  ['https://world.openproductsfacts.org'],
];
let offResolved = null;
let offWorkingHost = null;

function offCategoryTag() {
  return ($('offCategory')?.value || '').trim().toLowerCase().replace(/\s+/g, '-');
}

async function offHostsFor(params) {
  const category = params.get('categories_tags') || '';
  if (!category) {
    offResolved = null;
    return OFF_FOOD_HOSTS;
  }
  if (offResolved?.category === category) return offResolved.hosts;
  const probe = new URLSearchParams(params);
  probe.delete('countries_tags');
  probe.set('page', '1');
  probe.set('page_size', '1');
  let bestHosts = OFF_FOOD_HOSTS;
  let bestCount = -1;
  for (const hosts of OFF_CATEGORY_HOSTS) {
    try {
      const body = await fetchOpenFoodJson(hosts.map((host) => `${host}/api/v2/search?${probe}`));
      const count = Number(body.count) || 0;
      if (count > bestCount) {
        bestCount = count;
        bestHosts = hosts;
      }
    } catch (err) {
      /* try the next catalog */
    }
  }
  offResolved = { category, hosts: bestHosts };
  return bestHosts;
}

async function fetchOpenFoodJson(urls) {
  let lastError = null;
  const ordered = offWorkingHost
    ? [
      ...urls.filter((url) => url.startsWith(offWorkingHost)),
      ...urls.filter((url) => !url.startsWith(offWorkingHost)),
    ]
    : urls;
  for (const url of ordered) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        lastError = new Error(`Open Food Facts returned ${response.status}`);
        continue;
      }
      offWorkingHost = new URL(url).origin;
      return await response.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(lastError?.message || 'Open Food Facts is not reachable right now');
}

function offClean(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : '';
}

function offDigits(value) {
  return String(value || '').replace(/[०-९]/g, (digit) => {
    const index = '०१२३४५६७८९'.indexOf(digit);
    return index >= 0 ? String(index) : digit;
  });
}

function offBarcode(code) {
  const digits = String(code || '').replace(/\D/g, '');
  return /^\d{4,18}$/.test(digits) ? digits : '';
}

function offSize(raw) {
  if (!raw) return '';
  const text = offDigits(raw).replace(',', '.').replace(/\s+/g, ' ').trim();
  const match = text.match(/(\d+(?:\.\d+)?)\s*(kgs?|gr|gms?|g|mls?|ltr|litres?|liters?|l|cl|pcs|pc|pieces)?/i);
  if (!match) return '';
  let value = parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return '';
  let unit = String(match[2] || '').toLowerCase();
  if (unit === 'gr' || unit === 'gm' || unit === 'gms') unit = 'g';
  if (unit === 'kgs' || unit === 'kg') unit = 'kg';
  if (unit === 'mls' || unit === 'ml') unit = 'ml';
  if (['ltr', 'litre', 'liter', 'litres', 'liters', 'l'].includes(unit)) unit = 'L';
  if (unit === 'cl') {
    value *= 10;
    unit = 'ml';
  }
  if (unit === 'pc' || unit === 'pcs' || unit === 'pieces') unit = 'pc';
  if (!unit) return '';
  const shown = Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
  return `${shown} ${unit}`.slice(0, 30);
}

function offKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function offMapHit(hit) {
  const raw = offClean(hit.product_name, 200);
  const english = offClean(hit.product_name_en, 200);
  const generic = offClean(hit.generic_name_en, 200);
  if (/wird geladen|loading\.\.\.|unknown product/i.test(raw)) return null;
  const devanagari = /[\u0900-\u097F]/;
  let name = '';
  if (raw && !devanagari.test(raw)) name = raw;
  else if (english && !devanagari.test(english)) name = english;
  else if (generic && !devanagari.test(generic)) name = generic;
  else name = raw || english || generic;
  if (!name || name.length < 2) return null;
  const barcode = offBarcode(hit.code);
  if (!barcode) return null;
  const brands = String(hit.brands || '').split(',').map((item) => offClean(item, 150)).filter(Boolean);
  const nameKey = offKey(name);
  const brand = brands.find((item) => offKey(item) !== nameKey) || brands[0] || '';
  const tags = Array.isArray(hit.categories_tags) ? hit.categories_tags : [];
  const specific = [...tags].reverse().find((tag) => String(tag).startsWith('en:'));
  const category = specific
    ? offClean(String(specific).slice(3).replace(/-/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase()), 150)
    : '';
  return {
    name,
    nameMr: offClean(hit.product_name_mr, 200) || (devanagari.test(raw) ? raw : ''),
    brand,
    brandKey: [...new Set(brands.map(offKey).filter((item) => item && item !== nameKey))].sort().join(' '),
    category,
    description: offClean(hit.generic_name_en || hit.generic_name, 800),
    barcode,
    size: offSize(hit.quantity),
  };
}

function offGroup(hits) {
  const order = [];
  const groups = new Map();
  for (const hit of hits || []) {
    const row = offMapHit(hit);
    if (!row) continue;
    const base = offKey(row.name).replace(/\d+(?:\.\d+)?\s*(kg|g|ml|l|pc)\b/g, ' ').replace(/\b(biscuits?|cookies?|wafers?)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const key = `${base || offKey(row.name)}|${row.brandKey}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    const bucket = groups.get(key);
    if (bucket.some((item) => item.barcode === row.barcode)) continue;
    if (bucket.length && !bucket[0].nameMr && row.nameMr) bucket[0].nameMr = row.nameMr;
    if (bucket.length && !bucket[0].category && row.category) bucket[0].category = row.category;
    if (bucket.length && !bucket[0].description && row.description) bucket[0].description = row.description;
    bucket.push(row);
  }
  return order.map((key) => {
    const items = groups.get(key);
    const first = items[0];
    const bySize = new Map();
    items.forEach((item) => {
      const sizeKey = item.size || '';
      if (!bySize.has(sizeKey)) bySize.set(sizeKey, []);
      const codes = bySize.get(sizeKey);
      if (!codes.includes(item.barcode)) codes.push(item.barcode);
    });
    const sized = [...bySize.keys()].filter(Boolean);
    if (sized.length >= 2) {
      const bases = items
        .map((item) => item.name.replace(/\b\d+(?:[.,]\d+)?\s*(kgs?|gms?|gr|g|mls?|ltr|l)\b/gi, ' ').replace(/\s+/g, ' ').trim())
        .filter((name) => name.length >= 2)
        .sort((a, b) => a.length - b.length);
      return {
        id: key,
        name: bases[0] || first.name,
        nameMr: first.nameMr,
        brand: first.brand,
        category: first.category,
        description: first.description || '',
        variants: sized.map((size) => ({ size, barcodes: bySize.get(size) })),
      };
    }
    const size = sized[0] || '';
    const name = size && !first.name.toLowerCase().includes(size.toLowerCase()) ? `${first.name} ${size}`.slice(0, 200) : first.name;
    const barcodes = (size ? bySize.get(size) : bySize.get('')) || [];
    return {
      id: key,
      name,
      nameMr: first.nameMr,
      brand: first.brand,
      category: first.category,
      description: first.description || '',
      barcodes: barcodes.slice(0, 3),
    };
  });
}

async function fetchOpenFoodCatalog(page, extra) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: '100',
    fields: OFF_FIELDS,
    sort_by: 'created_t',
  });
  const category = offCategoryTag();
  if (category) params.set('categories_tags', category);
  else params.set('countries_tags', 'india');
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const hosts = await offHostsFor(params);
  const body = await fetchOpenFoodJson(hosts.map((host) => `${host}/api/v2/search?${params}`));
  const hits = Array.isArray(body.products) ? body.products : [];
  const count = Number(body.count) || hits.length;
  return {
    hits,
    products: offGroup(hits),
    count,
    pageSize: 100,
    pageCount: Math.max(1, Math.ceil(count / 100)),
  };
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOpenFoodCatalogRetry(page, extra) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await fetchOpenFoodCatalog(page, extra);
    } catch (err) {
      lastError = err;
      if (attempt < 4) await waitMs(1000 * (2 ** attempt));
    }
  }
  throw lastError;
}

function offDateChildren(tag) {
  if (/^\d{4}$/.test(tag)) {
    return Array.from({ length: 12 }, (_, index) => `${tag}-${String(index + 1).padStart(2, '0')}`);
  }
  if (/^\d{4}-\d{2}$/.test(tag)) {
    const [year, month] = tag.split('-').map(Number);
    const days = new Date(year, month, 0).getDate();
    return Array.from({ length: days }, (_, index) => `${tag}-${String(index + 1).padStart(2, '0')}`);
  }
  return [];
}

async function searchOpenFoodCatalog(term) {
  const category = offCategoryTag();
  if (/^\d{4,18}$/.test(term)) {
    const params = new URLSearchParams({ code: term, page_size: '20', fields: OFF_FIELDS });
    if (category) params.set('categories_tags', category);
    const hosts = await offHostsFor(params);
    const body = await fetchOpenFoodJson(hosts.map((host) => `${host}/api/v2/search?${params}`));
    const hits = Array.isArray(body.products) ? body.products : [];
    return { products: offGroup(hits), count: hits.length, pageCount: 1 };
  }
  const params = new URLSearchParams({
    search_terms: term,
    search_simple: '1',
    action: 'process',
    json: '1',
    page: '1',
    page_size: '24',
    fields: OFF_FIELDS,
  });
  if (category) params.set('categories_tags', category);
  const hosts = await offHostsFor(params);
  const body = await fetchOpenFoodJson(hosts.map((host) => `${host}/cgi/search.pl?${params}`));
  const hits = Array.isArray(body.products) ? body.products : [];
  return { products: offGroup(hits), count: Number(body.count) || hits.length, pageCount: 1 };
}

function openFoodRowHtml(row, index) {
  const packs = (row.variants || []).map((variant) => variant.size).filter(Boolean).join(', ');
  const codes = packs || (row.barcodes || []).slice(0, 2).join(', ');
  const meta = [row.brand, row.category, codes].filter(Boolean).join(' · ');
  return `<label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border)">
    <input type="checkbox" class="off-pick" data-index="${index}" />
    <span><strong>${esc(row.name)}</strong>${meta ? `<br><small style="color:var(--muted)">${esc(meta)}</small>` : ''}</span>
  </label>`;
}

function renderOpenFoodRows(products) {
  openFoodRows = products || [];
  const list = $('offList');
  if (list) list.innerHTML = openFoodRows.map(openFoodRowHtml).join('') || '<p class="hint">No products</p>';
}

async function loadOpenFoodList() {
  const status = $('offStatus');
  const term = ($('offSearch')?.value || '').trim();
  if (status) status.textContent = 'Loading…';
  const data = term.length >= 2
    ? await searchOpenFoodCatalog(term)
    : await fetchOpenFoodCatalog(1);
  renderOpenFoodRows(data.products || []);
  if (status) status.textContent = `Showing ${openFoodRows.length} of ${data.count || openFoodRows.length}. Select all imports every available product.`;
  return data;
}

async function postOpenFoodImport(businessTypeId, products) {
  return api('/master-products/import-from-open-food', {
    method: 'POST',
    body: JSON.stringify({ businessTypeId, products }),
  });
}

async function importOpenFoodBatches(businessTypeId, products, status, progress) {
  const totals = { imported: 0, created: 0, updated: 0, failed: 0 };
  for (let index = 0; index < products.length; index += 50) {
    const batch = products.slice(index, index + 50);
    progress.done += batch.length;
    if (status) status.textContent = `Importing ${progress.done} of ${progress.total} products`;
    const data = await postOpenFoodImport(businessTypeId, batch);
    totals.imported += data.imported || 0;
    totals.created += data.created || 0;
    totals.updated += data.updated || 0;
    totals.failed += data.failed || 0;
  }
  return totals;
}

async function importOpenFoodPages(businessTypeId, status, progress, totals, extra, first) {
  const count = first.count || (first.hits || []).length;
  const pages = Math.min(10, Math.max(1, Math.ceil(count / 100)));
  const add = (part) => {
    totals.imported += part.imported;
    totals.created += part.created;
    totals.updated += part.updated;
    totals.failed += part.failed;
  };
  add(await importOpenFoodBatches(businessTypeId, offGroup(first.hits || []), status, progress));
  for (let page = 2; page <= pages; page += 1) {
    try {
      const data = await fetchOpenFoodCatalogRetry(page, extra);
      const hits = data.hits || [];
      if (!hits.length) break;
      add(await importOpenFoodBatches(businessTypeId, offGroup(hits), status, progress));
    } catch (err) {
      totals.missedPages += 1;
      if (status) status.textContent = `Imported ${progress.done} of ${progress.total} products. One page was skipped.`;
      break;
    }
    await waitMs(150);
  }
}

async function importOpenFoodDateSlice(tag, businessTypeId, status, progress, totals) {
  const extra = { entry_dates_tags: tag };
  let first;
  try {
    first = await fetchOpenFoodCatalogRetry(1, extra);
  } catch (err) {
    totals.missedPages += 1;
    if (status) status.textContent = `Imported ${progress.done} of ${progress.total} products. ${tag} was skipped.`;
    return;
  }
  const count = first.count || (first.hits || []).length;
  if (!count) return;
  if (count > 1000) {
    const children = offDateChildren(tag);
    if (children.length) {
      for (const child of children) {
        await importOpenFoodDateSlice(child, businessTypeId, status, progress, totals);
      }
      return;
    }
  }
  if (status) status.textContent = `Importing ${tag}, ${progress.done} of ${progress.total} products`;
  await importOpenFoodPages(businessTypeId, status, progress, totals, extra, first);
}

async function importAllAvailableOpenFood(businessTypeId, status) {
  const first = await fetchOpenFoodCatalogRetry(1);
  const total = first.count || (first.hits || []).length;
  const progress = { done: 0, total };
  const totals = { imported: 0, created: 0, updated: 0, failed: 0, missedPages: 0 };
  if (total <= 1000) {
    await importOpenFoodPages(businessTypeId, status, progress, totals, {}, first);
    return totals;
  }
  const newestYear = new Date().getFullYear();
  for (let year = 2012; year <= newestYear; year += 1) {
    await importOpenFoodDateSlice(String(year), businessTypeId, status, progress, totals);
  }
  return totals;
}

async function importOpenFoodMasterModal() {
  const businessTypeId = getCatalogBusinessTypeId();
  if (!businessTypeId) {
    showAlert('Select a shop type first', 'error');
    return;
  }
  const typeName = getBusinessTypeById(businessTypeId)?.name || 'this catalog';
  openFoodRows = [];
  openModal('Import from API', `
    <p class="hint">Products are saved into <strong>${esc(typeName)}</strong>. Set a category tag such as <strong>soap</strong> to load that whole category. Leave it blank to list Indian products. Pack sizes stay one product, each size with its own barcode and MRP.</p>
    <div class="field-row">
      <input id="offCategory" placeholder="categories_tags, e.g. soap" />
      <input id="offSearch" placeholder="Search name or barcode" />
      <button type="button" class="secondary" id="offLoad">Search</button>
    </div>
    <label style="display:flex;gap:8px;margin:8px 0"><input type="checkbox" id="offSelectAll" /> Select all available products</label>
    <div id="offStatus" class="hint">Loading the first page…</div>
    <div id="offList" style="max-height:360px;overflow:auto"></div>
  `, async () => {
    const term = ($('offSearch')?.value || '').trim();
    const selectAll = $('offSelectAll')?.checked;
    const status = $('offStatus');
    let imported = 0;
    let created = 0;
    let updated = 0;
    let failed = 0;
    let missedPages = 0;
    if (selectAll && term.length < 2) {
      const totals = await importAllAvailableOpenFood(businessTypeId, status);
      imported = totals.imported;
      created = totals.created;
      updated = totals.updated;
      failed = totals.failed;
      missedPages = totals.missedPages;
      if (!imported) throw new Error('No products could be imported');
    } else {
      const selected = selectAll
        ? (await searchOpenFoodCatalog(term)).products || []
        : [...document.querySelectorAll('.off-pick:checked')]
          .map((box) => openFoodRows[Number(box.dataset.index)])
          .filter(Boolean);
      if (!selected.length) throw new Error('Select at least one product');
      const totals = await importOpenFoodBatches(businessTypeId, selected, status, { done: 0, total: selected.length });
      imported = totals.imported;
      created = totals.created;
      updated = totals.updated;
      failed = totals.failed;
    }
    const missedNote = missedPages ? ` ${missedPages} pages could not be loaded.` : '';
    showAlert(`Saved ${imported} into ${typeName}. Added ${created}, updated ${updated}, failed ${failed}.${missedNote}`);
    await loadBusinessTypes();
    await loadCatalogProducts();
  }, { saveLabel: 'Import', wide: true });

  $('offLoad').onclick = () => {
    loadOpenFoodList().catch((err) => {
      const status = $('offStatus');
      if (status) status.textContent = err.message || 'Could not load products';
    });
  };
  $('offSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      $('offLoad').click();
    }
  });
  $('offCategory').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      $('offLoad').click();
    }
  });
  loadOpenFoodList().catch((err) => {
    const status = $('offStatus');
    if (status) status.textContent = err.message || 'Could not load products';
  });
}

async function editMasterProduct(id) {
  const p = masterProducts.find((x) => x.id === id);
  if (!p) return;
  if (!units.length) await loadUnits();
  await Promise.all([
    refreshMasterProductCategories(p.businessTypeId),
    refreshMasterProductBrands(p.businessTypeId),
  ]);
  openModal('Edit Product Master', masterProductFormHtml(p), async () => {
    const body = collectMasterProductForm();
    if (!body.name) throw new Error('Product name is required');
    await api(`/master-products/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    showAlert('Product master updated');
    await loadBusinessTypes();
    await loadCatalogProducts();
    if (selectedCatalogTab === 'categories') await loadMasterCategories();
    if (selectedCatalogTab === 'brands') await loadMasterBrands();
  });
  bindMasterProductBusinessTypeChange();
}

async function deleteMasterProduct(id) {
  const p = masterProducts.find((x) => x.id === id);
  if (!p || !confirm(`Delete product master "${p.name}"?`)) return;
  await api(`/master-products/${id}`, { method: 'DELETE' });
  showAlert('Product master deleted');
  await loadBusinessTypes();
  await loadCatalogProducts();
  if (selectedCatalogTab === 'categories') await loadMasterCategories();
}

function fillTenantSelect(selectEl, currentValue) {
  const cur = currentValue || selectEl.value;
  selectEl.innerHTML = '<option value="">Select tenant...</option>' +
    tenants.map((t) => `<option value="${t.id}">${t.name} (${t.slug})</option>`).join('');
  if (cur) selectEl.value = cur;
  enhanceSearchableSelect(selectEl);
}

async function loadTenants() {
  const params = new URLSearchParams();
  const search = $('tenantSearch')?.value?.trim();
  const status = $('tenantStatusFilter')?.value;
  const planId = $('tenantPlanFilter')?.value;
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (planId) params.set('planId', planId);
  tenants = await api(`/tenants?${params.toString()}`);
  renderPagedTable('tenants', {
    tbodyId: 'tenantsTable',
    rows: tenants,
    colspan: 10,
    resetPage: true,
    emptyHtml: '<tr><td colspan="10" class="empty">No clients yet. Create one.</td></tr>',
    renderRow: (t) => `
      <tr>
        <td><strong>${esc(t.name)}</strong>${t.billingEmail ? `<br><small style="color:var(--muted)">${esc(t.billingEmail)}</small>` : ''}</td>
        <td><code>${esc(t.slug)}</code></td>
        <td>${t.ownerMobile ? `<strong>${esc(t.ownerMobile)}</strong>` : '<span style="color:var(--warning)">Not set</span>'}</td>
        <td>${badge(t.status)}</td>
        <td>${esc(t.businessTypeName || '—')}${t.businessTypeCode ? `<br><small style="color:var(--muted)"><code>${esc(t.businessTypeCode)}</code></small>` : ''}</td>
        <td>${esc(t.planName || '—')}<br><small style="color:var(--muted)">${t.maxBranches} br / ${t.maxUsers} users</small></td>
        <td>${t.subscriptionYears || '—'}</td>
        <td>${fmtDate(t.trialEndsAt)}</td>
        <td>${fmtDate(t.subscriptionEndsAt)}</td>
        <td>
          <div class="row-actions">
          ${rowActions(
            actionBtn('edit-tenant', t.id, { icon: 'edit', title: 'Edit' }),
            actionBtn('reset-tenant-password', t.id, { icon: 'key', title: 'Reset password' }),
            actionBtn('tenant-products', t.id, { icon: 'box', title: 'Products' }),
          )}
          </div>
        </td>
      </tr>`,
  });
  const sel = $('productTenantSelect');
  fillTenantSelect(sel);
  const savedTenant = sessionStorage.getItem('adminProductTenant');
  if (savedTenant && tenants.some((t) => t.id === savedTenant)) {
    sel.value = savedTenant;
    selectedTenantId = savedTenant;
  }
}

function createTenantModal() {
  if (!activePlans().length) {
    showAlert('Create at least one active plan first', 'error');
    return;
  }
  openModal('Create Client', `
    <p style="font-size:13px;color:var(--primary);margin:0 0 12px;padding:10px 12px;background:#e3f2fd;border-radius:8px;border:1px solid #90caf9">
      Shop owner signs in on the <strong>mobile app</strong> with <strong>shop code + mobile number + password</strong> (not email).
    </p>
    <div class="grid-2">
      <div class="field"><label>Shop name *</label><input id="c_name" /></div>
      <div class="field"><label>Shop code (slug) *</label><input id="c_slug" placeholder="demo-kirana" /></div>
      <div class="field"><label>Owner name *</label><input id="c_ownerName" /></div>
      <div class="field"><label>Owner mobile * <small style="color:var(--muted);font-weight:400">(login ID)</small></label><input id="c_ownerMobile" type="tel" inputmode="numeric" maxlength="10" placeholder="9876543210" /></div>
      <div class="field"><label>Owner password *</label><input id="c_ownerPassword" type="password" /></div>
      <div class="field"><label>Billing email <small style="color:var(--muted);font-weight:400">(optional)</small></label><input id="c_billingEmail" type="email" placeholder="For invoices only" /></div>
      <div class="field"><label>Plan *</label><select id="c_planId">${planOptionsHtml()}</select></div>
      <div class="field"><label>Business type</label><select id="c_businessTypeId">${businessTypeOptionsHtml()}</select></div>
      <div class="field hidden" id="c_yearsWrap"><label>Subscription years *</label><input id="c_subscriptionYears" type="number" min="1" value="1" /></div>
      <div class="field"><label>City</label><input id="c_city" placeholder="Printed on bills" /></div>
    </div>
    <div class="field"><label>Shop address <small style="color:var(--muted);font-weight:400">(printed on bills)</small></label><textarea id="c_address" rows="2" placeholder="Street, area, landmark…"></textarea></div>
    <p id="c_limits" style="font-size:13px;color:var(--muted);margin:0 0 8px"></p>
    <p id="c_endPreview" style="font-size:13px;color:var(--primary);font-weight:600;margin:0 0 8px"></p>
    <p id="c_catalogPreview" style="font-size:13px;color:var(--muted);margin:0 0 12px"></p>
    <div class="field"><label>Notes</label><textarea id="c_notes" rows="2"></textarea></div>
  `, async () => {
    const plan = getPlanById($('c_planId').value);
    const body = {
      name: $('c_name').value.trim(),
      slug: $('c_slug').value.trim().toLowerCase(),
      ownerName: $('c_ownerName').value.trim(),
      ownerMobile: $('c_ownerMobile').value.trim(),
      ownerPassword: $('c_ownerPassword').value,
      planId: $('c_planId').value,
      billingEmail: $('c_billingEmail').value.trim() || undefined,
      address: $('c_address').value.trim() || undefined,
      city: $('c_city').value.trim() || undefined,
      notes: $('c_notes').value.trim() || undefined,
      businessTypeId: $('c_businessTypeId').value || undefined,
    };
    if (plan && !plan.isTrial) {
      body.subscriptionYears = Number($('c_subscriptionYears').value);
    }
    await api('/tenants', { method: 'POST', body: JSON.stringify(body) });
    showAlert('Client created successfully');
    await loadDashboard();
    await loadTenants();
  });
  bindPlanFields('c');
  bindBusinessTypePreview('c');
}

async function editTenant(id) {
  let t = tenants.find((x) => x.id === id);
  if (!t) return;
  try {
    const detail = await api(`/tenants/${id}`);
    t = { ...t, ...detail };
  } catch (_) {
    /* use list row if detail fetch fails */
  }
  openModal('Edit Client & Subscription', `
    <p style="font-size:13px;color:var(--primary);margin:0 0 12px;padding:10px 12px;background:#e3f2fd;border-radius:8px;border:1px solid #90caf9">
      Mobile app login uses <strong>shop code + owner mobile + password</strong>.
    </p>
    <div class="grid-2">
      <div class="field"><label>Shop name</label><input id="e_name" value="${esc(t.name)}" /></div>
      <div class="field"><label>Slug (read-only)</label><input value="${esc(t.slug)}" disabled /></div>
      <div class="field"><label>Status</label><select id="e_status">${['trial', 'active', 'suspended', 'deleted'].map((s) => `<option ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>Owner mobile <small style="color:var(--muted);font-weight:400">(login ID)</small></label><input id="e_ownerMobile" type="tel" inputmode="numeric" maxlength="10" value="${esc(t.ownerMobile || '')}" placeholder="9876543210" /></div>
      <div class="field"><label>Billing email <small style="color:var(--muted);font-weight:400">(optional)</small></label><input id="e_billingEmail" type="email" value="${esc(t.billingEmail || '')}" placeholder="For invoices only" /></div>
      <div class="field"><label>Plan</label><select id="e_planId">${planOptionsHtml(t.planId)}</select></div>
      <div class="field"><label>Business type</label><select id="e_businessTypeId">${businessTypeOptionsHtml(t.businessTypeId)}</select></div>
      <div class="field hidden" id="e_yearsWrap"><label>Subscription years</label><input id="e_subscriptionYears" type="number" min="1" value="${t.subscriptionYears || 1}" /></div>
      <div class="field"><label>City</label><input id="e_city" value="${esc(t.city || '')}" placeholder="Printed on bills" /></div>
    </div>
    <div class="field"><label>Shop address <small style="color:var(--muted);font-weight:400">(printed on bills)</small></label><textarea id="e_address" rows="2" placeholder="Street, area, landmark…">${esc(t.address || '')}</textarea></div>
    <p id="e_limits" style="font-size:13px;color:var(--muted);margin:0 0 8px"></p>
    <p id="e_endPreview" style="font-size:13px;color:var(--primary);font-weight:600;margin:0 0 8px"></p>
    <p id="e_catalogPreview" style="font-size:12px;color:var(--muted);margin:0 0 12px">Changing business type updates the label only — catalog is preloaded at tenant creation.</p>
    <p style="font-size:12px;color:var(--muted)">Changing plan recalculates end dates from today. Current trial ends: ${fmtDate(t.trialEndsAt)} · Sub ends: ${fmtDate(t.subscriptionEndsAt)}</p>
    <div class="field" style="padding:12px;background:#f5f7fa;border-radius:8px;border:1px solid var(--border)">
      <label style="margin-bottom:8px">Owner login password</label>
      <p style="font-size:13px;color:var(--muted);margin:0 0 10px">If the shop owner forgot their password, reset it to the platform default (<code>123456</code>). Login uses <strong>mobile number</strong>.</p>
      <button type="button" class="secondary" id="e_resetPasswordBtn" title="Reset owner password to 123456">Set Default Password (123456)</button>
    </div>
    <div class="field"><label>Notes</label><textarea id="e_notes" rows="2">${esc(t.notes || '')}</textarea></div>
  `, async () => {
    const newPlanId = $('e_planId').value;
    const plan = getPlanById(newPlanId);
    const body = {
      name: $('e_name').value.trim(),
      status: $('e_status').value,
      billingEmail: $('e_billingEmail').value.trim() || null,
      ownerMobile: $('e_ownerMobile').value.trim() || null,
      address: $('e_address').value.trim(),
      city: $('e_city').value.trim(),
      notes: $('e_notes').value.trim() || null,
      businessTypeId: $('e_businessTypeId').value || null,
    };
    const newYears = plan && !plan.isTrial ? Number($('e_subscriptionYears').value) : null;
    if (newPlanId !== t.planId) {
      body.planId = newPlanId;
      if (newYears) body.subscriptionYears = newYears;
    } else if (newYears != null && newYears !== t.subscriptionYears) {
      body.planId = newPlanId;
      body.subscriptionYears = newYears;
    }
    await api(`/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    showAlert('Client updated');
    await loadDashboard();
    await loadTenants();
  });
  bindPlanFields('e', t.subscriptionYears || 1);
  $('e_resetPasswordBtn').onclick = async () => {
    await resetTenantPassword(id);
  };
  const plan = getPlanById(t.planId);
  if (plan && !plan.isTrial) {
    setTimeout(() => {
      $('e_endPreview').textContent = computeEndDatePreview(plan, t.subscriptionYears || 1);
    }, 0);
  }
}

async function resetTenantPassword(id) {
  const t = tenants.find((x) => x.id === id);
  if (!t) return;
  const defaultPassword = '123456';
  const hint = t.ownerMobile
    ? `Reset owner login for "${t.name}" (${t.slug})?\n\nMobile: ${t.ownerMobile}\nNew password: ${defaultPassword}\nPIN: 1234`
    : `Reset owner login for "${t.name}" (${t.slug})?\n\nSet owner mobile in Edit first if this fails.\nNew password: ${defaultPassword}`;
  if (!confirm(hint)) return;
  try {
    const result = await api(`/tenants/${id}/reset-owner-password`, { method: 'POST' });
    const action = result.created ? 'Owner account created' : 'Password reset';
    showAlert(`${action} for ${result.ownerMobile}. Password: ${result.defaultPassword}, PIN: ${result.pin || '1234'}`);
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

function selectTenantForProducts(id) {
  switchTab('products');
  $('productTenantSelect').value = id;
  selectedTenantId = id;
  saveProductTenant(id);
  if ($('addProductBtn')) $('addProductBtn').disabled = false;
  if ($('importProductBtn')) $('importProductBtn').disabled = false;
  if ($('importMasterProductBtn')) $('importMasterProductBtn').disabled = false;
  fillProductCategoryFilter(false).then(() => loadProducts());
}

async function loadCatalogMeta() {
  if (!selectedTenantId) return;
  catalogMeta = await api(`/tenants/${selectedTenantId}/catalog-meta`);
}

const VALID_TABS = ['dashboard', 'plans', 'business-types', 'units', 'tenants', 'products', 'shopify'];

const TAB_TITLES = {
  dashboard: 'Dashboard',
  plans: 'Subscriptions',
  'business-types': 'Product catalog',
  units: 'Units',
  tenants: 'Clients',
  products: 'Client products',
  shopify: 'Shopify',
};

const TAB_LEADS = {
  dashboard: 'Clients, plans, and catalog health at a glance',
  plans: 'Manage subscription plans and client billing periods',
  'business-types': 'Pick a shop type, then manage its categories, brands, and product templates',
  units: 'Global units of measure for every client',
  tenants: 'Shops (tenants) — owner login, plan, and status',
  products: 'Per-client products and attributes (price, tax, UOM, barcode)',
  shopify: 'Shopify connection and sync health per client',
};

function getSavedTab() {
  const hash = (location.hash || '').replace(/^#/, '');
  const stored = localStorage.getItem('adminTab') || sessionStorage.getItem('adminTab') || '';

  if (hash === 'master-products') {
    selectedCatalogTab = 'products';
    return 'business-types';
  }
  if (VALID_TABS.includes(hash)) return hash;

  if (stored === 'master-products') {
    selectedCatalogTab = 'products';
    return 'business-types';
  }
  if (VALID_TABS.includes(stored)) return stored;

  return 'dashboard';
}

function saveAdminState(tab) {
  if (!VALID_TABS.includes(tab)) return;
  localStorage.setItem('adminTab', tab);
  sessionStorage.setItem('adminTab', tab);
  try {
    const url = new URL(window.location.href);
    url.hash = tab;
    const next = `${url.pathname}${url.search}${url.hash}`;
    const cur = `${location.pathname}${location.search}${location.hash}`;
    if (cur !== next) history.replaceState(null, '', next);
  } catch (_) {
    if (location.hash !== `#${tab}`) location.hash = tab;
  }
}

function saveProductTenant(tenantId) {
  if (tenantId) sessionStorage.setItem('adminProductTenant', tenantId);
  else sessionStorage.removeItem('adminProductTenant');
}

const SIZE_PRESETS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Free Size', '28', '30', '32', '34', '36', '38', '40'];

function primaryVariant(product) {
  return (product?.variants || [])[0] || null;
}

function variantPrice(variant) {
  if (!variant) return '—';
  return Number(variant.selling_price).toFixed(2);
}

function variantBarcode(variant) {
  if (!variant?.barcodes?.length) return '';
  const primary = variant.barcodes.find((b) => b.is_primary);
  return (primary || variant.barcodes[0]).barcode || '';
}

function productHasSizes(product) {
  const variants = product?.variants || [];
  return variants.length > 1 || variants.some((v) => !!(v.size || v.color));
}

function formatPriceRange(product) {
  const variants = product?.variants || [];
  if (!variants.length) return '—';
  if (variants.length === 1) return variantPrice(variants[0]);
  const prices = variants.map((v) => Number(v.selling_price) || 0);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return min.toFixed(2);
  return `${min.toFixed(2)} – ${max.toFixed(2)}`;
}

function optionList(items, selectedId, emptyLabel) {
  const opts = emptyLabel ? `<option value="">${emptyLabel}</option>` : '';
  return opts + items.map((item) =>
    `<option value="${item.id}" ${item.id === selectedId ? 'selected' : ''}>${esc(item.name)}</option>`
  ).join('');
}

function makeSizeSku(baseSku, size) {
  const base = (baseSku || '').trim().toUpperCase().replace(/\s+/g, '');
  const suffix = String(size || '').trim().toUpperCase().replace(/\s+/g, '');
  const token = Math.random().toString(36).slice(2, 6).toUpperCase();
  // Empty product SKU used to become "M-M" for every product. That unique key
  // made the second size M fail with "Record already exists".
  const body = base
    ? `${base}-${suffix || 'VAR'}-${token}`
    : `${suffix || 'SKU'}-${token}`;
  return body.slice(0, 50);
}

function sizeRowHtml(row = {}) {
  return `
    <div class="size-row" data-variant-id="${esc(row.id || '')}" data-size="${esc(row.size || '')}">
      <div class="size-row-head">
        <span class="size-badge">${esc(row.size || '')}</span>
        <button type="button" class="danger size-remove" title="Remove size">Remove</button>
      </div>
      <div class="grid-2">
        <div class="field"><label>Selling price *</label><input class="sz-price" type="number" step="0.01" value="${row.sellingPrice ?? ''}" /></div>
        <div class="field"><label>Cost price</label><input class="sz-cost" type="number" step="0.01" value="${row.costPrice ?? ''}" /></div>
        <div class="field"><label>MRP</label><input class="sz-mrp" type="number" step="0.01" value="${row.mrp ?? ''}" /></div>
        <div class="field"><label>SKU</label><input class="sz-sku" value="${esc(row.sku || '')}" /></div>
        <div class="field" style="grid-column:1/-1"><label>Barcode</label><input class="sz-barcode" value="${esc(row.barcode || '')}" /></div>
      </div>
    </div>
  `;
}

function productFormHtml(meta, initial = {}) {
  const v = initial.variant || {};
  const units = meta.units || [];
  const categories = meta.categories || [];
  const brands = meta.brands || [];
  const taxGroups = meta.taxGroups || [];
  const sizeVariants = initial.variants || [];
  const multiSizes = sizeVariants.length > 0;

  return `
    <div class="form-section">
      <h4>Identity</h4>
      <div class="field"><label>Product name *</label><input id="p_name" value="${esc(initial.name)}" /></div>
      <div class="field"><label>Description</label><textarea id="p_desc" rows="2">${esc(initial.description)}</textarea></div>
      <div class="grid-2">
        <div class="field"><label>Status</label>
          <select id="p_status">
            <option value="active" ${initial.status === 'active' ? 'selected' : ''}>active</option>
            <option value="inactive" ${initial.status === 'inactive' ? 'selected' : ''}>inactive</option>
          </select>
        </div>
        <div class="field"><label>Unit of measure *</label>
          <select id="p_uom">${units.map((u) =>
            `<option value="${u.id}" ${u.id === initial.uomId ? 'selected' : ''}>${esc(u.name)} (${esc(u.code)})</option>`
          ).join('')}</select>
        </div>
      </div>
    </div>
    <div class="form-section">
      <h4>Classification</h4>
      <div class="grid-2">
        <div class="field">
          <label>Category</label>
          <div class="inline-add">
            <select id="p_category">${optionList(categories, initial.categoryId, '— None —')}</select>
            <button type="button" class="secondary" id="p_addCategory" title="Add category">+ Add</button>
          </div>
          <p class="hint">Categories for this client shop. Add one if the list is empty.</p>
        </div>
        <div class="field">
          <label>Brand</label>
          <div class="inline-add">
            <select id="p_brand">${optionList(brands, initial.brandId, '— None —')}</select>
            <button type="button" class="secondary" id="p_addBrand" title="Add brand">+ Add</button>
          </div>
          <p class="hint">Optional. Use + Add to create a brand for this client.</p>
        </div>
      </div>
    </div>
    <div class="form-section" id="p_singlePricing">
      <h4>Pricing &amp; codes</h4>
      <p class="hint" style="margin-bottom:10px">Used when the product has a single price. With multiple sizes, each size has its own price below.</p>
      <div class="grid-2">
        <div class="field"><label>Selling price *</label><input id="p_price" type="number" step="0.01" value="${v.sellingPrice ?? ''}" /></div>
        <div class="field"><label>Cost price</label><input id="p_cost" type="number" step="0.01" value="${v.costPrice ?? ''}" /></div>
        <div class="field"><label>MRP</label><input id="p_mrp" type="number" step="0.01" value="${v.mrp ?? ''}" /></div>
        <div class="field"><label>SKU</label><input id="p_sku" value="${esc(v.sku)}" /></div>
        <div class="field"><label>Barcode</label><input id="p_barcode" value="${esc(v.barcode)}" /></div>
      </div>
    </div>
    <div class="form-section">
      <h4>Sizes</h4>
      <label class="size-toggle">
        <input type="checkbox" id="p_multiSizes" ${multiSizes ? 'checked' : ''} />
        <span>
          <strong>Multiple sizes</strong>
          <span>Add S, M, L, XL or custom sizes — each size can have its own price, SKU and barcode</span>
        </span>
      </label>
      <div id="p_sizesPanel" style="${multiSizes ? '' : 'display:none'}">
        <div class="size-chips" id="p_sizeChips">
          ${SIZE_PRESETS.map((s) =>
            `<button type="button" class="secondary size-chip${sizeVariants.some((v) => String(v.size).toUpperCase() === s.toUpperCase()) ? ' active' : ''}" data-size="${esc(s)}" title="Toggle size ${esc(s)}">${esc(s)}</button>`
          ).join('')}
        </div>
        <div class="inline-add" style="margin-bottom:10px">
          <input id="p_customSize" placeholder="Custom size (e.g. 42, Kids)" />
          <button type="button" class="secondary" id="p_addCustomSize" title="Add a custom size">Add size</button>
        </div>
        <div class="size-rows" id="p_sizeRows">
          ${sizeVariants.map((row) => sizeRowHtml(row)).join('')}
        </div>
        <p class="hint" id="p_sizesEmpty" style="${sizeVariants.length ? 'display:none' : ''}">Tap a size chip above to add it.</p>
      </div>
    </div>
    <div class="form-section">
      <h4>Tax</h4>
      <div class="grid-2">
        <div class="field"><label>Tax group</label>
          <select id="p_taxGroup">
            <option value="">— None —</option>
            ${taxGroups.map((t) =>
              `<option value="${t.id}" ${t.id === initial.taxGroupId ? 'selected' : ''}>${esc(t.name)} (${t.totalRate}%)</option>`
            ).join('')}
          </select>
        </div>
        <div class="field"><label>Tax / HSN code</label><input id="p_taxCode" value="${esc(initial.taxCode)}" /></div>
      </div>
    </div>
  `;
}

function appendSelectOption(selectEl, item, selectIt = true) {
  if (!selectEl || !item?.id) return;
  const existing = [...selectEl.options].find((o) => o.value === item.id);
  if (existing) {
    if (selectIt) selectEl.value = item.id;
    return;
  }
  const opt = document.createElement('option');
  opt.value = item.id;
  opt.textContent = item.name;
  selectEl.appendChild(opt);
  if (selectIt) selectEl.value = item.id;
}

function syncSizeUi() {
  const multi = $('p_multiSizes')?.checked;
  const panel = $('p_sizesPanel');
  const single = $('p_singlePricing');
  if (panel) panel.style.display = multi ? '' : 'none';
  if (single) single.style.opacity = multi ? '0.55' : '1';
  const rows = document.querySelectorAll('#p_sizeRows .size-row');
  const empty = $('p_sizesEmpty');
  if (empty) empty.style.display = rows.length ? 'none' : '';
  document.querySelectorAll('#p_sizeChips .size-chip').forEach((chip) => {
    const size = chip.dataset.size || '';
    const active = [...rows].some((r) => (r.dataset.size || '').toUpperCase() === size.toUpperCase());
    chip.classList.toggle('active', active);
  });
}

function addSizeRow(size) {
  const label = String(size || '').trim();
  if (!label) return;
  const rows = $('p_sizeRows');
  if (!rows) return;
  const exists = [...rows.querySelectorAll('.size-row')].some(
    (r) => (r.dataset.size || '').toUpperCase() === label.toUpperCase()
  );
  if (exists) return;

  const baseSku = $('p_sku')?.value || '';
  const defaultPrice = $('p_price')?.value || '';
  const defaultCost = $('p_cost')?.value || '';
  const defaultMrp = $('p_mrp')?.value || '';
  rows.insertAdjacentHTML('beforeend', sizeRowHtml({
    size: label,
    sku: makeSizeSku(baseSku || label, label),
    sellingPrice: defaultPrice,
    costPrice: defaultCost,
    mrp: defaultMrp,
  }));
  syncSizeUi();
}

function wireProductFormExtras() {
  const categoryBtn = $('p_addCategory');
  const brandBtn = $('p_addBrand');
  if (categoryBtn) {
    categoryBtn.onclick = async () => {
      const name = prompt('New category name for this client:');
      if (!name?.trim()) return;
      try {
        const created = await api(`/tenants/${selectedTenantId}/categories`, {
          method: 'POST',
          body: JSON.stringify({ name: name.trim() }),
        });
        appendSelectOption($('p_category'), created, true);
        if (catalogMeta) {
          catalogMeta.categories = [...(catalogMeta.categories || []), created];
        }
        showAlert(`Category "${created.name}" added`);
      } catch (e) {
        showAlert(e.message, 'error');
      }
    };
  }
  if (brandBtn) {
    brandBtn.onclick = async () => {
      const name = prompt('New brand name for this client:');
      if (!name?.trim()) return;
      try {
        const created = await api(`/tenants/${selectedTenantId}/brands`, {
          method: 'POST',
          body: JSON.stringify({ name: name.trim() }),
        });
        appendSelectOption($('p_brand'), created, true);
        if (catalogMeta) {
          catalogMeta.brands = [...(catalogMeta.brands || []), created];
        }
        showAlert(`Brand "${created.name}" added`);
      } catch (e) {
        showAlert(e.message, 'error');
      }
    };
  }

  const multi = $('p_multiSizes');
  if (multi) {
    multi.onchange = () => syncSizeUi();
  }
  document.querySelectorAll('#p_sizeChips .size-chip').forEach((chip) => {
    chip.onclick = () => {
      if (!$('p_multiSizes').checked) {
        $('p_multiSizes').checked = true;
        syncSizeUi();
      }
      const size = chip.dataset.size;
      const rows = $('p_sizeRows');
      const existing = [...rows.querySelectorAll('.size-row')].find(
        (r) => (r.dataset.size || '').toUpperCase() === size.toUpperCase()
      );
      if (existing) {
        existing.remove();
      } else {
        addSizeRow(size);
      }
      syncSizeUi();
    };
  });
  const addCustom = $('p_addCustomSize');
  if (addCustom) {
    addCustom.onclick = () => {
      if (!$('p_multiSizes').checked) {
        $('p_multiSizes').checked = true;
      }
      addSizeRow($('p_customSize').value);
      $('p_customSize').value = '';
      syncSizeUi();
    };
  }
  const customInput = $('p_customSize');
  if (customInput) {
    customInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCustom?.click();
      }
    };
  }
  const sizeRows = $('p_sizeRows');
  if (sizeRows) {
    sizeRows.onclick = (e) => {
      const btn = e.target.closest('.size-remove');
      if (!btn) return;
      btn.closest('.size-row')?.remove();
      syncSizeUi();
    };
  }
  syncSizeUi();
}

function collectSizeVariants() {
  return [...document.querySelectorAll('#p_sizeRows .size-row')].map((row) => {
    const num = (sel) => {
      const v = row.querySelector(sel)?.value?.trim();
      return v === '' || v == null ? undefined : Number(v);
    };
    const str = (sel) => {
      const v = row.querySelector(sel)?.value?.trim();
      return v || undefined;
    };
    const id = row.dataset.variantId || undefined;
    const size = row.dataset.size || '';
    return {
      id: id || undefined,
      size,
      sellingPrice: num('.sz-price'),
      costPrice: num('.sz-cost') ?? 0,
      mrp: num('.sz-mrp'),
      sku: str('.sz-sku'),
      barcode: str('.sz-barcode'),
    };
  });
}

function collectProductForm() {
  const num = (id) => {
    const v = $(id).value.trim();
    return v === '' ? undefined : Number(v);
  };
  const str = (id) => {
    const v = $(id).value.trim();
    return v || undefined;
  };
  const nullableId = (id) => {
    const v = $(id).value;
    return v || null;
  };

  const base = {
    name: $('p_name').value.trim(),
    uomId: $('p_uom').value,
    status: $('p_status').value,
    categoryId: nullableId('p_category'),
    brandId: nullableId('p_brand'),
    taxGroupId: nullableId('p_taxGroup'),
    taxCode: str('p_taxCode'),
    description: str('p_desc'),
  };

  if ($('p_multiSizes')?.checked) {
    const variants = collectSizeVariants();
    return { ...base, variants };
  }

  return {
    ...base,
    sellingPrice: num('p_price'),
    costPrice: num('p_cost'),
    mrp: num('p_mrp'),
    sku: str('p_sku'),
    barcode: $('p_barcode').value.trim(),
  };
}

async function fillProductCategoryFilter(keepValue = true) {
  const sel = $('productCategoryFilter');
  if (!sel) return;
  const prev = keepValue ? sel.value : '';
  if (!selectedTenantId) {
    sel.innerHTML = '<option value="">All categories</option>';
    sel.disabled = true;
    enhanceSearchableSelect(sel);
    return;
  }
  sel.disabled = false;
  try {
    await loadCatalogMeta();
    const cats = catalogMeta?.categories || [];
    sel.innerHTML = '<option value="">All categories</option>' +
      cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    else sel.value = '';
  } catch {
    sel.innerHTML = '<option value="">All categories</option>';
    sel.value = '';
  }
  enhanceSearchableSelect(sel);
}

function variantCost(variant) {
  if (!variant) return '—';
  const n = Number(variant.cost_price);
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}

function variantMrp(variant) {
  if (!variant || variant.mrp == null || variant.mrp === '') return '—';
  const n = Number(variant.mrp);
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}

function updateBulkPriceToolbar() {
  const hasTenant = !!selectedTenantId;
  const selectedCount = selectedProductIds.size;
  const editBtn = $('bulkPriceEditBtn');
  const saveBtn = $('bulkPriceSaveBtn');
  const cancelBtn = $('bulkPriceCancelBtn');
  const hint = $('bulkPriceHint');
  const selectAll = $('productSelectAll');

  if (editBtn) {
    editBtn.disabled = !hasTenant || priceEditMode || selectedCount === 0;
    editBtn.classList.toggle('hidden', priceEditMode);
  }
  if (saveBtn) {
    saveBtn.classList.toggle('hidden', !priceEditMode);
    saveBtn.disabled = !priceEditMode || selectedCount === 0;
  }
  if (cancelBtn) {
    cancelBtn.classList.toggle('hidden', !priceEditMode);
  }
  if (hint) {
    hint.classList.toggle('hidden', !priceEditMode);
  }
  if (selectAll) {
    selectAll.disabled = !hasTenant || !products.length;
  }
  if ($('addProductBtn')) $('addProductBtn').disabled = !hasTenant || priceEditMode;
  if ($('importProductBtn')) $('importProductBtn').disabled = !hasTenant || priceEditMode;
  if ($('importMasterProductBtn')) $('importMasterProductBtn').disabled = !hasTenant || priceEditMode;
}

function exitPriceEditMode({ clearSelection = false } = {}) {
  priceEditMode = false;
  if (clearSelection) selectedProductIds = new Set();
  updateBulkPriceToolbar();
}

function renderTenantProductsTable({ resetPage = false, emptyHtml } = {}) {
  renderPagedTable('tenantProducts', {
    tbodyId: 'productsTable',
    rows: products,
    colspan: PRODUCT_TABLE_COLS,
    resetPage,
    emptyHtml: emptyHtml || '<tr><td colspan="12" class="empty">No products. Add one.</td></tr>',
    renderRow: (p) => {
      const v = primaryVariant(p);
      const sizeCount = (p.variants || []).length;
      const hasSizes = productHasSizes(p);
      const selected = selectedProductIds.has(p.id);
      const editing = priceEditMode && selected;
      const selling = v ? Number(v.selling_price) : '';
      const cost = v ? Number(v.cost_price) : '';
      const mrp = v?.mrp != null && v.mrp !== '' ? Number(v.mrp) : '';
      const sizeLabel = hasSizes
        ? `<br><small style="color:var(--primary)">${sizeCount} size${sizeCount === 1 ? '' : 's'}: ${(p.variants || []).map((x) => x.size || '—').join(', ')}</small>`
        : '';
      const sellingCell = editing
        ? `<input class="price-input" type="number" min="0" step="0.01" data-price-field="selling" data-id="${p.id}" value="${Number.isFinite(selling) ? selling : ''}" />`
        : (hasSizes ? formatPriceRange(p) : variantPrice(v));
      const costCell = editing
        ? `<input class="price-input" type="number" min="0" step="0.01" data-price-field="cost" data-id="${p.id}" value="${Number.isFinite(cost) ? cost : ''}" />`
        : variantCost(v);
      const mrpCell = editing
        ? `<input class="price-input" type="number" min="0" step="0.01" data-price-field="mrp" data-id="${p.id}" value="${Number.isFinite(mrp) ? mrp : ''}" />`
        : variantMrp(v);

      return `
    <tr class="${editing ? 'price-edit-row' : ''}" data-product-id="${p.id}">
      <td>
        <input type="checkbox" class="product-select" data-id="${p.id}" ${selected ? 'checked' : ''} ${priceEditMode && selected ? '' : ''} />
      </td>
      <td><strong>${esc(p.name)}</strong>${sizeLabel}${p.description ? `<br><small style="color:var(--muted)">${esc(p.description)}</small>` : ''}</td>
      <td>${esc(p.category?.name || '—')}</td>
      <td>${esc(p.brand?.name || '—')}</td>
      <td>${esc(p.uom?.code || '—')}</td>
      <td>${sellingCell}</td>
      <td>${costCell}</td>
      <td>${mrpCell}</td>
      <td><code>${esc(v?.sku || '—')}</code></td>
      <td><code>${esc(variantBarcode(v) || '—')}</code></td>
      <td>${badge(p.status)}</td>
      <td>
        ${rowActions(
          actionBtn('edit-product', p.id, { icon: 'edit', title: 'Edit', disabled: priceEditMode }),
          actionBtn('delete-product', p.id, { icon: 'delete', title: 'Delete', danger: true, disabled: priceEditMode }),
        )}
      </td>
    </tr>`;
    },
  });

  syncProductSelectAllCheckbox();
  updateBulkPriceToolbar();
}

function syncProductSelectAllCheckbox() {
  const selectAll = $('productSelectAll');
  if (!selectAll) return;
  const boxes = [...document.querySelectorAll('#productsTable .product-select')];
  if (!boxes.length) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }
  const checked = boxes.filter((b) => b.checked).length;
  selectAll.checked = checked === boxes.length;
  selectAll.indeterminate = checked > 0 && checked < boxes.length;
}

function startBulkPriceEdit() {
  if (!selectedTenantId) return;
  if (!selectedProductIds.size) {
    showAlert('Select one or more products first', 'error');
    return;
  }
  priceEditMode = true;
  renderTenantProductsTable({ resetPage: false });
}

function cancelBulkPriceEdit() {
  exitPriceEditMode({ clearSelection: false });
  renderTenantProductsTable({ resetPage: false });
}

async function saveBulkPrices() {
  if (!selectedTenantId || !priceEditMode) return;
  const ids = [...selectedProductIds];
  if (!ids.length) {
    showAlert('No products selected', 'error');
    return;
  }

  const saveBtn = $('bulkPriceSaveBtn');
  setButtonLoading(saveBtn, true, 'Saving…');
  try {
    const updates = [];
    for (const id of ids) {
      const product = products.find((p) => p.id === id);
      if (!product) continue;
      const sellingEl = document.querySelector(`input[data-price-field="selling"][data-id="${id}"]`);
      const costEl = document.querySelector(`input[data-price-field="cost"][data-id="${id}"]`);
      const mrpEl = document.querySelector(`input[data-price-field="mrp"][data-id="${id}"]`);
      if (!sellingEl) {
        // Selected product not on current page — skip silently (still selected)
        continue;
      }
      const sellingPrice = sellingEl.value.trim() === '' ? 0 : parseFloat(sellingEl.value);
      const costPrice = costEl?.value === '' ? 0 : parseFloat(costEl.value);
      const mrpRaw = mrpEl?.value?.trim() ?? '';
      const mrp = mrpRaw === '' ? null : parseFloat(mrpRaw);

      if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
        throw new Error(`Enter a valid selling price for "${product.name}"`);
      }
      if (!Number.isFinite(costPrice) || costPrice < 0) {
        throw new Error(`Enter a valid cost price for "${product.name}"`);
      }
      if (mrp != null && (!Number.isFinite(mrp) || mrp < 0)) {
        throw new Error(`Enter a valid MRP for "${product.name}"`);
      }

      const variants = product.variants || [];
      if (productHasSizes(product) && variants.length > 1) {
        updates.push({
          productId: id,
          body: {
            variants: variants.map((v) => ({
              id: v.id,
              size: v.size || '',
              color: v.color || '',
              sku: v.sku,
              sellingPrice,
              costPrice,
              mrp,
              barcode: variantBarcode(v) || undefined,
            })),
          },
        });
      } else {
        const v = primaryVariant(product);
        updates.push({
          productId: id,
          body: {
            variantId: v?.id,
            sellingPrice,
            costPrice,
            mrp,
          },
        });
      }
    }

    if (!updates.length) {
      showAlert('Open the page that contains your selected products, then save', 'error');
      return;
    }

    for (const u of updates) {
      await api(`/tenants/${selectedTenantId}/products/${u.productId}`, {
        method: 'PATCH',
        body: JSON.stringify(u.body),
      });
    }
    showAlert(`Updated prices for ${updates.length} product${updates.length === 1 ? '' : 's'}`);
    exitPriceEditMode({ clearSelection: true });
    await loadProducts();
  } catch (e) {
    showAlert(e.message || 'Could not save prices', 'error');
  } finally {
    setButtonLoading(saveBtn, false);
    updateBulkPriceToolbar();
  }
}

async function loadProducts() {
  selectedTenantId = $('productTenantSelect').value;
  exitPriceEditMode({ clearSelection: true });
  updateBulkPriceToolbar();
  if (!selectedTenantId) {
    fillProductCategoryFilter(false);
    products = [];
    renderPagedTable('tenantProducts', {
      tbodyId: 'productsTable',
      rows: [],
      colspan: PRODUCT_TABLE_COLS,
      resetPage: true,
      emptyHtml: '<tr><td colspan="12" class="empty">Select a client to manage products</td></tr>',
      renderRow: () => '',
    });
    updateBulkPriceToolbar();
    return;
  }
  renderPagedTable('tenantProducts', {
    tbodyId: 'productsTable',
    rows: [],
    colspan: PRODUCT_TABLE_COLS,
    emptyHtml: `<tr><td colspan="12" class="empty">${inlineLoadingHtml('Loading products…', true)}</td></tr>`,
    renderRow: () => '',
  });
  const search = $('productSearch').value.trim();
  const categoryId = $('productCategoryFilter')?.value;
  const params = new URLSearchParams({ limit: '1000' });
  if (search) params.set('search', search);
  if (categoryId) params.set('categoryId', categoryId);
  let data;
  try {
    data = await api(`/tenants/${selectedTenantId}/products?${params.toString()}`);
  } catch (e) {
    products = [];
    renderPagedTable('tenantProducts', {
      tbodyId: 'productsTable',
      rows: [],
      colspan: PRODUCT_TABLE_COLS,
      emptyHtml: `<tr><td colspan="12" class="empty">${esc(e.message || 'Could not load products')}</td></tr>`,
      renderRow: () => '',
    });
    updateBulkPriceToolbar();
    return;
  }
  products = data.items || [];
  renderTenantProductsTable({ resetPage: true });
}

async function deleteProduct(productId) {
  if (!confirm('Delete this product?')) return;
  await api(`/tenants/${selectedTenantId}/products/${productId}`, { method: 'DELETE' });
  showAlert('Product deleted');
  loadProducts();
}

async function addProductModal() {
  try {
    await loadCatalogMeta();
  } catch (e) {
    showAlert(e.message || 'Could not load catalog options', 'error');
    return;
  }
  const units = catalogMeta?.units || [];
  if (!units.length) {
    showAlert('No units of measure in this client. Sync units from the Units tab first.', 'error');
    return;
  }
  openModal('Add Product', productFormHtml(catalogMeta), async () => {
    const body = collectProductForm();
    if (!body.name) throw new Error('Product name is required');
    if (!body.uomId) throw new Error('Unit of measure is required');
    if (Array.isArray(body.variants)) {
      if (!body.variants.length) throw new Error('Add at least one size');
      const bad = body.variants.find((v) => {
        const price = Number(v.sellingPrice);
        return !Number.isFinite(price) || price < 0;
      });
      if (bad) throw new Error(`Enter a valid selling price for size ${bad.size || ''} (0 allowed)`);
    } else if (body.sellingPrice === undefined) {
      throw new Error('Selling price is required');
    } else if (!Number.isFinite(Number(body.sellingPrice)) || Number(body.sellingPrice) < 0) {
      throw new Error('Enter a valid selling price (0 allowed)');
    }
    await api(`/tenants/${selectedTenantId}/products`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    showAlert('Product created');
    loadProducts();
  }, { wide: true });
  wireProductFormExtras();
}

async function editProduct(productId) {
  const product = products.find((p) => p.id === productId);
  if (!product) return;

  try {
    await loadCatalogMeta();
  } catch (e) {
    showAlert(e.message || 'Could not load catalog options', 'error');
    return;
  }
  const variant = primaryVariant(product);
  const hasSizes = productHasSizes(product);
  const sizeVariants = hasSizes
    ? (product.variants || []).map((v) => ({
        id: v.id,
        size: v.size || 'Default',
        sku: v.sku || '',
        barcode: variantBarcode(v),
        sellingPrice: Number(v.selling_price) || '',
        costPrice: Number(v.cost_price) || '',
        mrp: v.mrp != null ? Number(v.mrp) : '',
      }))
    : [];

  openModal('Edit Product', productFormHtml(catalogMeta, {
    name: product.name,
    description: product.description,
    status: product.status,
    uomId: product.uom_id || product.uom?.id,
    categoryId: product.category_id || product.category?.id,
    brandId: product.brand_id || product.brand?.id,
    taxGroupId: product.tax_group_id || product.taxGroup?.id,
    taxCode: product.tax_code,
    variant: variant ? {
      variantId: variant.id,
      sku: variant.sku,
      sellingPrice: Number(variant.selling_price),
      costPrice: Number(variant.cost_price),
      mrp: variant.mrp != null ? Number(variant.mrp) : '',
      barcode: variantBarcode(variant),
    } : {},
    variants: sizeVariants,
  }), async () => {
    const body = collectProductForm();
    if (!body.name) throw new Error('Product name is required');
    if (!body.uomId) throw new Error('Unit of measure is required');
    if (Array.isArray(body.variants)) {
      if (!body.variants.length) throw new Error('Add at least one size');
      const bad = body.variants.find((v) => {
        const price = Number(v.sellingPrice);
        return !Number.isFinite(price) || price < 0;
      });
      if (bad) throw new Error(`Enter a valid selling price for size ${bad.size || ''} (0 allowed)`);
    } else if (body.sellingPrice === undefined) {
      throw new Error('Selling price is required');
    } else if (!Number.isFinite(Number(body.sellingPrice)) || Number(body.sellingPrice) < 0) {
      throw new Error('Enter a valid selling price (0 allowed)');
    }
    // Collapsing multi-size → single price must replace all size variants
    if (!Array.isArray(body.variants) && hasSizes) {
      body.variants = [{
        id: variant?.id,
        size: '',
        color: '',
        sellingPrice: body.sellingPrice,
        costPrice: body.costPrice ?? 0,
        mrp: body.mrp,
        sku: body.sku,
        barcode: body.barcode,
      }];
    } else if (!Array.isArray(body.variants) && variant) {
      body.variantId = variant.id;
    }
    await api(`/tenants/${selectedTenantId}/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    showAlert('Product updated');
    loadProducts();
  }, { wide: true });
  wireProductFormExtras();
}

const UNIT_TYPES = ['count', 'weight', 'volume', 'length'];

function unitFormHtml(allUnits, initial = {}) {
  const baseOptions = allUnits
    .filter((u) => u.id !== initial.id)
    .map((u) => `<option value="${u.id}" ${u.id === initial.baseUnitId ? 'selected' : ''}>${esc(u.name)} (${esc(u.code)})</option>`)
    .join('');

  return `
    <div class="grid-2">
      <div class="field"><label>Code *</label><input id="u_code" value="${esc(initial.code)}" placeholder="kg" ${initial.id ? '' : ''} /></div>
      <div class="field"><label>Name *</label><input id="u_name" value="${esc(initial.name)}" placeholder="Kilogram" /></div>
      <div class="field"><label>Type *</label>
        <select id="u_type">
          ${UNIT_TYPES.map((t) => `<option value="${t}" ${initial.type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Conversion factor</label><input id="u_factor" type="number" step="0.000001" value="${initial.conversionFactor ?? 1}" /></div>
      <div class="field" style="grid-column:1/-1"><label>Base unit (optional)</label>
        <select id="u_base"><option value="">— None —</option>${baseOptions}</select>
      </div>
    </div>
    <p style="font-size:12px;color:var(--muted);margin:0">Use base unit + conversion for derived units (e.g. gram → kilogram, factor 0.001).</p>
  `;
}

function collectUnitForm() {
  const factor = $('u_factor').value.trim();
  return {
    code: $('u_code').value.trim(),
    name: $('u_name').value.trim(),
    type: $('u_type').value,
    baseUnitId: $('u_base').value || null,
    conversionFactor: factor === '' ? 1 : Number(factor),
  };
}

async function loadUnits() {
  const tbody = $('unitsTable');
  units = await api('/units');
  renderPagedTable('units', {
    tbodyId: 'unitsTable',
    rows: units,
    colspan: 6,
    resetPage: true,
    emptyHtml: '<tr><td colspan="6" class="empty">No units yet. Add one.</td></tr>',
    renderRow: (u) => `
    <tr>
      <td><code>${esc(u.code)}</code></td>
      <td><strong>${esc(u.name)}</strong></td>
      <td>${u.type}</td>
      <td>${u.baseUnit ? `${esc(u.baseUnit.name)} (${esc(u.baseUnit.code)})` : '—'}</td>
      <td>${u.conversionFactor}</td>
      <td>
        ${rowActions(
          actionBtn('edit-unit', u.id, { icon: 'edit', title: 'Edit' }),
          actionBtn('delete-unit', u.id, { icon: 'delete', title: 'Delete', danger: true }),
        )}
      </td>
    </tr>`,
  });
}

const SHOPIFY_STATUS_LABELS = {
  connected: 'Connected',
  pending: 'Pending',
  error: 'Needs attention',
  disconnected: 'Disconnected',
  not_connected: 'Not connected',
  ok: 'OK',
  partial: 'Partial',
  running: 'Running',
  queued: 'Queued',
  idle: 'Idle',
};

function shopifyBadge(status) {
  const key = status || 'not_connected';
  return `<span class="badge ${esc(key)}">${esc(SHOPIFY_STATUS_LABELS[key] || key)}</span>`;
}

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString();
}

let shopifyLoadSeq = 0;
async function loadShopifyConnections() {
  const seq = ++shopifyLoadSeq;
  const params = new URLSearchParams();
  const search = $('shopifySearch')?.value?.trim();
  const status = $('shopifyStatusFilter')?.value;
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  const data = await api(`/shopify/connections${params.toString() ? `?${params}` : ''}`);
  if (seq !== shopifyLoadSeq) return;
  const s = data.summary || {};
  $('shopifyStats').innerHTML = `
    <div class="stat"><div class="lbl">Server config</div><div class="num">${s.configured ? 'Ready' : 'Not set'}</div></div>
    <div class="stat"><div class="lbl">Connected</div><div class="num">${s.connected || 0} / ${s.total || 0}</div></div>
    <div class="stat"><div class="lbl">With errors</div><div class="num">${s.errors || 0}</div></div>
    <div class="stat"><div class="lbl">Jobs in queue</div><div class="num">${s.pendingJobs || 0}</div></div>
  `;
  renderPagedTable('shopify', {
    tbodyId: 'shopifyTable',
    rows: data.items || [],
    colspan: 7,
    resetPage: true,
    emptyHtml: '<tr><td colspan="7" class="empty">No clients match.</td></tr>',
    renderRow: (r) => `
    <tr>
      <td><strong>${esc(r.customer)}</strong><br><small style="color:var(--muted)">${esc(r.slug)}</small></td>
      <td>${shopifyBadge(r.connectionStatus)}</td>
      <td>${r.store ? `${esc(r.storeName || '')}${r.storeName ? '<br>' : ''}<small>${esc(r.store)}</small>` : '—'}</td>
      <td>${fmtDateTime(r.lastSyncAt)}</td>
      <td>${r.syncStatus && r.connectionStatus !== 'not_connected' ? shopifyBadge(r.syncStatus) : '—'}</td>
      <td>${r.pendingJobs ? `${r.pendingJobs} pending` : '—'}${r.failedJobs ? `<br><small style="color:var(--bad)">${r.failedJobs} failed (30d)</small>` : ''}</td>
      <td>${r.lastError ? `<div class="shopify-error">${esc(r.lastError)}</div><small style="color:var(--muted)">${fmtDateTime(r.lastErrorAt)}</small>` : '—'}</td>
    </tr>`,
  });
}

function createUnitModal() {
  openModal('Add Unit', unitFormHtml(units), async () => {
    const body = collectUnitForm();
    if (!body.code) throw new Error('Unit code is required');
    if (!body.name) throw new Error('Unit name is required');
    await api('/units', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    showAlert('Unit created');
    loadUnits();
  });
}

function editUnit(unitId) {
  const unit = units.find((u) => u.id === unitId);
  if (!unit) return;
  openModal('Edit Unit', unitFormHtml(units, unit), async () => {
    const body = collectUnitForm();
    if (!body.code) throw new Error('Unit code is required');
    if (!body.name) throw new Error('Unit name is required');
    await api(`/units/${unitId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    showAlert('Unit updated');
    loadUnits();
  });
}

async function deleteUnit(unitId) {
  const unit = units.find((u) => u.id === unitId);
  if (!unit || !confirm(`Delete unit "${unit.name}" (${unit.code})?`)) return;
  await api(`/units/${unitId}`, { method: 'DELETE' });
  showAlert('Unit deleted');
  loadUnits();
}

async function syncUnitsToTenants() {
  if (!confirm('Push all master units to every tenant? Existing unit rows will be updated by code.')) return;
  const btn = $('syncUnitsBtn');
  setButtonLoading(btn, true, 'Syncing…');
  try {
    const result = await api('/units/sync-tenants', { method: 'POST' });
    let msg = `Synced ${result.synced} unit(s) across ${result.tenants} tenant(s)`;
    if (result.errors?.length) msg += ` (${result.errors.length} failed)`;
    showAlert(msg, result.errors?.length ? 'error' : 'success');
  } catch (e) {
    showAlert(e.message || 'Sync failed', 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

const IMPORT_NUMERIC_FIELDS = new Set(['sellingPrice', 'costPrice', 'mrp', 'wholesalePrice', 'reorderLevel']);
const CATALOG_IMPORT_NUMERIC_FIELDS = new Set(['sellingPrice', 'costPrice', 'mrp', 'sortOrder', 'sort_order']);

function normalizeImportRow(row) {
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    const k = String(key).trim();
    if (!k || val == null || val === '') continue;
    out[k] = IMPORT_NUMERIC_FIELDS.has(k) ? Number(val) : String(val).trim();
  }
  return out.name ? out : null;
}

function normalizeCatalogImportRow(row) {
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    const k = String(key).trim();
    if (!k || val == null || val === '') continue;
    out[k] = CATALOG_IMPORT_NUMERIC_FIELDS.has(k) ? Number(val) : String(val).trim();
  }
  return out.name ? out : null;
}

function bindImportFilePreview(fileInputId, statusId, normalizer) {
  const fileInput = $(fileInputId);
  const status = $(statusId);
  if (!fileInput || !status) return;
  fileInput.onchange = async () => {
    if (!fileInput.files?.[0]) return;
    try {
      const name = fileInput.files[0].name.toLowerCase();
      let rows = [];
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        rows = parseExcelBuffer(await fileInput.files[0].arrayBuffer(), normalizer);
      } else {
        rows = parseCsv(await fileInput.files[0].text()).map(normalizer).filter(Boolean);
      }
      const ext = name.split('.').pop().toLowerCase();
      status.textContent = `${rows.length} row(s) detected from ${ext === 'xlsx' || ext === 'xls' ? 'Excel' : 'CSV'} file`;
      status.style.color = 'var(--muted)';
    } catch (e) {
      status.textContent = e.message;
      status.style.color = 'var(--danger)';
    }
  };
}

function normalizeNameImportRow(row) {
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    const k = String(key).trim();
    if (!k || val == null || val === '') continue;
    out[k] = String(val).trim();
  }
  // Accept common CSV header aliases
  if (!out.name && out.Name) out.name = out.Name;
  if (!out.nameMr && (out.name_mr || out['Marathi name'] || out.marathiName)) {
    out.nameMr = out.name_mr || out['Marathi name'] || out.marathiName;
  }
  return out.name ? out : null;
}

function importMasterCategoriesModal() {
  const businessTypeId = getCatalogBusinessTypeId();
  if (!businessTypeId) {
    showAlert('Select a business type first', 'error');
    return;
  }
  const sampleCsv = 'name,nameMr,description,sortOrder\nGrocery,किराणा,Daily grocery,1\nSnacks,स्नॅक्स,Packaged snacks,2';
  openModal('Import Categories (CSV)', `
    <p style="font-size:13px;color:var(--muted);margin:0 0 12px;line-height:1.5">
      Import categories for the selected shop type from <strong>CSV</strong>.
      Required: <code>name</code>. Optional: <code>nameMr</code> (Marathi), <code>description</code>, <code>sortOrder</code>, <code>status</code>.
      Existing English names are skipped (Marathi is filled if missing).
    </p>
    <p style="margin:0 0 12px">
      <a href="#" id="mcimp_downloadCsv" style="color:var(--primary);font-weight:600">Download sample CSV</a>
    </p>
    <div class="field"><label>CSV file</label><input id="mcimp_file" type="file" accept=".csv,text/csv" /></div>
    <div class="field"><label>Or paste CSV</label><textarea id="mcimp_text" rows="8" placeholder="${sampleCsv}"></textarea></div>
    <p id="mcimp_status" style="font-size:13px;color:var(--muted);margin:0"></p>
  `, async () => {
    let rows = [];
    const fileInput = $('mcimp_file');
    const text = $('mcimp_text').value.trim();
    if (fileInput.files?.[0]) {
      rows = parseCsv(await fileInput.files[0].text()).map(normalizeNameImportRow).filter(Boolean);
    } else if (text) {
      rows = parseCsv(text).map(normalizeNameImportRow).filter(Boolean);
    }
    if (!rows.length) throw new Error('No valid rows found (each row needs name)');
    const result = await api('/master-categories/import', {
      method: 'POST',
      body: JSON.stringify({ businessTypeId, rows }),
    });
    let msg = `Imported ${result.success} categor${result.success === 1 ? 'y' : 'ies'}`;
    if (result.skipped) msg += `, ${result.skipped} skipped`;
    if (result.failed) msg += `, ${result.failed} failed`;
    showAlert(msg, result.failed ? 'error' : 'success');
    if (result.errors?.length) console.warn('Category import errors:', result.errors);
    await loadBusinessTypes();
    await loadMasterCategories();
  });
  $('mcimp_downloadCsv').onclick = (e) => {
    e.preventDefault();
    const blob = new Blob([sampleCsv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'master-categories-import-sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  bindImportFilePreview('mcimp_file', 'mcimp_status', normalizeNameImportRow);
}

function importMasterBrandsModal() {
  const businessTypeId = $('catalogBrandTypeSelect')?.value || getCatalogBusinessTypeId();
  if (!businessTypeId) {
    showAlert('Select a business type first', 'error');
    return;
  }
  const sampleCsv = 'name,nameMr,description,sortOrder\nAmul,अमूल,Dairy brand,1\nBritannia,ब्रिटानिया,Bakery brand,2';
  openModal('Import Brands (CSV)', `
    <p style="font-size:13px;color:var(--muted);margin:0 0 12px;line-height:1.5">
      Import brands for the selected shop type from <strong>CSV</strong>.
      Required: <code>name</code>. Optional: <code>nameMr</code> (Marathi), <code>description</code>, <code>sortOrder</code>, <code>status</code>.
      Existing English names are skipped (Marathi is filled if missing).
    </p>
    <p style="margin:0 0 12px">
      <a href="#" id="mbimp_downloadCsv" style="color:var(--primary);font-weight:600">Download sample CSV</a>
    </p>
    <div class="field"><label>CSV file</label><input id="mbimp_file" type="file" accept=".csv,text/csv" /></div>
    <div class="field"><label>Or paste CSV</label><textarea id="mbimp_text" rows="8" placeholder="${sampleCsv}"></textarea></div>
    <p id="mbimp_status" style="font-size:13px;color:var(--muted);margin:0"></p>
  `, async () => {
    let rows = [];
    const fileInput = $('mbimp_file');
    const text = $('mbimp_text').value.trim();
    if (fileInput.files?.[0]) {
      rows = parseCsv(await fileInput.files[0].text()).map(normalizeNameImportRow).filter(Boolean);
    } else if (text) {
      rows = parseCsv(text).map(normalizeNameImportRow).filter(Boolean);
    }
    if (!rows.length) throw new Error('No valid rows found (each row needs name)');
    const result = await api('/master-brands/import', {
      method: 'POST',
      body: JSON.stringify({ businessTypeId, rows }),
    });
    let msg = `Imported ${result.success} brand${result.success === 1 ? '' : 's'}`;
    if (result.skipped) msg += `, ${result.skipped} skipped`;
    if (result.failed) msg += `, ${result.failed} failed`;
    showAlert(msg, result.failed ? 'error' : 'success');
    if (result.errors?.length) console.warn('Brand import errors:', result.errors);
    await loadBusinessTypes();
    await loadMasterBrands();
  });
  $('mbimp_downloadCsv').onclick = (e) => {
    e.preventDefault();
    const blob = new Blob([sampleCsv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'master-brands-import-sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  bindImportFilePreview('mbimp_file', 'mbimp_status', normalizeNameImportRow);
}

function importCatalogProductsModal() {
  const defaultBusinessTypeId = $('catalogProductTypeSelect')?.value || getCatalogBusinessTypeId() || '';
  const sampleCsv = 'name,nameMr,sellingPrice,costPrice,mrp,uom,category,categoryNameMr,brand,brandNameMr,sku,barcode,description,sortOrder,businessTypeCode\nRice 1kg,तांदूळ १ किलो,60,50,65,kg,Grocery,किराणा,India Gate,इंडिया गेट,KIR-RICE-1KG,8901001001001,Basmati rice,1,kirana';

  openModal('Import Catalog Products', `
    <p style="font-size:13px;color:var(--muted);margin:0 0 12px;line-height:1.5">
      Import product templates into the <strong>catalog master</strong> (not tenant shops).
      Supports <strong>Excel (.xlsx)</strong>, <strong>CSV</strong>, and <strong>JSON</strong>.
      Required: <code>name</code>, <code>sellingPrice</code>.
      Optional: <code>nameMr, costPrice, mrp, uom, category, categoryNameMr, brand, brandNameMr, sku, barcode, description, sortOrder, businessTypeCode</code>.
      Unknown categories/brands are created automatically for the selected business type.
    </p>
    <div class="field">
      <label>Default business type</label>
      <select id="cimp_businessTypeId">${businessTypeOptionsHtml(defaultBusinessTypeId, 'Use businessTypeCode column per row')}</select>
      <small style="color:var(--muted)">Applies when rows do not include <code>businessTypeCode</code></small>
    </div>
    <div class="grid-2">
      <div class="field"><label><input type="checkbox" id="cimp_createCategories" checked /> Auto-create categories</label></div>
      <div class="field"><label><input type="checkbox" id="cimp_createBrands" checked /> Auto-create brands</label></div>
      <div class="field"><label><input type="checkbox" id="cimp_skipDuplicates" checked /> Skip duplicate SKUs</label></div>
    </div>
    <p style="margin:0 0 12px">
      <a href="${BASE}/admin/samples/catalog-product-import-sample.xlsx" download="catalog-product-import-sample.xlsx" style="color:var(--primary);font-weight:600;margin-right:16px">
        Download sample Excel
      </a>
      <a href="#" id="cimp_downloadCsv" style="color:var(--primary);font-weight:600">Download sample CSV</a>
    </p>
    <div class="field"><label>Excel / CSV file</label><input id="cimp_file" type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /></div>
    <div class="field"><label>Or paste CSV / JSON</label><textarea id="cimp_text" rows="8" placeholder="${sampleCsv}"></textarea></div>
    <p id="cimp_status" style="font-size:13px;color:var(--muted);margin:0"></p>
  `, async () => {
    let rows = [];
    const fileInput = $('cimp_file');
    const text = $('cimp_text').value.trim();

    if (fileInput.files && fileInput.files[0]) {
      const name = fileInput.files[0].name.toLowerCase();
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        rows = parseExcelBuffer(await fileInput.files[0].arrayBuffer(), normalizeCatalogImportRow);
      } else {
        rows = parseCsv(await fileInput.files[0].text()).map(normalizeCatalogImportRow).filter(Boolean);
      }
    } else if (text) {
      if (text.startsWith('[') || text.startsWith('{')) {
        const parsed = JSON.parse(text);
        const raw = Array.isArray(parsed) ? parsed : parsed.rows || [];
        rows = raw.map(normalizeCatalogImportRow).filter(Boolean);
      } else {
        rows = parseCsv(text).map(normalizeCatalogImportRow).filter(Boolean);
      }
    }

    if (!rows.length) throw new Error('No valid rows found (each row needs name and sellingPrice)');

    const businessTypeId = $('cimp_businessTypeId').value || undefined;
    if (!businessTypeId && !rows.some((r) => r.businessTypeCode || r.businessType)) {
      throw new Error('Select a business type or include businessTypeCode in each row');
    }

    const result = await api('/master-products/import', {
      method: 'POST',
      body: JSON.stringify({
        businessTypeId,
        rows,
        options: {
          createCategories: $('cimp_createCategories').checked,
          createBrands: $('cimp_createBrands')?.checked !== false,
          skipDuplicates: $('cimp_skipDuplicates').checked,
        },
      }),
    });

    let msg = `Imported ${result.success} product(s)`;
    if (result.skipped) msg += `, ${result.skipped} skipped (duplicate SKU)`;
    if (result.categoriesCreated) msg += `, ${result.categoriesCreated} new categor${result.categoriesCreated === 1 ? 'y' : 'ies'}`;
    if (result.brandsCreated) msg += `, ${result.brandsCreated} new brand${result.brandsCreated === 1 ? '' : 's'}`;
    if (result.failed) msg += `, ${result.failed} failed`;
    showAlert(msg, result.failed ? 'error' : 'success');
    if (result.errors?.length) console.warn('Catalog import errors:', result.errors);

    await loadBusinessTypes();
    await loadCatalogProducts();
    if (selectedCatalogTab === 'categories') await loadMasterCategories();
    if (selectedCatalogTab === 'brands') await loadMasterBrands();
  });

  $('cimp_downloadCsv').onclick = (e) => {
    e.preventDefault();
    const blob = new Blob([sampleCsv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catalog-product-import-sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  bindImportFilePreview('cimp_file', 'cimp_status', normalizeCatalogImportRow);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = parseLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      const val = cells[idx] ?? '';
      if (val !== '') row[h] = val;
    });
    return row;
  });
}

function parseExcelBuffer(buffer, normalizer = normalizeImportRow) {
  if (typeof XLSX === 'undefined') {
    throw new Error('Excel parser is still loading. Wait a moment and try again.');
  }
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
  return rows.map(normalizer).filter(Boolean);
}

async function parseImportFile(file, normalizer = normalizeImportRow) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseExcelBuffer(await file.arrayBuffer(), normalizer);
  }
  return parseCsv(await file.text()).map(normalizer).filter(Boolean);
}

async function importMasterProductsModal() {
  if (!selectedTenantId) {
    showAlert('Select a client first', 'error');
    return;
  }

  const triggerBtn = $('importMasterProductBtn');
  setButtonLoading(triggerBtn, true, 'Opening…');

  let businessTypes = [];
  let categories = [];
  let products = [];
  let selectedIds = new Set();
  let productsLoadSeq = 0;

  try {
    businessTypes = await api(`/tenants/${selectedTenantId}/master-catalog/business-types`);
  } catch (e) {
    setButtonLoading(triggerBtn, false);
    showAlert(e.message || 'Could not load master catalog', 'error');
    return;
  }

  setButtonLoading(triggerBtn, false);

  const typeOptions = (businessTypes || [])
    .map((t) => {
      const selected = (t.isTenantDefault || t.isDefault || t.isTenantDefault) ? 'selected' : '';
      const count = t.productCount ?? t.count ?? 0;
      return `<option value="${esc(t.id)}" ${selected}>${esc(t.name)} (${count})</option>`;
    })
    .join('');

  openModal('Import Master Products', `
    <p style="font-size:13px;color:var(--muted);margin:0 0 10px">
      Copy products from the admin master catalog into this client.
      Name and category are copied. <strong>Selling price is set to 0</strong> so the client can set their own price.
      Master catalog is never changed.
    </p>
    <div class="grid-2">
      <div class="field"><label>Business type</label>
        <select id="mimp_businessTypeId">${typeOptions || '<option value="">No catalogs</option>'}</select>
      </div>
      <div class="field"><label>Category</label>
        <select id="mimp_categoryId"><option value="">Loading categories…</option></select>
      </div>
    </div>
    <div class="field"><label>Search</label><input id="mimp_search" placeholder="Search master products..." /></div>
    <div style="display:flex;gap:8px;margin:8px 0;align-items:center">
      <button type="button" class="secondary" id="mimp_selectAll" title="Select all products in the list">Select all</button>
      <button type="button" class="secondary" id="mimp_clear" title="Clear selected products">Clear</button>
      <span id="mimp_count" style="font-size:13px;color:var(--muted)">0 selected</span>
    </div>
    <div id="mimp_list" class="mimp-list is-loading">${inlineLoadingHtml('Loading products…', true)}</div>
  `, async () => {
    const ids = [...selectedIds];
    if (!ids.length) throw new Error('Select at least one product');
    const result = await api(`/tenants/${selectedTenantId}/products/import-from-master`, {
      method: 'POST',
      body: JSON.stringify({ masterProductIds: ids }),
    });
    const imported = result.imported ?? result.created ?? 0;
    const skipped = result.skipped ?? 0;
    const failed = result.failed ?? 0;
    if (failed && result.errors?.length) {
      const detail = result.errors.slice(0, 3).map((e) => e.message || e.name).join('; ');
      showAlert(`Imported ${imported}, skipped ${skipped}, failed ${failed}. ${detail}`, failed === imported + skipped + failed ? 'error' : 'success');
    } else {
      showAlert(`Imported ${imported}, skipped ${skipped}, failed ${failed}`);
    }
    await loadProducts();
  }, { wide: true, saveLabel: 'Import selected', loadingLabel: 'Importing…' });

  const showListError = (msg) => {
    const el = $('modalAlert');
    if (el) {
      el.textContent = msg;
      el.classList.remove('hidden');
    } else {
      showAlert(msg, 'error');
    }
  };

  const setMimpFiltersBusy = (busy) => {
    ['mimp_businessTypeId', 'mimp_categoryId', 'mimp_search', 'mimp_selectAll', 'mimp_clear'].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = busy;
    });
  };

  const showListLoading = (message = 'Loading products…') => {
    const wrap = $('mimp_list');
    if (!wrap) return;
    wrap.classList.add('is-loading');
    wrap.innerHTML = inlineLoadingHtml(message, true);
  };

  const updateCount = () => {
    const el = $('mimp_count');
    if (el) el.textContent = `${selectedIds.size} selected`;
  };

  const productLabel = (p) => p.name || p.productName || p.title || 'Unnamed product';
  const categoryLabel = (p) => p.categoryName || p.category?.name || 'Uncategorized';

  const renderList = () => {
    const wrap = $('mimp_list');
    if (!wrap) return;
    wrap.classList.remove('is-loading');
    if (!products.length) {
      wrap.innerHTML = '<p class="mimp-empty">No master products found for this filter</p>';
      return;
    }
    wrap.innerHTML = products.map((p) => `
      <div class="mimp-row">
        <input type="checkbox" data-id="${esc(p.id)}" ${selectedIds.has(p.id) ? 'checked' : ''} />
        <div class="mimp-row-text">
          <div class="mimp-name">${esc(productLabel(p))}</div>
          <div class="mimp-meta">${esc(categoryLabel(p))} · ₹0</div>
        </div>
      </div>
    `).join('');
    wrap.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.onchange = () => {
        if (cb.checked) selectedIds.add(cb.dataset.id);
        else selectedIds.delete(cb.dataset.id);
        updateCount();
      };
    });
  };

  const reloadCategories = async () => {
    const btId = $('mimp_businessTypeId')?.value;
    const catSel = $('mimp_categoryId');
    if (catSel) {
      catSel.disabled = true;
      catSel.innerHTML = '<option value="">Loading categories…</option>';
    }
    try {
      categories = btId
        ? await api(`/tenants/${selectedTenantId}/master-catalog/categories?businessTypeId=${encodeURIComponent(btId)}`)
        : [];
    } catch (e) {
      categories = [];
      showListError(e.message || 'Could not load categories');
    }
    if (catSel) {
      catSel.disabled = false;
      catSel.innerHTML = `<option value="">All categories</option>${(categories || []).map((c) =>
        `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}`;
      enhanceSearchableSelect(catSel);
    }
  };

  const reloadProducts = async () => {
    const seq = ++productsLoadSeq;
    showListLoading('Loading products…');
    setMimpFiltersBusy(true);
    const params = new URLSearchParams();
    const btId = $('mimp_businessTypeId')?.value;
    const catId = $('mimp_categoryId')?.value;
    const q = $('mimp_search')?.value?.trim();
    if (btId) params.set('businessTypeId', btId);
    if (catId) params.set('categoryId', catId);
    if (q) params.set('search', q);
    params.set('limit', '500');
    try {
      const data = await api(`/tenants/${selectedTenantId}/master-catalog/products?${params.toString()}`);
      if (seq !== productsLoadSeq) return;
      products = Array.isArray(data) ? data : (data?.items || data?.rows || []);
      const alertEl = $('modalAlert');
      if (alertEl && products.length) {
        alertEl.classList.add('hidden');
        alertEl.textContent = '';
      }
    } catch (e) {
      if (seq !== productsLoadSeq) return;
      products = [];
      showListError(e.message || 'Could not load master products');
    } finally {
      if (seq !== productsLoadSeq) return;
      setMimpFiltersBusy(false);
      renderList();
      updateCount();
    }
  };

  await reloadCategories();
  await reloadProducts();

  if ($('mimp_businessTypeId')) {
    $('mimp_businessTypeId').onchange = async () => {
      selectedIds.clear();
      updateCount();
      await reloadCategories();
      await reloadProducts();
    };
  }
  if ($('mimp_categoryId')) {
    $('mimp_categoryId').onchange = () => {
      selectedIds.clear();
      updateCount();
      reloadProducts();
    };
  }
  let searchTimer;
  if ($('mimp_search')) {
    $('mimp_search').oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => reloadProducts(), 250);
    };
  }
  if ($('mimp_selectAll')) {
    $('mimp_selectAll').onclick = () => {
      products.forEach((p) => selectedIds.add(p.id));
      renderList();
      updateCount();
    };
  }
  if ($('mimp_clear')) {
    $('mimp_clear').onclick = () => {
      selectedIds.clear();
      renderList();
      updateCount();
    };
  }
}

function importProductsModal() {
  if (!selectedTenantId) {
    showAlert('Select a tenant first', 'error');
    return;
  }
  const sample = 'name,sellingPrice,costPrice,mrp,uom,category,brand,sku,barcode,description\nRice 1kg,60,50,65,kg,Grocery,Acme,SKU-RICE,8901234567890,Premium rice';
  openModal('Import Products', `
    <p style="font-size:13px;color:var(--muted);margin:0 0 10px">
      Upload an <strong>Excel (.xlsx)</strong> or CSV file, or paste CSV/JSON below.
      Required column: <code>name</code>.
      Optional: <code>sellingPrice, costPrice, mrp, wholesalePrice, reorderLevel, uom, category, brand, sku, barcode, taxCode, description</code>.
      Unknown categories/brands are created automatically. Default UOM is <code>pcs</code>.
    </p>
    <p style="margin:0 0 12px">
      <a href="${BASE}/admin/samples/product-import-sample.xlsx" download="product-import-sample.xlsx" style="color:var(--primary);font-weight:600">
        Download sample Excel sheet
      </a>
    </p>
    <div class="field"><label>Excel / CSV file</label><input id="imp_file" type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /></div>
    <div class="field"><label>Or paste CSV / JSON</label><textarea id="imp_text" rows="8" placeholder="${sample}"></textarea></div>
    <p id="imp_status" style="font-size:13px;color:var(--muted)"></p>
  `, async () => {
    let rows = [];
    const fileInput = $('imp_file');
    const text = $('imp_text').value.trim();

    if (fileInput.files && fileInput.files[0]) {
      rows = await parseImportFile(fileInput.files[0]);
    } else if (text) {
      if (text.startsWith('[') || text.startsWith('{')) {
        const parsed = JSON.parse(text);
        const raw = Array.isArray(parsed) ? parsed : parsed.rows || [];
        rows = raw.map(normalizeImportRow).filter(Boolean);
      } else {
        rows = parseCsv(text);
      }
    }

    if (!rows.length) throw new Error('No valid rows found (each row needs a name)');

    const result = await api(`/tenants/${selectedTenantId}/products/import`, {
      method: 'POST',
      body: JSON.stringify({ rows }),
    });

    let msg = `Imported ${result.success} product(s)`;
    if (result.failed) msg += `, ${result.failed} failed`;
    showAlert(msg, result.failed ? 'error' : 'success');
    if (result.errors?.length) {
      console.warn('Import errors:', result.errors);
    }
    loadProducts();
  });

  const fileInput = $('imp_file');
  const status = $('imp_status');
  fileInput.onchange = async () => {
    if (!fileInput.files?.[0]) return;
    try {
      const rows = await parseImportFile(fileInput.files[0]);
      const ext = fileInput.files[0].name.split('.').pop().toLowerCase();
      status.textContent = `${rows.length} row(s) detected from ${ext === 'xlsx' || ext === 'xls' ? 'Excel' : 'CSV'} file`;
    } catch (e) {
      status.textContent = e.message;
      status.style.color = 'var(--danger)';
    }
  };
}

function switchTab(tab, persist = true, options = {}) {
  if (!VALID_TABS.includes(tab)) tab = 'dashboard';
  document.querySelectorAll('.nav-btn[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  VALID_TABS.forEach((t) => {
    const el = $('tab-' + t);
    if (el) el.classList.toggle('hidden', t !== tab);
  });
  const title = $('pageTitle');
  if (title) title.textContent = TAB_TITLES[tab] || tab;
  const lead = $('pageLead');
  if (lead) lead.textContent = TAB_LEADS[tab] || '';
  document.documentElement.dataset.adminTab = tab;
  // Always remember the active tab (even during boot restore).
  if (persist) saveAdminState(tab);
  if (options.uiOnly) return;
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'plans') {
    loadPlans();
    switchSubTab(selectedSubTab, false);
  }
  if (tab === 'business-types') {
    loadBusinessTypes();
  }
  if (tab === 'products') {
    fillProductCategoryFilter(!!selectedTenantId).then(() => loadProducts());
  }
  if (tab === 'units') loadUnits();
  if (tab === 'tenants') loadTenants();
  if (tab === 'shopify') loadShopifyConnections();
}

function bindEvents() {
  document.querySelectorAll('.nav-btn[data-tab]').forEach((btn) => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
  document.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.onclick = () => {
      const tab = btn.dataset.goto;
      switchTab(tab);
      if (btn.dataset.actionGoto === 'create' && tab === 'tenants') {
        setTimeout(() => createTenantModal(), 50);
      }
    };
  });
  document.querySelectorAll('.sub-tab').forEach((btn) => {
    btn.onclick = () => switchSubTab(btn.dataset.subTab);
  });
  $('loginBtn').onclick = login;
  $('logoutBtn').onclick = () => {
    clearSession();
    document.documentElement.classList.remove('has-admin-session');
    localStorage.removeItem('adminTab');
    sessionStorage.removeItem('adminTab');
    sessionStorage.removeItem('adminProductTenant');
    sessionStorage.removeItem('catalogTab');
    sessionStorage.removeItem('catalogBusinessTypeId');
    sessionStorage.removeItem('subTab');
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    location.reload();
  };
  $('createPlanBtn').onclick = createPlanModal;
  $('createBusinessTypeBtn').onclick = createBusinessTypeModal;
  $('createMasterCategoryBtn').onclick = createMasterCategoryModal;
  if ($('importMasterCategoriesBtn')) $('importMasterCategoriesBtn').onclick = importMasterCategoriesModal;
  if ($('createMasterBrandBtn')) $('createMasterBrandBtn').onclick = createMasterBrandModal;
  if ($('importMasterBrandsBtn')) $('importMasterBrandsBtn').onclick = importMasterBrandsModal;
  $('createMasterProductBtn').onclick = createMasterProductModal;
  $('importCatalogProductsBtn').onclick = importCatalogProductsModal;
  if ($('importOpenFoodMasterBtn')) $('importOpenFoodMasterBtn').onclick = importOpenFoodMasterModal;
  document.querySelectorAll('.catalog-tab').forEach((btn) => {
    btn.onclick = () => switchCatalogTab(btn.dataset.catalogTab);
  });
  $('createTenantBtn').onclick = createTenantModal;
  $('addProductBtn').onclick = addProductModal;
  $('importProductBtn').onclick = importProductsModal;
  if ($('importMasterProductBtn')) $('importMasterProductBtn').onclick = importMasterProductsModal;
  $('createUnitBtn').onclick = createUnitModal;
  $('syncUnitsBtn').onclick = syncUnitsToTenants;
  $('shopifySearch').oninput = () => loadShopifyConnections();
  $('shopifyStatusFilter').onchange = () => loadShopifyConnections();
  $('shopifyRefreshBtn').onclick = () => loadShopifyConnections();
  $('tenantSearch').oninput = () => loadTenants();
  $('tenantStatusFilter').onchange = () => loadTenants();
  $('tenantPlanFilter').onchange = () => loadTenants();
  if ($('subClientSearch')) $('subClientSearch').oninput = () => loadClientSubscriptions();
  if ($('subStatusFilter')) $('subStatusFilter').onchange = () => loadClientSubscriptions();
  if ($('refreshSubsBtn')) $('refreshSubsBtn').onclick = () => loadClientSubscriptions();
  $('productTenantSelect').onchange = async () => {
    saveProductTenant($('productTenantSelect').value);
    selectedTenantId = $('productTenantSelect').value;
    await fillProductCategoryFilter(false);
    loadProducts();
  };
  $('productSearch').oninput = () => loadProducts();
  if ($('productCategoryFilter')) $('productCategoryFilter').onchange = () => loadProducts();
  $('catalogBusinessTypeSelect').onchange = () => {
    selectCatalogBusinessType($('catalogBusinessTypeSelect').value);
  };
  if ($('catalogBrandTypeSelect')) {
    $('catalogBrandTypeSelect').onchange = () => {
      selectCatalogBusinessType($('catalogBrandTypeSelect').value);
    };
  }
  $('catalogProductTypeSelect').onchange = async () => {
    selectCatalogBusinessType($('catalogProductTypeSelect').value);
  };
  if ($('catalogProductCategorySelect')) {
    $('catalogProductCategorySelect').onchange = () => loadCatalogProducts();
  }
  $('catalogProductSearch').oninput = () => loadCatalogProducts();
  if ($('catalogTypeList')) {
    $('catalogTypeList').onclick = (e) => {
      const btn = e.target.closest('.catalog-type-item');
      if (!btn) return;
      selectCatalogBusinessType(btn.dataset.typeId);
    };
  }
  if ($('editCatalogTypeBtn')) {
    $('editCatalogTypeBtn').onclick = () => {
      if (selectedCatalogBusinessTypeId) editBusinessType(selectedCatalogBusinessTypeId);
    };
  }
  if ($('deleteCatalogTypeBtn')) {
    $('deleteCatalogTypeBtn').onclick = () => {
      if (selectedCatalogBusinessTypeId) deleteBusinessType(selectedCatalogBusinessTypeId);
    };
  }
  if ($('adminUsername')) $('adminUsername').onkeydown = (e) => { if (e.key === 'Enter') login(); };
  if ($('adminPassword')) $('adminPassword').onkeydown = (e) => { if (e.key === 'Enter') login(); };

  const handleTenantAction = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'edit-tenant') editTenant(id);
    if (btn.dataset.action === 'reset-tenant-password') resetTenantPassword(id);
    if (btn.dataset.action === 'tenant-products') selectTenantForProducts(id);
  };

  const onPlanAction = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'edit-plan') editPlan(id);
    if (btn.dataset.action === 'delete-plan') deletePlan(id);
  };
  if ($('plansTable')) $('plansTable').onclick = onPlanAction;
  if ($('plansGrid')) $('plansGrid').onclick = onPlanAction;

  $('tenantsTable').onclick = handleTenantAction;
  if ($('clientSubsTable')) $('clientSubsTable').onclick = handleTenantAction;
  if ($('dashboardExpiringTable')) $('dashboardExpiringTable').onclick = handleTenantAction;

  $('productsTable').onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'edit-product') editProduct(id);
    if (btn.dataset.action === 'delete-product') deleteProduct(id);
  };

  $('productsTable').onchange = (e) => {
    const box = e.target.closest('.product-select');
    if (!box) return;
    const id = box.dataset.id;
    if (!id) return;
    if (box.checked) selectedProductIds.add(id);
    else selectedProductIds.delete(id);
    if (priceEditMode) {
      renderTenantProductsTable({ resetPage: false });
      return;
    }
    syncProductSelectAllCheckbox();
    updateBulkPriceToolbar();
  };

  if ($('productSelectAll')) {
    $('productSelectAll').onchange = () => {
      const selectAll = $('productSelectAll');
      const boxes = [...document.querySelectorAll('#productsTable .product-select')];
      boxes.forEach((box) => {
        box.checked = selectAll.checked;
        if (selectAll.checked) selectedProductIds.add(box.dataset.id);
        else selectedProductIds.delete(box.dataset.id);
      });
      if (priceEditMode) renderTenantProductsTable({ resetPage: false });
      else {
        syncProductSelectAllCheckbox();
        updateBulkPriceToolbar();
      }
    };
  }

  if ($('bulkPriceEditBtn')) $('bulkPriceEditBtn').onclick = () => startBulkPriceEdit();
  if ($('bulkPriceCancelBtn')) $('bulkPriceCancelBtn').onclick = () => cancelBulkPriceEdit();
  if ($('bulkPriceSaveBtn')) {
    $('bulkPriceSaveBtn').onclick = () => {
      saveBulkPrices().catch((e) => showAlert(e.message || 'Could not save prices', 'error'));
    };
  }

  $('unitsTable').onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'edit-unit') editUnit(id);
    if (btn.dataset.action === 'delete-unit') deleteUnit(id);
  };

  $('businessTypesTable').onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'edit-btype') editBusinessType(id);
    if (btn.dataset.action === 'catalog-categories') manageCategoriesForType(id);
    if (btn.dataset.action === 'catalog-brands') manageBrandsForType(id);
    if (btn.dataset.action === 'catalog-products') manageProductsForType(id);
    if (btn.dataset.action === 'delete-btype') deleteBusinessType(id);
  };

  $('masterCategoriesTable').onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'edit-mcat') editMasterCategory(id);
    if (btn.dataset.action === 'delete-mcat') deleteMasterCategory(id);
  };

  if ($('masterBrandsTable')) {
    $('masterBrandsTable').onclick = (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.action === 'edit-mbrand') editMasterBrand(id);
      if (btn.dataset.action === 'delete-mbrand') deleteMasterBrand(id);
    };
  }

  $('catalogProductsTable').onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'edit-mprod') editMasterProduct(id);
    if (btn.dataset.action === 'delete-mprod') deleteMasterProduct(id);
  };
}

function init() {
  bindEvents();
  enhanceAdminUi();
  window.addEventListener('hashchange', () => {
    if ($('appView').classList.contains('hidden') && !document.documentElement.classList.contains('has-admin-session')) return;
    switchTab(getSavedTab(), true);
  });
  // Persist hash into storage before async login so refresh keeps the page.
  const bootTab = getSavedTab();
  if (bootTab) {
    localStorage.setItem('adminTab', bootTab);
    sessionStorage.setItem('adminTab', bootTab);
  }
  if (platformKey) {
    if ($('adminUsername')) $('adminUsername').value = platformUser || '';
    if ($('adminPassword')) $('adminPassword').value = platformKey;
    // Show the last tab right away (before network) when session exists.
    if (document.documentElement.classList.contains('has-admin-session') || platformKey) {
      $('loginView')?.classList.add('hidden');
      $('appView')?.classList.remove('hidden');
      // Show the last tab shell immediately; data loads after silent login succeeds.
      switchTab(bootTab, true, { uiOnly: true });
    }
    login({ silent: true });
  } else {
    document.documentElement.classList.remove('has-admin-session');
  }
}

document.addEventListener('DOMContentLoaded', init);
