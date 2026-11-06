# 装 dsh-model-scope（本地 tarball 方式）

适合：不能或不想往 npm 发布，直接把包发给别人用。

---

## 一、给发送方（你）

把这一个文件发过去就行：

```
/root/dsh-model-scope/dsh-model-scope-1.0.1.tgz
大小 21723 字节（21.2 KB）
SHA-256 f305b765a76963a8ea2e6105db134dc8d834cf6180eed6984b542c534a7587ca
```

对方拿到后核对一下大小/哈希一致，再装。

---

## 二、给接收方（对方照做）

### 1. 前提

- 已经装好 `dsh`，命令行能跑 `dsh --help`
- 版本 ≥ `0.2.0-rc.1`（`dsh --version` 看）。更老的版本本插件会拒绝加载
- **不需要** npm 账号、不需要联网装依赖（包里零第三方依赖）

### 2. 安装

```bash
dsh plugin --profile web add /你放文件的路径/dsh-model-scope-1.0.1.tgz
```

输出会长这样：

```
dsh: initialized profile web at ~/.dsh/profiles/web     ← profile 不存在时自动建
dependencies:
+ dsh-model-scope file:/你放文件的路径/dsh-model-scope-1.0.1.tgz
Done in 401ms using pnpm
```

这一步会自动把 `dsh-model-scope` 追加进该 profile 的 `dsh.profile.bundles`，不用手动改任何配置。

如果对方用的是别的 profile（比如 `headless` / 自建的），把 `--profile web` 换成对应名字即可。

### 3. 重启

```bash
# 如果你用 systemd 跑 dsh-web
systemctl --user restart dsh-web      # 或 sudo systemctl restart dsh-web
# 如果就是前台跑的 dsh web，Ctrl-C 后重新起
```

不需要重启的话，下次启动就会生效。

### 4. 验证装上了

```bash
# 配置里应该有这一行
dsh --profile web --dump-config | grep -A3 "id: model-scope"
```

应该看到：

```
- id: model-scope
  name: dsh-model-scope
  config:
    ui: true
```

然后起 web，打开页面右下角应该有 **`⇄ 对话模型`** 按钮。

更直接的探针（页面已登录的状态下）：

```bash
curl -s -b <你的cookie> http://127.0.0.1:3080/dsh-model-scope/version
# {"ok":true,"build":"1.0.1"}
```

---

## 三、怎么用

### 面板

右下角 `⇄ 对话模型`：

1. 选范围：「全部对话 / 某个工作区 / 未挂载工作区」，下面是 provider 下拉，两者可叠加
2. 搜索框找模型，点一下选中（只在该行展开推理档）
3. `先预演` 看会影响几个，`切换` 真写

### 命令

```
/model-scope                                    全部对话的模型分布
/model-scope list ws:<工作区 id 前几位>          只看某个范围
/model-scope workbuddy deepseek-v4.1-flash high  切全部
/model-scope ws "工作区名" <provider> <model> [effort]
/model-scope dry ...                            只预演，加在最前面
```

### 注意

- **只有范围是「全部对话」时才会动全局默认模型**，切单个工作区不会影响以后新开的对话
- 已经是目标模型的对话会被跳过（`unchanged`），重复跑很便宜
- 归档对话默认不动（配置里 `skipArchived: false` 可改）

---

## 四、卸载

```bash
dsh plugin --profile web remove dsh-model-scope
```

已经写进对话日志的 `model/selection` 事件不会被撤销 —— 那是正常的 DSH 事件，对话照常能读。

---

## 五、出问题怎么查

| 现象 | 原因 | 处理 |
|---|---|---|
| `dsh plugin add` 报 peer 不满足 | dsh 版本太老 | 升级 dsh 到 ≥ 0.2.0-rc.1 |
| 装了但右下角没按钮 | 不是 web profile，或没重启 | 确认 `--profile web`，重启；tui/headless 下只有 `/model-scope` 命令没有面板 |
| `/dsh-model-scope/version` 404 | 插件没加载 | `dsh --profile web --dump-config \| grep model-scope` 确认行在；再看启动日志有没有 `model-scope` 相关报错 |
| 点切换没反应 | 前端脚本缓存 | 硬刷新页面（Ctrl-Shift-R） |
