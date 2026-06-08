import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyServerOptions } from "fastify";

import { appRouter } from "./router";

export async function createApp(options: FastifyServerOptions = {}) {
  const server = Fastify({
    logger: true,
    ...options
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

  return server;
}
