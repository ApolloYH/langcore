# DevScope Day 2 开发文档

本目录是 Day 2 的独立工作副本。根目录 `langcore/` 只保留：

```text
01/  # Day 1 快照
02/  # Day 2 当前实现
```

Day 2 核心目标：把 GitHub + Hacker News 数据采集进 pgvector，并用最朴素的 RAG 链路完成语义检索和回答。

## 交付状态

- [x] GitHub 数据采集 Pipeline
- [x] Octokit 获取仓库基础信息
- [x] Octokit 获取 README 内容
- [x] README/metadata/HN 文本分块，默认 500 token 近似 chunks
- [x] 1536 维 embedding 生成
- [x] pgvector `vector(1536)` 存储
- [x] Hacker News 相关讨论采集
- [x] pgvector 余弦相似度检索
- [x] tRPC `github.ingest` 采集接口
- [x] tRPC `semantic.search` 语义搜索接口
- [x] Claude RAG 综合回答封装
- [x] 前端 TanStack Query 展示采集、搜索、回答和检索结果

## 关键目录

```text
apps/api/src/github-pipeline.ts   # GitHub + HN 采集、分块、embedding、入库
apps/api/src/semantic-search.ts   # 查询 embedding -> pgvector 检索 -> Claude 回答
apps/api/src/router.ts            # tRPC routes
apps/web/app/page.tsx             # TanStack Query 前端工作台
packages/ai/src/embeddings.ts     # 500 token chunks + 1536 维 embedding
packages/ai/src/rag-answer.ts     # Claude RAG answer
packages/db/src/vector-store.ts   # pgvector 建表、写入、搜索
packages/db/sql/init.sql          # PostgreSQL 扩展、表、索引初始化
packages/shared/src/rag.ts        # Day 2 输入输出 Schema
```

## 环境变量

复制配置：

```bash
cp .env.example .env
```

`.env.example`：

```bash
DATABASE_URL=postgres://devscope:devscope@localhost:5432/devscope
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_MODEL=deepseek-v4-pro
GITHUB_TOKEN=
NEXT_PUBLIC_API_URL=http://localhost:4000
```

说明：

- `GITHUB_TOKEN` 可选，但建议配置，避免 GitHub unauthenticated rate limit 只有 60 次/小时。
- `ANTHROPIC_API_KEY` 是 RAG 综合回答所需。当前本地 `.env` 使用 DeepSeek 的 Anthropic-compatible endpoint 和 `deepseek-v4-pro`。

## 数据库

启动 Postgres + pgvector：

```bash
docker compose up -d postgres
```

如果容器已存在，但需要更新 Day 2 表结构：

```bash
docker compose exec -T postgres psql -U devscope -d devscope < packages/db/sql/init.sql
```

验证扩展和表：

```bash
docker compose exec -T postgres psql -U devscope -d devscope -c "SELECT extname FROM pg_extension WHERE extname IN ('vector','pgcrypto');"
docker compose exec -T postgres psql -U devscope -d devscope -c "\\d repository_documents"
```

核心表：

```sql
repository_documents (
  id uuid primary key,
  owner text not null,
  repo text not null,
  source_type text not null,
  source_url text,
  title text not null,
  chunk_index integer not null,
  content text not null,
  metadata jsonb not null,
  embedding vector(1536) not null,
  created_at timestamptz not null
)
```

索引：

```sql
USING hnsw (embedding vector_cosine_ops)
```

## 采集 Pipeline

入口：

```ts
ingestGithubRepository({ owner, repo, maxHnDiscussions })
```

流程：

1. Octokit `repos.get` 获取仓库基础信息
2. 记录 GitHub rate limit 日志
3. Octokit `repos.getReadme` 获取 README
4. Algolia Hacker News API 搜索相关 story
5. 文本按 500 token 近似分块
6. 每个 chunk 生成 1536 维 embedding
7. 删除该 repo 旧 chunks
8. 批量写入 `repository_documents`

真实验证结果：

```text
vercel/next.js
chunksStored: 4
githubChunks: 2
hackerNewsChunks: 2
```

## 语义搜索

入口：

```ts
semanticSearch({ query, owner, repo, limit })
```

流程：

1. 将用户 query 转为 1536 维 embedding
2. 使用 pgvector 余弦距离搜索：

```sql
ORDER BY embedding <=> $1::vector
```

3. 将 top-k context 拼进 prompt
4. 调用 Claude 生成综合回答
5. 返回：

```ts
{
  answer: string;
  results: SearchResult[];
}
```

无 `ANTHROPIC_API_KEY` 时，检索可用，但 Claude 综合回答不可真实调用。

## tRPC 路由

API 服务：

```bash
pnpm --filter @devscope/api dev
```

默认：

```text
http://localhost:4000
```

路由：

```text
github.ingest      # mutation
semantic.search    # mutation
github.analyze     # Day 1 结构化分析仍保留
health             # query
```

## 前端

启动：

```bash
pnpm --filter @devscope/web dev
```

默认：

```text
http://localhost:3000
```

页面能力：

- 输入 `owner/repo`
- 点击采集，显示 total/GitHub/HN chunks
- 输入自然语言问题
- 点击搜索并回答
- 展示 Claude answer 和 pgvector retrieved context

前端使用：

```text
@tanstack/react-query
@trpc/client
```

## 测试与验证

运行：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

当前验证结果：

```text
pnpm test      12 passed, coverage > 80%
pnpm typecheck 5/5 packages passed
pnpm lint      5/5 packages passed
pnpm build     5/5 packages passed
API /health    {"ok":true}
```

pgvector 最小检索验证结果：

```json
[
  {
    "title": "README",
    "sourceType": "github_readme",
    "score": 0.43301270702519157
  },
  {
    "title": "HN discussion",
    "sourceType": "hacker_news",
    "score": 0
  }
]
```

## 避坑处理

1. Embedding 维度

   Schema、DB 和 embedding 生成统一使用 `1536`，常量在 `packages/shared/src/rag.ts`。如果后续换成 `bge-m3`，必须同步改为 `vector(1024)`，否则插入会失败。

2. GitHub Rate Limit

   Pipeline 会记录 `x-ratelimit-remaining/x-ratelimit-limit`，并默认在 GitHub 请求之间等待 500ms。生产环境建议配置 `GITHUB_TOKEN`。

3. 先跑朴素 RAG

   当前没有做 Hybrid Search、rerank、复杂 chunk overlap。先保证：

```text
用户输入 -> embedding -> pgvector cosine search -> Claude answer
```

这条链路能跑通。
