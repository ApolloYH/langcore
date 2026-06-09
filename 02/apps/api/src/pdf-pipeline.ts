import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import { generateEmbedding, LOCAL_EMBEDDING_MODEL, splitTextIntoTokenChunks } from "@devscope/ai";
import {
  createPgPool,
  type PgPool,
  replaceRepositoryDocuments,
  type RepositoryDocumentInput
} from "@devscope/db";
import { PdfIngestInputSchema, type PdfIngestInput, type PdfIngestResponse } from "@devscope/shared";
import { PDFParse } from "pdf-parse";

interface PdfPipelineOptions {
  pool?: PgPool;
}

export async function ingestPdfDocument(
  input: PdfIngestInput,
  options: PdfPipelineOptions = {}
): Promise<PdfIngestResponse> {
  const parsedInput = PdfIngestInputSchema.parse(input);
  const pool = options.pool ?? createPgPool();
  const fileBuffer = await readFile(parsedInput.filePath);
  const fileInfo = await stat(parsedInput.filePath);
  const parser = new PDFParse({ data: fileBuffer });

  try {
    const info = await parser.getInfo({ parsePageInfo: false }).catch(() => null);
    const textResult = await parser.getText();
    const text = normalizePdfText(textResult.text);

    if (!text) {
      throw new Error(`No extractable text found in PDF: ${parsedInput.filePath}`);
    }

    const title = info?.info?.Title || basename(parsedInput.filePath);
    const chunks = splitTextIntoTokenChunks(text);
    const documents: RepositoryDocumentInput[] = [];

    for (const chunk of chunks) {
      documents.push({
        owner: parsedInput.owner,
        repo: parsedInput.repo,
        sourceType: "local_pdf",
        sourceUrl: parsedInput.filePath,
        title,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        embedding: await generateEmbedding(chunk.content),
        metadata: {
          filePath: parsedInput.filePath,
          fileSize: fileInfo.size,
          embeddingModel: LOCAL_EMBEDDING_MODEL,
          pages: info?.total ?? null
        }
      });
    }

    const chunksStored = await replaceRepositoryDocuments(pool, parsedInput.owner, parsedInput.repo, documents);

    return {
      owner: parsedInput.owner,
      repo: parsedInput.repo,
      filePath: parsedInput.filePath,
      title,
      chunksStored,
      pages: info?.total ?? null
    };
  } finally {
    await parser.destroy();
  }
}

function normalizePdfText(text: string) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
