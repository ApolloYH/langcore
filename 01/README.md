# DevScope Day 1 开发文档

DevScope 是一个用于分析 GitHub 项目健康度、活跃度、风险和机会的结构化分析服务。当前 Day 1 版本的核心目标是把 Monorepo 骨架、PostgreSQL + pgvector、本地开发命令、Claude 结构化输出 API 和 TDD 测试跑通。

## 交付状态

- [x] Monorepo 项目骨架：pnpm workspace + Turborepo
- [x] `apps/web`：Next.js 15 + Tailwind CSS 4 + shadcn/ui 基础组件
- [x] `apps/api`：Fastify + tRPC
- [x] `packages/db`：Drizzle ORM + PostgreSQL + pgvector schema
- [x] `packages/ai`：Anthropic SDK 封装，强制 Claude tool call 输出结构化数据
- [x] `packages/shared`：Zod Schema 与公共类型定义
- [x] Docker Compose 启动 PostgreSQL + pgvector
- [x] GitHub 项目分析结构化输出 API
- [x] Vitest TDD，Mock Anthropic SDK，覆盖率阈值 80%+
- [x] API 层集成测试，Mock AI 层并通过 Fastify inject 验证 tRPC 接口

## 目录结构

```text
.
├── apps
│   ├── api                  # Fastify + tRPC API 服务
│   │   └── src
│   │       ├── router.ts    # tRPC router，包含 github.analyze mutation
│   │       └── server.ts    # Fastify 启动入口
│   └── web                  # Next.js 15 前端
│       ├── app              # App Router 页面
│       ├── components       # shadcn/ui 组件
│       └── lib              # Web 工具函数
├── packages
│   ├── ai                   # Anthropic Claude SDK 封装与测试
│   ├── db                   # Drizzle schema、数据库客户端、pgvector 初始化 SQL
│   └── shared               # Zod Schema、公共类型
├── docker-compose.yml       # PostgreSQL + pgvector
├── pnpm-workspace.yaml      # pnpm workspace 配置
├── turbo.json               # Turborepo task pipeline
└── vitest.config.ts         # 测试与覆盖率阈值
```

## 环境准备

要求：

- Node.js 20+，本次验证环境为 Node.js 24.16.0
- pnpm 11+
- Docker Desktop 或兼容 Docker Compose 的运行环境

安装依赖：

```bash
pnpm install
```

复制环境变量：

```bash
cp .env.example .env
```

`.env.example` 内容：

```bash
DATABASE_URL=postgres://devscope:devscope@localhost:5432/devscope
NEXT_PUBLIC_API_URL=http://localhost:4000
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
```

## 启动 PostgreSQL + pgvector

启动数据库：

```bash
docker compose up -d postgres
```

检查容器状态：

```bash
docker compose ps
```

当前 Compose 使用镜像：

```text
pgvector/pgvector:pg16
```

初始化 SQL 位于 `packages/db/sql/init.sql`：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Drizzle schema 位于 `packages/db/src/schema.ts`，包含 `repository_analyses` 表和 `embedding vector(1536)` 字段。

## 启动服务

启动 API：

```bash
pnpm --filter @devscope/api dev
```

API 默认监听：

```text
http://localhost:4000
```

健康检查：

```bash
curl http://localhost:4000/health
```

启动 Web：

```bash
pnpm --filter @devscope/web dev
```

Web 默认监听：

```text
http://localhost:3000
```

Web 默认请求 `NEXT_PUBLIC_API_URL` 指向的 API 地址；未配置时使用 `http://localhost:4000`。如果 API 临时换了端口，例如 `4012`，启动 Web 前需要设置：

```bash
NEXT_PUBLIC_API_URL=http://localhost:4012 pnpm --filter @devscope/web dev
```

也可以启动整个 monorepo：

```bash
pnpm dev
```

## 结构化分析 API

入口：

- tRPC router：`apps/api/src/router.ts`
- mutation：`github.analyze`
- AI 封装：`packages/ai/src/github-analyzer.ts`
- Schema：`packages/shared/src/github-analysis.ts`

输入 Schema：

```ts
{
  owner: string;
  repo: string;
  description?: string;
  stars?: number;
  openIssues?: number;
  closedIssuesLast30Days?: number;
  commitsLast30Days?: number;
  contributorsLast90Days?: number;
}
```

输出 Schema：

