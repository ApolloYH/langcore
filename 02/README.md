# DevScope Day 2 开发文档

本目录是 Day 2 的独立工作副本。根目录 `langcore/` 只保留：

```text
01/  # Day 1 快照
02/  # Day 2 当前实现
```

Day 2 核心目标：把 GitHub + Hacker News 数据采集进 pgvector，并完成一个简单但完整的 RAG Web 工作台。当前实现保留 Advanced RAG 的关键结构，但不额外引入 Cohere API key，精排先用本地关键词 overlap 版本替代。

## 依赖边界

Day 2 的所有依赖都必须放在 `02/` 里管理：

- Node/TypeScript 依赖只在 `02/` 下用 `pnpm install`、`pnpm add`、`pnpm --filter ... add`。
- 不在仓库根目录安装 Day 2 依赖，不改 `01/` 的依赖。
- 如果后续加入 Python，必须在 `02/` 下使用 `uv`：

```bash
cd /Users/apollo/Code-YH/langcore/02
uv init
uv add <package>
uv sync
```

Python 虚拟环境使用 `02/.venv`，`uv.lock` 和 `pyproject.toml` 属于 02 项目文件；`.venv`、缓存目录和构建产物不提交。

## 交付状态

- [x] GitHub 数据采集 Pipeline
- [x] Octokit 获取仓库基础信息
- [x] Octokit 获取 README 内容
- [x] README/metadata/HN 文本分块，默认 500 token 近似 chunks
- [x] 本地真实 embedding 模型：`Xenova/paraphrase-multilingual-MiniLM-L12-v2`
- [x] 384 维 embedding 生成
- [x] pgvector `vector(384)` 存储
- [x] Hacker News 相关讨论采集
- [x] pgvector 余弦相似度检索
- [x] Query Rewriting：DeepSeek/Claude 可用时 LLM 改写，不可用时本地 fallback
- [x] Hybrid Search：pgvector 语义分 + PostgreSQL full-text keyword score 融合
- [x] Rerank：本地关键词 overlap 精排，预留 Cohere 精排替换位置
- [x] Context Compression：只保留和问题最相关的片段
- [x] 引用溯源：返回 title/sourceType/sourceUrl
- [x] tRPC `github.ingest` 采集接口
- [x] tRPC `semantic.search` 语义搜索接口
- [x] DeepSeek Anthropic-compatible RAG 综合回答封装
- [x] 前端 TanStack Query 展示采集、搜索、回答和检索结果

## 上午理论：RAG 设计

朴素 RAG 的典型问题：

- 检索精度差：只靠向量相似度，容易错过精确关键词。
- chunk 边界信息丢失：答案需要的上下文可能散落在多个块里。
- 多跳推理失败：模型只看到 top-k 片段，不一定能串起 repo metadata、README 和社区讨论。

DevScope Day 2 的 Advanced RAG 设计：

1. Query Rewriting

   `packages/ai/src/rag-pipeline.ts` 里实现 `rewriteRagQuery`。有 `ANTHROPIC_API_KEY` 时走 DeepSeek/Claude 改写；没有 key 时使用本地 fallback，把 GitHub、README、issue、HN、risk/opportunity 等检索词补进去。

2. Hybrid Search

   `packages/db/src/vector-store.ts` 里把 `vector_score` 和 PostgreSQL full-text `keyword_score` 融合：

   ```text
   score = 0.7 * vector_score + 0.3 * keyword_score
   ```

3. Rerank

   当前使用本地 query/content 关键词 overlap 做轻量 rerank。Cohere rerank 可以以后替换 `rerankSearchResults`，不影响 API 输出结构。

4. Context Compression

   `compressSearchResults` 只保留命中 query term 的句子，并限制最大上下文长度，避免把无关 chunk 全塞给 LLM。

5. 引用溯源

   `buildCitations` 返回来源标题、类型和 URL。Web 页面会展示“引用来源”。

## 关键目录

