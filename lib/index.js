/**
 * dsh-model-scope — switch the model of DSH conversations, by scope.
 *
 * DSH keeps the chosen model per conversation: picking a model in the UI only
 * rewrites that one session's next request (plus the deployment default), so
 * older conversations keep whatever model they last used. This plugin applies
 * the same durable primitive (`model/selection`) across a chosen scope:
 *
 *   scope   what to touch: everything, one workspace, the unmounted rest, or
 *           every conversation currently on one provider, or an intersection;
 *   target  what to write: one provider/model/reasoning-effort triple;
 *   mode    dry run or real write.
 *
 * Live conversations go through the session controller's own
 * `selectForNextRequest` when that service exists (web), and otherwise append
 * the same event directly to the live session log. Cold ones always get a
 * `model/selection` event appended to their log, so the next resume picks the
 * new model up.
 *
 * Workspace membership is a union: the registry's own `sessionIds` account
 * only covers sessions it has mounted, and on a busy host that can be roughly
 * half of them. Anything whose header `cwd` resolves to the workspace path
 * belongs to that workspace too, mounted or not.
 *
 * Everything outside the base bundle is optional: the plugin needs only
 * `commands`, `llm`, `sessions`, `sessionQuery`, `sessionPersistence` and
 * `agentDefaultModel`, so it loads in every profile. The web surface (routes +
 * injected panel) is registered through `ctx.inject(['webServer'], …)` and
 * simply never activates where there is no web server.
 */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The Cordis service name this plugin registers under. */
export const name = 'model-scope';

/** Services this plugin needs before it can apply. */
export const inject = [
  'commands',
  'llm',
  'sessions',
  'sessionQuery',
  'sessionPersistence',
  'agentDefaultModel',
];

const UI_SCRIPT_PATH = '/dsh-model-scope/ui.js';
const CATALOG_PATH = '/dsh-model-scope/catalog';
const APPLY_PATH = '/dsh-model-scope/apply';
const STATUS_PATH = '/dsh-model-scope/status';
const VERSION_PATH = '/dsh-model-scope/version';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Version reported by `/dsh-model-scope/version`, so a running host can be
 * checked from outside. Read from this package's own manifest rather than
 * written twice, so it cannot drift from what npm published.
 */
