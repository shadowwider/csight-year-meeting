# 本地验证流程

这份说明用于在本地验证 Cloudflare Workers + D1 的基础流程，不依赖外部服务。真实通讯录不要放进仓库，也不要用真实个人信息做本地冒烟测试。

## 1. 安装依赖

```powershell
npm install
```

## 2. 准备本地环境变量

```powershell
Copy-Item .dev.vars.example .dev.vars
notepad .dev.vars
```

把 `ADMIN_PASSWORD` 改成只用于本地的长密码。不要提交 `.dev.vars`。

## 3. 应用本地 D1 迁移

```powershell
wrangler d1 migrations apply csight-alumni-db --local
```

或使用项目脚本：

```powershell
npm run db:migrate:local
```

## 4. 启动本地 Worker

```powershell
wrangler dev
```

或使用项目脚本：

```powershell
npm run dev
```

默认访问地址通常是：

```text
http://127.0.0.1:8787
```

## 5. PowerShell curl 冒烟测试思路

确认首页或静态入口能返回内容：

```powershell
curl.exe -i http://127.0.0.1:8787/
```

确认公开页面和静态资源没有明显 500：

```powershell
curl.exe -I http://127.0.0.1:8787/
curl.exe -I http://127.0.0.1:8787/csightlogo.png
```

如果成员导入接口已经实现，可以用虚构模板测试上传。下面命令中的路径和接口名请按实际实现调整：

```powershell
$AdminPassword = "replace-with-local-admin-password"
curl.exe -i `
  -H "X-Admin-Password: $AdminPassword" `
  -H "Content-Type: text/csv; charset=utf-8" `
  --data-binary "@sample-data/members-template.csv" `
  http://127.0.0.1:8787/api/admin/import-members
```

验证点：

- 未携带或携带错误 `ADMIN_PASSWORD` 时，管理接口应拒绝访问。
- 使用 `sample-data/members-template.csv` 时，应能识别标准表头。
- 上传 `.xlsx` 或 `.xls` 时，应返回不支持的文件类型。
- 缺少 `spirit_name` 或 `phone` 的行，应被拒绝或报告为错误。
- 重复 `phone` 应被识别为重复数据。

## 6. 类型检查

```powershell
npm run check
```

本地验证完成后运行：

```powershell
git status --short
```
