# 创见校友年会问卷系统

创见校友年会问卷系统用于年度校友信息更新、活动反馈、年会参与意向收集和通讯录维护。项目目标是以 Cloudflare Workers 承载前后端入口，以 Cloudflare D1 存储成员、问卷结果和找回请求，并通过自定义域名对校友开放访问。

## MVP 功能

- 校友入口：查看年会说明，确认通讯录信息，填写年度问卷。
- 成员核验：基于通讯录成员信息识别校友，支持资料更新和找回请求。
- 年度问卷：收集活动反馈、未来活动需求、创见集市意向和通讯录授权。
- 管理后台：使用 `ADMIN_TOKEN` 进入后台，管理成员名单、问卷结果、通讯录和导出。
- CSV 导入：成员导入只支持标准 CSV 模板，不兼容旧 Excel 文件。模板见 [docs/import-template.md](docs/import-template.md)。

## 本地开发

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
# 编辑 .dev.vars，把 ADMIN_TOKEN 改成仅本地使用的随机值
npm run db:migrate:local
npm run dev
```

常用脚本：

- `npm run dev`：启动 Wrangler 本地开发服务。
- `npm run check`：执行 TypeScript 类型检查。
- `npm run db:migrate:local`：把 `migrations/` 里的 D1 迁移应用到本地数据库。
- `npm run db:migrate:remote`：把迁移应用到 Cloudflare 远端 D1 数据库。

更完整的本地验证流程见 [scripts/README.md](scripts/README.md)。

## Cloudflare D1 创建与迁移

1. 登录 Cloudflare：

   ```powershell
   npx wrangler login
   ```

2. 创建生产 D1 数据库：

   ```powershell
   npx wrangler d1 create csight-alumni-db
   ```

3. 将命令输出的 `database_id` 填入 [wrangler.jsonc](wrangler.jsonc) 的 `d1_databases[0].database_id`。本项目约定：

   - binding：`DB`
   - database_name：`csight-alumni-db`
   - migrations_dir：`migrations`

4. 应用远端迁移：

   ```powershell
   npm run db:migrate:remote
   ```

5. 部署前确认远端迁移已经成功，再部署 Worker：

   ```powershell
   npm run deploy
   ```

参考：Cloudflare [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) 和 [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)。

## ADMIN_TOKEN Secret

`ADMIN_TOKEN` 是管理后台口令，不要写入 `wrangler.jsonc`，也不要提交真实值。

本地开发：

```powershell
Copy-Item .dev.vars.example .dev.vars
# 编辑 .dev.vars 中的 ADMIN_TOKEN
```

生产环境：

```powershell
npx wrangler secret put ADMIN_TOKEN
```

输入一个足够长、随机、只给管理员使用的值。之后在 Cloudflare Dashboard 的 Worker 设置中确认 secret 已配置。参考 Cloudflare [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/) 和 [environment variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)。

## Workers Builds GitHub 连接

可以通过 Cloudflare Workers Builds 连接 GitHub 仓库，让 main 分支 push 后自动构建和部署。

1. 将代码推送到 GitHub 仓库。
2. 打开 Cloudflare Dashboard，进入 Workers & Pages。
3. 创建或选择 Worker，使用 Git integration / Workers Builds 连接 GitHub 仓库。
4. 选择生产分支，例如 `main`。
5. 构建命令建议使用：

   ```text
   npm install && npm run check
   ```

6. 部署命令使用 Wrangler 默认部署流程，或在 Build 配置中确保执行：

   ```text
   npm run deploy
   ```

7. 在首次自动部署前，先确认远端 D1 已创建、`wrangler.jsonc` 中的 `database_id` 已替换、`ADMIN_TOKEN` secret 已配置、远端迁移已执行。

参考：Cloudflare [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) 和 [GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)。

## 自定义域名绑定

1. 确认域名已经在 Cloudflare 账户中托管，或目标子域可由 Cloudflare 管理。
2. 进入 Worker 的 Settings / Domains and Routes。
3. 添加 Custom Domain，例如：

   ```text
   alumni.example.org
   ```

4. Cloudflare 会为该自定义域名创建 DNS 记录并签发证书。
5. 等待证书和 DNS 生效后访问自定义域名，确认首页、问卷提交、管理后台和静态资源都可访问。

Custom Domain 会把该域名下所有路径指向 Worker。参考 Cloudflare [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。

## 敏感数据与导入文件

真实通讯录含手机号、微信号、邮箱等个人信息，不能提交到 Git。

- 真实 `.csv`、`.xlsx`、`.xls` 文件只应保存在受控本地环境或安全存储中。
- 仓库 `.gitignore` 已忽略 `*.csv`、`*.xlsx`、`*.xls`，避免误提交真实名单。
- `sample-data/members-template.csv` 仅包含虚构示例，用于说明标准 CSV 表头和格式。
- 导入前请核对文件来源、字段含义、授权范围和管理员操作权限。
- 导出文件同样视为敏感数据，下载后不要转发到公开群、网盘或未授权仓库。