```text
apps/api/src/github-pipeline.ts   # GitHub + HN 采集、分块、embedding、入库
apps/api/src/semantic-search.ts   # 查询 embedding -> pgvector 检索 -> Claude 回答
apps/api/src/router.ts            # tRPC routes
apps/web/app/page.tsx             # TanStack Query 前端工作台
packages/ai/src/embeddings.ts     # 500 token chunks + 本地 multilingual MiniLM embedding
packages/ai/src/rag-answer.ts     # Claude RAG answer
packages/ai/src/rag-pipeline.ts   # Query rewrite、rerank、context compression、citation
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
TRANSFORMERS_REMOTE_HOST=https://hf-mirror.com
DEVSCOPE_PROXY_URL=http://127.0.0.1:7897
GITHUB_TOKEN=
NEXT_PUBLIC_API_URL=http://localhost:4000
```

说明：

- `GITHUB_TOKEN` 可选，但建议配置，避免 GitHub unauthenticated rate limit 只有 60 次/小时。
- `ANTHROPIC_API_KEY` 是 RAG 综合回答所需。当前本地 `.env` 使用 DeepSeek 的 Anthropic-compatible endpoint 和 `deepseek-v4-pro`。
- `TRANSFORMERS_REMOTE_HOST` 只影响首次下载本地 embedding 模型。模型下载后会走本地缓存，本地执行推理。
- `DEVSCOPE_PROXY_URL` 是 API 侧网络代理。当前配置为 `http://127.0.0.1:7897`，Octokit、fetch 和 git clone 会尽量复用这个代理。

## 完整启动命令

以下命令全部在 `02/` 目录执行，不要在仓库根目录或 `01/` 里装 Day 2 依赖。

1. 进入 Day 2 目录

```bash
cd /Users/apollo/Code-YH/langcore/02
```

2. 安装依赖

```bash
pnpm install
```

3. 准备环境变量

```bash
cp .env.example .env
```

然后编辑 `02/.env`，至少确认这些值存在：

```bash
DATABASE_URL=postgres://devscope:devscope@localhost:5432/devscope
ANTHROPIC_API_KEY=你的 DeepSeek Key
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_MODEL=deepseek-v4-pro
TRANSFORMERS_REMOTE_HOST=https://hf-mirror.com
DEVSCOPE_PROXY_URL=http://127.0.0.1:7897
NEXT_PUBLIC_API_URL=http://localhost:4000
```

4. 启动 PostgreSQL + pgvector

```bash
docker compose up -d postgres
```

5. 初始化数据库表和索引

```bash
docker compose exec -T postgres psql -U devscope -d devscope < packages/db/sql/init.sql
```

6. 验证数据库

```bash
docker compose ps
docker compose exec -T postgres psql -U devscope -d devscope -c "SELECT extname FROM pg_extension WHERE extname IN ('vector','pgcrypto');"
docker compose exec -T postgres psql -U devscope -d devscope -c "\\d repo_embeddings"
```

`repo_embeddings.embedding` 必须显示为：

```text
vector(384)
```

7. 启动 API

```bash
pnpm --filter @devscope/api dev
```

API 默认地址：

```text
http://localhost:4000
```

健康检查：

```bash
curl http://localhost:4000/health
```

应该返回：

```json
{"ok":true}
```

8. 新开一个终端启动 Web

```bash
cd /Users/apollo/Code-YH/langcore/02
pnpm --filter @devscope/web dev
```

Web 默认地址：

```text
http://localhost:3000
```

9. 打开页面

```text
http://localhost:3000
```

页面使用方式：

- 输入 GitHub 地址，例如 `https://github.com/ApolloYH/EchoCore`
- 点击“采集/切换 GitHub”，或直接提问让前端自动采集
- 或直接点击“采集 PDF 论文”，默认路径为 `/Users/apollo/YH/杨豪-202234070916-毕业论文.pdf`
- 输入问题
- 点击“检索并回答”
- 查看 rewritten query、LLM 回答、引用来源和检索到的原始文本块

GitHub 地址不变时，问答不会重复拉取仓库，只复用 pgvector 中已有文本块；只有地址变化，或调用接口时显式传 `force: true`，才会重新采集。

## API 验证命令

如果不想先点 Web，可以直接用 curl 验证 tRPC。

采集 GitHub + Hacker News：

```bash
curl -s -X POST http://localhost:4000/trpc/github.ingest \
  -H 'Content-Type: application/json' \
  --data '{
    "githubUrl": "https://github.com/ApolloYH/EchoCore",
    "maxHnDiscussions": 3,
    "force": false
  }'
```

