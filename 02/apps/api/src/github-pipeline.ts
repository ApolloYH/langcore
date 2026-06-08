import { generateEmbedding, splitTextIntoTokenChunks } from "@devscope/ai";
import {
  createPgPool,
  type PgPool,
  replaceRepositoryDocuments,
  type RepositoryDocumentInput
} from "@devscope/db";
import {
  GithubIngestInputSchema,
  type GithubIngestInput,
  type GithubIngestResponse,
  type SourceType
} from "@devscope/shared";
import { Octokit } from "@octokit/rest";

interface GithubPipelineOptions {
  fetchImpl?: typeof fetch;
  githubToken?: string;
  logger?: Pick<Console, "info" | "warn">;
  octokit?: Octokit;
  pool?: PgPool;
  rateLimitDelayMs?: number;
}

interface HnHit {
  objectID: string;
  title?: string;
  url?: string;
  story_text?: string;
  comment_text?: string;
}

export async function ingestGithubRepository(
  input: GithubIngestInput,
  options: GithubPipelineOptions = {}
): Promise<GithubIngestResponse> {
  const parsedInput = GithubIngestInputSchema.parse(input);
  const logger = options.logger ?? console;
  const octokit = options.octokit ?? new Octokit({ auth: options.githubToken ?? process.env.GITHUB_TOKEN });
  const pool = options.pool ?? createPgPool();
  const fetchImpl = options.fetchImpl ?? fetch;
  const delayMs = options.rateLimitDelayMs ?? 500;
  const documents: RepositoryDocumentInput[] = [];

  logger.info(`[github-pipeline] fetching ${parsedInput.owner}/${parsedInput.repo} repository metadata`);
  const repoResponse = await octokit.repos.get({
    owner: parsedInput.owner,
    repo: parsedInput.repo
  });
  logGithubRateLimit(logger, repoResponse.headers);
  await delay(delayMs);

  const repo = repoResponse.data;
  await appendChunkedDocuments(documents, {
    owner: parsedInput.owner,
    repo: parsedInput.repo,
    sourceType: "github_repo",
    sourceUrl: repo.html_url,
    title: `${parsedInput.owner}/${parsedInput.repo} repository metadata`,
    text: [
      `Name: ${repo.full_name}`,
      `Description: ${repo.description ?? ""}`,
      `Stars: ${repo.stargazers_count}`,
      `Forks: ${repo.forks_count}`,
      `Open issues: ${repo.open_issues_count}`,
      `Language: ${repo.language ?? "unknown"}`,
      `Topics: ${(repo.topics ?? []).join(", ")}`
    ].join("\n"),
    metadata: {
      defaultBranch: repo.default_branch,
      pushedAt: repo.pushed_at,
      watchers: repo.watchers_count
    }
  });

  logger.info(`[github-pipeline] fetching README for ${parsedInput.owner}/${parsedInput.repo}`);
  const readme = await fetchReadme(octokit, parsedInput.owner, parsedInput.repo);
  await delay(delayMs);

  if (readme) {
    await appendChunkedDocuments(documents, {
      owner: parsedInput.owner,
      repo: parsedInput.repo,
      sourceType: "github_readme",
      sourceUrl: readme.url,
      title: `${parsedInput.owner}/${parsedInput.repo} README`,
      text: readme.content,
      metadata: { path: readme.path }
    });
  }

  logger.info(`[github-pipeline] fetching Hacker News discussions for ${parsedInput.owner}/${parsedInput.repo}`);
  const hnDiscussions = await fetchHackerNewsDiscussions(
    fetchImpl,
    `${parsedInput.owner}/${parsedInput.repo}`,
    parsedInput.maxHnDiscussions
  );

  for (const discussion of hnDiscussions) {
    await appendChunkedDocuments(documents, {
      owner: parsedInput.owner,
      repo: parsedInput.repo,
      sourceType: "hacker_news",
      sourceUrl: `https://news.ycombinator.com/item?id=${discussion.objectID}`,
      title: discussion.title ?? `Hacker News discussion ${discussion.objectID}`,
      text: [discussion.title, discussion.url, discussion.story_text, discussion.comment_text].filter(Boolean).join("\n"),
      metadata: {
        objectID: discussion.objectID,
        externalUrl: discussion.url
      }
    });
  }

  const githubChunks = documents.filter((document) => document.sourceType !== "hacker_news").length;
  const hackerNewsChunks = documents.filter((document) => document.sourceType === "hacker_news").length;

  logger.info(`[github-pipeline] storing ${documents.length} chunks in pgvector`);
  const chunksStored = await replaceRepositoryDocuments(pool, parsedInput.owner, parsedInput.repo, documents);

  return {
    owner: parsedInput.owner,
    repo: parsedInput.repo,
    chunksStored,
    githubChunks,
    hackerNewsChunks
  };
}

async function fetchReadme(octokit: Octokit, owner: string, repo: string) {
  try {
    const response = await octokit.repos.getReadme({ owner, repo });
    const data = response.data;

    if (!("content" in data) || typeof data.content !== "string") {
      return null;
    }

    return {
      content: Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8"),
      path: data.path,
      url: data.html_url ?? null
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

async function fetchHackerNewsDiscussions(fetchImpl: typeof fetch, query: string, limit: number): Promise<HnHit[]> {
  if (limit === 0) {
    return [];
  }

  const url = new URL("https://hn.algolia.com/api/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("tags", "story");
  url.searchParams.set("hitsPerPage", String(limit));

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Hacker News search failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { hits?: HnHit[] };
  return payload.hits ?? [];
}

async function appendChunkedDocuments(
  documents: RepositoryDocumentInput[],
  source: {
    owner: string;
    repo: string;
    sourceType: SourceType;
    sourceUrl: string | null;
    title: string;
    text: string;
    metadata: Record<string, unknown>;
  }
) {
  const chunks = splitTextIntoTokenChunks(source.text);

  for (const chunk of chunks) {
    documents.push({
      owner: source.owner,
      repo: source.repo,
      sourceType: source.sourceType,
      sourceUrl: source.sourceUrl,
      title: source.title,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      embedding: await generateEmbedding(chunk.content),
      metadata: source.metadata
    });
  }
}

function logGithubRateLimit(logger: Pick<Console, "info">, headers: Record<string, string | number | undefined>) {
  const limit = headers["x-ratelimit-limit"];
  const remaining = headers["x-ratelimit-remaining"];

  if (limit && remaining) {
    logger.info(`[github-pipeline] GitHub rate limit remaining ${remaining}/${limit}`);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isNotFoundError(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}
