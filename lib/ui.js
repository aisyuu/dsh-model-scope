/**
 * dsh-model-scope — floating panel for switching many conversations' model.
 *
 * Two independent axes, matching the server:
 *   scope  — which conversations this applies to (all / a workspace / the
 *            unmounted rest / every conversation currently on one provider);
 *   target — one provider/model plus an optional reasoning effort.
 *
 * The panel only paints; every count it shows comes from /status, so a scope
 * with zero conversations is visible before anything is written.
 */
(() => {
  const STATE_KEY = '__DSH_MODEL_SCOPE__';
  if (globalThis[STATE_KEY]) return;
  globalThis[STATE_KEY] = true;

  const CATALOG_URL = '/dsh-model-scope/catalog';
  const STATUS_URL = '/dsh-model-scope/status';
  const APPLY_URL = '/dsh-model-scope/apply';

  const css = document.createElement('style');
  css.textContent = `
.dsh-ma-root{position:fixed;right:18px;bottom:18px;z-index:1200;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e8ecf2}
.dsh-ma-toggle{display:flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(28,32,42,.92);color:inherit;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.35);backdrop-filter:blur(8px)}
.dsh-ma-toggle:hover{background:rgba(42,48,62,.95)}
.dsh-ma-panel{position:absolute;right:0;bottom:46px;width:min(560px,calc(100vw - 36px));height:min(78vh,660px);display:flex;flex-direction:column;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(22,25,33,.97);box-shadow:0 18px 48px rgba(0,0,0,.5);overflow:hidden}
.dsh-ma-panel[hidden]{display:none}
.dsh-ma-head{flex:none;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-ma-title{font-weight:600}
.dsh-ma-close{border:0;background:transparent;color:#9aa4b5;font-size:16px;cursor:pointer;padding:2px 6px;border-radius:6px}
.dsh-ma-close:hover{background:rgba(255,255,255,.08);color:#e8ecf2}

/* scope bar */
.dsh-ma-scope{flex:none;padding:8px 10px 6px;border-bottom:1px solid rgba(255,255,255,.07)}
.dsh-ma-scope-label{color:#7f8b9e;font-size:11px;letter-spacing:.04em;text-transform:uppercase;margin:0 2px 5px}
.dsh-ma-chips{display:flex;flex-wrap:wrap;gap:5px}
.dsh-ma-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(255,255,255,.16);background:transparent;color:#b9c3d3;border-radius:999px;padding:3px 10px;font:inherit;font-size:11.5px;cursor:pointer}
.dsh-ma-chip:hover{background:rgba(255,255,255,.08);color:#fff}
.dsh-ma-chip[data-on="1"]{background:rgba(120,170,255,.26);border-color:rgba(120,170,255,.6);color:#fff}
.dsh-ma-chip-n{font-size:10.5px;color:#7f8b9e}
.dsh-ma-chip[data-on="1"] .dsh-ma-chip-n{color:#cfdcff}
.dsh-ma-providerrow{display:flex;align-items:center;gap:6px;margin-top:6px}
.dsh-ma-providerrow label{color:#7f8b9e;font-size:11.5px;white-space:nowrap}
.dsh-ma-providerrow select{flex:1 1 auto;min-width:0;padding:3px 6px;border-radius:7px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#dfe6f0;font:inherit;font-size:11.5px;outline:none}

/* collapsible stats */
.dsh-ma-stats{flex:none;border-bottom:1px solid rgba(255,255,255,.07)}
.dsh-ma-statsbar{display:flex;align-items:center;gap:6px;width:100%;padding:6px 12px;border:0;background:transparent;color:#9aa4b5;font:inherit;font-size:12px;text-align:left;cursor:pointer}
.dsh-ma-statsbar:hover{color:#cfd8e6}
.dsh-ma-statsbar-chevron{flex:none;transition:transform .15s}
.dsh-ma-stats[data-open="1"] .dsh-ma-statsbar-chevron{transform:rotate(90deg)}
.dsh-ma-statsbody{display:none;max-height:110px;overflow:auto;padding:0 12px 8px;color:#8b96a8;font-size:11.5px;white-space:pre-wrap}
.dsh-ma-stats[data-open="1"] .dsh-ma-statsbody{display:block}

/* search */
.dsh-ma-search{flex:none;padding:7px 10px;border-bottom:1px solid rgba(255,255,255,.07)}
.dsh-ma-search input{width:100%;box-sizing:border-box;padding:6px 9px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:inherit;font:inherit;font-size:12.5px;outline:none}
.dsh-ma-search input:focus{border-color:rgba(120,170,255,.55);background:rgba(255,255,255,.08)}
.dsh-ma-search input::placeholder{color:#6f7a8c}

/* model list */
.dsh-ma-body{flex:1 1 auto;min-height:0;padding:4px 6px 8px;overflow:auto;overscroll-behavior:contain}
.dsh-ma-group{margin:2px 0 8px}
.dsh-ma-grouphead{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;border:0;background:rgba(22,25,33,.97);color:#8f9bb0;font:inherit;font-size:11px;letter-spacing:.04em;text-transform:uppercase;text-align:left;cursor:pointer}
.dsh-ma-grouphead:hover{color:#c3cddd}
.dsh-ma-grouphead-count{margin-left:auto;font-size:10.5px;color:#66707f;letter-spacing:0;text-transform:none}
.dsh-ma-group[data-open="0"] .dsh-ma-row{display:none}
.dsh-ma-row{display:block}
.dsh-ma-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 9px;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
.dsh-ma-item:hover{background:rgba(255,255,255,.07)}
.dsh-ma-row[data-sel="1"] .dsh-ma-item{background:rgba(90,140,255,.18);box-shadow:inset 0 0 0 1px rgba(120,170,255,.5)}
.dsh-ma-item-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ma-badge{flex:none;margin-left:auto;font-size:10.5px;color:#7f8b9e;padding:1px 6px;border-radius:999px;border:1px solid rgba(255,255,255,.13)}
.dsh-ma-efforts{display:flex;flex-wrap:wrap;gap:5px;padding:1px 9px 7px}
.dsh-ma-row[data-sel="0"] .dsh-ma-efforts{display:none}
.dsh-ma-effort{border:1px solid rgba(255,255,255,.16);background:transparent;color:#b9c3d3;border-radius:999px;padding:2px 9px;font:inherit;font-size:11px;cursor:pointer}
.dsh-ma-effort:hover{background:rgba(255,255,255,.1);color:#fff}
.dsh-ma-effort[data-on="1"]{background:rgba(120,170,255,.28);border-color:rgba(120,170,255,.6);color:#fff}
.dsh-ma-empty{padding:18px 10px;text-align:center;color:#6f7a8c;font-size:12px}

/* footer */
.dsh-ma-foot{flex:none;padding:8px 12px;border-top:1px solid rgba(255,255,255,.09);color:#9aa4b5;font-size:12px;white-space:pre-wrap;max-height:140px;overflow:auto}
.dsh-ma-foot[data-kind="error"]{color:#ff9a9a}
.dsh-ma-foot[data-kind="ok"]{color:#9ce6b0}
.dsh-ma-foot[data-kind="confirm"]{color:#e8ecf2}
.dsh-ma-foot .dsh-ma-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.dsh-ma-spin{display:inline-block;width:10px;height:10px;border-radius:50%;border:2px solid rgba(255,255,255,.25);border-top-color:#e8ecf2;animation:dsh-ma-spin .8s linear infinite;vertical-align:-1px}
@keyframes dsh-ma-spin{to{transform:rotate(360deg)}}
`;
  document.head.appendChild(css);

  const root = document.createElement('div');
  root.className = 'dsh-ma-root';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'dsh-ma-toggle';
  toggle.title = '按范围切换对话使用的模型';
  toggle.textContent = '⇄ 对话模型';

  const panel = document.createElement('div');
  panel.className = 'dsh-ma-panel';
  panel.hidden = true;

  const head = document.createElement('div');
  head.className = 'dsh-ma-head';
  const title = document.createElement('span');
  title.className = 'dsh-ma-title';
  title.textContent = '切换对话的模型';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'dsh-ma-close';
  close.textContent = '×';
  head.append(title, close);

  // --- scope bar ---
  const scopeBar = document.createElement('div');
  scopeBar.className = 'dsh-ma-scope';
  const scopeLabel = document.createElement('div');
  scopeLabel.className = 'dsh-ma-scope-label';
  scopeLabel.textContent = '作用范围';
  const chips = document.createElement('div');
  chips.className = 'dsh-ma-chips';
  const providerRow = document.createElement('div');
  providerRow.className = 'dsh-ma-providerrow';
  const providerLabel = document.createElement('label');
  providerLabel.textContent = '或按 provider';
  const providerSelect = document.createElement('select');
  providerRow.append(providerLabel, providerSelect);
  scopeBar.append(scopeLabel, chips, providerRow);

  // --- collapsible stats ---
  const stats = document.createElement('div');
  stats.className = 'dsh-ma-stats';
  stats.dataset.open = '0';
  const statsBar = document.createElement('button');
  statsBar.type = 'button';
  statsBar.className = 'dsh-ma-statsbar';
  const chevron = document.createElement('span');
  chevron.className = 'dsh-ma-statsbar-chevron';
  chevron.textContent = '▸';
  const statsLabel = document.createElement('span');
  statsLabel.textContent = '正在读取对话统计…';
  statsBar.append(chevron, statsLabel);
  const statsBody = document.createElement('div');
  statsBody.className = 'dsh-ma-statsbody';
  stats.append(statsBar, statsBody);
  statsBar.addEventListener('click', () => {
    stats.dataset.open = stats.dataset.open === '1' ? '0' : '1';
  });

  // --- search ---
  const search = document.createElement('div');
  search.className = 'dsh-ma-search';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = '搜索模型或 provider…';
  searchInput.autocomplete = 'off';
  search.appendChild(searchInput);

  const body = document.createElement('div');
  body.className = 'dsh-ma-body';

  const foot = document.createElement('div');
  foot.className = 'dsh-ma-foot';
  foot.textContent = '';

  panel.append(head, scopeBar, stats, search, body, foot);
  root.append(panel, toggle);
  document.body.appendChild(root);

  let loaded = false;
  let busy = false;
  // An apply result must survive the status refresh that follows it: the
  // refresh repaints the footer, and without this the answer to "did it work?"
  // blinks out of existence a second after it arrives.
  let pinned = null;
  let selected = null; // { provider, model, reasoningEffort? }
  let scope = 'all';
  let scopeTitle = '全部对话';
  let scopeCount = null;
  let providerScope = ''; // '' = none; otherwise provider id
  const rows = [];
  const groupsOf = new Map();

  const describe = (choice) => {
    if (!choice) return '未记录';
    return choice.reasoningEffort
      ? `${choice.provider}/${choice.model} · ${choice.reasoningEffort}`
      : `${choice.provider}/${choice.model}`;
  };

  // A workspace chip and the provider filter compose: the server accepts
  // `ws:<id>|provider:<pid>` and requires every part to match.
  const effectiveScope = () => {
    const parts = [];
    if (scope !== 'all') parts.push(scope);
    if (providerScope.length > 0) parts.push(`provider:${providerScope}`);
    return parts.length === 0 ? 'all' : parts.join('|');
  };

  const scopeText = () => {
    const parts = [];
    if (scope !== 'all') parts.push(scopeTitle);
    if (providerScope.length > 0) parts.push(`provider:${providerScope}`);
    return parts.length === 0 ? '全部对话' : parts.join(' ∩ ');
  };

  const setFoot = (text, kind) => {
    foot.textContent = text;
    if (kind === undefined) delete foot.dataset.kind;
    else foot.dataset.kind = kind;
  };

  const sortGroups = (groups) =>
    [...groups].sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id)));

  const idleFooter = () => {
    if (busy) return;
    if (pinned !== null) {
      setFoot(pinned.text, pinned.kind);
      return;
    }
    const countText = scopeCount === null ? '' : `（${scopeCount} 个对话）`;
    if (selected === null) {
      setFoot(`范围：${scopeText()}${countText}\n点一个模型即可选中，再确认切换。`, undefined);
      return;
    }
    setFoot(`范围：${scopeText()}${countText}\n已选：${describe(selected)}`, 'confirm');
    const actions = document.createElement('div');
    actions.className = 'dsh-ma-actions';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'dsh-ma-effort';
    ok.textContent = '切换';
    ok.addEventListener('click', () => apply(selected, false));
    const dry = document.createElement('button');
    dry.type = 'button';
    dry.className = 'dsh-ma-effort';
    dry.textContent = '先预演';
    dry.addEventListener('click', () => apply(selected, true));
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'dsh-ma-effort';
    cancel.textContent = '取消选择';
    cancel.addEventListener('click', () => pick(null));
    actions.append(ok, dry, cancel);
    foot.appendChild(actions);
  };

  const pick = (choice, rowRef) => {
    pinned = null;
    selected = choice;
    for (const row of rows) row.el.dataset.sel = '0';
    if (rowRef !== undefined) {
      rowRef.el.dataset.sel = '1';
      rowRef.el.scrollIntoView({ block: 'nearest' });
      for (const chip of rowRef.el.querySelectorAll('.dsh-ma-effort')) {
        chip.dataset.on = chip.dataset.effort === (choice.reasoningEffort ?? '') ? '1' : '0';
      }
    }
    idleFooter();
  };

  const renderChips = (scopes) => {
    chips.textContent = '';
    for (const entry of scopes.filter((item) => item.kind !== 'provider')) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'dsh-ma-chip';
      chip.dataset.scope = entry.id;
      chip.dataset.on = entry.id === scope ? '1' : '0';
      const label = document.createElement('span');
      label.textContent = entry.label;
      const count = document.createElement('span');
      count.className = 'dsh-ma-chip-n';
      count.textContent = String(entry.count);
      chip.append(label, count);
      chip.addEventListener('click', () => {
        pinned = null;
        scope = entry.id;
        scopeTitle = entry.label;
        for (const other of chips.querySelectorAll('.dsh-ma-chip')) {
          other.dataset.on = other.dataset.scope === entry.id ? '1' : '0';
        }
        void reloadStatus();
      });
      chips.appendChild(chip);
    }

    const providers = scopes.filter((entry) => entry.kind === 'provider');
    const previous = providerScope;
    providerSelect.textContent = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '不限';
    providerSelect.appendChild(none);
    for (const entry of providers) {
      const option = document.createElement('option');
      option.value = entry.id.slice('provider:'.length);
      option.textContent = `${entry.id.slice('provider:'.length)}（${entry.count}）`;
      providerSelect.appendChild(option);
    }
    providerSelect.value = providers.some((entry) => entry.id === `provider:${previous}`) ? previous : '';
    providerScope = providerSelect.value;
  };

  const renderStats = (status) => {
    const models = Array.isArray(status.models) ? status.models : [];
    const known = models.filter((entry) => entry.provider && entry.model);
    const liveNote = status.live ? `，${status.live} 个在内存中` : '';
    const archivedNote = status.archivedCount ? `，其中归档 ${status.archivedCount} 个` : '';
    statsLabel.textContent = `范围「${status.scopeLabel}」${status.count} 个对话（全部 ${status.total}${liveNote}${archivedNote}）· ${known.length} 种模型在用`;
    statsBody.textContent = models.length > 0
      ? models.map((entry) => `${describe(entry)} — ${entry.count} 个`).join('\n')
      : '（暂无记录）';
    scopeCount = status.count;
    idleFooter();
  };

  // A corpus-wide read takes seconds, so overlapping requests are the norm
  // (click two scope chips quickly and the first answer lands last). Each call
  // carries a ticket and only the newest one is allowed to paint.
  let statusTicket = 0;
  const reloadStatus = async () => {
    statusTicket += 1;
    const ticket = statusTicket;
    const scopeId = effectiveScope();
    try {
      const response = await fetch(`${STATUS_URL}?scope=${encodeURIComponent(scopeId)}&t=${Date.now()}`, {
        credentials: 'same-origin',
      });
      const status = await response.json();
      if (ticket !== statusTicket) return;
      if (!status.ok) throw new Error(status.error || '统计失败');
      if (Array.isArray(status.scopes) && status.scopes.length > 0) renderChips(status.scopes);
      renderStats(status);
    } catch (error) {
      if (ticket !== statusTicket) return;
      statsLabel.textContent = `对话统计失败：${String(error && error.message ? error.message : error)}`;
    }
  };

  const buildRow = (provider, model, groupEl) => {
    const el = document.createElement('div');
    el.className = 'dsh-ma-row';
    el.dataset.sel = '0';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dsh-ma-item';
    const name = document.createElement('span');
    name.className = 'dsh-ma-item-name';
    name.textContent = model.name || model.id;
    const badge = document.createElement('span');
    badge.className = 'dsh-ma-badge';
    const efforts = model.reasoning && Array.isArray(model.reasoning.efforts) ? model.reasoning.efforts : [];
    badge.textContent = efforts.length > 0 ? `${efforts.length} 档` : '无档';
    button.append(name, badge);
    button.title = `${provider.id}/${model.id}${model.description ? `\n${model.description}` : ''}`;

    const entry = {
      el,
      group: groupEl,
      provider,
      model,
      haystack: `${provider.id} ${provider.name || ''} ${model.id} ${model.name || ''}`.toLowerCase(),
    };

    const defaultEffort = model.reasoning && model.reasoning.defaultEffort;
    button.addEventListener('click', () => {
      const choice = { provider: provider.id, model: model.id };
      if (efforts.length > 0 && defaultEffort !== undefined) choice.reasoningEffort = defaultEffort;
      pick(choice, entry);
    });

    el.appendChild(button);

    if (efforts.length > 0) {
      const wrap = document.createElement('div');
      wrap.className = 'dsh-ma-efforts';
      for (const effort of efforts) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'dsh-ma-effort';
        chip.dataset.effort = effort.id;
        chip.textContent = effort.name || effort.id;
        chip.addEventListener('click', (event) => {
          event.stopPropagation();
          pick({ provider: provider.id, model: model.id, reasoningEffort: effort.id }, entry);
        });
        wrap.appendChild(chip);
      }
      el.appendChild(wrap);
    }

    rows.push(entry);
    return el;
  };

  const render = (catalog) => {
    const groups = Array.isArray(catalog.groups) ? catalog.groups : [];
    body.textContent = '';
    rows.length = 0;
    groupsOf.clear();

    if (groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dsh-ma-empty';
      empty.textContent = '没有可用的模型目录';
      body.appendChild(empty);
      return;
    }

    for (const group of sortGroups(groups)) {
      const section = document.createElement('div');
      section.className = 'dsh-ma-group';
      section.dataset.open = '1';

      const headButton = document.createElement('button');
      headButton.type = 'button';
      headButton.className = 'dsh-ma-grouphead';
      const headLabel = document.createElement('span');
      headLabel.textContent = group.name || group.id;
      const headCount = document.createElement('span');
      headCount.className = 'dsh-ma-grouphead-count';
      headCount.textContent = `${(group.models || []).length} 个`;
      headButton.append(headLabel, headCount);
      headButton.addEventListener('click', () => {
        section.dataset.open = section.dataset.open === '1' ? '0' : '1';
      });
      section.appendChild(headButton);

      for (const model of group.models || []) section.appendChild(buildRow(group, model, section));
      groupsOf.set(group.id, { el: section, count: headCount, total: (group.models || []).length });
      body.appendChild(section);
    }

    if (Array.isArray(catalog.failures) && catalog.failures.length > 0) {
      const note = document.createElement('div');
      note.className = 'dsh-ma-empty';
      note.textContent = `部分 provider 不可用：${catalog.failures.map((entry) => entry.id).join(', ')}`;
      body.appendChild(note);
    }
  };

  /** Hide non-matching rows, hide groups left empty, report the hit count. */
  const filter = (rawQuery) => {
    const query = String(rawQuery || '').trim().toLowerCase();
    const matchedPerGroup = new Map();
    for (const info of groupsOf.values()) matchedPerGroup.set(info.el, 0);
    for (const row of rows) {
      const hit = query.length === 0 || row.haystack.includes(query);
      row.el.style.display = hit ? '' : 'none';
      if (hit) matchedPerGroup.set(row.group, (matchedPerGroup.get(row.group) || 0) + 1);
    }
    let visible = 0;
    for (const info of groupsOf.values()) {
      const matched = matchedPerGroup.get(info.el) || 0;
      visible += matched;
      info.el.style.display = query.length > 0 && matched === 0 ? 'none' : '';
      info.count.textContent = query.length > 0 ? `${matched} / ${info.total}` : `${info.total} 个`;
      if (query.length > 0 && matched > 0) info.el.dataset.open = '1';
    }
    if (query.length > 0) {
      if (visible === 0) setFoot(`没有匹配「${rawQuery}」的模型。`, 'error');
      else setFoot(`${visible} 个模型匹配「${rawQuery}」。`, undefined);
    } else {
      idleFooter();
    }
  };

  const load = async () => {
    if (loaded) return;
    loaded = true;
    setFoot('正在读取模型目录…', undefined);
    try {
      const response = await fetch(`${CATALOG_URL}?t=${Date.now()}`, { credentials: 'same-origin' });
      const catalog = await response.json();
      if (!catalog.ok) throw new Error(catalog.error || '模型目录读取失败');
      render(catalog);
      filter(searchInput.value);
      void reloadStatus();
    } catch (error) {
      loaded = false;
      setFoot(String(error && error.message ? error.message : error), 'error');
    }
  };

  const apply = async (choice, dryRun) => {
    if (busy || choice === null) return;
    busy = true;
    setFoot('', 'confirm');
    const spin = document.createElement('span');
    spin.className = 'dsh-ma-spin';
    foot.append(
      spin,
      document.createTextNode(
        ` 范围「${scopeText()}」${dryRun === true ? '正在预演' : '正在切换为'} ${describe(choice)} …`,
      ),
    );
    try {
      const body = { ...choice, scope: effectiveScope() };
      if (dryRun === true) body.dryRun = true;
      const response = await fetch(APPLY_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || '切换失败');
      busy = false;
      pinned = { text: payload.summary || '完成。', kind: 'ok' };
      setFoot(pinned.text, pinned.kind);
      void reloadStatus();
    } catch (error) {
      busy = false;
      pinned = { text: String(error && error.message ? error.message : error), kind: 'error' };
      setFoot(pinned.text, pinned.kind);
    }
  };

  providerSelect.addEventListener('change', () => {
    pinned = null;
    providerScope = providerSelect.value;
    void reloadStatus();
  });
  searchInput.addEventListener('input', () => filter(searchInput.value));

  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      load();
      searchInput.focus();
    }
  });
  close.addEventListener('click', () => {
    panel.hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) panel.hidden = true;
  });
})();
