import { existsSync } from "node:fs";
import { resolve } from "node:path";

import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { config } from "dotenv";
import Fastify from "fastify";

import { appRouter } from "./router";
import { configureNetworkProxy } from "./proxy";

const envPath = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")].find((path) => existsSync(path));
config(envPath ? { path: envPath } : undefined);
configureNetworkProxy();

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const server = Fastify({
  logger: true
});

await server.register(cors, {
  origin: true
});

server.get("/health", async () => ({ ok: true }));

await server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter
  }
});

await server.listen({ host, port });
