import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApiApp } from './server/app.ts';
import { appConfig, assertValidProductionConfig } from './server/config.ts';
import { closePool, isDatabaseConfigured } from './server/db/pool.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // Fail fast in production if SESSION_SECRET, CSRF_SECRET, GCS upload config, or TLS flags are invalid.
  assertValidProductionConfig(process.env);

  const app = createApiApp();

  if (appConfig.nodeEnv !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir, { maxAge: '1d' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);

  server.listen(appConfig.port, '0.0.0.0', () => {
    console.log(
      `[LEVELUP RWANDA] Server listening on http://0.0.0.0:${appConfig.port} (${appConfig.nodeEnv}) | MySQL configured: ${isDatabaseConfigured()}`,
    );
  });

  const gracefulShutdown = async (signal: string) => {
    console.log(`[LEVELUP RWANDA] Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      await closePool();
      console.log('[LEVELUP RWANDA] HTTP server and MySQL pool closed.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[LEVELUP RWANDA] Forced shutdown after timeout.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('[LEVELUP RWANDA] Failed to start server:', err);
  process.exit(1);
});
