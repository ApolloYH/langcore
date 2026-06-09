import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, relative } from "node:path";
import { promisify } from "node:util";

import { generateEmbedding, splitTextIntoTokenChunks } from "@devscope/ai";
import {
  createPgPool,
  getRepositoryDocumentStats,
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

const execFileAsync = promisify(execFile);
const MAX_REPOSITORY_FILES = 40;
const MAX_REPOSITORY_FILE_BYTES = 180_000;
const INCLUDED_FILE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".py",
  ".css",
  ".html",
  ".sql",
  ".yml",
  ".yaml",
  ".toml",
  ".env",
  ".example"
]);
const INCLUDED_FILE_NAMES = new Set(["README", "LICENSE", "Dockerfile", "Makefile"]);
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  "__pycache__",
  "coverage",
  "deps",
  "dist",
  "external",
  "node_modules",
  "third_party",
  "vendor"
]);

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
  const repository = resolveGithubRepository(parsedInput);
  const documents: RepositoryDocumentInput[] = [];

  if (!parsedInput.force) {
    const existingStats = await getRepositoryDocumentStats(pool, repository.owner, repository.repo);
    if (existingStats.chunksStored > 0) {
      logger.info(
        `[github-pipeline] cache hit for ${repository.owner}/${repository.repo}, reusing ${existingStats.chunksStored} stored chunks`
      );

      return {
        owner: repository.owner,
        repo: repository.repo,
        repositoryUrl: repository.repositoryUrl,
        ...existingStats
      };
    }
  }

  logger.info(`[github-pipeline] fetching ${repository.owner}/${repository.repo} repository metadata`);
  const repoResponse = await octokit.repos.get({
    owner: repository.owner,
    repo: repository.repo
  });
  logGithubRateLimit(logger, repoResponse.headers);
  await delay(delayMs);

  const repo = repoResponse.data;
  await appendChunkedDocuments(documents, {
    owner: repository.owner,
    repo: repository.repo,
    sourceType: "github_repo",
    sourceUrl: repo.html_url,
    title: `${repository.owner}/${repository.repo} repository metadata`,
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

  logger.info(`[github-pipeline] fetching README for ${repository.owner}/${repository.repo}`);
  const readme = await fetchReadme(octokit, repository.owner, repository.repo);
  await delay(delayMs);

  if (readme) {
    await appendChunkedDocuments(documents, {
      owner: repository.owner,
      repo: repository.repo,
      sourceType: "github_readme",
      sourceUrl: readme.url,
      title: `${repository.owner}/${repository.repo} README`,
      text: readme.content,
      metadata: { path: readme.path }
    });
  }

  logger.info(`[github-pipeline] cloning ${repo.clone_url} for repository file ingestion`);
  const repositoryFiles = await collectRepositoryFiles({
    cloneUrl: repo.clone_url,
    defaultBranch: repo.default_branch,
    fetchImpl,
    htmlUrl: repo.html_url,
    logger,
    octokit,
    owner: repository.owner,
    repo: repository.repo
  });

  for (const file of repositoryFiles) {
    await appendChunkedDocuments(documents, {
      owner: repository.owner,
      repo: repository.repo,
      sourceType: "github_file",
      sourceUrl: file.sourceUrl,
      title: file.path,
      text: [`Path: ${file.path}`, file.content].join("\n\n"),
      metadata: {
        path: file.path,
        bytes: file.bytes
      }
    });
  }

  logger.info(`[github-pipeline] fetching Hacker News discussions for ${repository.owner}/${repository.repo}`);
  const hnDiscussions = await fetchHackerNewsDiscussions(
    fetchImpl,
    `${repository.owner}/${repository.repo}`,
    parsedInput.maxHnDiscussions
  );

  for (const discussion of hnDiscussions) {
    await appendChunkedDocuments(documents, {
      owner: repository.owner,
      repo: repository.repo,
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

  const codeChunks = documents.filter((document) => document.sourceType === "github_file").length;
  const githubChunks = documents.filter((document) => document.sourceType === "github_repo" || document.sourceType === "github_readme").length;
  const hackerNewsChunks = documents.filter((document) => document.sourceType === "hacker_news").length;

  logger.info(`[github-pipeline] storing ${documents.length} chunks in pgvector`);
  const chunksStored = await replaceRepositoryDocuments(pool, repository.owner, repository.repo, documents);

  return {
    owner: repository.owner,
    repo: repository.repo,
    repositoryUrl: repo.html_url,
    chunksStored,
    githubChunks,
    codeChunks,
    hackerNewsChunks
  };
}

function resolveGithubRepository(input: GithubIngestInput) {
  if (input.githubUrl) {
    const url = new URL(input.githubUrl);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const owner = pathParts[0];
    const repo = pathParts[1]?.replace(/\.git$/, "");

    if (url.hostname !== "github.com" || !owner || !repo) {
      throw new Error(`Invalid GitHub repository URL: ${input.githubUrl}`);
    }

    return {
      owner,
      repo,
      repositoryUrl: `https://github.com/${owner}/${repo}`
    };
  }

  return {
    owner: input.owner as string,
    repo: input.repo as string,
    repositoryUrl: `https://github.com/${input.owner}/${input.repo}`
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

async function collectRepositoryFiles(options: {
  cloneUrl: string;
  defaultBranch: string;
  fetchImpl: typeof fetch;
  htmlUrl: string;
  logger: Pick<Console, "info" | "warn">;
  octokit: Octokit;
  owner: string;
  repo: string;
}) {
  const cloneDir = await mkdtemp(join(tmpdir(), "devscope-github-"));

  try {
    await execFileAsync("git", ["-c", "http.version=HTTP/1.1", "clone", "--depth", "1", options.cloneUrl, cloneDir], {
      env: {
        ...process.env,
        HTTP_PROXY: process.env.GIT_HTTP_PROXY ?? process.env.HTTP_PROXY,
        HTTPS_PROXY: process.env.GIT_HTTPS_PROXY ?? process.env.HTTPS_PROXY,
        GIT_HTTP_VERSION: "HTTP/1.1"
      },
      timeout: 120_000
    });
    const files = await listIngestibleFiles(cloneDir);
    options.logger.info(`[github-pipeline] cloned repository and selected ${files.length} files for embedding`);

    const collected: Array<{ path: string; sourceUrl: string; content: string; bytes: number }> = [];
    for (const filePath of files) {
      const fileStat = await stat(filePath);
      const relativePath = relative(cloneDir, filePath);
      const content = await readFile(filePath, "utf8");

      collected.push({
        path: relativePath,
        sourceUrl: `${options.htmlUrl}/blob/${options.defaultBranch}/${relativePath}`,
        content,
        bytes: fileStat.size
      });
    }

    return collected;
  } catch (error) {
    options.logger.warn(
      `[github-pipeline] git clone failed, falling back to GitHub tree/raw API: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return collectRepositoryFilesFromGithubApi(options);
  } finally {
    await rm(cloneDir, { force: true, recursive: true });
  }
}

async function collectRepositoryFilesFromGithubApi(options: {
  defaultBranch: string;
  fetchImpl: typeof fetch;
  htmlUrl: string;
  logger: Pick<Console, "info" | "warn">;
  octokit: Octokit;
  owner: string;
  repo: string;
}) {
  const treeResponse = await options.octokit.git.getTree({
    owner: options.owner,
    repo: options.repo,
    tree_sha: options.defaultBranch,
    recursive: "true"
  });
  logGithubRateLimit(options.logger, treeResponse.headers);

  const selectedFiles = treeResponse.data.tree
    .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
    .filter((entry) => isIngestibleFile(entry.path as string))
    .filter((entry) => typeof entry.size === "number" && entry.size > 0 && entry.size <= MAX_REPOSITORY_FILE_BYTES)
    .sort((left, right) => (left.path ?? "").localeCompare(right.path ?? ""))
    .slice(0, MAX_REPOSITORY_FILES);

  options.logger.info(`[github-pipeline] selected ${selectedFiles.length} files from GitHub tree API for embedding`);

  const collected: Array<{ path: string; sourceUrl: string; content: string; bytes: number }> = [];
  for (const file of selectedFiles) {
    const path = file.path as string;
    const rawUrl = `https://raw.githubusercontent.com/${options.owner}/${options.repo}/${options.defaultBranch}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const response = await options.fetchImpl(rawUrl);

    if (!response.ok) {
      options.logger.warn(`[github-pipeline] failed to fetch raw file ${path}: ${response.status}`);
      continue;
    }

    collected.push({
      path,
      sourceUrl: `${options.htmlUrl}/blob/${options.defaultBranch}/${path}`,
      content: await response.text(),
      bytes: file.size ?? 0
    });
  }

  return collected;
}

async function listIngestibleFiles(rootDir: string) {
  const files: string[] = [];

  async function walk(currentDir: string) {
    if (files.length >= MAX_REPOSITORY_FILES) {
      return;
    }

    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (files.length >= MAX_REPOSITORY_FILES) {
        return;
      }

      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
          await walk(fullPath);
        }
        continue;
      }

      if (!entry.isFile() || !isIngestibleFile(entry.name)) {
        continue;
      }

      const fileStat = await stat(fullPath);
      if (fileStat.size > 0 && fileStat.size <= MAX_REPOSITORY_FILE_BYTES) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return files;
}

function isIngestibleFile(fileName: string) {
  const pathSegments = fileName.split(/[\\/]/g);
  if (pathSegments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) {
    return false;
  }

  if (INCLUDED_FILE_NAMES.has(fileName) || INCLUDED_FILE_NAMES.has(basename(fileName, extname(fileName)))) {
    return true;
  }

  return INCLUDED_FILE_EXTENSIONS.has(extname(fileName));
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

function logGithubRateLimit(logger: Pick<Console, "info" | "warn">, headers: Record<string, string | number | undefined>) {
  const limit = headers["x-ratelimit-limit"];
  const remaining = headers["x-ratelimit-remaining"];

  if (limit && remaining) {
    logger.info(`[github-pipeline] GitHub rate limit remaining ${remaining}/${limit}`);
    if (Number(remaining) < 10) {
      logger.warn(`[github-pipeline] GitHub rate limit is low: ${remaining}/${limit}`);
    }
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
