import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { ApolloServer, type ApolloServerPlugin } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { config } from './config.js';
import { createContext, type Context } from './context.js';
import { pool, waitForDatabase } from './db.js';
import { resolvers } from './graphql/resolvers.js';
import { typeDefs } from './graphql/typeDefs.js';
import { log } from './log.js';
import { runMigrations } from './migrate.js';
import { rebuildCatalogIfEmpty } from './projections/catalog.js';
import { startProjector } from './projections/projector.js';
import { startFulfillmentWorker } from './workers/fulfillment.js';

async function main() {
  // 1) Base de datos (Supabase): conexión, migraciones (incluye el seed de 50 medicamentos) y read model.
  await waitForDatabase();
  await runMigrations();
  await rebuildCatalogIfEmpty();

  // 2) API GraphQL
  const app = express();
  app.disable('x-powered-by');
  const httpServer = http.createServer(app);
  const schema = makeExecutableSchema({ typeDefs, resolvers: resolvers as any });

  const allowedOrigins = [
    ...config.FRONTEND_ORIGIN.split(',').map((o) => o.trim()),
    ...(config.ENABLE_INTROSPECTION ? ['https://sandbox.embed.apollographql.com', 'https://studio.apollographql.com'] : []),
  ];

  // Subscriptions sobre WebSocket (protocolo graphql-ws) en el MISMO endpoint /graphql
  const wsServer = new WebSocketServer({ server: httpServer, path: '/graphql' });
  const wsCleanup = useServer(
    {
      schema,
      onConnect: (ctx) => {
        const origin = (ctx.extra as { request: http.IncomingMessage }).request.headers.origin;
        if (origin && !allowedOrigins.includes(origin)) {
          log.warn('ws', `Conexión rechazada, origen no permitido: ${origin}`);
          return false;
        }
        return true;
      },
      // Se evalúa por operación: cada suscripción obtiene su propio contexto (usuario + loaders).
      context: (ctx) => {
        const params = ctx.connectionParams as Record<string, unknown> | undefined;
        return createContext(typeof params?.authorization === 'string' ? params.authorization : null);
      },
    },
    wsServer,
  );

  const requestLogger: ApolloServerPlugin<Context> = {
    async requestDidStart() {
      const started = performance.now();
      return {
        async willSendResponse(rc) {
          const name = rc.operationName ?? 'anonymous';
          if (name === 'IntrospectionQuery') return;
          const errors = rc.errors?.length ? ` errors=${rc.errors.length}` : '';
          log.info('graphql', `${rc.operation?.operation ?? 'operation'} ${name} ${(performance.now() - started).toFixed(1)}ms${errors}`);
        },
      };
    },
  };

  const server = new ApolloServer<Context>({
    schema,
    introspection: config.ENABLE_INTROSPECTION,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      { async serverWillStart() { return { async drainServer() { await wsCleanup.dispose(); } }; } },
      ApolloServerPluginLandingPageLocalDefault({ embed: true, includeCookies: false }),
      requestLogger,
    ],
    formatError: (formatted, error) => {
      if (formatted.extensions?.code === 'INTERNAL_SERVER_ERROR') {
        log.error('graphql', `Error interno: ${(error as Error)?.message ?? formatted.message}`);
        return { message: 'Error interno del servidor', extensions: { code: 'INTERNAL_SERVER_ERROR' } };
      }
      return formatted;
    },
  });
  await server.start();

  app.use(
    '/graphql',
    cors({ origin: allowedOrigins }),
    express.json({ limit: '100kb' }),
    expressMiddleware(server, { context: async ({ req }) => createContext(req.headers.authorization) }),
  );

  await new Promise<void>((resolve) => httpServer.listen({ port: config.PORT, host: '0.0.0.0' }, resolve));
  log.info('server', `GraphQL listo en http://localhost:${config.PORT}/graphql  (Queries, Mutations y Subscriptions ws://)`);

  // 3) Procesos asíncronos del lado de escritura/lectura
  const projector = startProjector();
  const fulfillment = startFulfillmentWorker();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('server', `${signal} recibido: cerrando…`);
    projector.stop();
    fulfillment.stop();
    await server.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('server', `Fallo al iniciar: ${(err as Error).message}`);
  process.exit(1);
});