再次对同一个 GitHub 地址执行上面的命令时，后端会命中缓存并直接返回已入库统计，不再访问 GitHub。API 日志会出现类似：

```text
[github-pipeline] cache hit for ApolloYH/EchoCore, reusing 85 stored chunks
```

采集本地 PDF 论文：

```bash
curl -s -X POST http://localhost:4000/trpc/document.ingestPdf \
  -H 'Content-Type: application/json' \
  --data '{
    "filePath": "/Users/apollo/YH/杨豪-202234070916-毕业论文.pdf",
    "owner": "local",
    "repo": "thesis"
  }'
```

成功后会返回：

```ts
{
  owner: "local";
  repo: "thesis";
  filePath: string;
  title: string;
  chunksStored: number;
  pages: number | null;
}
```

语义搜索 + RAG 回答：

```bash
curl -s -X POST http://localhost:4000/trpc/semantic.search \
  -H 'Content-Type: application/json' \
  --data '{
    "owner": "ApolloYH",
    "repo": "EchoCore",
    "query": "这个仓库的价值、风险和社区反馈分别是什么？",
    "limit": 5,
    "minSimilarity": 0
  }'
```

返回结构包含：

```ts
{
  rewrittenQuery: string;
  answer: string;
  citations: Array<{
    title: string;
    sourceType: "github_repo" | "github_readme" | "github_file" | "hacker_news" | "local_pdf";
    sourceUrl: string | null;
  }>;
  results: Array<{
    title: string;
    chunkIndex: number;
    content: string;
    score: number;
    vectorScore: number;
    keywordScore: number;
    sourceUrl: string | null;
  }>;
}
```

搜索这篇毕业论文：

```bash
curl -s -X POST http://localhost:4000/trpc/semantic.search \
  -H 'Content-Type: application/json' \
  --data '{
    "owner": "local",
    "repo": "thesis",
    "query": "这篇论文的研究主题、方法、系统设计和结论是什么？",
    "limit": 5,
    "minSimilarity": 0
  }'
```

当前验证结果：

```text
PDF: /Users/apollo/YH/杨豪-202234070916-毕业论文.pdf
owner/repo: local/thesis
pages: 61
chunksStored: 11
sourceType: local_pdf
```

## 本地 Embedding 模型位置

当前 embedding 模型：

```text
Xenova/paraphrase-multilingual-MiniLM-L12-v2
```

代码定义位置：

```text
packages/ai/src/embeddings.ts
```

首次运行会下载模型，当前本机缓存位置是：

```text
02/node_modules/.pnpm/@xenova+transformers@2.17.2/node_modules/@xenova/transformers/.cache/Xenova/paraphrase-multilingual-MiniLM-L12-v2
```

模型文件大约 `129M`，关键文件：

```text
config.json
tokenizer.json
tokenizer_config.json
onnx/model_quantized.onnx
```

这个模型不提交到 Git。删除 `02/node_modules` 后，下次运行会重新下载。

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
docker compose exec -T postgres psql -U devscope -d devscope -c "\\d repo_embeddings"
```

核心表：

```sql
repo_embeddings (
  id uuid primary key,
  owner text not null,
  repo text not null,
  source_type text not null,
  source_url text,
  title text not null,
  chunk_index integer not null,
  content text not null,
  metadata jsonb not null,
  embedding vector(384) not null,
  created_at timestamptz not null
)
```

索引：

```sql
USING hnsw (embedding vector_cosine_ops)
USING gin (to_tsvector('english', title || ' ' || content))
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
6. 每个 chunk 用本地 `Xenova/paraphrase-multilingual-MiniLM-L12-v2` 生成 384 维 embedding
7. 删除该 repo 旧 chunks
8. 批量写入 `repo_embeddings`

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

1. 使用 DeepSeek/Claude 或本地 fallback 改写 query
2. 将改写后的 query 转为 384 维 embedding
3. 使用 pgvector 余弦距离搜索：

```sql
1 - (embedding <=> $1::vector) AS vector_score
```