const BUILD = (() => {
  try {
    return JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

const DEFAULT_CONFIG = {
  /** Inject the floating panel into the web UI. */
  ui: true,
  /** Leave conversations alone while a turn is writing to their log. */
  skipRunning: true,
  /** Leave archived conversations alone. */
  skipArchived: true,
  /**
   * Also answer to `/model-all`, the command name this plugin had before it
   * grew a scope. Off by default: new installs should not inherit a name that
   * promises something the plugin no longer means.
   */
  legacyCommand: false,
};

function normalizeConfig(config) {
  const source = config ?? {};
  return {
    ui: source.ui !== false,
    skipRunning: source.skipRunning !== false,
    skipArchived: source.skipArchived !== false,
    legacyCommand: source.legacyCommand === true,
  };
}

// --- selection primitives ---------------------------------------------------

/** Read one model selection out of a raw event list, exactly the way the projection folds it. */
function effectiveSelection(events) {
  let pending;
  let lastUsed;
  for (const event of events) {
    const data = event.data;
    if (event.type === 'model/selection') {
      if (data && typeof data.provider === 'string' && typeof data.model === 'string') pending = selectionOf(data);
      continue;
    }
    if (event.type === 'request/header') {
      const header = data?.header;
      const config = header?.config;
      if (config && typeof config.provider === 'string' && typeof config.model === 'string') {
        // The history projection drops an effort the adapter supplied by
        // default; mirror that so "already using this model" stays honest.
        lastUsed = selectionOf(config, header?.adapterDefaults?.reasoningEffort === true);
        if (sameSelection(pending, lastUsed)) pending = undefined;
      }
    }
  }
  return pending ?? lastUsed;
}

function selectionOf(source, dropEffort = false) {
  return {
    provider: source.provider,
    model: source.model,
    ...(!dropEffort && typeof source.reasoningEffort === 'string' ? { reasoningEffort: source.reasoningEffort } : {}),
  };
}

function normalizeTarget(value) {
  if (value === null || typeof value !== 'object') return undefined;
  if (typeof value.provider !== 'string' || typeof value.model !== 'string') return undefined;
  return selectionOf(value);
}

function sameSelection(left, right) {
  if (left === undefined || right === undefined) return false;
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    (left.reasoningEffort ?? null) === (right.reasoningEffort ?? null)
  );
}

function describeSelection(selection) {
  if (selection === undefined) return '(未记录)';
  return selection.reasoningEffort === undefined
    ? `${selection.provider}/${selection.model}`
    : `${selection.provider}/${selection.model} · ${selection.reasoningEffort}`;
}

/** Validate a requested model against the live registry and normalize it like the UI does. */
async function resolveSelection(ctx, request) {
  const provider = typeof request?.provider === 'string' ? request.provider.trim() : '';
  const model = typeof request?.model === 'string' ? request.model.trim() : '';
  if (provider.length === 0 || model.length === 0) throw new Error('需要同时提供 provider 与 model');
  const providers = ctx.llm.listProviders();
  if (!providers.some((entry) => entry.id === provider)) {
    throw new Error(`未知 provider "${provider}"；可用：${providers.map((entry) => entry.id).join(', ')}`);
  }
  const models = await ctx.llm.listModels(provider);
  if (!models.some((entry) => entry.id === model)) {
    throw new Error(`provider "${provider}" 没有模型 "${model}"`);
  }
  const effort =
    typeof request?.reasoningEffort === 'string' && request.reasoningEffort.trim().length > 0
      ? request.reasoningEffort.trim()
      : undefined;
  const resolved = await ctx.llm.resolveCallConfig({
    provider,
    model,
    ...(effort === undefined ? {} : { reasoningEffort: effort }),
  });
  return {
    provider: resolved.provider,
    model: resolved.model,
    ...(resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort }),
  };
}

// --- scope ------------------------------------------------------------------

function normalizeCwd(value) {
  if (typeof value !== 'string') return null;
  let text = value.trim();
  if (text.length === 0) return null;
  while (text.length > 1 && text.endsWith('/')) text = text.slice(0, -1);
  return text;
}

/**
 * Workspace membership index.
 *
 * Two sources are unioned on purpose: `sessionIds` is the registry's mounted
 * account, while a session merely *living* in the workspace directory (its
 * header cwd) is what the user thinks of as "in that workspace". Counting only
 * the mounted half under-reports badly on this host.
 */
function workspaceIndex(ctx) {
  const entries = [];
  const registry = ctx.get('workspaceRegistry');
  if (registry !== undefined) {
    let list = [];
    try {
      list = registry.list();
    } catch {
      list = [];
    }
    for (const workspace of list) {
      let mounted = [];
      try {
        mounted = [...workspace.sessionIds];
      } catch {
        mounted = [];
      }
      entries.push({
        id: workspace.id,
        title: workspace.title || workspace.path || workspace.id,
        path: normalizeCwd(workspace.path),
        mounted: new Set(mounted),
      });
    }
  }
  const byPath = new Map();
  for (const entry of entries) if (entry.path !== null && !byPath.has(entry.path)) byPath.set(entry.path, entry);
  const bySession = new Map();
  for (const entry of entries) for (const id of entry.mounted) bySession.set(id, entry.id);
  return { entries, byPath, bySession };
}

/**
 * `all` | `unmounted` | `ws:<id>` | `provider:<id>`, optionally joined with `|`
 * to narrow further (`ws:<id>|provider:<pid>` = that workspace's conversations
 * that currently run on that provider). Every part must match.
 */
function parseScope(raw) {
  if (raw === undefined || raw === null || raw === '' || raw === 'all') return { kind: 'all', id: 'all' };
  if (typeof raw !== 'string') throw new Error('scope 必须是字符串');
  const parts = raw
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== 'all');
  if (parts.length === 0) return { kind: 'all', id: 'all' };
  for (const part of parts) {
    if (part === 'unmounted') continue;
    if (part.startsWith('ws:') && part.length > 3) continue;
    if (part.startsWith('provider:') && part.length > 9) continue;
    throw new Error(`无法识别的 scope "${part}"；应为 all / unmounted / ws:<工作区 id> / provider:<provider id>，可用 | 组合`);
  }
  const id = parts.join('|');
  if (parts.length === 1) {
    const only = parts[0];
    const kind = only === 'unmounted' ? 'unmounted' : only.startsWith('ws:') ? 'workspace' : 'provider';
    return { kind, id, parts };
  }
  return { kind: 'compound', id, parts };
}

function matchesOne(record, part) {
  if (part === 'unmounted') return record.workspaceId === null;
  if (part.startsWith('ws:')) return `ws:${record.workspaceId}` === part;
  if (part.startsWith('provider:')) return record.selection?.provider === part.slice('provider:'.length);
  return true;
}

