# 发布 / 分发指南

包已经打好，三种分发方式，任选：

## A. npm 公开包（推荐，别的用户可以 `dsh plugin add dsh-model-scope`）

`dsh-model-scope` 在 npm 上**名字空着**（已查 registry，404）。

```bash
cd /root/dsh-model-scope
npm login                       # 或 npm config set //registry.npmjs.org/:_authToken=<token>
npm publish --access public
```

发布后别人只需要：

```bash
dsh plugin --profile web add dsh-model-scope
```

已验证 `dsh plugin add` 会自动：
- 把 `dsh-model-scope` 加进 profile 的 `dependencies`
- 追加进 `dsh.profile.bundles`
- 读取包里的 `cordis.patch.yml`，把 `- id: model-scope` 行插入 Loader 树

## B. 本地 tarball（不发布，直接给文件）

`dsh-model-scope-1.0.1.tgz`（21 KB）可以直接发给别人：

```bash
dsh plugin --profile web add /path/to/dsh-model-scope-1.0.1.tgz
```

已实测：从 tarball 装出来的 profile 能正常起 web，面板注入、5 条路由全部工作。

## C. Git 仓库 / GitHub

```bash
cd /root/dsh-model-scope
git remote add origin https://github.com/<you>/dsh-model-scope.git
git push -u origin main
```

别人可以 `dsh plugin --profile web add github:<you>/dsh-model-scope`。

---

## 发布前检查清单

- [x] `npm pack --dry-run` 内容正确（6 个文件，21 KB，无 node_modules）
- [x] `main` / `exports` 指向 `./lib/index.js`
- [x] `dsh.bundle.patch` 指向 `./cordis.patch.yml`
- [x] `dsh.engines.dsh` = `>=0.2.0-rc.1`（本机 runtime 是 0.2.0-rc.2）
- [x] `peerDependencies` 只有 `@deepseek-ai/cordis`，且标 `optional`
- [x] 无第三方运行时依赖（只有 node: 内置模块）
- [x] 空 profile 从零安装 → 启动 → 路由/面板全部正常
- [x] 在已有 225 个真实对话的宿主上跑通 dry-run 与真写 + 回填

## 升级已装的旧版本

```bash
dsh plugin --profile web add dsh-model-scope@latest   # 升级
dsh plugin --profile web remove dsh-model-scope       # 卸载
```

`remove` 只去掉插件行和依赖；插件写进会话日志的 `model/selection` 事件**不会**被撤销——那是普通 DSH 事件，会话照常可读，只是仍用当时切过去的模型。