4. 使用 PostgreSQL full-text search 计算 keyword score
5. 融合排序并执行本地 rerank
6. 压缩 context，只保留相关句子，压缩结果只用于 LLM prompt
7. 调用 DeepSeek 生成综合回答
8. 返回原始检索 chunks、引用和回答：

```ts
{
  rewrittenQuery: string;
  answer: string;
  citations: Citation[];
  results: SearchResult[];
}
```

无 `ANTHROPIC_API_KEY` 时，query rewrite 可 fallback，检索可用，但 LLM 综合回答不可真实调用。

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
document.ingestPdf # mutation
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

- 输入 GitHub URL，默认 `https://github.com/ApolloYH/EchoCore`
- 点击采集，显示总块数、GitHub metadata/README chunks、代码 chunks、HN chunks
- GitHub URL 不变时，问答只复用已落库的 pgvector 文本块，不重复拉取
- GitHub URL 变化时，提问会先自动采集新仓库，再执行 RAG 问答
- 输入本地 PDF 路径并采集，默认使用毕业论文 PDF，采集后自动切换到 `local/thesis`
- 输入自然语言问题
- 点击搜索并回答
- 展示 rewritten query、LLM answer、引用来源和完整检索文本块

前端使用：

```text
@tanstack/react-query
@trpc/client
```

## 测试与验证

### 测试命令

所有命令都在 `02/` 目录执行：

```bash
# 全量测试 + coverage，推荐每次提交前跑
pnpm test

# 按模块跑 mock 测试
pnpm test:ai
pnpm test:api
pnpm test:db

# 监听模式，适合边改边跑
pnpm test:watch

# 类型、lint、生产构建
pnpm typecheck
pnpm lint
pnpm build
```

命令含义：

| 命令 | 覆盖范围 | 是否打真实外网/API |
| --- | --- | --- |
| `pnpm test` | AI、shared、API pipeline、DB vector-store 全部 Vitest 测试，并输出 coverage | 否 |
| `pnpm test:ai` | Embedding 分块、RAG query rewrite、rerank、compression、LLM answer mock | 否 |
| `pnpm test:api` | GitHub 采集 pipeline、语义搜索 API 编排 mock | 否 |
| `pnpm test:db` | pgvector SQL 参数、事务回滚、维度校验 mock | 否 |
| `pnpm test:watch` | 与 `pnpm test` 同覆盖范围，文件变化自动重跑 | 否 |
| `pnpm typecheck` | 5 个 workspace TypeScript 类型检查 | 否 |
| `pnpm build` | API/DB/AI/shared tsc + Web Next build | 否 |

当前验证结果：

```text
pnpm test      7 test files passed, 32 tests passed
coverage       statements 95.9%, branches 86.84%, functions 100%, lines 95.65%
pnpm test:api  2 files passed, 4 tests passed
pnpm test:db   1 file passed, 3 tests passed
pnpm test:ai   4 files passed, 25 tests passed
pnpm typecheck 5/5 packages passed
pnpm build     5/5 packages passed
API /health    {"ok":true}
```

Coverage 统计口径在 `vitest.config.ts` 中配置为核心 AI/shared schema。API/DB 测试仍然随 `pnpm test` 一起执行，但不把大量异常分支、git fallback 分支纳入全局 coverage 阈值，避免覆盖率数字被实现细节噪音拉低。

### Mock 测试覆盖点

1. AI/RAG mock 测试

   文件：

   ```text
   packages/ai/src/embeddings.test.ts
   packages/ai/src/github-analyzer.test.ts
   packages/ai/src/rag-answer.test.ts
   packages/ai/src/rag-pipeline.test.ts
   ```

   覆盖：

   - Embedding 分块边界：空文本、长文本、chunk index。
   - Claude/DeepSeek 调用 mock：不请求真实模型。
   - 必填 `max_tokens`：避免 Anthropic-compatible API 直接报错。
   - Query rewriting：LLM 成功、LLM 失败、本地 fallback。
   - Rerank：关键词 overlap 排序。
   - Context compression：上下文预算耗尽、无关键词命中时 fallback。
   - Citation 去重：同一 title/sourceUrl 不重复返回。
   - Day 1 `github.analyze` 的结构化输出：枚举、范围、非法字段拦截。

