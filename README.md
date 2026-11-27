# AI 起名平台（Vercel + Supabase + 多模型）

一个零基础也能跑通的 AI 起名平台：输入需求 → 大模型流式输出 3 组名字方案 → 结果自动写入 Supabase → 部署到 Vercel，绑定独立域名访问。

- 主域名：`rangzijigenghao.online`
- 部署子域（CNAME）：`wangyihan03`（即 `wangyihan03.rangzijigenghao.online`）
- 默认模型：豆包（火山方舟），可下拉切换 DeepSeek / 通义千问 / Kimi

## 目录结构

```
ai-naming-platform/
├── api/
│   ├── name.js          # 起名主接口：modelConfigMap + SSE 流式转发 + 写库
│   └── history.js       # 历史记录查询接口
├── index.html           # 前端页面（流式渲染 + 模型下拉 + 历史列表）
├── supabase/
│   └── schema.sql       # 建表 SQL + RLS 策略
├── .env.example         # 环境变量模板（复制成 .env）
├── .gitignore           # 已排除 .env / node_modules / .vercel
└── package.json
```

## 本地跑通（阶段 1→2）

```bash
cd ai-naming-platform
npm install @supabase/supabase-js dotenv
cp .env.example .env      # 然后填入真实密钥
vercel dev                # 打开 http://localhost:3000
```

前端会请求 `POST /api/name`，后端做的事只有三件：

1. 从 `modelConfigMap[modelKey]` 取出 `baseURL / apiKey / model`；
2. 用同一段 `fetch` 调 `${baseURL}/chat/completions`，请求体带 `stream: true`；
3. 逐片解析上游 SSE 的 `delta.content`，原样推给浏览器，最后把全文写进 `name_history`。

## 建表（阶段 3）

Supabase → SQL Editor → 粘贴执行 `supabase/schema.sql`。
调试期脚本里默认开启了「匿名可读写」的 RLS 策略，正式上线按文件里 **方案 B** 的注释重配权限。

## 推送 GitHub + 部署 Vercel（阶段 4）

```bash
git init && git add . && git commit -m "feat: AI 起名平台（多模型 + 流式 + Supabase）"
git remote add origin https://github.com/<你的账号>/ai-naming-platform.git
git push -u origin main        # .env 已在 .gitignore 中，不会被提交
```

Vercel → Add New Project → 导入该仓库 → 在 **Settings → Environment Variables** 里逐条填入 `.env` 的全部变量（生产 / 预览 / 开发三个环境都勾上）→ Deploy。

## 绑定域名 `rangzijigenghao.online`

1. Vercel 项目 → Settings → Domains → 添加 `wangyihan03.rangzijigenghao.online`（如要裸域再加一条 `rangzijigenghao.online`）；
2. 到域名服务商 DNS 控制台添加记录：

| 主机记录 | 类型 | 记录值 |
|---|---|---|
| `wangyihan03` | CNAME | `cname.vercel-dns.com` |

3. 回 Vercel 点 Verify，生效后访问 `https://wangyihan03.rangzijigenghao.online` 即为公网地址。

> 如果服务商要求 CNAME 记录名就是 `wangyihan03`（部分免费 DNS 平台的默认写法），上面的表格照填即可；若你的平台是把 `wangyihan03` 当成「项目前缀」自动拼接，最终访问地址仍是 `wangyihan03.rangzijigenghao.online`，两者一致。

## 常见报错

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面提示「尚未配置密钥」 | Vercel 环境变量没填或没重新部署 | 补变量后 Redeploy |
| 上游返回 401 | API Key 错 / 方舟模型名不是接入点 ID | 按方舟控制台改 `DOUBAO_MODEL` |
| 通义千问报错 | 用了普通 dashscope 地址 | 必须 `compatible-mode/v1` |
| 历史为空 | SQL 没执行 / RLS 拦截 | 先跑 schema.sql，再用调试策略验证 |
| 文字一次性全出来 | 网关或代理缓冲了 SSE | 已加 `X-Accel-Buffering: no` 与 `no-transform` |
