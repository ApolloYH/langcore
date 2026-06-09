"use client";

import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { Database, Link2, Search, UploadCloud } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

type IngestResponse = {
  owner: string;
  repo: string;
  repositoryUrl: string;
  chunksStored: number;
  githubChunks: number;
  codeChunks: number;
  hackerNewsChunks: number;
};

type PdfIngestResponse = {
  owner: string;
  repo: string;
  filePath: string;
  title: string;
  chunksStored: number;
  pages: number | null;
};

type SearchResponse = {
  answer: string;
  rewrittenQuery: string;
  citations: Array<{
    title: string;
    sourceType: "github_repo" | "github_readme" | "github_file" | "hacker_news" | "local_pdf";
    sourceUrl: string | null;
  }>;
  results: Array<{
    id: string;
    sourceType: "github_repo" | "github_readme" | "github_file" | "hacker_news" | "local_pdf";
    sourceUrl: string | null;
    title: string;
    chunkIndex: number;
    content: string;
    score: number;
    vectorScore?: number;
    keywordScore?: number;
  }>;
};

type DevScopeTrpcClient = {
  github: {
    ingest: {
      mutate(input: { githubUrl: string; maxHnDiscussions: number; force?: boolean }): Promise<IngestResponse>;
    };
  };
  document: {
    ingestPdf: {
      mutate(input: { filePath: string; owner: string; repo: string }): Promise<PdfIngestResponse>;
    };
  };
  semantic: {
    search: {
      mutate(input: { owner: string; repo: string; query: string; limit: number; minSimilarity: number }): Promise<SearchResponse>;
    };
  };
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function createClient() {
  return createTRPCClient<any>({
    links: [
      httpBatchLink({
        url: `${apiUrl}/trpc`
      })
    ]
  }) as unknown as DevScopeTrpcClient;
}

export default function Home() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <DevScopeWorkspace />
    </QueryClientProvider>
  );
}