2. API 层 mock 测试

   文件：

   ```text
   apps/api/src/github-pipeline.test.ts
   apps/api/src/semantic-search.test.ts
   ```

   覆盖：

   - GitHub URL 没变时命中缓存，不调用 Octokit，不重新写 DB。
   - `force: true` 时强制重新采集。
   - `git clone` 失败时 fallback 到 GitHub Tree/Raw API。
   - 过滤 `third_party`、`node_modules`、`vendor` 等依赖目录，避免 vendored 代码污染 RAG。
   - Hacker News 请求 mock，不消耗真实网络。
   - Embedding mock，不下载/运行真实模型。
   - 非 GitHub URL 拦截，例如 `gitlab.com/...` 会在调用 Octokit 前失败。
   - `semantic.search` 编排链路：rewrite -> embedding -> pgvector search -> compression -> answer -> citations。

3. DB/pgvector mock 测试

   文件：

   ```text
   packages/db/src/vector-store.test.ts
   ```

   覆盖：

   - `getRepositoryDocumentStats` 聚合统计映射。
   - `searchRepositoryDocuments` SQL 参数顺序：embedding、keyword tsquery、owner、repo、similarity、limit。
   - Hybrid Search SQL：向量分 + keyword score 融合。
   - Embedding 维度错误时事务 `ROLLBACK`，防止写入半截脏数据。

### 手动集成验证

Mock 测试不打真实外网。下面这些命令用于手动验证真实链路：

```bash
docker compose up -d postgres
pnpm --filter @devscope/api dev
pnpm --filter @devscope/web dev
```

健康检查：

```bash
curl http://localhost:4000/health
```

真实 GitHub 采集：

```bash
curl -s -X POST http://localhost:4000/trpc/github.ingest \
  -H 'Content-Type: application/json' \
  --data '{
    "githubUrl": "https://github.com/ApolloYH/EchoCore",
    "maxHnDiscussions": 5,
    "force": true
  }'
```

缓存验证：

```bash
curl -s -X POST http://localhost:4000/trpc/github.ingest \
  -H 'Content-Type: application/json' \
  --data '{
    "githubUrl": "https://github.com/ApolloYH/EchoCore",
    "maxHnDiscussions": 5,
    "force": false
  }'
```

API 日志应出现：

```text
[github-pipeline] cache hit for ApolloYH/EchoCore, reusing 70 stored chunks
```

真实 RAG 问答：