function matchesScope(record, scope) {
  if (scope.kind === 'all') return true;
  const parts = scope.parts ?? [scope.id];
  return parts.every((part) => matchesOne(record, part));
}

/**
 * Expand a parsed scope into fully-qualified ids.
 *
 * `parseScope` only checks the shape, so `ws:71d89c06` (an id prefix, which is
 * what a human types) would silently match nothing. Every workspace part is
 * therefore resolved through the same matcher the `ws <name>` form uses, and a
 * workspace part that resolves to nothing is an error rather than an empty set.
 */
async function resolveScope(ctx, index, scope) {
  if (scope.kind === 'all' || scope.kind === 'unmounted') return scope;
  const parts = [];
  for (const part of scope.parts ?? [scope.id]) {
    if (part === 'unmounted') {
      parts.push(part);
      continue;
    }
    if (part.startsWith('ws:')) {
      const reference = part.slice('ws:'.length);
      const workspace = findWorkspace(index, reference);
      if (workspace === undefined) {
        throw new Error(
          `没有找到工作区「${reference}」；现有：${index.entries.map((entry) => entry.title).join('、')}`,
        );
      }
      parts.push(`ws:${workspace.id}`);
      continue;
    }
    if (part.startsWith('provider:')) {
      const reference = part.slice('provider:'.length);
      const known = await providerIds(ctx);
      const exact = known.includes(reference) ? reference : undefined;
      const prefixed = exact === undefined ? known.filter((id) => id.startsWith(reference)) : [];
      if (exact === undefined && prefixed.length !== 1) {
        throw new Error(
          prefixed.length === 0
            ? `没有找到 provider「${reference}」；现有：${known.join('、')}`
            : `provider「${reference}」有多个匹配：${prefixed.join('、')}`,
        );
      }
      parts.push(`provider:${exact ?? prefixed[0]}`);
      continue;
    }
    throw new Error(`无法识别的范围片段「${part}」`);
  }
  if (parts.length === 1) {
    const only = parts[0];
    const kind = only === 'unmounted' ? 'unmounted' : only.startsWith('ws:') ? 'workspace' : 'provider';
    return { kind, id: only, parts };
  }
  return { kind: 'compound', id: parts.join('|'), parts };
}

/** Provider ids the host knows about, for prefix resolution. */
async function providerIds(ctx) {
  try {
    const providers = ctx.llm.listProviders();
    return providers.map((provider) => provider.id).filter((id) => typeof id === 'string');
  } catch {
    return [];
  }
}

/** Resolve a workspace by id, id prefix, exact title or path suffix. */
function findWorkspace(index, reference) {
  const text = String(reference ?? '').trim();
  if (text.length === 0) return undefined;
  const exact = index.entries.find((entry) => entry.id === text);
  if (exact !== undefined) return exact;
  const byTitle = index.entries.find((entry) => entry.title === text);
  if (byTitle !== undefined) return byTitle;
  const prefixed = index.entries.filter((entry) => entry.id.startsWith(text));
  if (prefixed.length === 1) return prefixed[0];
  const loose = index.entries.filter(
    (entry) => entry.title.includes(text) || (entry.path !== null && entry.path.endsWith(`/${text}`)),
  );
  if (loose.length === 1) return loose[0];
  return undefined;
}

// --- corpus -----------------------------------------------------------------

/** Enumerate the corpus with archive + workspace attribution. */
async function corpusOf(ctx, config, signal) {
  const records = await ctx.sessionQuery.listSessions(signal);
  const registry = ctx.get('workspaceRegistry');
  let archivedIds = [];
  try {
    archivedIds = registry === undefined ? [] : [...registry.archivedSessionIds];
  } catch {
    archivedIds = [];
  }
  const archived = new Set(archivedIds);
  const index = workspaceIndex(ctx);
  return records.map((record) => {
    const id = record.header.id;
    const mounted = index.bySession.get(id);
    const byCwd = index.byPath.get(normalizeCwd(record.header.cwd))?.id;
    return {
      id,
      header: record.header,
      live: record.live,
      persisted: record.persisted,
      archived: archived.has(id),
      workspaceId: mounted ?? byCwd ?? null,
    };
  });
}

/**
 * Point one live conversation at a new model.
 *
 * The web app offers `sessionController.agents.selectForNextRequest`, which
 * also updates the controller's cached pending selection; without it (tui,
 * headless, acp) appending the same event to the live log is equivalent for
 * every later request, because the projection folds it exactly that way.
 */
async function writeLiveSelection(ctx, live, selection) {
  const controller = ctx.get('sessionController')?.agents;
  if (controller !== undefined && typeof controller.selectForNextRequest === 'function') {
    controller.selectForNextRequest(live, { ...selection });
  } else {
    live.session.append('model/selection', { ...selection });
  }
  await ctx.sessions.flush(live.session);
}