function DevScopeWorkspace() {
  const client = useMemo(() => createClient(), []);
  const [githubUrl, setGithubUrl] = useState("https://github.com/ApolloYH/EchoCore");
  const [activeSource, setActiveSource] = useState<"github" | "pdf">("github");
  const [lastIngestedGithubUrl, setLastIngestedGithubUrl] = useState("");
  const [lastGithubIngest, setLastGithubIngest] = useState<IngestResponse | null>(null);
  const [owner, setOwner] = useState("ApolloYH");
  const [repo, setRepo] = useState("EchoCore");
  const [pdfPath, setPdfPath] = useState("/Users/apollo/YH/杨豪-202234070916-毕业论文.pdf");
  const [query, setQuery] = useState("这个项目的核心功能、架构设计和潜在风险是什么？");

  const ingestMutation = useMutation({
    mutationFn: () =>
      client.github.ingest.mutate({
        githubUrl,
        maxHnDiscussions: 5,
        force: false
      }),
    onSuccess: (data) => {
      setOwner(data.owner);
      setRepo(data.repo);
      setActiveSource("github");
      setLastIngestedGithubUrl(githubUrl);
      setLastGithubIngest(data);
      setQuery("这个项目的核心功能、架构设计和潜在风险是什么？");
    }
  });

  const pdfIngestMutation = useMutation({
    mutationFn: () =>
      client.document.ingestPdf.mutate({
        filePath: pdfPath,
        owner: "local",
        repo: "thesis"
      }),
    onSuccess: (data) => {
      setOwner(data.owner);
      setRepo(data.repo);
      setActiveSource("pdf");
      setQuery("这篇论文的研究主题、方法、系统设计和结论是什么？");
    }
  });

  const searchMutation = useMutation({
    mutationFn: async () => {
      const corpus = await ensureCorpusReady();

      return client.semantic.search.mutate({
        owner: corpus.owner,
        repo: corpus.repo,
        query,
        limit: 5,
        minSimilarity: 0
      });
    }
  });

  async function ensureCorpusReady() {
    if (activeSource !== "github" || githubUrl === lastIngestedGithubUrl) {
      return { owner, repo };
    }

    const data = await client.github.ingest.mutate({
      githubUrl,
      maxHnDiscussions: 5,
      force: false
    });

    setOwner(data.owner);
    setRepo(data.repo);
    setActiveSource("github");
    setLastIngestedGithubUrl(githubUrl);
    setLastGithubIngest(data);

    return { owner: data.owner, repo: data.repo };
  }

  const githubIngestResult = ingestMutation.data ?? lastGithubIngest;

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            <span className="text-base font-semibold">DevScope RAG</span>
          </div>
          <div className="text-xs text-muted-foreground">Day 2 GitHub + HN 检索增强问答</div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[360px_1fr]">
        <div className="rounded-lg border bg-white p-5">
          <div className="mb-5 flex items-center gap-2">
            <UploadCloud className="h-4 w-4" />
            <h1 className="text-lg font-semibold">采集仓库语料</h1>
          </div>

          <label className="block text-xs font-medium text-muted-foreground" htmlFor="githubUrl">
            GitHub 地址
          </label>
          <input
            className="mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            id="githubUrl"
            onChange={(event) => {
              setGithubUrl(event.target.value);
              setActiveSource("github");
            }}
            value={githubUrl}
          />

          <div className="mt-4 rounded-md border bg-secondary p-3 text-xs text-muted-foreground">
            当前搜索语料：{owner}/{repo}
            <br />
            GitHub 地址未变化时，问答只复用 pgvector 里的文本块，不重复拉取仓库。
          </div>

          <Button
            className="mt-5 w-full"
            disabled={ingestMutation.isPending || githubUrl.length === 0}
            onClick={() => ingestMutation.mutate()}
          >
            <UploadCloud className="h-4 w-4" />
            {ingestMutation.isPending ? "采集中" : "采集/切换 GitHub"}
          </Button>

          {githubIngestResult ? (
            <div className="mt-5 rounded-md border bg-secondary p-4 text-sm">
              <div className="font-medium">
                {githubIngestResult.owner}/{githubIngestResult.repo}
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                <Metric label="总块数" value={githubIngestResult.chunksStored} />
                <Metric label="概览" value={githubIngestResult.githubChunks} />
                <Metric label="代码" value={githubIngestResult.codeChunks} />
                <Metric label="HN" value={githubIngestResult.hackerNewsChunks} />
              </div>
            </div>
          ) : null}

          {ingestMutation.error ? <ErrorMessage message={ingestMutation.error.message} /> : null}

          <div className="mt-6 border-t pt-5">
            <div className="mb-4 flex items-center gap-2">
              <UploadCloud className="h-4 w-4" />
              <h2 className="text-sm font-semibold">采集本地 PDF 论文</h2>
            </div>

            <label className="block text-xs font-medium text-muted-foreground" htmlFor="pdfPath">
              PDF 路径
            </label>
            <input
              className="mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              id="pdfPath"
              onChange={(event) => setPdfPath(event.target.value)}
              value={pdfPath}
            />

            <Button
              className="mt-4 w-full"
              disabled={pdfIngestMutation.isPending || pdfPath.length === 0}
              onClick={() => pdfIngestMutation.mutate()}
            >
              <UploadCloud className="h-4 w-4" />
              {pdfIngestMutation.isPending ? "采集中" : "采集 PDF 论文"}
            </Button>

            {pdfIngestMutation.data ? (
              <div className="mt-4 rounded-md border bg-secondary p-4 text-sm">
                <div className="font-medium">{pdfIngestMutation.data.title}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                  <Metric label="文本块" value={pdfIngestMutation.data.chunksStored} />
                  <Metric label="页数" value={pdfIngestMutation.data.pages ?? 0} />
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  已切换搜索语料到 {pdfIngestMutation.data.owner}/{pdfIngestMutation.data.repo}
                </div>
              </div>
            ) : null}

            {pdfIngestMutation.error ? <ErrorMessage message={pdfIngestMutation.error.message} /> : null}
          </div>
        </div>

        <div className="rounded-lg border bg-white p-5">
          <div className="mb-5 flex items-center gap-2">
            <Search className="h-4 w-4" />
            <h2 className="text-lg font-semibold">RAG 提问</h2>
          </div>

          <textarea
            className="min-h-28 w-full resize-y rounded-md border bg-white p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring"
            onChange={(event) => setQuery(event.target.value)}
            value={query}
          />

          <Button
            className="mt-4"
            disabled={searchMutation.isPending || ingestMutation.isPending || query.length === 0}
            onClick={() => searchMutation.mutate()}
          >
            <Search className="h-4 w-4" />
            {searchMutation.isPending ? "检索中" : "检索并回答"}
          </Button>

          {searchMutation.error ? <ErrorMessage message={searchMutation.error.message} /> : null}

          {searchMutation.data ? (
            <div className="mt-6 grid gap-5">
              <section>
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Query Rewriting</div>
                <p className="rounded-md border bg-white p-3 text-sm leading-6 text-muted-foreground">
                  {searchMutation.data.rewrittenQuery}
                </p>
              </section>

              <section>
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">LLM 综合回答</div>
                <p className="rounded-md border bg-secondary p-4 text-sm leading-6">{searchMutation.data.answer}</p>
              </section>

              {searchMutation.data.citations.length > 0 ? (
                <section>
                  <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">引用来源</div>
                  <div className="grid gap-2">
                    {searchMutation.data.citations.map((citation) => (
                      <SourceLink citation={citation} key={`${citation.title}:${citation.sourceUrl ?? ""}`} />
                    ))}
                  </div>
                </section>
              ) : null}

              <section>
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">检索到的文本块</div>
                <div className="grid gap-3">
                  {searchMutation.data.results.map((result) => (
                    <article className="rounded-md border p-4" key={result.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium">{result.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatSourceType(result.sourceType)} · 综合 {result.score.toFixed(3)}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>Chunk #{result.chunkIndex}</span>
                        <span>向量 {formatScore(result.vectorScore)}</span>
                        <span>关键词 {formatScore(result.keywordScore)}</span>
                      </div>
                      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-secondary p-3 text-sm leading-6 text-muted-foreground">
                        {result.content}
                      </pre>
                      {result.sourceUrl ? (
                        <a
                          className="mt-3 inline-block text-xs font-medium text-accent-foreground"
                          href={result.sourceUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          打开来源
                        </a>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-white px-2 py-3">
      <div className="text-lg font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return <div className="mt-4 rounded-md border border-destructive p-3 text-sm text-destructive">{message}</div>;
}

function SourceLink({ citation }: { citation: SearchResponse["citations"][number] }) {
  const content = (
    <>
      <Link2 className="h-4 w-4 shrink-0" />
      <span className="truncate">{citation.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatSourceType(citation.sourceType)}</span>
    </>
  );

  if (!citation.sourceUrl) {
    return <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">{content}</div>;
  }

  return (
    <a
      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-secondary"
      href={citation.sourceUrl}
      rel="noreferrer"
      target="_blank"
    >
      {content}
    </a>
  );
}

function formatSourceType(sourceType: SearchResponse["results"][number]["sourceType"]) {
  const labels = {
    github_repo: "GitHub 元数据",
    github_readme: "README",
    github_file: "GitHub 文件",
    hacker_news: "Hacker News",
    local_pdf: "PDF 论文"
  };

  return labels[sourceType];
}

function formatScore(score: number | undefined) {
  return typeof score === "number" ? score.toFixed(3) : "-";
}
