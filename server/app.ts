import cookieParser from 'cookie-parser';
import express, { Express } from 'express';
import fs from 'fs';
import { appConfig } from './config.ts';
import {
  centralizedErrorHandler,
  createCorsMiddleware,
  createHelmetMiddleware,
  ensureCsrfCookie,
  generalApiLimiter,
  verifyCsrfToken,
} from './middleware/security.ts';
import { createV1Router } from './routes/v1.ts';

export function createApiApp(): Express {
  const app = express();

  if (appConfig.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use(createHelmetMiddleware());
  app.use(createCorsMiddleware());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(ensureCsrfCookie);

  // In local development, serve validated user-uploaded images from UPLOAD_DIR with nosniff headers.
  // When UPLOAD_STORAGE_DRIVER="gcs" (Cloud Run production), do NOT create or rely on ephemeral local storage;
  // media is persisted to Google Cloud Storage and served via permission-checked /api/v1/media/:folder/:filename.
  if (appConfig.uploadStorageDriver === 'local') {
    fs.mkdirSync(appConfig.uploadDir, { recursive: true });
    app.use(
      '/uploads',
      (_req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        next();
      },
      express.static(appConfig.uploadDir),
    );
  }

  // Apply rate limiting & CSRF verification to /api/v1/*
  app.use('/api/v1', generalApiLimiter, verifyCsrfToken, createV1Router());

  // Fallback for unknown API endpoints
  app.use('/api', (_req, res) => {
    res.status(404).json({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'API endpoint not found' },
    });
  });

  app.use(centralizedErrorHandler);

  return app;
}