/** Append one `model/selection` event to a cold session's log. */
async function appendSelectionToCold(ctx, sessionId, selection) {
  const handle = await ctx.sessionPersistence.open(sessionId, 'write');
  try {
    const { events } = await handle.read();
    const entry = { type: 'model/selection', seq: events.length, time: Date.now(), data: selection };
    await handle.append([entry]);
    await handle.flush();
  } finally {
    await handle.close();
  }
}

/** Read a cold session's events without taking write ownership. */
async function readColdEvents(ctx, sessionId) {
  const handle = await ctx.sessionPersistence.open(sessionId, 'read');
  try {
    const { events } = await handle.read();
    return events;
  } finally {
    await handle.close();
  }
}

/** Read one conversation's effective model selection, live or cold. */
async function inspectSelection(ctx, entry) {
  const live = ctx.get('agents')?.get(entry.id);
  if (live !== undefined) return effectiveSelection(live.session.snapshotEvents());
  return effectiveSelection(await readColdEvents(ctx, entry.id));
}

/** Provider/model catalog, with or without the web session controller. */
async function catalogOf(ctx) {
  const controller = ctx.get('sessionController');
  if (controller !== undefined && typeof controller.modelCatalog === 'function') {
    return await controller.modelCatalog();
  }
  const defaultSelection = (() => {
    try {
      return ctx.agentDefaultModel.currentSelection();
    } catch {
      return undefined;
    }
  })();
  const providers = ctx.llm.listProviders();
  const groups = [];
  const failures = [];
  for (const provider of providers) {
    try {
      const models = await ctx.llm.listModels(provider.id);
      groups.push({
        id: provider.id,
        name: provider.name ?? provider.id,
        models: models.map((model) => ({
          id: model.id,
          name: model.name ?? model.id,
          ...(model.description === undefined ? {} : { description: model.description }),
        })),
      });
    } catch (error) {
      failures.push({ provider: provider.id, message: String(error?.message ?? error) });
    }
  }
  return { default: defaultSelection, groups, failures };
}

/**
 * Read the whole corpus once: every conversation with its workspace and its
 * current effective selection. Reading every cold log is the expensive part
 * (~77 MB of zstd), so the result is memoized briefly and every scope
 * aggregation is computed from this single snapshot in memory.
 */
async function snapshotCorpus(ctx, config, signal) {
  const cached = documentCache.get('corpus');
  if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) return cached;

  const records = await corpusOf(ctx, config, signal);
  const selections = await mapLimit(records, 16, async (entry) => {
    try {
      return await inspectSelection(ctx, entry);
    } catch {
      return undefined;
    }
  });
  let liveCount = 0;
  try {
    const agents = ctx.get('agents');
    liveCount = agents === undefined ? 0 : agents.list().length;
  } catch {
    liveCount = 0;
  }
  const value = {
    at: Date.now(),
    live: liveCount,
    records: records.map((entry, position) => ({ ...entry, selection: selections[position] })),
  };
  // Stored as-is: the snapshot *is* the cache entry (it carries its own `at`),
  // so a reader reuses the same object it was handed rather than a wrapper.
  documentCache.set('corpus', value);
  return value;
}

