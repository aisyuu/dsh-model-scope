# dsh-model-scope

Switch **many** DeepSeek Harness conversations to one model at once — by workspace, by provider, or by their intersection — with a dry-run preview.

Works in every DSH profile: `tui` and `headless` get the `/model-scope` command, `web` additionally gets the panel and the HTTP routes.

## Why

DSH's model picker only affects two things: the **current conversation's next request**, and the **deployment default**. Every older conversation keeps whatever model it last used. So after switching models in the UI, your sidebar is still a mix of a dozen models, and there is no built-in way to fix that in bulk.

This plugin writes the same durable primitive DSH uses (`model/selection`) across a scope you choose.

## Install

```bash
# from GitHub
dsh plugin --profile web add github:aisyuu/dsh-model-scope

# or from a local tarball
dsh plugin --profile web add ./dsh-model-scope-1.0.1.tgz
```

Then restart the profile (or let the HMR layer pick it up). Nothing else is required — the bundle patch registers the plugin row.

Requires DSH `>= 0.2.0-rc.1` and Node `>= 20`. No third-party runtime dependencies.

`dsh plugin --profile web remove dsh-model-scope` uninstalls it. The `model/selection` events it wrote stay in your conversation logs, which is by design: they are ordinary DSH events and the conversations remain perfectly readable.

## Use

### Panel

A `⇄ 对话模型` button appears in the bottom-right corner of the web UI.

1. Pick a **scope**: `全部对话` / each workspace / `未挂载工作区`, optionally narrowed by a **provider** dropdown — the two combine (`QQ 聊天 ∩ workbuddy`).
2. Search the model list, click a model, pick a reasoning effort if the model has them.
3. `先预演` to preview, `切换` to write.

The panel shows live conversation counts per scope, so you can see what you are about to touch before touching it.

### Command

Works in every profile, including `tui` and `headless`:

```
/model-scope                                    # model distribution of every conversation
/model-scope list ws:71d89c06                   # just one scope (id prefix is enough)
/model-scope list provider:trae
/model-scope workbuddy deepseek-v4.1-flash high  # switch everything
/model-scope ws <工作区> <provider> <model> [effort]
/model-scope scope <范围> <provider> <model> [effort]
/model-scope dry ...                            # prefix with dry to only preview
```

Scope syntax: `all`, `unmounted`, `ws:<workspace>`, `provider:<id>`, joined with `|` for intersection.

```
/model-scope dry ws "QQ 聊天" workbuddy deepseek-v4.1-flash high
```

### HTTP

| Route | |
|---|---|
| `GET /dsh-model-scope/version` | `{ok, build}` |
| `GET /dsh-model-scope/catalog` | providers and models |
| `GET /dsh-model-scope/status?scope=…` | counts, model distribution, available scopes |
| `POST /dsh-model-scope/apply` | `{scope, provider, model, reasoningEffort?, dryRun?}` |

All routes go through DSH's own `connection.requestRejection` plus a same-origin check; they need the same session cookie as the rest of the web UI.

## Configuration

```yaml
- id: model-scope
  name: dsh-model-scope
  config:
    ui: true            # inject the floating panel (web only)
    skipRunning: true   # don't touch conversations with a turn in flight
    skipArchived: true  # don't touch archived conversations
    legacyCommand: false # also answer to /model-all (the name this plugin had before scopes)
```

## How it works

- **Workspace membership is a union.** `workspaceRegistry.sessionIds` only lists conversations the registry has *mounted*; a conversation sitting in the workspace directory with the turn closed is not in it. Counting only the mounted half under-reports badly (on the host this was written on: 63 vs 157). Membership is therefore `sessionIds ∪ {cwd === workspace path}`.
- **Live conversations** go through the session controller's `selectForNextRequest` when that service exists (web), and otherwise get the same `model/selection` event appended to the live log.
- **Cold conversations** get one `model/selection` event appended to their log with the next sequence number. They are never resumed — resuming every conversation to change a model would blow up memory.
- **The deployment default is only moved when the scope is everything.** Switching one workspace must not repaint the model of every new conversation.
- Every conversation whose current model already equals the target is reported as `unchanged` and left untouched, so re-running is cheap and idempotent.
- A conversation whose log is corrupt is reported as `failed` and skipped; the rest of the batch continues.

## Limits

- No undo journal yet: a real write appends events, and reverting means switching back. `POST /apply` accepts `assignments: {"<sessionId>": {provider, model}}` for per-conversation restore.
- No rule table: it is one target per invocation.
- No image-modality guard: switching a conversation that contains images to a text-only model is not blocked.
- Archived conversations are skipped by default (`skipArchived: false` to include them).

## License

MIT
