import cors from 'cors';
import { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { appConfig } from '../config.ts';
import { DatabaseUnavailableError } from '../db/pool.ts';
import { generateSecureToken, timingSafeEqualsString } from '../utils/crypto.ts';
import { AppError } from '../utils/errors.ts';

export const SESSION_COOKIE_NAME = 'levelup_session';
export const CSRF_COOKIE_NAME = 'levelup_csrf';

export function buildCspImgSrcDirectives(env: NodeJS.ProcessEnv = process.env): string[] {
  const origins = new Set<string>(["'self'", 'data:', 'blob:', 'https://storage.googleapis.com']);

  const candidateUrls = [env.GCS_PUBLIC_BASE_URL, env.UPLOAD_CDN_ORIGIN];
  for (const raw of candidateUrls) {
    if (!raw || !raw.trim()) continue;
    try {
      const parsed = new URL(raw.trim());
      if (parsed.protocol === 'https:') {
        origins.add(parsed.origin);
      }
    } catch {
      // Ignore malformed origin overrides
    }
  }

  return Array.from(origins);
}

export function createHelmetMiddleware() {
  const imgSrc = buildCspImgSrcDirectives();
  return helmet({
    contentSecurityPolicy: appConfig.isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc,
            connectSrc: ["'self'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
  });
}

export function createCorsMiddleware() {
  const allowedOrigins = appConfig.corsOrigin
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new AppError('Origin not allowed by CORS', 403, 'CORS_FORBIDDEN'));
    },
    credentials: true,
  });
}

export const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again.' },
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: {
      code: 'AUTH_RATE_LIMITED',
      message: 'Too many authentication attempts. Please wait 15 minutes and try again.',
    },
  },
});

export const uploadRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: { code: 'UPLOAD_RATE_LIMITED', message: 'Upload rate limit reached. Try again later.' },
  },
});

export function ensureCsrfCookie(req: Request, res: Response, next: NextFunction): void {
  if (!req.cookies?.[CSRF_COOKIE_NAME]) {
    const token = generateSecureToken(24);
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: appConfig.cookieSecure,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
  next();
}

export function verifyCsrfToken(req: Request, _res: Response, next: NextFunction): void {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method.toUpperCase())) {
    next();
    return;
  }

  // Only enforce CSRF when a session cookie is present (state-changing browser requests)
  const hasSessionCookie = Boolean(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!hasSessionCookie) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.get('x-csrf-token');

  if (!cookieToken || !headerToken || !timingSafeEqualsString(cookieToken, headerToken)) {
    next(new AppError('Invalid or missing CSRF token', 403, 'CSRF_INVALID'));
    return;
  }
  next();
}

export function centralizedErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof DatabaseUnavailableError) {
    res.status(503).json({
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        missingFields: err.missingFields,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please check the highlighted form fields.',
        details: err.flatten().fieldErrors,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  // Handle Multer errors cleanly
  if (err && typeof err === 'object' && 'code' in err && (err as any).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      ok: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message: `Uploaded file exceeds maximum allowed size of ${Math.round(appConfig.maxUploadBytes / (1024 * 1024))} MB.`,
      },
    });
    return;
  }

  console.error('[Unhandled Server Error]', err);
  res.status(500).json({
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: appConfig.isProduction
        ? 'An unexpected server error occurred.'
        : err instanceof Error
          ? err.message
          : 'Unexpected error',
    },
  });
}
