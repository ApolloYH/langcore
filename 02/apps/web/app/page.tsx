"use client";

import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { Database, Search, UploadCloud } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

type IngestResponse = {
  owner: string;
  repo: string;
  chunksStored: number;
  githubChunks: number;
  hackerNewsChunks: number;
};

type SearchResponse = {
  answer: string;
  results: Array<{
    id: string;
    sourceType: "github_repo" | "github_readme" | "hacker_news";
    sourceUrl: string | null;
    title: string;
    content: string;
    score: number;
  }>;
};

type DevScopeTrpcClient = {
  github: {
    ingest: {
      mutate(input: { owner: string; repo: string; maxHnDiscussions: number }): Promise<IngestResponse>;
    };
  };
  semantic: {
    search: {
      mutate(input: { owner: string; repo: string; query: string; limit: number }): Promise<SearchResponse>;
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
  const [owner, setOwner] = useState("vercel");
  const [repo, setRepo] = useState("next.js");
  const [query, setQuery] = useState("What makes this repository valuable and what risks show up?");

  const ingestMutation = useMutation({
    mutationFn: () =>
      client.github.ingest.mutate({
        owner,
        repo,
        maxHnDiscussions: 5
      })
  });

  const searchMutation = useMutation({
    mutationFn: () =>
      client.semantic.search.mutate({
        owner,
        repo,
        query,
        limit: 5
      })
  });

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            <span className="text-base font-semibold">DevScope</span>
          </div>
          <div className="text-xs text-muted-foreground">Day 2 RAG pipeline</div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[360px_1fr]">
        <div className="rounded-lg border bg-white p-5">
          <div className="mb-5 flex items-center gap-2">
            <UploadCloud className="h-4 w-4" />
            <h1 className="text-lg font-semibold">Repository ingest</h1>
          </div>

          <label className="block text-xs font-medium text-muted-foreground" htmlFor="owner">
            Owner
          </label>
          <input
            className="mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            id="owner"
            onChange={(event) => setOwner(event.target.value)}
            value={owner}
          />

          <label className="mt-4 block text-xs font-medium text-muted-foreground" htmlFor="repo">
            Repo
          </label>
          <input
            className="mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            id="repo"
            onChange={(event) => setRepo(event.target.value)}
            value={repo}
          />

          <Button
            className="mt-5 w-full"
            disabled={ingestMutation.isPending || owner.length === 0 || repo.length === 0}
            onClick={() => ingestMutation.mutate()}
          >
            <UploadCloud className="h-4 w-4" />
            {ingestMutation.isPending ? "Ingesting" : "Ingest data"}
          </Button>

          {ingestMutation.data ? (
            <div className="mt-5 rounded-md border bg-secondary p-4 text-sm">
              <div className="font-medium">
                {ingestMutation.data.owner}/{ingestMutation.data.repo}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <Metric label="Total" value={ingestMutation.data.chunksStored} />
                <Metric label="GitHub" value={ingestMutation.data.githubChunks} />
                <Metric label="HN" value={ingestMutation.data.hackerNewsChunks} />
              </div>
            </div>
          ) : null}

          {ingestMutation.error ? <ErrorMessage message={ingestMutation.error.message} /> : null}
        </div>

        <div className="rounded-lg border bg-white p-5">
          <div className="mb-5 flex items-center gap-2">
            <Search className="h-4 w-4" />
            <h2 className="text-lg font-semibold">Semantic search</h2>
          </div>

          <textarea
            className="min-h-28 w-full resize-y rounded-md border bg-white p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring"
            onChange={(event) => setQuery(event.target.value)}
            value={query}
          />

          <Button
            className="mt-4"
            disabled={searchMutation.isPending || query.length === 0}
            onClick={() => searchMutation.mutate()}
          >
            <Search className="h-4 w-4" />
            {searchMutation.isPending ? "Searching" : "Search and answer"}
          </Button>

          {searchMutation.error ? <ErrorMessage message={searchMutation.error.message} /> : null}

          {searchMutation.data ? (
            <div className="mt-6 grid gap-5">
              <section>
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Answer</div>
                <p className="rounded-md border bg-secondary p-4 text-sm leading-6">{searchMutation.data.answer}</p>
              </section>

              <section>
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Retrieved context</div>
                <div className="grid gap-3">
                  {searchMutation.data.results.map((result) => (
                    <article className="rounded-md border p-4" key={result.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium">{result.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {result.sourceType} · {result.score.toFixed(3)}
                        </div>
                      </div>
                      <p className="mt-3 line-clamp-4 text-sm leading-6 text-muted-foreground">{result.content}</p>
                      {result.sourceUrl ? (
                        <a
                          className="mt-3 inline-block text-xs font-medium text-accent-foreground"
                          href={result.sourceUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open source
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