```ts
{
  health_score: number; // 0-100 整数
  activity_level: "high" | "medium" | "low" | "dead";
  key_metrics: {
    stars_growth_rate: number;       // 0-1
    issue_resolution_rate: number;   // 0-1
    contributor_diversity: number;   // 0-1
  };
  risk_factors: string[];
  opportunities: string[];
  recommendation: "invest" | "watch" | "avoid";
}
```

Claude 调用约束：

- 使用 `messages.create`
- 必填 `max_tokens`
- 使用 `tools[].input_schema`
- 不使用 OpenAI 风格的 `parameters`
- 使用 `tool_choice: { type: "tool", name: "record_github_project_analysis" }` 强制工具调用
- 对 429、5xx、网络类临时错误做最多 2 次重试；400 等请求格式错误不重试
- Claude 返回后再次用 `GithubProjectAnalysisSchema.parse(...)` 校验

关键实现：

```ts
const response = await client.create({
  model,
  max_tokens: 1024,
  tool_choice: { type: "tool", name: TOOL_NAME },
  tools: [
    {
      name: TOOL_NAME,
      description: "Return a structured GitHub project investment analysis.",
      input_schema: zodToJsonSchema(GithubProjectAnalysisSchema, {
        $refStrategy: "none"
      }) as Anthropic.Tool.InputSchema
    }
  ],
  messages: [...]
});
```

## TDD 测试策略

测试文件：

```text
packages/ai/src/github-analyzer.test.ts
apps/api/src/app.test.ts
```

AI 层测试重点：

- Mock Anthropic SDK，避免真实 Claude API 调用
- 验证调用参数包含必填 `max_tokens`
- 验证工具 schema 使用 `input_schema`
- 验证没有错误使用 OpenAI 的 `parameters`
- 验证边界值：`health_score = 0`、metric `0/1`
- 验证非法数值会被 Zod 拦截
- 验证大写枚举值会被 Zod 拦截
- 验证 Claude 返回额外字段会被 `.strict()` 拦截
- 验证 Claude 没有返回 tool call 时抛出明确错误

API 层测试重点：

- 通过 `createApp({ logger: false })` 创建测试 Fastify 实例，不监听真实端口
- 使用 `app.inject(...)` 调用 `/health` 和 `/trpc/github.analyze`
- Mock `@devscope/ai` 的 `analyzeGithubProject`，避免真实 Claude API 调用
- 验证 `github.analyze` 成功时返回 tRPC 结构化 JSON
- 验证非法输入会在 tRPC/Zod 层返回 400，且不会调用 AI 层
- 验证 AI 层异常会通过 API 返回 500 错误
- 验证 CORS preflight 能正常响应

运行测试：

```bash
pnpm test
```

当前覆盖率阈值配置在 `vitest.config.ts`：

```ts
thresholds: {
  branches: 80,
  functions: 80,
  lines: 80,
  statements: 80
}
```

当前测试结果：

```text
Test Files  2 passed (2)
Tests       13 passed (13)
Statements 82.97%
Branches   81.08%
Functions  90.9%
Lines      82.22%
```

## 常用验证命令

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
docker compose config
```

## 已处理的 Day 1 避坑点

1. Claude API 格式

   `max_tokens` 已显式传入；工具 schema 使用 `input_schema`，没有使用 OpenAI 的 `parameters`。

2. Zod 与 Claude 输出对齐

   输出 Schema 使用 `.strict()`，可以拦截 Claude 多返回字段；枚举值只接受小写的 `high/medium/low/dead` 和 `invest/watch/avoid`。

3. TDD 不触发真实 API

   AI 层测试 mock 了 `@anthropic-ai/sdk`，只验证调用形态、解析逻辑和 Zod 校验逻辑；API 层测试 mock 了 `@devscope/ai`，只验证 HTTP/tRPC 行为。

4. pnpm 构建脚本审批

   `pnpm-workspace.yaml` 已允许 `esbuild` 和 `sharp` 的安装脚本，否则 Vite/Vitest 和 Next 依赖可能安装不完整。

5. Next 15 lint

   `next lint` 会进入交互式初始化，并提示未来移除；当前 Web lint 使用 `tsc -p tsconfig.json --noEmit`，适合 CI 非交互式执行。

## 下一步建议

- 接入 GitHub API 自动拉取仓库指标，而不是依赖调用方传入
- 把分析结果写入 `repository_analyses`
- 增加 Drizzle migration 管理
- 在 Web 页面接入 tRPC client 和真实分析表单