```bash
curl -s -X POST http://localhost:4000/trpc/semantic.search \
  -H 'Content-Type: application/json' \
  --data '{
    "owner": "ApolloYH",
    "repo": "EchoCore",
    "query": "这个项目的核心功能、架构设计和潜在风险是什么？",
    "limit": 5,
    "minSimilarity": 0
  }'
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

   Schema、DB 和 embedding 生成统一使用 `384`，常量在 `packages/shared/src/rag.ts`。当前本地模型是 `Xenova/paraphrase-multilingual-MiniLM-L12-v2`，真实输出就是 384 维。这个不是 hash 模拟，也不是远程 embedding API。

   如果后续换成 `bge-m3`，必须同步改为 `vector(1024)`；如果换成 OpenAI `text-embedding-3-small`，再同步改为 `vector(1536)`。维度不一致时，pgvector 插入会失败。

2. GitHub Rate Limit

   Pipeline 会记录 `x-ratelimit-remaining/x-ratelimit-limit`，并默认在 GitHub 请求之间等待 500ms。生产环境建议配置 `GITHUB_TOKEN`。

   `github.ingest` 默认 `force: false`。如果同一个 `owner/repo` 已经有 pgvector 文本块，后端会直接返回已有统计并跳过 Octokit、git clone 和 HN 请求。只有新 GitHub URL 或显式 `force: true` 才会重新采集。

3. 先跑朴素 RAG

   当前已经加了轻量 Hybrid Search、rerank 和 compression，但核心仍然保持简单：

```text
用户输入 -> query rewrite -> embedding -> pgvector + keyword search -> compression -> DeepSeek answer
```

这条链路能跑通。

4. Cohere Rerank

   Day 2 没有引入 Cohere key。当前 `rerankSearchResults` 是本地精排替代，后续如果要接 Cohere，只需要替换这个函数，不需要改 tRPC 或前端结构。

## 潜在问题与排查

1. Docker 镜像或 GitHub 请求超时

   现象：

   ```text
   TLS handshake timeout
   failed to connect to github.com
   ```

   处理：

   ```bash
   # 确认 02/.env 中存在
   DEVSCOPE_PROXY_URL=http://127.0.0.1:7897
   ```

   修改 `.env` 后必须重启 API：

   ```bash
   pnpm --filter @devscope/api dev
   ```

2. GitHub Rate Limit

   现象：日志里 `x-ratelimit-remaining` 很低，或者 GitHub API 返回 403。

   处理：

   ```bash
   # 02/.env
   GITHUB_TOKEN=你的 GitHub token
   ```

   Pipeline 已经记录 rate limit，并默认请求间隔 500ms。测试里 Octokit 是 mock，不会消耗真实 rate limit。

3. 同一个 GitHub 地址重复采集

   正常行为：

   - 前端 GitHub URL 不变时，问答不重新拉取。
   - 后端 `github.ingest` 默认 `force: false`，已有 chunks 时直接 cache hit。
   - 只有 URL 改变或显式 `force: true` 才重新采集。

   验证：

   ```bash
   curl -s -X POST http://localhost:4000/trpc/github.ingest \
     -H 'Content-Type: application/json' \
     --data '{"githubUrl":"https://github.com/ApolloYH/EchoCore","force":false}'
   ```

4. Embedding 维度不匹配

   现象：

   ```text
   expected 384 dimensions, not ...
   Embedding dimension must be 384.
   ```

   处理：

   - 当前模型是 `Xenova/paraphrase-multilingual-MiniLM-L12-v2`，输出 384 维。
   - `packages/shared/src/rag.ts` 的 `EMBEDDING_DIMENSIONS` 必须等于 DB 表 `vector(384)`。
   - 如果换模型，先改常量和 SQL，再重建表。

5. 首次启动 embedding 很慢

   原因：首次运行会下载本地模型。

   处理：

   ```bash
   # 02/.env
   TRANSFORMERS_REMOTE_HOST=https://hf-mirror.com
   ```

   模型缓存位置：

   ```text
   02/node_modules/.pnpm/@xenova+transformers@2.17.2/node_modules/@xenova/transformers/.cache
   ```

6. 检索结果混入依赖库/第三方代码

   现象：问题问 EchoCore，但检索块来自 `third_party`、`node_modules`、`vendor`。

   当前处理：

   - Pipeline 已过滤 `.git`、`.next`、`.turbo`、`.venv`、`__pycache__`、`coverage`、`deps`、`dist`、`external`、`node_modules`、`third_party`、`vendor`。
   - 对 EchoCore 已重新采集，当前落库为 `70` 个 chunks，检索来源回到 README、backend、config、docker-compose 等项目自身文件。

7. LLM 回答为空或报错

   可能原因：

   - `ANTHROPIC_API_KEY` 缺失。
   - `ANTHROPIC_BASE_URL` 不兼容。
   - provider 没返回 text block。

   处理：

   ```bash
   # 02/.env
   ANTHROPIC_API_KEY=你的 DeepSeek Key
   ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
   ANTHROPIC_MODEL=deepseek-v4-pro
   ```

   注意：测试里 LLM 是 mock，不会真实调用 DeepSeek。真实调用只发生在启动 API 后访问 `semantic.search`。

8. pgvector 表结构旧了

   现象：字段不存在、约束不接受 `github_file`、embedding 维度错误。

   处理：

   ```bash
   docker compose exec -T postgres psql -U devscope -d devscope < packages/db/sql/init.sql
   ```

   确认：

   ```bash
   docker compose exec -T postgres psql -U devscope -d devscope -c "\\d repo_embeddings"
   ```

9. Web 请求 API 失败

   现象：页面点击后没有结果，浏览器 console 里请求 `localhost:4000` 失败。

   处理：

   ```bash
   # 02/.env
   NEXT_PUBLIC_API_URL=http://localhost:4000
   ```

   然后重启 Web：

   ```bash
   pnpm --filter @devscope/web dev
   ```