/** Aggregate a snapshot down to the numbers the panel and `/model-scope list` show. */
function aggregate(corpus, index, scope) {
  const buckets = new Map();
  const workspaceCounts = new Map();
  const providerCounts = new Map();
  let count = 0;
  let archivedCount = 0;
  for (const record of corpus.records) {
    workspaceCounts.set(record.workspaceId ?? 'unmounted', (workspaceCounts.get(record.workspaceId ?? 'unmounted') || 0) + 1);
    // Provider counts stay corpus-wide so the picker does not lose its options
    // as soon as one provider is selected.
    const providerId = record.selection?.provider;
    if (typeof providerId === 'string') providerCounts.set(providerId, (providerCounts.get(providerId) || 0) + 1);
    if (!matchesScope(record, scope)) continue;
    count += 1;
    if (record.archived) archivedCount += 1;
    const selection = record.selection;
    const key =
      selection === undefined
        ? 'unknown'
        : `${selection.provider}\u0000${selection.model}\u0000${selection.reasoningEffort ?? ''}`;
    const bucket = buckets.get(key) ?? {
      provider: selection?.provider ?? null,
      model: selection?.model ?? null,
      reasoningEffort: selection?.reasoningEffort ?? null,
      count: 0,
    };
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  const models = [...buckets.values()].sort((left, right) => right.count - left.count);

  const scopes = [{ id: 'all', kind: 'all', label: '全部对话', count: corpus.records.length }];
  for (const workspace of index.entries) {
    scopes.push({
      id: `ws:${workspace.id}`,
      kind: 'workspace',
      label: workspace.title,
      path: workspace.path,
      count: workspaceCounts.get(workspace.id) || 0,
    });
  }
  scopes.push({
    id: 'unmounted',
    kind: 'unmounted',
    label: '未挂载工作区',
    count: workspaceCounts.get('unmounted') || 0,
  });
  for (const [provider, providerCount] of [...providerCounts.entries()].sort((left, right) => right[1] - left[1])) {
    scopes.push({ id: `provider:${provider}`, kind: 'provider', label: provider, count: providerCount });
  }

  return { total: corpus.records.length, live: corpus.live, count, archivedCount, models, scopes };
}

/** Short-lived cache for corpus-wide reads; invalidated after any switch. */
const documentCache = new Map();
const CACHE_TTL_MS = 20_000;

/** Run an async mapper with bounded concurrency. */
async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Apply one selection to every conversation in `options.scope`.
 * @returns per-session accounting plus the normalized selection.
 */
async function applyEverywhere(ctx, config, selection, options) {
  let records = await corpusOf(ctx, config, options?.signal);
  if (Array.isArray(options?.sessionIds)) {
    const wanted = new Set(options.sessionIds.filter((id) => typeof id === 'string'));
    records = records.filter((entry) => wanted.has(entry.id));
  }
  const assignments = options?.assignments !== null && typeof options?.assignments === 'object' ? options.assignments : undefined;
  if (assignments !== undefined) {
    const known = new Map(records.map((entry) => [entry.id, entry]));
    records = Object.keys(assignments)
      .filter((id) => known.has(id))
      .map((id) => known.get(id));
  }
  const dryRun = options?.dryRun === true;
  const report = {
    selection: { ...selection },
    scope: options?.scopeLabel ?? '全部对话',
    dryRun,
    total: records.length,
    updated: [],
    unchanged: [],
    skippedRunning: [],
    skippedArchived: [],
    failed: [],
  };
  const agents = ctx.get('agents');

  for (const entry of records) {
    if (entry.archived && config.skipArchived) {
      report.skippedArchived.push(entry.id);
      continue;
    }
    const live = agents?.get(entry.id);
    if (live !== undefined && config.skipRunning && live.status === 'running') {
      report.skippedRunning.push(entry.id);
      continue;
    }
    const target = assignments === undefined ? selection : normalizeTarget(assignments[entry.id]);
    if (target === undefined) {
      report.failed.push({ id: entry.id, message: '无效的目标模型配置' });
      continue;
    }
    try {
      if (live !== undefined) {
        if (sameSelection(effectiveSelection(live.session.snapshotEvents()), target)) {
          report.unchanged.push(entry.id);
          continue;
        }
        if (dryRun !== true) await writeLiveSelection(ctx, live, target);
        report.updated.push(entry.id);
        continue;
      }
      const current = effectiveSelection(await readColdEvents(ctx, entry.id));
      if (sameSelection(current, target)) {
        report.unchanged.push(entry.id);
        continue;
      }
      if (dryRun !== true) await appendSelectionToCold(ctx, entry.id, { ...target });
      report.updated.push(entry.id);
    } catch (error) {
      // A session may have become live (or been claimed) since the listing;
      // retry once through the live path before recording a failure.
      const late = agents?.get(entry.id);
      if (late !== undefined) {
        try {
          await writeLiveSelection(ctx, late, target);
          report.updated.push(entry.id);
          continue;
        } catch (retryError) {
          report.failed.push({ id: entry.id, message: String(retryError?.message ?? retryError) });
          continue;
        }
      }
      report.failed.push({ id: entry.id, message: String(error?.message ?? error) });
    }
  }

  documentCache.delete('corpus');
  // The deployment default is only a sensible thing to move when the switch
  // really was corpus-wide; a single-workspace switch must not repaint new
  // conversations everywhere.
  if (dryRun !== true && options?.saveDefault !== false && assignments === undefined) {
    try {
      await ctx.agentDefaultModel.saveSelection({ ...selection });
    } catch (error) {
      ctx.logger?.warn?.(`model-scope: conversation models switched but the deployment default was not saved: ${String(error)}`);
    }
  }
  return report;
}

/** Resolve a scope string into the ids it covers, using one corpus snapshot. */
async function idsForScope(ctx, config, scope, signal) {
  if (scope.kind === 'all') return undefined;
  const corpus = await snapshotCorpus(ctx, config, signal);
  const ids = corpus.records.filter((record) => matchesScope(record, scope)).map((record) => record.id);
  return ids;
}

function summarize(report) {
  const lines = [
    `范围：${report.scope}（${report.total} 个对话）`,
    `目标模型：${describeSelection(report.selection)}`,
    report.dryRun === true
      ? `预演可切换 ${report.updated.length}，本来就是该模型 ${report.unchanged.length}（未写入）`
      : `已切换 ${report.updated.length}，本来就是该模型 ${report.unchanged.length}`,
  ];
  if (report.skippedRunning.length > 0) lines.push(`跳过 ${report.skippedRunning.length} 个正在运行 turn 的对话`);
  if (report.skippedArchived.length > 0) lines.push(`跳过 ${report.skippedArchived.length} 个已归档对话`);
  if (report.failed.length > 0) {
    const sample = report.failed
      .slice(0, 3)
      .map((item) => `${item.id}: ${item.message}`)
      .join('；');
    lines.push(`失败 ${report.failed.length} 个：${sample}${report.failed.length > 3 ? ' …' : ''}`);
  }
  return lines.join('\n');
}

// --- command ----------------------------------------------------------------

/**
 * Parse `/model-scope` arguments.
 *
 *   /model-scope [list [scope]]
 *   /model-scope [dry] [ws <工作区>] <provider> <model> [effort]
 */
/** Split on whitespace but keep "quoted words" together, so a workspace named
 *  "QQ 聊天" survives as one argument. */
function tokenize(raw) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (const character of raw) {
    if (quote !== null) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (current.length > 0) tokens.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function parseCommandInput(rawInput) {
  const raw = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (raw.length === 0) return { action: 'list' };
  let parts = tokenize(raw);
  if (parts.length === 0) return { action: 'list' };
  const head = parts[0].toLowerCase();
  if (head === 'help' || head === '-h' || head === '--help') return { action: 'help' };
  if (head === 'list' || head === 'ls' || head === 'status') return { action: 'list', scope: parts[1] };
  let dryRun = false;
  if (head === 'dry' || head === 'dry-run') {
    dryRun = true;
    parts = parts.slice(1);
  }
  // `scope <ref>` beats `ws <name>`: it takes the raw scope syntax
  // (all / unmounted / ws:<id> / provider:<id>, joined with | for "and").
  if (parts[0] !== undefined && parts[0].toLowerCase() === 'scope') {
    return { action: 'apply', dryRun, scope: parts[1], provider: parts[2], model: parts[3], reasoningEffort: parts[4] };
  }
  let workspace;
  if (parts[0] !== undefined && parts[0].toLowerCase() === 'ws') {
    workspace = parts[1];
    parts = parts.slice(2);
  }
  return { action: 'apply', dryRun, workspace, provider: parts[0], model: parts[1], reasoningEffort: parts[2] };
}

const HELP_TEXT = [
  '用法（范围：all / unmounted / ws:<工作区 id> / provider:<provider id>，用 | 组合表示「且」）：',
  '  /model-scope                          列出全部对话的模型分布',
  '  /model-scope list <范围>              只看某个范围的分布',
  '  /model-scope <provider> <model> [effort]',
  '                                      切换全部对话',
  '  /model-scope ws <工作区> <provider> <model> [effort]',
  '                                      只切换某个工作区（名字带空格时加引号）',
  '  /model-scope scope <范围> <provider> <model> [effort]',
  '                                      用范围写法精确指定',
  '  在最前面加 dry 表示只预演',
  '',
  '例：/model-scope list ws:71d89c06',
  '    /model-scope dry ws "QQ 聊天" workbuddy deepseek-v4.1-flash high',
].join('\n');

// --- HTTP surface -----------------------------------------------------------

function rejectUnsafe(req, res, connection) {
  if (connection !== undefined && typeof connection.requestRejection === 'function') {
    const rejection = connection.requestRejection(req);
    if (rejection !== undefined) {
      res.writeHead(rejection, { 'cache-control': 'no-store' });
      res.end();
      return true;
    }
  }
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin !== undefined && host !== undefined) {
    const allowed = new Set([`http://${host}`, `https://${host}`]);
    if (!allowed.has(origin)) {
      res.writeHead(403, { 'cache-control': 'no-store' });
      res.end();
      return true;
    }
  }
  return false;
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Human label for a scope id, including compound ones. */
function describeScope(index, scope) {
  if (scope.kind === 'all') return '全部对话';
  const parts = scope.parts ?? [scope.id];
  return parts
    .map((part) => {
      if (part === 'unmounted') return '未挂载工作区';
      if (part.startsWith('ws:')) {
        const found = index.entries.find((entry) => `ws:${entry.id}` === part);
        return found === undefined ? part : found.title;
      }
      if (part.startsWith('provider:')) return part.slice('provider:'.length);
      return part;
    })
    .join(' · ');
}

function scopeLabelOf(scopes, id) {
  const found = scopes.find((entry) => entry.id === id);
  return found === undefined ? id : found.label;
}

/** @param {any} ctx @param {any} config */
export function apply(ctx, config) {
  const settings = normalizeConfig(config);

  /** Resolve a request into a normalized selection plus the ids it may touch. */
  const plan = async (request, options) => {
    const index = workspaceIndex(ctx);
    const scope = await resolveScope(ctx, index, parseScope(options?.scope));
    const selection = await resolveSelection(ctx, request);
    const sessionIds = await idsForScope(ctx, settings, scope, options?.signal);
    if (Array.isArray(sessionIds) && sessionIds.length === 0) {
      throw new Error(`范围「${scope.id}」里没有对话`);
    }
    return {
      selection,
      scope,
      sessionIds,
      scopeLabel: describeScope(index, scope),
    };
  };

  const runApply = async (request, options) => {
    if (options?.assignments !== undefined) {
      // Per-session restore path: each entry carries its own provider/model,
      // so nothing has to resolve globally.
      let valid = 0;
      for (const value of Object.values(options.assignments)) {
        if (normalizeTarget(value) !== undefined) valid += 1;
      }
      if (valid === 0) throw new Error('assignments 里没有有效的 provider/model');
      return applyEverywhere(ctx, settings, { provider: '(per-session)', model: '(per-session)' }, options);
    }
    const resolved = await plan(request, options);
    return applyEverywhere(ctx, settings, resolved.selection, {
      ...options,
      ...(resolved.sessionIds === undefined ? {} : { sessionIds: resolved.sessionIds }),
      scopeLabel: resolved.scopeLabel,
      // Only a corpus-wide switch should move the deployment default.
      saveDefault: resolved.scope.kind === 'all' && options?.saveDefault !== false,
    });
  };

  // Slash command: usable from any conversation without touching the UI.
  const commandHandler = async ({ rawInput }) => {
          try {
            const parsed = parseCommandInput(rawInput);
            if (parsed.action === 'help') return { kind: 'success', text: HELP_TEXT };
            const index = workspaceIndex(ctx);
            let scopeRef = parsed.scope;
            if (parsed.action === 'apply' && parsed.workspace !== undefined) {
              const workspace = findWorkspace(index, parsed.workspace);
              if (workspace === undefined) {
                return {
                  kind: 'error',
                  text: `没有找到工作区「${parsed.workspace}」；现有：${index.entries.map((entry) => entry.title).join('、')}`,
                };
              }
              scopeRef = `ws:${workspace.id}`;
            }
            if (parsed.action === 'list') {
              const scope = await resolveScope(ctx, index, parseScope(scopeRef));
              const corpus = await snapshotCorpus(ctx, settings);
              const scoped = aggregate(corpus, index, scope);
              const header = `范围「${describeScope(index, scope)}」共 ${scoped.count} 个对话（全部 ${scoped.total}，${scoped.live} 个在内存中）：`;
              const rows = scoped.models
                .map(
                  (entry) =>
                    `  ${entry.provider ?? '?'} / ${entry.model ?? '?'}${entry.reasoningEffort === null ? '' : ` · ${entry.reasoningEffort}`} — ${entry.count} 个`,
                )
                .join('\n');
              const scopeLine = scoped.scopes
                .filter((entry) => entry.kind !== 'provider')
                .map((entry) => `  ${entry.label} — ${entry.count} 个`)
                .join('\n');
              return { kind: 'success', text: `${header}\n${rows}\n\n可切换的范围：\n${scopeLine}` };
            }
            if (!parsed.provider || !parsed.model) return { kind: 'error', text: HELP_TEXT };
            const report = await runApply(parsed, {
              dryRun: parsed.dryRun === true,
              ...(scopeRef === undefined ? {} : { scope: scopeRef }),
            });
            const prefix = parsed.dryRun === true ? '【预演】' : '';
            return { kind: 'success', text: `${prefix}${summarize(report)}` };
          } catch (error) {
            return { kind: 'error', text: `model-scope 失败：${String(error?.message ?? error)}` };
          }
  };

  const commandNames = settings.legacyCommand ? ['model-scope', 'model-all'] : ['model-scope'];
  for (const commandName of commandNames) {
    ctx.effect(
      () =>
        ctx.commands.register({
          name: commandName,
          description: '按范围切换对话使用的模型（默认全部）',
          input: { hint: '[list [scope] | [dry] [ws <工作区>] <provider> <model> [effort]]' },
          handler: commandHandler,
        }),
      `model-scope: slash command ${commandName}`,
    );
  }

  // The whole HTTP surface is web-only. Declaring `webServer` in the plugin's
  // `inject` would keep the plugin from loading at all on profiles that have
  // no web server (tui, headless, acp), so it is requested here instead: on
  // those profiles this callback simply never runs and the command still works.
  ctx.inject(['webServer'], (webCtx) => {
    const connectionOf = () => webCtx.get('connection');

    if (settings.ui) {
      ctx.effect(
        () =>
          webCtx.webServer.register({
            kind: 'exact',
            path: UI_SCRIPT_PATH,
            handler: async (req, res) => {
              if (rejectUnsafe(req, res, connectionOf())) return;
              if (req.method !== 'GET' && req.method !== 'HEAD') {
                res.writeHead(405, { 'cache-control': 'no-store' });
                res.end();
                return;
              }
              try {
                const script = await readFile(join(HERE, 'ui.js'), 'utf8');
                res.writeHead(200, {
                  'content-type': 'application/javascript; charset=utf-8',
                  'cache-control': 'no-store',
                });
                res.end(req.method === 'HEAD' ? undefined : script);
              } catch (error) {
                sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
              }
            },
          }),
        'model-scope: ui script route',
      );

      ctx.effect(
        () =>
          webCtx.webServer.tapIndex((html) =>
            html.includes(UI_SCRIPT_PATH) ? html : html.replace('</body>', `<script defer src="${UI_SCRIPT_PATH}"></script></body>`),
          ),
        'model-scope: index injection',
      );
    }

    ctx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: VERSION_PATH,
          handler: (req, res) => {
            if (rejectUnsafe(req, res, connectionOf())) return;
            sendJson(res, 200, { ok: true, build: BUILD });
          },
        }),
      'model-scope: build info route',
    );

    ctx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: CATALOG_PATH,
          handler: async (req, res) => {
            if (rejectUnsafe(req, res, connectionOf())) return;
            try {
              const catalog = await catalogOf(ctx);
              sendJson(res, 200, {
                ok: true,
                default: catalog.default,
                groups: catalog.groups,
                failures: catalog.failures,
              });
            } catch (error) {
              sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
            }
          },
        }),
      'model-scope: catalog route',
    );

    ctx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: STATUS_PATH,
          handler: async (req, res) => {
            if (rejectUnsafe(req, res, connectionOf())) return;
            try {
              const started = Date.now();
              const url = new URL(req.url ?? '/', 'http://localhost');
              const index = workspaceIndex(ctx);
              const scope = await resolveScope(ctx, index, parseScope(url.searchParams.get('scope') ?? 'all'));
              const corpus = await snapshotCorpus(ctx, settings);
              const scoped = aggregate(corpus, index, scope);
              sendJson(res, 200, {
                ok: true,
                build: BUILD,
                scope: scope.id,
                scopeLabel: describeScope(index, scope),
                total: scoped.total,
                count: scoped.count,
                archivedCount: scoped.archivedCount,
                live: scoped.live,
                models: scoped.models,
                scopes: scoped.scopes,
                ms: Date.now() - started,
              });
            } catch (error) {
              sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
            }
          },
        }),
      'model-scope: status route',
    );

    ctx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: APPLY_PATH,
          handler: async (req, res) => {
            if (rejectUnsafe(req, res, connectionOf())) return;
            if (req.method !== 'POST') {
              sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
              return;
            }
            let body;
            try {
              body = await readJsonBody(req);
            } catch (error) {
              sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
              return;
            }
            try {
              const report = await runApply(body, {
                dryRun: body?.dryRun === true,
                saveDefault: body?.saveDefault !== false,
                ...(typeof body?.scope === 'string' ? { scope: body.scope } : {}),
                ...(Array.isArray(body?.sessionIds) ? { sessionIds: body.sessionIds } : {}),
                ...(body?.assignments !== null && typeof body?.assignments === 'object' ? { assignments: body.assignments } : {}),
              });
              sendJson(res, 200, { ok: true, report, summary: summarize(report) });
            } catch (error) {
              sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
            }
          },
        }),
      'model-scope: apply route',
    );
  });
}
