# 推到 GitHub

仓库：https://github.com/aisyuu/dsh-model-scope （已存在，空）

## 本机缺什么

`git push` 需要凭据。这台机器上：

- 没有 `/root/.npmrc`、没有 `/root/.netrc`、没有 `/root/.git-credentials`
- 没有 `gh` CLI
- 环境变量里没有 `GITHUB_TOKEN` / `GH_TOKEN`
- `/root/.ssh/` 下现有的两把私钥都没往 GitHub 注册（`git@github.com` 直连 → `Permission denied (publickey)`）

所以推送这一步必须由仓库所有者授权一次。

## 推荐：加部署密钥（Deploy key）

已经生成好一把专用密钥，只给这个仓库用：

```
公钥：/root/.ssh/id_ed25519_dsh_model_scope.pub
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJJUSW004QqlwdggNltB2MhfNr3rNvjOiNERhkdvV4s6 dsh-model-scope-deploy
```

操作（在 GitHub 网页上）：

1. 打开 https://github.com/aisyuu/dsh-model-scope/settings/keys
2. `Add deploy key`
3. Title 填 `dsh-model-scope-deploy`
4. Key 粘贴上面那整行
5. **勾上 `Allow write access`**（不勾只能拉不能推）
6. `Add key`

然后本机执行：

```bash
cd /root/dsh-model-scope
git remote set-url origin git@github.com:aisyuu/dsh-model-scope.git
GIT_SSH_COMMAND="ssh -i /root/.ssh/id_ed25519_dsh_model_scope -o IdentitiesOnly=yes" git push -u origin main
```

## 备选：给一个 PAT

在 https://github.com/settings/tokens 建一个 classic token，勾 `repo` 权限，然后：

```bash
cd /root/dsh-model-scope
git remote set-url origin https://<TOKEN>@github.com/aisyuu/dsh-model-scope.git
git push -u origin main
```

或者直接把 token 给我，我来推。

注意：token 会留在 `.git/config` 里，推完记得 `git remote set-url origin https://github.com/aisyuu/dsh-model-scope.git` 清掉。

## 推上去之后

对方安装：

```bash
dsh plugin --profile web add github:aisyuu/dsh-model-scope
```

以后你更新，`git push` 一下，对方重新 `add` 一次（或删掉重装）就拿到新版。

`public` 仓库所以不需要对方有 GitHub 账号 —— `pnpm` 走 https 匿名拉取。

## 仓库里会有什么

```
.gitignore
.npmignore
INSTALL-tarball.md
LICENSE
PUBLISH-GITHUB.md
PUBLISH.md
README.md
cordis.patch.yml
lib/index.js
lib/ui.js
package.json
```

`*.tgz` 已被 `.gitignore` 排除，不会进仓库。
