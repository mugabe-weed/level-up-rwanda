// server.ts
import express2 from "express";
import http from "http";
import path3 from "path";
import { fileURLToPath } from "url";

// server/app.ts
import cookieParser from "cookie-parser";
import express from "express";
import fs3 from "fs";

// server/config.ts
import crypto from "crypto";
import dotenv from "dotenv";
import path from "path";
dotenv.config();
var MIN_PRODUCTION_SECRET_LENGTH = 32;
var MIN_SECRET_UNIQUE_CHARS = 10;
var KNOWN_WEAK_SECRET_VALUES = /* @__PURE__ */ new Set([
  "changeme",
  "change-me",
  "change_me",
  "secret",
  "password",
  "default",
  "development",
  "production",
  "session_secret",
  "csrf_secret",
  "my_session_secret",
  "my_csrf_secret",
  "replace_me",
  "replace-with-secret",
  "test-secret",
  "supersecret"
]);
var devFallbackSessionSecret = crypto.randomBytes(32).toString("hex");
var devFallbackCsrfSecret = crypto.randomBytes(32).toString("hex");
function validateSecretStrength(name, rawValue) {
  const errors = [];
  const value = rawValue?.trim() || "";
  if (!value) {
    errors.push(`${name} is required in production.`);
    return errors;
  }
  if (value.length < MIN_PRODUCTION_SECRET_LENGTH) {
    errors.push(
      `${name} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters long in production.`
    );
  }
  const lower = value.toLowerCase();
  if (KNOWN_WEAK_SECRET_VALUES.has(lower) || lower.startsWith("my_") || lower.startsWith("replace_") || lower.startsWith("example_")) {
    errors.push(`${name} must not use a placeholder or weak default value in production.`);
  }
  const uniqueChars = new Set(value).size;
  if (uniqueChars < MIN_SECRET_UNIQUE_CHARS) {
    errors.push(
      `${name} has insufficient character diversity in production (at least ${MIN_SECRET_UNIQUE_CHARS} distinct characters required).`
    );
  }
  return errors;
}
function validateProductionConfig(env = process.env) {
  if (env.NODE_ENV !== "production") {
    return { ok: true, errors: [] };
  }
  const errors = [];
  errors.push(...validateSecretStrength("SESSION_SECRET", env.SESSION_SECRET));
  errors.push(...validateSecretStrength("CSRF_SECRET", env.CSRF_SECRET));
  const sessionSecret = env.SESSION_SECRET?.trim() || "";
  const csrfSecret = env.CSRF_SECRET?.trim() || "";
  if (sessionSecret && csrfSecret && sessionSecret === csrfSecret) {
    errors.push("SESSION_SECRET and CSRF_SECRET must be distinct values in production.");
  }
  const storageDriverRaw = (env.UPLOAD_STORAGE_DRIVER || "").trim().toLowerCase();
  if (storageDriverRaw !== "gcs") {
    errors.push(
      'UPLOAD_STORAGE_DRIVER must be set to "gcs" in production so persistent user uploads never depend on ephemeral local Cloud Run storage.'
    );
  } else if (!env.GCS_BUCKET_NAME || env.GCS_BUCKET_NAME.trim().length === 0) {
    errors.push('GCS_BUCKET_NAME is required when UPLOAD_STORAGE_DRIVER="gcs" in production.');
  }
  if (env.MYSQL_SSL_ENABLED === "false") {
    errors.push('MYSQL_SSL_ENABLED cannot be "false" in production.');
  }
  if (env.MYSQL_SSL_REJECT_UNAUTHORIZED === "false") {
    errors.push('MYSQL_SSL_REJECT_UNAUTHORIZED cannot be "false" in production.');
  }
  return {
    ok: errors.length === 0,
    errors
  };
}
var ProductionConfigError = class extends Error {
  constructor(errors) {
    super(`Invalid production configuration:
- ${errors.join("\n- ")}`);
    this.name = "ProductionConfigError";
    this.errors = errors;
  }
};
function assertValidProductionConfig(env = process.env) {
  const result = validateProductionConfig(env);
  if (!result.ok) {
    throw new ProductionConfigError(result.errors);
  }
}
function resolveUploadStorageDriver(env = process.env) {
  const raw = (env.UPLOAD_STORAGE_DRIVER || "").trim().toLowerCase();
  if (raw === "gcs") return "gcs";
  if (raw === "local") return "local";
  return env.NODE_ENV === "production" ? "gcs" : "local";
}
function buildAppConfig(env = process.env) {
  const isProd = env.NODE_ENV === "production";
  const signedUrlTtlRaw = Number.parseInt(env.GCS_SIGNED_URL_TTL_SECONDS || "300", 10);
  const gcsSignedUrlTtlSeconds = Number.isFinite(signedUrlTtlRaw) && signedUrlTtlRaw >= 30 && signedUrlTtlRaw <= 3600 ? signedUrlTtlRaw : 300;
  return {
    nodeEnv: env.NODE_ENV || "development",
    isProduction: isProd,
    port: Number.parseInt(env.PORT || "3000", 10),
    appUrl: env.APP_URL || "http://localhost:3000",
    corsOrigin: env.CORS_ORIGIN || env.APP_URL || "http://localhost:3000",
    trustProxy: env.TRUST_PROXY !== "false",
    sessionSecret: isProd ? env.SESSION_SECRET?.trim() || "" : env.SESSION_SECRET || devFallbackSessionSecret,
    csrfSecret: isProd ? env.CSRF_SECRET?.trim() || "" : env.CSRF_SECRET || devFallbackCsrfSecret,
    hasExplicitSessionSecret: Boolean(env.SESSION_SECRET?.trim()),
    hasExplicitCsrfSecret: Boolean(env.CSRF_SECRET?.trim()),
    sessionTtlHours: Number.parseInt(env.SESSION_TTL_HOURS || "168", 10),
    cookieSecure: env.COOKIE_SECURE === "true" ? true : env.COOKIE_SECURE === "false" ? false : isProd,
    adminBootstrapToken: env.ADMIN_BOOTSTRAP_TOKEN || "",
    uploadStorageDriver: resolveUploadStorageDriver(env),
    uploadDir: path.resolve(process.cwd(), env.UPLOAD_DIR || "./uploads"),
    maxUploadBytes: Number.parseInt(env.MAX_UPLOAD_BYTES || String(5 * 1024 * 1024), 10),
    gcsBucketName: env.GCS_BUCKET_NAME?.trim() || "",
    gcsKeyPrefix: (env.GCS_KEY_PREFIX || "").trim().replace(/^\/+|\/+$/g, ""),
    gcsDeliveryMode: env.GCS_DELIVERY_MODE === "signed_url" ? "signed_url" : "proxy",
    gcsSignedUrlTtlSeconds,
    gcsPublicBaseUrl: (env.GCS_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, ""),
    uploadCdnOrigin: (env.UPLOAD_CDN_ORIGIN || "").trim()
  };
}
var appConfig = buildAppConfig(process.env);

// server/middleware/security.ts
import cors from "cors";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { ZodError } from "zod";

// server/db/pool.ts
import mysql from "mysql2/promise";

// server/db/config.ts
import fs from "fs";
var MysqlConfigurationError = class extends Error {
  constructor(message) {
    super(message);
    this.code = "MYSQL_CONFIG_ERROR";
    this.name = "MysqlConfigurationError";
  }
};
function getMysqlConfigStatus(env = process.env) {
  if (env.MYSQL_URL && env.MYSQL_URL.trim().length > 0) {
    return { configured: true, missingFields: [], mode: "url" };
  }
  const required = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"];
  const missingFields = required.filter((key) => !env[key] || env[key].trim().length === 0);
  if (missingFields.length === 0) {
    return { configured: true, missingFields: [], mode: "fields" };
  }
  return { configured: false, missingFields, mode: "unconfigured" };
}
function resolveMysqlCaCertificate(env = process.env) {
  if (env.MYSQL_CA_CERT !== void 0 && env.MYSQL_CA_CERT.trim().length > 0) {
    return env.MYSQL_CA_CERT.replace(/\\n/g, "\n");
  }
  if (env.MYSQL_CA_CERT_BASE64 !== void 0 && env.MYSQL_CA_CERT_BASE64.trim().length > 0) {
    const decoded = Buffer.from(env.MYSQL_CA_CERT_BASE64.trim(), "base64").toString("utf8").trim();
    if (!decoded) {
      throw new MysqlConfigurationError(
        "MYSQL_CA_CERT_BASE64 was provided but decoded to an empty certificate."
      );
    }
    return decoded;
  }
  if (env.MYSQL_CA_CERT_PATH !== void 0 && env.MYSQL_CA_CERT_PATH.trim().length > 0) {
    const certPath = env.MYSQL_CA_CERT_PATH.trim();
    if (!fs.existsSync(certPath)) {
      throw new MysqlConfigurationError(
        `MYSQL_CA_CERT_PATH points to a file that does not exist: ${certPath}`
      );
    }
    const stat = fs.statSync(certPath);
    if (!stat.isFile()) {
      throw new MysqlConfigurationError(
        `MYSQL_CA_CERT_PATH must point to a regular certificate file: ${certPath}`
      );
    }
    const content = fs.readFileSync(certPath, "utf8").trim();
    if (!content) {
      throw new MysqlConfigurationError(
        `MYSQL_CA_CERT_PATH certificate file is empty: ${certPath}`
      );
    }
    return content;
  }
  return void 0;
}
function parsePositiveInt(raw, fallback, min = 1) {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return parsed;
}
function buildMysqlPoolOptions(env = process.env) {
  const status = getMysqlConfigStatus(env);
  if (!status.configured) {
    return null;
  }
  const isProd = env.NODE_ENV === "production";
  const sslEnabled = env.MYSQL_SSL_ENABLED !== "false";
  const rejectUnauthorized = env.MYSQL_SSL_REJECT_UNAUTHORIZED !== "false";
  if (isProd && (!sslEnabled || !rejectUnauthorized)) {
    throw new MysqlConfigurationError(
      "Strict MySQL TLS verification cannot be disabled in production (MYSQL_SSL_ENABLED and MYSQL_SSL_REJECT_UNAUTHORIZED must not be false)."
    );
  }
  if (sslEnabled && !rejectUnauthorized) {
    throw new MysqlConfigurationError(
      "MySQL TLS certificate verification cannot be silently disabled while MYSQL_SSL_ENABLED is true (MYSQL_SSL_REJECT_UNAUTHORIZED must remain true)."
    );
  }
  const ca = resolveMysqlCaCertificate(env);
  const sslOption = sslEnabled ? {
    ca,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2"
  } : void 0;
  const connectionLimit = parsePositiveInt(env.MYSQL_CONNECTION_LIMIT, 10, 1);
  const connectTimeout = parsePositiveInt(env.MYSQL_CONNECT_TIMEOUT_MS, 1e4, 1e3);
  if (status.mode === "url" && env.MYSQL_URL) {
    let url;
    try {
      url = new URL(env.MYSQL_URL);
    } catch {
      throw new MysqlConfigurationError(
        "MYSQL_URL is not a valid MySQL connection URI."
      );
    }
    const sslModeParam = (url.searchParams.get("ssl-mode") || url.searchParams.get("sslmode") || "").toLowerCase();
    const sslParam = (url.searchParams.get("ssl") || "").toLowerCase();
    if ((sslEnabled || isProd) && (sslModeParam === "disabled" || sslModeParam === "disable" || sslParam === "false")) {
      throw new MysqlConfigurationError(
        "MYSQL_URL attempts to disable SSL while strict TLS verification is active."
      );
    }
    return {
      host: url.hostname,
      port: url.port ? Number.parseInt(url.port, 10) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, "") || env.MYSQL_DATABASE || "levelup_rwanda",
      ssl: sslOption,
      waitForConnections: true,
      connectionLimit,
      connectTimeout,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 1e4,
      timezone: "Z",
      multipleStatements: false
    };
  }
  return {
    host: env.MYSQL_HOST,
    port: parsePositiveInt(env.MYSQL_PORT, 3306, 1),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    ssl: sslOption,
    waitForConnections: true,
    connectionLimit,
    connectTimeout,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 1e4,
    timezone: "Z",
    multipleStatements: false
  };
}

// server/db/pool.ts
var DatabaseUnavailableError = class extends Error {
  constructor(missingFields) {
    super(
      `MySQL 8 database is not configured. Supply environment variables: ${missingFields.join(", ")}`
    );
    this.code = "DATABASE_NOT_CONFIGURED";
    this.statusCode = 503;
    this.name = "DatabaseUnavailableError";
    this.missingFields = missingFields;
  }
};
var poolInstance = null;
function getPool() {
  if (poolInstance) {
    return poolInstance;
  }
  const options = buildMysqlPoolOptions();
  if (!options) {
    const status = getMysqlConfigStatus();
    throw new DatabaseUnavailableError(status.missingFields);
  }
  poolInstance = mysql.createPool(options);
  return poolInstance;
}
function isDatabaseConfigured() {
  return getMysqlConfigStatus().configured;
}
function scrubDatabaseSecrets(text) {
  return text.replace(/mysqls?:\/\/[^@\s]+@/gi, "mysql://[REDACTED]@").replace(/(password\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED]");
}
function formatDatabaseErrorForLog(err) {
  if (err && typeof err === "object") {
    const e = err;
    return {
      name: typeof e.name === "string" ? e.name : "DatabaseError",
      code: typeof e.code === "string" ? e.code : void 0,
      errno: typeof e.errno === "number" ? e.errno : void 0,
      sqlState: typeof e.sqlState === "string" ? e.sqlState : void 0,
      message: typeof e.message === "string" ? scrubDatabaseSecrets(e.message) : "Unknown database error"
    };
  }
  return { message: scrubDatabaseSecrets(String(err)) };
}
function formatReadinessDatabaseError(err, isProduction) {
  if (isProduction) {
    return "Database connection unavailable";
  }
  if (err instanceof Error) {
    const code = err.code;
    const msg = scrubDatabaseSecrets(err.message);
    return code ? `${code}: ${msg}` : msg;
  }
  return "Database connection error";
}
async function pingDatabase(options) {
  const status = getMysqlConfigStatus();
  if (!status.configured) {
    return {
      connected: false,
      configured: false,
      missingFields: status.missingFields
    };
  }
  const isProd = options?.isProduction ?? process.env.NODE_ENV === "production";
  const startedAt = Date.now();
  try {
    if (options?.probeFn) {
      await options.probeFn();
    } else {
      const pool = getPool();
      await pool.query("SELECT 1 AS ok");
    }
    return {
      connected: true,
      configured: true,
      missingFields: [],
      latencyMs: Date.now() - startedAt
    };
  } catch (err) {
    console.error("[MySQL Readiness Error]", formatDatabaseErrorForLog(err));
    return {
      connected: false,
      configured: true,
      missingFields: [],
      error: formatReadinessDatabaseError(err, isProd)
    };
  }
}
async function queryRows(sql, params = [], conn) {
  const executor = conn ?? getPool();
  const [rows] = await executor.execute(sql, params);
  return rows;
}
async function executeSql(sql, params = [], conn) {
  const executor = conn ?? getPool();
  const [result] = await executor.execute(sql, params);
  return result;
}
async function withTransaction(fn) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
async function closePool() {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}

// server/utils/crypto.ts
import crypto2 from "crypto";
var SCRYPT_N = 16384;
var SCRYPT_R = 8;
var SCRYPT_P = 1;
var KEY_LEN = 64;
async function hashPassword(password) {
  const salt = crypto2.randomBytes(16).toString("hex");
  const derivedKey = await new Promise((resolve, reject) => {
    crypto2.scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derivedKey.toString("hex")}`;
}
async function verifyPassword(password, storedHash) {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const n = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  const salt = parts[4];
  const expectedHex = parts[5];
  if (!n || !r || !p || !salt || !expectedHex) {
    return false;
  }
  const derivedKey = await new Promise((resolve, reject) => {
    crypto2.scrypt(password, salt, KEY_LEN, { N: n, r, p }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  const expectedBuf = Buffer.from(expectedHex, "hex");
  if (derivedKey.length !== expectedBuf.length) {
    return false;
  }
  return crypto2.timingSafeEqual(derivedKey, expectedBuf);
}
function sha256Hex(value) {
  return crypto2.createHash("sha256").update(value).digest("hex");
}
function generateSecureToken(byteLength = 32) {
  return crypto2.randomBytes(byteLength).toString("hex");
}
function generateVerificationCode() {
  const num = crypto2.randomInt(1e5, 999999);
  return String(num);
}
function timingSafeEqualsString(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto2.timingSafeEqual(bufA, bufB);
}

// server/utils/errors.ts
var AppError = class extends Error {
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR", details) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
};
var ValidationError = class extends AppError {
  constructor(message, details) {
    super(message, 400, "VALIDATION_ERROR", details);
  }
};
var UnauthorizedError = class extends AppError {
  constructor(message = "Authentication is required") {
    super(message, 401, "UNAUTHORIZED");
  }
};
var ForbiddenError = class extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, 403, "FORBIDDEN");
  }
};
var NotFoundError = class extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
};
var ConflictError = class extends AppError {
  constructor(message) {
    super(message, 409, "CONFLICT");
  }
};

// server/middleware/security.ts
var SESSION_COOKIE_NAME = "levelup_session";
var CSRF_COOKIE_NAME = "levelup_csrf";
function buildCspImgSrcDirectives(env = process.env) {
  const origins = /* @__PURE__ */ new Set(["'self'", "data:", "blob:", "https://storage.googleapis.com"]);
  const candidateUrls = [env.GCS_PUBLIC_BASE_URL, env.UPLOAD_CDN_ORIGIN];
  for (const raw of candidateUrls) {
    if (!raw || !raw.trim()) continue;
    try {
      const parsed = new URL(raw.trim());
      if (parsed.protocol === "https:") {
        origins.add(parsed.origin);
      }
    } catch {
    }
  }
  return Array.from(origins);
}
function createHelmetMiddleware() {
  const imgSrc = buildCspImgSrcDirectives();
  return helmet({
    contentSecurityPolicy: appConfig.isProduction ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc,
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"]
      }
    } : false,
    crossOriginEmbedderPolicy: false
  });
}
function createCorsMiddleware() {
  const allowedOrigins = appConfig.corsOrigin.split(",").map((s) => s.trim()).filter(Boolean);
  return cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new AppError("Origin not allowed by CORS", 403, "CORS_FORBIDDEN"));
    },
    credentials: true
  });
}
var generalApiLimiter = rateLimit({
  windowMs: 60 * 1e3,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down and try again." }
  }
});
var authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: {
      code: "AUTH_RATE_LIMITED",
      message: "Too many authentication attempts. Please wait 15 minutes and try again."
    }
  }
});
var uploadRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1e3,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: { code: "UPLOAD_RATE_LIMITED", message: "Upload rate limit reached. Try again later." }
  }
});
function ensureCsrfCookie(req, res, next) {
  if (!req.cookies?.[CSRF_COOKIE_NAME]) {
    const token = generateSecureToken(24);
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      sameSite: "lax",
      secure: appConfig.cookieSecure,
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1e3
    });
  }
  next();
}
function verifyCsrfToken(req, _res, next) {
  const safeMethods = ["GET", "HEAD", "OPTIONS"];
  if (safeMethods.includes(req.method.toUpperCase())) {
    next();
    return;
  }
  const hasSessionCookie = Boolean(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!hasSessionCookie) {
    next();
    return;
  }
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.get("x-csrf-token");
  if (!cookieToken || !headerToken || !timingSafeEqualsString(cookieToken, headerToken)) {
    next(new AppError("Invalid or missing CSRF token", 403, "CSRF_INVALID"));
    return;
  }
  next();
}
function centralizedErrorHandler(err, _req, res, _next) {
  if (err instanceof DatabaseUnavailableError) {
    res.status(503).json({
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        missingFields: err.missingFields
      }
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Please check the highlighted form fields.",
        details: err.flatten().fieldErrors
      }
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details
      }
    });
    return;
  }
  if (err && typeof err === "object" && "code" in err && err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({
      ok: false,
      error: {
        code: "FILE_TOO_LARGE",
        message: `Uploaded file exceeds maximum allowed size of ${Math.round(appConfig.maxUploadBytes / (1024 * 1024))} MB.`
      }
    });
    return;
  }
  console.error("[Unhandled Server Error]", err);
  res.status(500).json({
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: appConfig.isProduction ? "An unexpected server error occurred." : err instanceof Error ? err.message : "Unexpected error"
    }
  });
}

// server/routes/v1.ts
import { Router } from "express";

// shared/schemas.ts
import { z } from "zod";
var SUPPORTED_LANGUAGES = ["rw", "en", "fr"];
var USER_ROLES = ["member", "educator", "moderator", "admin", "super_admin"];
var AGE_GROUPS = ["youth_13_17", "adult_18_plus"];
var CHALLENGE_DIFFICULTIES = ["beginner", "intermediate", "advanced"];
var CHALLENGE_TYPES = ["daily", "weekly", "practice"];
var OPPORTUNITY_TYPES = [
  "scholarship",
  "internship",
  "job",
  "remote_job",
  "fellowship",
  "grant",
  "volunteering",
  "online_course"
];
var strongPasswordSchema = z.string().min(8, "Password must be at least 8 characters").max(128, "Password is too long").refine((val) => /[a-z]/.test(val), "Password must include a lowercase letter").refine((val) => /[A-Z]/.test(val), "Password must include an uppercase letter").refine((val) => /\d/.test(val), "Password must include a number");
var registerSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(190).optional().or(z.literal("")),
  phone: z.string().trim().regex(/^\+?[0-9]{9,15}$/, "Enter a valid phone number (e.g. +250788000000)").optional().or(z.literal("")),
  displayName: z.string().trim().min(2, "Display name is required").max(80),
  username: z.string().trim().min(3, "Username must be at least 3 characters").max(32).regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  password: strongPasswordSchema,
  ageGroup: z.enum(AGE_GROUPS).default("adult_18_plus"),
  preferredLanguage: z.enum(SUPPORTED_LANGUAGES).default("en"),
  district: z.string().trim().max(80).optional()
}).refine((data) => Boolean(data.email || data.phone), {
  message: "Provide either an email address or a phone number",
  path: ["email"]
});
var loginSchema = z.object({
  identifier: z.string().trim().min(3, "Email, phone, or username is required").max(190),
  password: z.string().min(1, "Password is required").max(128)
});
var verifyContactSchema = z.object({
  identifier: z.string().trim().min(3).max(190),
  code: z.string().trim().min(6).max(64)
});
var requestPasswordResetSchema = z.object({
  identifier: z.string().trim().min(3, "Email or phone is required").max(190)
});
var confirmPasswordResetSchema = z.object({
  identifier: z.string().trim().min(3).max(190),
  token: z.string().trim().min(6).max(128),
  newPassword: strongPasswordSchema
});
var bootstrapAdminSchema = z.object({
  bootstrapToken: z.string().trim().min(16, "Bootstrap token is required"),
  email: z.string().trim().email().max(190),
  displayName: z.string().trim().min(2).max(80),
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(12, "Administrator password must be at least 12 characters").max(128).refine((val) => /[a-z]/.test(val) && /[A-Z]/.test(val) && /\d/.test(val), {
    message: "Administrator password must include upper, lower, and numeric characters"
  })
});
var challengeSubmissionSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.number().int().positive(),
      selectedOptionIndex: z.number().int().min(0).max(10)
    })
  ).min(1, "Select at least one answer"),
  durationSeconds: z.number().int().min(1).max(7200)
});
var lessonCompletionSchema = z.object({
  selectedOptionIndex: z.number().int().min(0).max(10).optional()
});
var createPostSchema = z.object({
  postType: z.enum(["create_showcase", "discussion"]).default("create_showcase"),
  category: z.string().trim().min(2).max(60),
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(140),
  body: z.string().trim().min(10, "Share at least 10 characters").max(4e3),
  groupId: z.number().int().positive().nullable().optional()
});
var createCommentSchema = z.object({
  body: z.string().trim().min(2, "Comment is too short").max(1500)
});
var createGroupSchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().min(10).max(600),
  category: z.string().trim().min(2).max(60),
  isPrivate: z.boolean().default(false)
});
var reportContentSchema = z.object({
  targetType: z.enum(["post", "comment", "user", "opportunity"]),
  targetId: z.number().int().positive(),
  reason: z.enum([
    "spam",
    "harassment",
    "misinformation",
    "inappropriate_for_youth",
    "scam_or_fraud",
    "other"
  ]),
  details: z.string().trim().max(1e3).optional()
});
var createOpportunitySchema = z.object({
  categoryId: z.number().int().positive(),
  opportunityType: z.enum(OPPORTUNITY_TYPES),
  title: z.string().trim().min(5).max(160),
  organizationName: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(120),
  isRemote: z.boolean().default(false),
  summary: z.string().trim().min(20).max(3e3),
  eligibility: z.string().trim().min(5).max(1500),
  applicationUrl: z.string().trim().url("Provide a valid https:// application link").max(500),
  deadlineAt: z.string().trim().optional().nullable()
});
var updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  bio: z.string().trim().max(500).optional().default(""),
  district: z.string().trim().max(80).optional().default(""),
  interests: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  skills: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  profileVisibility: z.enum(["public", "community", "private"]).default("community"),
  showActivity: z.boolean().default(true),
  preferredLanguage: z.enum(SUPPORTED_LANGUAGES).optional()
});
var updateNotificationPrefsSchema = z.object({
  challengeReminders: z.boolean(),
  learningUpdates: z.boolean(),
  communityActivity: z.boolean(),
  opportunityAlerts: z.boolean(),
  announcements: z.boolean()
});
var adminCreateChallengeSchema = z.object({
  categoryId: z.number().int().positive(),
  slug: z.string().trim().min(3).max(90).regex(/^[a-z0-9-]+$/),
  titleEn: z.string().trim().min(3).max(160),
  titleRw: z.string().trim().min(3).max(160),
  titleFr: z.string().trim().min(3).max(160),
  descriptionEn: z.string().trim().min(10).max(2e3),
  descriptionRw: z.string().trim().min(10).max(2e3),
  descriptionFr: z.string().trim().min(10).max(2e3),
  difficulty: z.enum(CHALLENGE_DIFFICULTIES),
  challengeType: z.enum(CHALLENGE_TYPES),
  timeLimitSeconds: z.number().int().min(30).max(3600),
  xpReward: z.number().int().min(10).max(500),
  activeDate: z.string().trim().optional().nullable(),
  isFeatured: z.boolean().default(false),
  status: z.enum(["draft", "published", "archived"]).default("published")
});
var adminCreateQuestionSchema = z.object({
  challengeId: z.number().int().positive(),
  promptEn: z.string().trim().min(5).max(1e3),
  promptRw: z.string().trim().min(5).max(1e3),
  promptFr: z.string().trim().min(5).max(1e3),
  options: z.array(z.string().trim().min(1).max(300)).min(2).max(6),
  correctOptionIndex: z.number().int().min(0).max(5),
  explanationEn: z.string().trim().min(5).max(1e3),
  explanationRw: z.string().trim().min(5).max(1e3),
  explanationFr: z.string().trim().min(5).max(1e3),
  pointsWeight: z.number().int().min(1).max(100).default(10),
  sortOrder: z.number().int().min(1).max(100).default(1)
});
var adminCreateCourseSchema = z.object({
  categoryId: z.number().int().positive(),
  slug: z.string().trim().min(3).max(90).regex(/^[a-z0-9-]+$/),
  titleEn: z.string().trim().min(3).max(160),
  titleRw: z.string().trim().min(3).max(160),
  titleFr: z.string().trim().min(3).max(160),
  summaryEn: z.string().trim().min(10).max(2e3),
  summaryRw: z.string().trim().min(10).max(2e3),
  summaryFr: z.string().trim().min(10).max(2e3),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  estimatedMinutes: z.number().int().min(5).max(2e3),
  xpReward: z.number().int().min(20).max(1e3),
  status: z.enum(["draft", "published", "archived"]).default("published")
});
var adminCreateAnnouncementSchema = z.object({
  titleEn: z.string().trim().min(3).max(160),
  titleRw: z.string().trim().min(3).max(160),
  titleFr: z.string().trim().min(3).max(160),
  bodyEn: z.string().trim().min(5).max(2e3),
  bodyRw: z.string().trim().min(5).max(2e3),
  bodyFr: z.string().trim().min(5).max(2e3),
  audience: z.enum(["all", "learners", "moderators"]).default("all"),
  isActive: z.boolean().default(true)
});

// server/routes/v1.ts
import { z as z2 } from "zod";

// server/db/bootstrapAdmin.ts
async function provisionFirstSuperAdmin(params) {
  const passwordHash = await hashPassword(params.password);
  return withTransaction(async (conn) => {
    const [existingAdmins] = await conn.execute(
      "SELECT id FROM users WHERE role = 'super_admin' LIMIT 1"
    );
    if (existingAdmins.length > 0) {
      throw new Error("A super_admin account has already been provisioned.");
    }
    const [dupEmail] = await conn.execute(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [params.email.toLowerCase()]
    );
    if (dupEmail.length > 0) {
      throw new Error("Email is already registered.");
    }
    const [dupUser] = await conn.execute(
      "SELECT user_id FROM user_profiles WHERE username = ? LIMIT 1",
      [params.username.toLowerCase()]
    );
    if (dupUser.length > 0) {
      throw new Error("Username is already taken.");
    }
    const [userRes] = await conn.execute(
      `INSERT INTO users
        (email, password_hash, role, status, age_group, preferred_language, contact_verified)
       VALUES (?, ?, 'super_admin', 'active', 'adult_18_plus', 'en', 1)`,
      [params.email.toLowerCase(), passwordHash]
    );
    const userId = Number(userRes.insertId);
    await conn.execute(
      `INSERT INTO user_profiles
        (user_id, display_name, username, interests_json, skills_json, profile_visibility)
       VALUES (?, ?, ?, CAST('[]' AS JSON), CAST('[]' AS JSON), 'community')`,
      [userId, params.displayName, params.username.toLowerCase()]
    );
    await conn.execute(
      "INSERT INTO notification_preferences (user_id) VALUES (?)",
      [userId]
    );
    await conn.execute(
      `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata_json, ip_address)
       VALUES (?, 'SUPER_ADMIN_PROVISIONED', 'user', ?, CAST(? AS JSON), ?)`,
      [
        userId,
        String(userId),
        JSON.stringify({ email: params.email.toLowerCase(), username: params.username.toLowerCase() }),
        params.ipAddress || "cli"
      ]
    );
    return {
      userId,
      email: params.email.toLowerCase(),
      username: params.username.toLowerCase()
    };
  });
}

// server/middleware/auth.ts
async function resolveSessionUser(token) {
  if (!isDatabaseConfigured()) {
    return null;
  }
  const tokenHash = sha256Hex(token);
  const rows = await queryRows(
    `SELECT
       s.id AS session_id,
       u.id,
       u.email,
       u.phone,
       u.role,
       u.status,
       u.age_group,
       u.preferred_language,
       u.contact_verified,
       p.display_name,
       p.username,
       p.avatar_url,
       p.total_xp,
       p.current_level,
       p.current_streak
     FROM user_sessions s
     INNER JOIN users u ON u.id = s.user_id
     INNER JOIN user_profiles p ON p.user_id = u.id
     WHERE s.token_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  if (row.status === "suspended") {
    return null;
  }
  return {
    sessionId: Number(row.session_id),
    user: {
      id: Number(row.id),
      email: row.email ? String(row.email) : null,
      phone: row.phone ? String(row.phone) : null,
      role: row.role,
      status: row.status,
      ageGroup: row.age_group,
      preferredLanguage: row.preferred_language,
      contactVerified: Boolean(row.contact_verified),
      displayName: String(row.display_name),
      username: String(row.username),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      totalXp: Number(row.total_xp),
      currentLevel: Number(row.current_level),
      currentStreak: Number(row.current_streak)
    }
  };
}
async function optionalAuth(req, _res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (token && typeof token === "string") {
      const resolved = await resolveSessionUser(token);
      if (resolved) {
        req.user = resolved.user;
        req.sessionId = resolved.sessionId;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}
async function authenticateSession(req, _res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token || typeof token !== "string") {
      next(new UnauthorizedError("Please sign in to continue"));
      return;
    }
    const resolved = await resolveSessionUser(token);
    if (!resolved) {
      next(new UnauthorizedError("Your session has expired. Please sign in again."));
      return;
    }
    req.user = resolved.user;
    req.sessionId = resolved.sessionId;
    next();
  } catch (err) {
    next(err);
  }
}
function requireRole(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      next(new ForbiddenError("Insufficient permissions for this administrative resource"));
      return;
    }
    next();
  };
}

// server/services/auditService.ts
async function recordAuditLog(params) {
  await executeSql(
    `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata_json, ip_address)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)`,
    [
      params.actorUserId ?? null,
      params.action,
      params.targetType,
      params.targetId !== void 0 && params.targetId !== null ? String(params.targetId) : null,
      JSON.stringify(params.metadata ?? {}),
      params.ipAddress ?? null
    ],
    params.conn
  );
}

// server/services/adminService.ts
async function getAdminOverview() {
  const [usersCount] = await queryRows("SELECT COUNT(*) AS cnt FROM users");
  const [challengesCount] = await queryRows("SELECT COUNT(*) AS cnt FROM challenges");
  const [submissionsCount] = await queryRows(
    "SELECT COUNT(*) AS cnt FROM challenge_submissions"
  );
  const [coursesCount] = await queryRows("SELECT COUNT(*) AS cnt FROM courses");
  const [enrollmentsCount] = await queryRows(
    "SELECT COUNT(*) AS cnt FROM course_enrollments"
  );
  const [postsCount] = await queryRows("SELECT COUNT(*) AS cnt FROM creative_posts");
  const [openReportsCount] = await queryRows(
    "SELECT COUNT(*) AS cnt FROM content_reports WHERE status IN ('open', 'reviewing')"
  );
  const [pendingOppsCount] = await queryRows(
    "SELECT COUNT(*) AS cnt FROM opportunities WHERE approval_status = 'pending'"
  );
  const xpBreakdown = await queryRows(
    `SELECT source_type, COUNT(*) AS count, COALESCE(SUM(points), 0) AS total_points
     FROM xp_transactions
     GROUP BY source_type`
  );
  return {
    counts: {
      users: Number(usersCount?.cnt ?? 0),
      challenges: Number(challengesCount?.cnt ?? 0),
      submissions: Number(submissionsCount?.cnt ?? 0),
      courses: Number(coursesCount?.cnt ?? 0),
      enrollments: Number(enrollmentsCount?.cnt ?? 0),
      posts: Number(postsCount?.cnt ?? 0),
      openReports: Number(openReportsCount?.cnt ?? 0),
      pendingOpportunities: Number(pendingOppsCount?.cnt ?? 0)
    },
    xpBreakdown
  };
}
async function listUsersAdmin(search) {
  const q = search?.trim() ? `%${search.trim()}%` : null;
  const where = q ? "WHERE u.email LIKE ? OR up.username LIKE ? OR up.display_name LIKE ?" : "";
  const params = q ? [q, q, q] : [];
  return queryRows(
    `SELECT u.id, u.email, u.phone, u.role, u.status, u.age_group, u.contact_verified, u.last_login_at, u.created_at,
            up.display_name, up.username, up.district, up.total_xp, up.current_level
     FROM users u
     INNER JOIN user_profiles up ON up.user_id = u.id
     ${where}
     ORDER BY u.created_at DESC
     LIMIT 100`,
    params
  );
}
async function updateUserRoleOrStatusAdmin(params) {
  if (params.actorUserId === params.targetUserId && params.status === "suspended") {
    throw new ForbiddenError("You cannot suspend your own administrator account.");
  }
  if (params.role === "super_admin" && params.actorRole !== "super_admin") {
    throw new ForbiddenError("Only a super_admin can assign the super_admin role.");
  }
  await withTransaction(async (conn) => {
    const [rows] = await conn.execute("SELECT role, status FROM users WHERE id = ? LIMIT 1", [
      params.targetUserId
    ]);
    if (rows.length === 0) {
      throw new NotFoundError("User not found.");
    }
    if (rows[0].role === "super_admin" && params.actorRole !== "super_admin") {
      throw new ForbiddenError("Only a super_admin can modify another super_admin.");
    }
    if (params.role) {
      await conn.execute("UPDATE users SET role = ? WHERE id = ?", [params.role, params.targetUserId]);
    }
    if (params.status) {
      await conn.execute("UPDATE users SET status = ? WHERE id = ?", [params.status, params.targetUserId]);
      if (params.status === "suspended") {
        await conn.execute("UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = ?", [
          params.targetUserId
        ]);
      }
    }
    await recordAuditLog({
      actorUserId: params.actorUserId,
      action: "ADMIN_USER_UPDATED",
      targetType: "user",
      targetId: params.targetUserId,
      metadata: { role: params.role, status: params.status },
      ipAddress: params.ipAddress,
      conn
    });
  });
}
async function listAllChallengesAdmin() {
  return queryRows(
    `SELECT c.*, cat.name_en AS category_name,
            (SELECT COUNT(*) FROM challenge_questions q WHERE q.challenge_id = c.id) AS question_count
     FROM challenges c
     INNER JOIN challenge_categories cat ON cat.id = c.category_id
     ORDER BY c.created_at DESC`
  );
}
async function createChallengeAdmin(actorUserId, data, ipAddress) {
  return withTransaction(async (conn) => {
    const [res] = await conn.execute(
      `INSERT INTO challenges
        (category_id, slug, title_en, title_rw, title_fr, description_en, description_rw, description_fr, difficulty, challenge_type, time_limit_seconds, xp_reward, active_date, is_featured, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.categoryId,
        data.slug,
        data.titleEn,
        data.titleRw,
        data.titleFr,
        data.descriptionEn,
        data.descriptionRw,
        data.descriptionFr,
        data.difficulty,
        data.challengeType,
        data.timeLimitSeconds,
        data.xpReward,
        data.activeDate || null,
        data.isFeatured ? 1 : 0,
        data.status,
        actorUserId
      ]
    );
    const id = Number(res.insertId);
    await recordAuditLog({
      actorUserId,
      action: "ADMIN_CHALLENGE_CREATED",
      targetType: "challenge",
      targetId: id,
      metadata: { slug: data.slug },
      ipAddress,
      conn
    });
    return { id };
  });
}
async function addQuestionAdmin(actorUserId, data, ipAddress) {
  return withTransaction(async (conn) => {
    const [res] = await conn.execute(
      `INSERT INTO challenge_questions
        (challenge_id, prompt_en, prompt_rw, prompt_fr, options_json, correct_option_index, explanation_en, explanation_rw, explanation_fr, points_weight, sort_order)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?)`,
      [
        data.challengeId,
        data.promptEn,
        data.promptRw,
        data.promptFr,
        JSON.stringify(data.options),
        data.correctOptionIndex,
        data.explanationEn,
        data.explanationRw,
        data.explanationFr,
        data.pointsWeight,
        data.sortOrder
      ]
    );
    await recordAuditLog({
      actorUserId,
      action: "ADMIN_QUESTION_ADDED",
      targetType: "challenge",
      targetId: data.challengeId,
      ipAddress,
      conn
    });
    return { id: Number(res.insertId) };
  });
}
async function createCourseAdmin(actorUserId, data, ipAddress) {
  return withTransaction(async (conn) => {
    const [res] = await conn.execute(
      `INSERT INTO courses
        (category_id, slug, title_en, title_rw, title_fr, summary_en, summary_rw, summary_fr, level, estimated_minutes, xp_reward, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.categoryId,
        data.slug,
        data.titleEn,
        data.titleRw,
        data.titleFr,
        data.summaryEn,
        data.summaryRw,
        data.summaryFr,
        data.level,
        data.estimatedMinutes,
        data.xpReward,
        data.status,
        actorUserId
      ]
    );
    const courseId = Number(res.insertId);
    await conn.execute(
      `INSERT INTO course_modules (course_id, title_en, title_rw, title_fr, sort_order)
       VALUES (?, 'Module 1: Core Foundations', 'Igice cya 1: Ibanze', 'Module 1 : Fondamentaux', 1)`,
      [courseId]
    );
    await recordAuditLog({
      actorUserId,
      action: "ADMIN_COURSE_CREATED",
      targetType: "course",
      targetId: courseId,
      metadata: { slug: data.slug },
      ipAddress,
      conn
    });
    return { id: courseId };
  });
}
async function listModerationQueueAdmin() {
  const reports = await queryRows(
    `SELECT r.*, up.username AS reporter_username, up.display_name AS reporter_name
     FROM content_reports r
     INNER JOIN user_profiles up ON up.user_id = r.reporter_id
     ORDER BY FIELD(r.status, 'open', 'reviewing', 'resolved', 'dismissed'), r.created_at DESC
     LIMIT 100`
  );
  const posts = await queryRows(
    `SELECT p.id, p.title, p.post_type, p.category, p.moderation_status, p.created_at,
            up.username AS author_username, up.display_name AS author_name
     FROM creative_posts p
     INNER JOIN user_profiles up ON up.user_id = p.user_id
     ORDER BY p.created_at DESC
     LIMIT 60`
  );
  return { reports, posts };
}
async function moderatePostAdmin(actorUserId, postId, status, ipAddress) {
  await withTransaction(async (conn) => {
    await conn.execute("UPDATE creative_posts SET moderation_status = ? WHERE id = ?", [status, postId]);
    await recordAuditLog({
      actorUserId,
      action: "ADMIN_POST_MODERATED",
      targetType: "post",
      targetId: postId,
      metadata: { status },
      ipAddress,
      conn
    });
  });
}
async function resolveReportAdmin(actorUserId, reportId, status, resolutionNote, ipAddress) {
  await withTransaction(async (conn) => {
    await conn.execute(
      "UPDATE content_reports SET status = ?, reviewed_by = ?, resolution_note = ? WHERE id = ?",
      [status, actorUserId, resolutionNote || null, reportId]
    );
    await recordAuditLog({
      actorUserId,
      action: "ADMIN_REPORT_UPDATED",
      targetType: "report",
      targetId: reportId,
      metadata: { status, resolutionNote },
      ipAddress,
      conn
    });
  });
}
async function listAllOpportunitiesAdmin() {
  return queryRows(
    `SELECT o.*, cat.name_en AS category_name
     FROM opportunities o
     INNER JOIN opportunity_categories cat ON cat.id = o.category_id
     ORDER BY FIELD(o.approval_status, 'pending', 'approved', 'rejected', 'expired'), o.created_at DESC`
  );
}
async function updateOpportunityStatusAdmin(actorUserId, opportunityId, params, ipAddress) {
  await withTransaction(async (conn) => {
    if (params.approvalStatus) {
      await conn.execute(
        "UPDATE opportunities SET approval_status = ?, approved_by = ? WHERE id = ?",
        [params.approvalStatus, actorUserId, opportunityId]
      );
    }
    if (params.verifiedStatus) {
      await conn.execute("UPDATE opportunities SET verified_status = ? WHERE id = ?", [
        params.verifiedStatus,
        opportunityId
      ]);
    }
    await recordAuditLog({
      actorUserId,
      action: "ADMIN_OPPORTUNITY_UPDATED",
      targetType: "opportunity",
      targetId: opportunityId,
      metadata: params,
      ipAddress,
      conn
    });
  });
}
async function listOrganizationsAdmin() {
  return queryRows("SELECT * FROM organizations ORDER BY created_at DESC");
}
async function createOrganizationAdmin(actorUserId, data, ipAddress) {
  const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 75) + "-" + Date.now().toString(36);
  return withTransaction(async (conn) => {
    const [res] = await conn.execute(
      "INSERT INTO organizations (name, slug, org_type, website_url, verified, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [data.name, slug, data.orgType, data.websiteUrl || null, data.verified ? 1 : 0, data.description || null, actorUserId]
    );
    await recordAuditLog({
      actorUserId,
      action: "ADMIN_ORGANIZATION_CREATED",
      targetType: "organization",
      targetId: Number(res.insertId),
      ipAddress,
      conn
    });
    return { id: Number(res.insertId) };
  });
}
async function listAnnouncementsAdmin() {
  return queryRows("SELECT * FROM announcements ORDER BY created_at DESC");
}
async function createAnnouncementAdmin(actorUserId, data, ipAddress) {
  return withTransaction(async (conn) => {
    const [res] = await conn.execute(
      `INSERT INTO announcements (title_en, title_rw, title_fr, body_en, body_rw, body_fr, audience, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.titleEn,
        data.titleRw,
        data.titleFr,
        data.bodyEn,
        data.bodyRw,
        data.bodyFr,
        data.audience,
        data.isActive ? 1 : 0,
        actorUserId
      ]
    );
    await recordAuditLog({
      actorUserId,
      action: "ADMIN_ANNOUNCEMENT_CREATED",
      targetType: "announcement",
      targetId: Number(res.insertId),
      ipAddress,
      conn
    });
    return { id: Number(res.insertId) };
  });
}
async function listAuditLogsAdmin() {
  return queryRows(
    `SELECT al.*, up.username AS actor_username
     FROM audit_logs al
     LEFT JOIN user_profiles up ON up.user_id = al.actor_user_id
     ORDER BY al.created_at DESC
     LIMIT 100`
  );
}
async function listSettingsAdmin() {
  return queryRows("SELECT * FROM platform_settings ORDER BY setting_key ASC");
}
async function updateSettingAdmin(actorUserId, key, valueObj, ipAddress) {
  await withTransaction(async (conn) => {
    await conn.execute(
      `INSERT INTO platform_settings (setting_key, setting_value_json, updated_by)
       VALUES (?, CAST(? AS JSON), ?)
       ON DUPLICATE KEY UPDATE setting_value_json = CAST(? AS JSON), updated_by = ?`,
      [key, JSON.stringify(valueObj), actorUserId, JSON.stringify(valueObj), actorUserId]
    );
    await recordAuditLog({
      actorUserId,
      action: "ADMIN_SETTING_UPDATED",
      targetType: "setting",
      targetId: key,
      metadata: { valueObj },
      ipAddress,
      conn
    });
  });
}

// server/services/authService.ts
async function registerUser(params) {
  const email = params.email ? params.email.trim().toLowerCase() : null;
  const phone = params.phone ? params.phone.trim() : null;
  const username = params.username.trim().toLowerCase();
  const passwordHash = await hashPassword(params.password);
  const verificationCode = generateVerificationCode();
  const verificationCodeHash = sha256Hex(verificationCode);
  const userId = await withTransaction(async (conn) => {
    const [regSetting] = await conn.execute(
      "SELECT setting_value_json FROM platform_settings WHERE setting_key = 'registration_open' LIMIT 1"
    );
    if (regSetting.length > 0) {
      const val = typeof regSetting[0].setting_value_json === "string" ? JSON.parse(regSetting[0].setting_value_json) : regSetting[0].setting_value_json;
      if (val && val.enabled === false) {
        throw new ForbiddenError("New registrations are currently paused by an administrator.");
      }
    }
    if (email) {
      const [dupEmail] = await conn.execute(
        "SELECT id FROM users WHERE email = ? LIMIT 1",
        [email]
      );
      if (dupEmail.length > 0) {
        throw new ConflictError("An account with this email address already exists.");
      }
    }
    if (phone) {
      const [dupPhone] = await conn.execute(
        "SELECT id FROM users WHERE phone = ? LIMIT 1",
        [phone]
      );
      if (dupPhone.length > 0) {
        throw new ConflictError("An account with this phone number already exists.");
      }
    }
    const [dupUsername] = await conn.execute(
      "SELECT user_id FROM user_profiles WHERE username = ? LIMIT 1",
      [username]
    );
    if (dupUsername.length > 0) {
      throw new ConflictError("This username is already taken.");
    }
    const [userRes] = await conn.execute(
      `INSERT INTO users
        (email, phone, password_hash, role, status, age_group, preferred_language, contact_verified, contact_verification_token_hash, contact_verification_expires_at)
       VALUES (?, ?, ?, 'member', 'active', ?, ?, 0, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
      [email, phone, passwordHash, params.ageGroup, params.preferredLanguage, verificationCodeHash]
    );
    const createdUserId = Number(userRes.insertId);
    await conn.execute(
      `INSERT INTO user_profiles
        (user_id, display_name, username, district, interests_json, skills_json, profile_visibility)
       VALUES (?, ?, ?, ?, CAST('[]' AS JSON), CAST('[]' AS JSON), 'community')`,
      [createdUserId, params.displayName.trim(), username, params.district?.trim() || null]
    );
    await conn.execute(
      "INSERT INTO notification_preferences (user_id) VALUES (?)",
      [createdUserId]
    );
    await conn.execute(
      `INSERT INTO notifications (user_id, type, title_text, body_text, link_url)
       VALUES (?, 'welcome', 'Welcome to LEVELUP RWANDA', 'Verify your contact details and try today\u2019s Daily Challenge to earn your first XP.', '/play')`,
      [createdUserId]
    );
    await recordAuditLog({
      actorUserId: createdUserId,
      action: "USER_REGISTERED",
      targetType: "user",
      targetId: createdUserId,
      metadata: { ageGroup: params.ageGroup, preferredLanguage: params.preferredLanguage },
      ipAddress: params.ipAddress,
      conn
    });
    return createdUserId;
  });
  return {
    userId,
    verificationPreviewCode: appConfig.isProduction ? void 0 : verificationCode
  };
}
async function loginUser(params) {
  const idLower = params.identifier.trim().toLowerCase();
  const rows = await queryRows(
    `SELECT u.*, p.username, p.display_name
     FROM users u
     INNER JOIN user_profiles p ON p.user_id = u.id
     WHERE u.email = ? OR u.phone = ? OR p.username = ?
     LIMIT 1`,
    [idLower, params.identifier.trim(), idLower]
  );
  if (rows.length === 0) {
    throw new UnauthorizedError("Invalid credentials.");
  }
  const user = rows[0];
  if (user.status === "suspended") {
    throw new ForbiddenError("This account has been suspended. Contact support for assistance.");
  }
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw new ForbiddenError("Too many failed sign-in attempts. Please wait 15 minutes before trying again.");
  }
  const valid = await verifyPassword(params.password, String(user.password_hash));
  if (!valid) {
    await withTransaction(async (conn) => {
      const nextAttempts = Number(user.failed_login_attempts || 0) + 1;
      const shouldLock = nextAttempts >= 5;
      await conn.execute(
        `UPDATE users
         SET failed_login_attempts = ?,
             locked_until = ${shouldLock ? "DATE_ADD(NOW(), INTERVAL 15 MINUTE)" : "NULL"}
         WHERE id = ?`,
        [nextAttempts, user.id]
      );
      await recordAuditLog({
        actorUserId: Number(user.id),
        action: "LOGIN_FAILED",
        targetType: "user",
        targetId: Number(user.id),
        metadata: { attempts: nextAttempts, locked: shouldLock },
        ipAddress: params.ipAddress,
        conn
      });
    });
    throw new UnauthorizedError("Invalid credentials.");
  }
  const rawSessionToken = generateSecureToken(32);
  const tokenHash = sha256Hex(rawSessionToken);
  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE users
       SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW()
       WHERE id = ?`,
      [user.id]
    );
    await conn.execute(
      `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
      [
        user.id,
        tokenHash,
        params.ipAddress?.slice(0, 64) || null,
        params.userAgent?.slice(0, 255) || null,
        appConfig.sessionTtlHours
      ]
    );
    await recordAuditLog({
      actorUserId: Number(user.id),
      action: "LOGIN_SUCCESS",
      targetType: "user",
      targetId: Number(user.id),
      ipAddress: params.ipAddress,
      conn
    });
  });
  return {
    sessionToken: rawSessionToken,
    userId: Number(user.id)
  };
}
async function logoutSession(sessionId, userId, ipAddress) {
  await withTransaction(async (conn) => {
    await conn.execute("UPDATE user_sessions SET revoked_at = NOW() WHERE id = ?", [sessionId]);
    await recordAuditLog({
      actorUserId: userId,
      action: "LOGOUT",
      targetType: "session",
      targetId: sessionId,
      ipAddress,
      conn
    });
  });
}
async function verifyUserContact(identifier, code) {
  const idLower = identifier.trim().toLowerCase();
  const codeHash = sha256Hex(code.trim());
  await withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      `SELECT u.id, u.contact_verification_token_hash, u.contact_verification_expires_at
       FROM users u
       INNER JOIN user_profiles p ON p.user_id = u.id
       WHERE u.email = ? OR u.phone = ? OR p.username = ?
       LIMIT 1`,
      [idLower, identifier.trim(), idLower]
    );
    if (rows.length === 0) {
      throw new NotFoundError("Account not found.");
    }
    const user = rows[0];
    if (!user.contact_verification_token_hash || user.contact_verification_token_hash !== codeHash || !user.contact_verification_expires_at || new Date(user.contact_verification_expires_at).getTime() < Date.now()) {
      throw new ValidationError("Invalid or expired verification code.");
    }
    await conn.execute(
      `UPDATE users
       SET contact_verified = 1,
           contact_verification_token_hash = NULL,
           contact_verification_expires_at = NULL
       WHERE id = ?`,
      [user.id]
    );
  });
}
async function requestPasswordReset(identifier, ipAddress) {
  const idLower = identifier.trim().toLowerCase();
  const resetToken = generateVerificationCode();
  const resetHash = sha256Hex(resetToken);
  const rows = await queryRows(
    `SELECT u.id
     FROM users u
     INNER JOIN user_profiles p ON p.user_id = u.id
     WHERE u.email = ? OR u.phone = ? OR p.username = ?
     LIMIT 1`,
    [idLower, identifier.trim(), idLower]
  );
  if (rows.length === 0) {
    return { requested: true };
  }
  const userId = Number(rows[0].id);
  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE users
       SET password_reset_token_hash = ?, password_reset_expires_at = DATE_ADD(NOW(), INTERVAL 30 MINUTE)
       WHERE id = ?`,
      [resetHash, userId]
    );
    await recordAuditLog({
      actorUserId: userId,
      action: "PASSWORD_RESET_REQUESTED",
      targetType: "user",
      targetId: userId,
      ipAddress,
      conn
    });
  });
  return {
    requested: true,
    resetPreviewCode: appConfig.isProduction ? void 0 : resetToken
  };
}
async function confirmPasswordReset(params) {
  const idLower = params.identifier.trim().toLowerCase();
  const tokenHash = sha256Hex(params.token.trim());
  const newPasswordHash = await hashPassword(params.newPassword);
  await withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      `SELECT u.id, u.password_reset_token_hash, u.password_reset_expires_at
       FROM users u
       INNER JOIN user_profiles p ON p.user_id = u.id
       WHERE u.email = ? OR u.phone = ? OR p.username = ?
       LIMIT 1`,
      [idLower, params.identifier.trim(), idLower]
    );
    if (rows.length === 0) {
      throw new ValidationError("Invalid reset request.");
    }
    const user = rows[0];
    if (!user.password_reset_token_hash || user.password_reset_token_hash !== tokenHash || !user.password_reset_expires_at || new Date(user.password_reset_expires_at).getTime() < Date.now()) {
      throw new ValidationError("Invalid or expired password reset code.");
    }
    await conn.execute(
      `UPDATE users
       SET password_hash = ?,
           password_reset_token_hash = NULL,
           password_reset_expires_at = NULL,
           failed_login_attempts = 0,
           locked_until = NULL
       WHERE id = ?`,
      [newPasswordHash, user.id]
    );
    await conn.execute("UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = ?", [user.id]);
    await recordAuditLog({
      actorUserId: Number(user.id),
      action: "PASSWORD_RESET_COMPLETED",
      targetType: "user",
      targetId: Number(user.id),
      ipAddress: params.ipAddress,
      conn
    });
  });
}
async function hasAnySuperAdmin() {
  const rows = await queryRows(
    "SELECT id FROM users WHERE role = 'super_admin' LIMIT 1"
  );
  return rows.length > 0;
}

// server/services/gamificationService.ts
function calculateLevelFromXp(totalXp) {
  const safeXp = Math.max(0, totalXp);
  return Math.floor(Math.sqrt(safeXp / 100)) + 1;
}
function xpRangeForLevel(level) {
  const lvl = Math.max(1, level);
  return {
    currentLevelMinXp: (lvl - 1) * (lvl - 1) * 100,
    nextLevelMinXp: lvl * lvl * 100
  };
}
async function awardXpInTransaction(conn, params) {
  if (params.points <= 0) {
    const [rows] = await conn.execute(
      "SELECT total_xp, current_level FROM user_profiles WHERE user_id = ?",
      [params.userId]
    );
    return {
      awarded: false,
      newTotalXp: Number(rows[0]?.total_xp ?? 0),
      newLevel: Number(rows[0]?.current_level ?? 1)
    };
  }
  const [existing] = await conn.execute(
    "SELECT id FROM xp_transactions WHERE idempotency_key = ? LIMIT 1",
    [params.idempotencyKey]
  );
  if (existing.length > 0) {
    const [rows] = await conn.execute(
      "SELECT total_xp, current_level FROM user_profiles WHERE user_id = ?",
      [params.userId]
    );
    return {
      awarded: false,
      newTotalXp: Number(rows[0]?.total_xp ?? 0),
      newLevel: Number(rows[0]?.current_level ?? 1)
    };
  }
  await conn.execute(
    `INSERT INTO xp_transactions (user_id, source_type, source_id, idempotency_key, points, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      params.userId,
      params.sourceType,
      params.sourceId,
      params.idempotencyKey,
      params.points,
      params.description
    ]
  );
  await conn.execute(
    "UPDATE user_profiles SET total_xp = total_xp + ? WHERE user_id = ?",
    [params.points, params.userId]
  );
  const [profileRows] = await conn.execute(
    "SELECT total_xp FROM user_profiles WHERE user_id = ?",
    [params.userId]
  );
  const newTotalXp = Number(profileRows[0]?.total_xp ?? 0);
  const newLevel = calculateLevelFromXp(newTotalXp);
  await conn.execute(
    "UPDATE user_profiles SET current_level = ? WHERE user_id = ?",
    [newLevel, params.userId]
  );
  return { awarded: true, newTotalXp, newLevel };
}
async function updateChallengeStreakInTransaction(conn, userId) {
  const [rows] = await conn.execute(
    `SELECT current_streak, longest_streak, last_challenge_date, CURDATE() AS today_date,
            DATEDIFF(CURDATE(), last_challenge_date) AS days_diff
     FROM user_profiles
     WHERE user_id = ?
     FOR UPDATE`,
    [userId]
  );
  if (rows.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }
  const row = rows[0];
  let currentStreak = Number(row.current_streak || 0);
  let longestStreak = Number(row.longest_streak || 0);
  const daysDiff = row.days_diff === null ? null : Number(row.days_diff);
  if (daysDiff === null || daysDiff > 1) {
    currentStreak = 1;
  } else if (daysDiff === 1) {
    currentStreak += 1;
  } else if (daysDiff === 0 && currentStreak === 0) {
    currentStreak = 1;
  }
  if (currentStreak > longestStreak) {
    longestStreak = currentStreak;
  }
  await conn.execute(
    `UPDATE user_profiles
     SET current_streak = ?, longest_streak = ?, last_challenge_date = CURDATE()
     WHERE user_id = ?`,
    [currentStreak, longestStreak, userId]
  );
  return { currentStreak, longestStreak };
}
async function evaluateAndUnlockAchievementsInTransaction(conn, userId) {
  const [profileRows] = await conn.execute(
    "SELECT total_xp, current_streak FROM user_profiles WHERE user_id = ?",
    [userId]
  );
  const profile = profileRows[0];
  if (!profile) return [];
  const [[chCountRow]] = await conn.execute(
    "SELECT COUNT(*) AS cnt FROM challenge_submissions WHERE user_id = ?",
    [userId]
  );
  const [[courseCountRow]] = await conn.execute(
    "SELECT COUNT(*) AS cnt FROM course_enrollments WHERE user_id = ? AND status = 'completed'",
    [userId]
  );
  const [[postCountRow]] = await conn.execute(
    "SELECT COUNT(*) AS cnt FROM creative_posts WHERE user_id = ? AND moderation_status != 'removed'",
    [userId]
  );
  const metrics = {
    challenges_completed: Number(chCountRow?.cnt ?? 0),
    streak_days: Number(profile.current_streak ?? 0),
    courses_completed: Number(courseCountRow?.cnt ?? 0),
    posts_created: Number(postCountRow?.cnt ?? 0),
    total_xp: Number(profile.total_xp ?? 0)
  };
  const [eligible] = await conn.execute(
    `SELECT a.*
     FROM achievements a
     LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ?
     WHERE a.is_active = 1 AND ua.id IS NULL`,
    [userId]
  );
  const unlocked = [];
  for (const ach of eligible) {
    const metricVal = metrics[String(ach.rule_type)] ?? 0;
    if (metricVal >= Number(ach.rule_threshold)) {
      await conn.execute(
        "INSERT IGNORE INTO user_achievements (user_id, achievement_id) VALUES (?, ?)",
        [userId, ach.id]
      );
      const bonus = Number(ach.xp_bonus || 0);
      if (bonus > 0) {
        await awardXpInTransaction(conn, {
          userId,
          sourceType: "achievement_bonus",
          sourceId: Number(ach.id),
          idempotencyKey: `achievement:${userId}:${ach.id}`,
          points: bonus,
          description: `Achievement unlocked: ${ach.title_en}`
        });
      }
      await conn.execute(
        `INSERT INTO notifications (user_id, type, title_text, body_text, link_url)
         VALUES (?, 'achievement', ?, ?, '/profile')`,
        [
          userId,
          `Achievement unlocked: ${ach.title_en}`,
          `You earned the ${ach.title_en} badge (+${bonus} XP).`
        ]
      );
      unlocked.push({
        slug: String(ach.slug),
        titleEn: String(ach.title_en),
        xpBonus: bonus
      });
    }
  }
  return unlocked;
}

// server/services/challengeService.ts
async function listChallengeCategories() {
  return queryRows(
    "SELECT id, slug, name_en, name_rw, name_fr, description_en, description_rw, description_fr FROM challenge_categories WHERE is_active = 1 ORDER BY sort_order ASC"
  );
}
async function listChallenges(params) {
  const conditions = ["c.status = 'published'"];
  const values = [];
  if (params.categorySlug) {
    conditions.push("cat.slug = ?");
    values.push(params.categorySlug);
  }
  if (params.difficulty) {
    conditions.push("c.difficulty = ?");
    values.push(params.difficulty);
  }
  if (params.challengeType) {
    conditions.push("c.challenge_type = ?");
    values.push(params.challengeType);
  }
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push("(c.title_en LIKE ? OR c.title_rw LIKE ? OR c.title_fr LIKE ? OR c.description_en LIKE ?)");
    values.push(q, q, q, q);
  }
  const userSubJoin = params.userId ? "LEFT JOIN challenge_submissions cs ON cs.challenge_id = c.id AND cs.user_id = ?" : "";
  const queryParams = params.userId ? [params.userId, ...values] : values;
  const rows = await queryRows(
    `SELECT
       c.id, c.slug, c.title_en, c.title_rw, c.title_fr,
       c.description_en, c.description_rw, c.description_fr,
       c.difficulty, c.challenge_type, c.time_limit_seconds, c.xp_reward,
       c.active_date, c.is_featured, c.is_sample,
       cat.slug AS category_slug, cat.name_en AS category_name_en, cat.name_rw AS category_name_rw, cat.name_fr AS category_name_fr,
       (SELECT COUNT(*) FROM challenge_questions q WHERE q.challenge_id = c.id) AS question_count
       ${params.userId ? ", cs.id AS submission_id, cs.score AS user_score, cs.max_score AS user_max_score, cs.xp_awarded AS user_xp_awarded, cs.submitted_at AS user_submitted_at" : ""}
     FROM challenges c
     INNER JOIN challenge_categories cat ON cat.id = c.category_id
     ${userSubJoin}
     WHERE ${conditions.join(" AND ")}
     ORDER BY c.is_featured DESC, c.created_at DESC`,
    queryParams
  );
  return rows;
}
async function getChallengeDetail(slug, userId) {
  const rows = await queryRows(
    `SELECT
       c.id, c.slug, c.title_en, c.title_rw, c.title_fr,
       c.description_en, c.description_rw, c.description_fr,
       c.difficulty, c.challenge_type, c.time_limit_seconds, c.xp_reward,
       c.active_date, c.is_featured, c.is_sample,
       cat.slug AS category_slug, cat.name_en AS category_name_en, cat.name_rw AS category_name_rw, cat.name_fr AS category_name_fr
     FROM challenges c
     INNER JOIN challenge_categories cat ON cat.id = c.category_id
     WHERE c.slug = ? AND c.status = 'published'
     LIMIT 1`,
    [slug]
  );
  if (rows.length === 0) {
    throw new NotFoundError("Challenge not found.");
  }
  const challenge = rows[0];
  let userSubmission = null;
  if (userId) {
    const subs = await queryRows(
      "SELECT * FROM challenge_submissions WHERE challenge_id = ? AND user_id = ? LIMIT 1",
      [challenge.id, userId]
    );
    if (subs.length > 0) {
      userSubmission = subs[0];
    }
  }
  const questionsRaw = await queryRows(
    `SELECT id, prompt_en, prompt_rw, prompt_fr, options_json, points_weight, sort_order
            ${userSubmission ? ", correct_option_index, explanation_en, explanation_rw, explanation_fr" : ""}
     FROM challenge_questions
     WHERE challenge_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [challenge.id]
  );
  const questions = questionsRaw.map((q) => ({
    ...q,
    options: typeof q.options_json === "string" ? JSON.parse(q.options_json) : q.options_json
  }));
  return {
    challenge,
    questions,
    userSubmission: userSubmission ? {
      ...userSubmission,
      answers: typeof userSubmission.answers_json === "string" ? JSON.parse(userSubmission.answers_json) : userSubmission.answers_json
    } : null
  };
}
function evaluateChallengeAnswers(questions, submittedAnswers, challengeXpReward) {
  const answerMap = new Map(submittedAnswers.map((a) => [a.questionId, a.selectedOptionIndex]));
  let score = 0;
  let maxScore = 0;
  let correctCount = 0;
  const breakdown = questions.map((q) => {
    const selected = answerMap.get(q.id) ?? -1;
    const isCorrect = selected === q.correctOptionIndex;
    maxScore += q.pointsWeight;
    if (isCorrect) {
      score += q.pointsWeight;
      correctCount += 1;
    }
    return {
      questionId: q.id,
      selectedOptionIndex: selected,
      correctOptionIndex: q.correctOptionIndex,
      isCorrect,
      explanationEn: q.explanationEn,
      explanationRw: q.explanationRw,
      explanationFr: q.explanationFr
    };
  });
  const ratio = maxScore > 0 ? score / maxScore : 0;
  const xpAwarded = Math.max(Math.round(challengeXpReward * 0.25), Math.round(challengeXpReward * ratio));
  return {
    score,
    maxScore,
    correctCount,
    totalQuestions: questions.length,
    xpAwarded,
    breakdown
  };
}
async function submitChallengeAttempt(params) {
  return withTransaction(async (conn) => {
    const [chRows] = await conn.execute(
      "SELECT id, title_en, xp_reward, time_limit_seconds FROM challenges WHERE slug = ? AND status = 'published' LIMIT 1",
      [params.slug]
    );
    if (chRows.length === 0) {
      throw new NotFoundError("Challenge not found.");
    }
    const challenge = chRows[0];
    const [existingSub] = await conn.execute(
      "SELECT id FROM challenge_submissions WHERE challenge_id = ? AND user_id = ? LIMIT 1",
      [challenge.id, params.userId]
    );
    if (existingSub.length > 0) {
      throw new ConflictError("You have already submitted an attempt for this challenge.");
    }
    const [qRows] = await conn.execute(
      `SELECT id, correct_option_index, points_weight, explanation_en, explanation_rw, explanation_fr
       FROM challenge_questions
       WHERE challenge_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [challenge.id]
    );
    if (qRows.length === 0) {
      throw new ValidationError("This challenge does not have questions yet.");
    }
    const evaluation = evaluateChallengeAnswers(
      qRows.map((q) => ({
        id: Number(q.id),
        correctOptionIndex: Number(q.correct_option_index),
        pointsWeight: Number(q.points_weight),
        explanationEn: String(q.explanation_en),
        explanationRw: String(q.explanation_rw),
        explanationFr: String(q.explanation_fr)
      })),
      params.answers,
      Number(challenge.xp_reward)
    );
    await conn.execute(
      `INSERT INTO challenge_submissions
        (challenge_id, user_id, answers_json, score, max_score, correct_count, total_questions, duration_seconds, xp_awarded)
       VALUES (?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?)`,
      [
        challenge.id,
        params.userId,
        JSON.stringify(params.answers),
        evaluation.score,
        evaluation.maxScore,
        evaluation.correctCount,
        evaluation.totalQuestions,
        Math.min(params.durationSeconds, Number(challenge.time_limit_seconds) + 60),
        evaluation.xpAwarded
      ]
    );
    const xpRes = await awardXpInTransaction(conn, {
      userId: params.userId,
      sourceType: "challenge_completion",
      sourceId: Number(challenge.id),
      idempotencyKey: `challenge:${params.userId}:${challenge.id}`,
      points: evaluation.xpAwarded,
      description: `Completed challenge: ${challenge.title_en}`
    });
    const streakRes = await updateChallengeStreakInTransaction(conn, params.userId);
    const unlockedAchievements = await evaluateAndUnlockAchievementsInTransaction(conn, params.userId);
    return {
      ...evaluation,
      newTotalXp: xpRes.newTotalXp,
      newLevel: xpRes.newLevel,
      currentStreak: streakRes.currentStreak,
      unlockedAchievements
    };
  });
}
async function getLeaderboard(period) {
  let dateCondition = "";
  if (period === "daily") {
    dateCondition = "AND xt.created_at >= CURDATE()";
  } else if (period === "weekly") {
    dateCondition = "AND xt.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
  } else if (period === "monthly") {
    dateCondition = "AND xt.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)";
  }
  if (period === "all") {
    return queryRows(
      `SELECT
         p.user_id, p.display_name, p.username, p.avatar_url, p.district,
         p.total_xp AS period_xp, p.current_level, p.current_streak
       FROM user_profiles p
       INNER JOIN users u ON u.id = p.user_id
       WHERE u.status = 'active' AND p.profile_visibility != 'private'
       ORDER BY p.total_xp DESC, p.current_streak DESC
       LIMIT 25`
    );
  }
  return queryRows(
    `SELECT
       p.user_id, p.display_name, p.username, p.avatar_url, p.district,
       COALESCE(SUM(xt.points), 0) AS period_xp, p.current_level, p.current_streak
     FROM xp_transactions xt
     INNER JOIN user_profiles p ON p.user_id = xt.user_id
     INNER JOIN users u ON u.id = xt.user_id
     WHERE u.status = 'active' AND p.profile_visibility != 'private' ${dateCondition}
     GROUP BY p.user_id, p.display_name, p.username, p.avatar_url, p.district, p.current_level, p.current_streak
     ORDER BY period_xp DESC
     LIMIT 25`
  );
}

// server/services/communityService.ts
async function listPosts(params) {
  const conditions = ["p.moderation_status = 'approved'"];
  const values = [];
  if (params.postType) {
    conditions.push("p.post_type = ?");
    values.push(params.postType);
  }
  if (params.category) {
    conditions.push("p.category = ?");
    values.push(params.category);
  }
  if (params.groupId) {
    conditions.push("p.group_id = ?");
    values.push(params.groupId);
  }
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push("(p.title LIKE ? OR p.body LIKE ?)");
    values.push(q, q);
  }
  if (params.viewerUserId) {
    conditions.push(
      "p.user_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)"
    );
    values.push(params.viewerUserId);
  }
  const limit = Math.min(50, Math.max(1, params.limit ?? 20));
  const offset = Math.max(0, params.offset ?? 0);
  const viewerReactSelect = params.viewerUserId ? ", (SELECT reaction_type FROM post_reactions pr WHERE pr.post_id = p.id AND pr.user_id = ? LIMIT 1) AS user_reaction" : "";
  const queryParams = params.viewerUserId ? [params.viewerUserId, ...values, limit, offset] : [...values, limit, offset];
  return queryRows(
    `SELECT
       p.id, p.user_id, p.group_id, p.post_type, p.category, p.title, p.body,
       p.media_url, p.likes_count, p.comments_count, p.is_sample, p.created_at,
       up.display_name AS author_name, up.username AS author_username, up.avatar_url AS author_avatar,
       g.name AS group_name
       ${viewerReactSelect}
     FROM creative_posts p
     INNER JOIN user_profiles up ON up.user_id = p.user_id
     INNER JOIN users u ON u.id = p.user_id
     LEFT JOIN community_groups g ON g.id = p.group_id
     WHERE u.status = 'active' AND ${conditions.join(" AND ")}
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    queryParams
  );
}
async function createPost(params) {
  return withTransaction(async (conn) => {
    if (params.groupId) {
      const [gRows] = await conn.execute(
        "SELECT id FROM community_groups WHERE id = ? AND status = 'active' LIMIT 1",
        [params.groupId]
      );
      if (gRows.length === 0) {
        throw new NotFoundError("Group not found.");
      }
    }
    const [res] = await conn.execute(
      `INSERT INTO creative_posts
        (user_id, group_id, post_type, category, title, body, media_url, media_mime, moderation_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      [
        params.userId,
        params.groupId ?? null,
        params.postType,
        params.category,
        params.title,
        params.body,
        params.mediaUrl ?? null,
        params.mediaMime ?? null
      ]
    );
    const postId = Number(res.insertId);
    const [[todayPosts]] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM xp_transactions WHERE user_id = ? AND source_type = ? AND created_at >= CURDATE()",
      [params.userId, "community_post"]
    );
    if (Number(todayPosts?.cnt ?? 0) < 3) {
      await awardXpInTransaction(conn, {
        userId: params.userId,
        sourceType: "community_post",
        sourceId: postId,
        idempotencyKey: `post:${params.userId}:${postId}`,
        points: 15,
        description: `Published community post: ${params.title}`
      });
    }
    await evaluateAndUnlockAchievementsInTransaction(conn, params.userId);
    return { id: postId };
  });
}
async function togglePostReaction(params) {
  return withTransaction(async (conn) => {
    const [posts] = await conn.execute(
      "SELECT id FROM creative_posts WHERE id = ? AND moderation_status = 'approved' LIMIT 1",
      [params.postId]
    );
    if (posts.length === 0) {
      throw new NotFoundError("Post not found.");
    }
    const [existing] = await conn.execute(
      "SELECT id, reaction_type FROM post_reactions WHERE post_id = ? AND user_id = ? LIMIT 1",
      [params.postId, params.userId]
    );
    let activeReaction = params.reactionType;
    if (existing.length > 0 && existing[0].reaction_type === params.reactionType) {
      await conn.execute("DELETE FROM post_reactions WHERE id = ?", [existing[0].id]);
      activeReaction = null;
    } else if (existing.length > 0) {
      await conn.execute("UPDATE post_reactions SET reaction_type = ? WHERE id = ?", [
        params.reactionType,
        existing[0].id
      ]);
    } else {
      await conn.execute(
        "INSERT INTO post_reactions (post_id, user_id, reaction_type) VALUES (?, ?, ?)",
        [params.postId, params.userId, params.reactionType]
      );
    }
    const [[cntRow]] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM post_reactions WHERE post_id = ?",
      [params.postId]
    );
    const likesCount = Number(cntRow?.cnt ?? 0);
    await conn.execute("UPDATE creative_posts SET likes_count = ? WHERE id = ?", [
      likesCount,
      params.postId
    ]);
    return { likesCount, activeReaction };
  });
}
async function listComments(postId, viewerUserId) {
  const blockFilter = viewerUserId ? "AND c.user_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)" : "";
  const params = viewerUserId ? [postId, viewerUserId] : [postId];
  return queryRows(
    `SELECT c.id, c.post_id, c.user_id, c.body, c.created_at,
            up.display_name AS author_name, up.username AS author_username, up.avatar_url AS author_avatar
     FROM post_comments c
     INNER JOIN user_profiles up ON up.user_id = c.user_id
     WHERE c.post_id = ? AND c.moderation_status = 'visible' ${blockFilter}
     ORDER BY c.created_at ASC`,
    params
  );
}
async function addComment(params) {
  return withTransaction(async (conn) => {
    const [posts] = await conn.execute(
      "SELECT id, user_id, title FROM creative_posts WHERE id = ? AND moderation_status = 'approved' LIMIT 1",
      [params.postId]
    );
    if (posts.length === 0) {
      throw new NotFoundError("Post not found.");
    }
    const [res] = await conn.execute(
      "INSERT INTO post_comments (post_id, user_id, body, moderation_status) VALUES (?, ?, ?, 'visible')",
      [params.postId, params.userId, params.body]
    );
    const [[cntRow]] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM post_comments WHERE post_id = ? AND moderation_status = 'visible'",
      [params.postId]
    );
    await conn.execute("UPDATE creative_posts SET comments_count = ? WHERE id = ?", [
      Number(cntRow?.cnt ?? 0),
      params.postId
    ]);
    const postOwnerId = Number(posts[0].user_id);
    if (postOwnerId !== params.userId) {
      await conn.execute(
        `INSERT INTO notifications (user_id, type, title_text, body_text, link_url)
         VALUES (?, 'comment', 'New comment on your post', ?, '/connect')`,
        [postOwnerId, `Someone commented on "${posts[0].title}".`]
      );
    }
    return { id: Number(res.insertId), commentsCount: Number(cntRow?.cnt ?? 0) };
  });
}
async function listGroups(viewerUserId) {
  const memberJoin = viewerUserId ? "LEFT JOIN group_memberships gm ON gm.group_id = g.id AND gm.user_id = ?" : "";
  const params = viewerUserId ? [viewerUserId] : [];
  return queryRows(
    `SELECT g.* ${viewerUserId ? ", (gm.id IS NOT NULL) AS is_member" : ""}
     FROM community_groups g
     ${memberJoin}
     WHERE g.status = 'active'
     ORDER BY g.member_count DESC, g.created_at DESC`,
    params
  );
}
async function createGroup(params) {
  const baseSlug = params.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 70);
  const slug = `${baseSlug || "group"}-${Date.now().toString(36)}`;
  return withTransaction(async (conn) => {
    const [res] = await conn.execute(
      `INSERT INTO community_groups (slug, name, description, category, created_by, is_private, member_count, status)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'active')`,
      [slug, params.name, params.description, params.category, params.userId, params.isPrivate ? 1 : 0]
    );
    const groupId = Number(res.insertId);
    await conn.execute(
      "INSERT INTO group_memberships (group_id, user_id, role) VALUES (?, ?, 'moderator')",
      [groupId, params.userId]
    );
    return { id: groupId, slug };
  });
}
async function toggleGroupMembership(groupId, userId) {
  return withTransaction(async (conn) => {
    const [gRows] = await conn.execute(
      "SELECT id FROM community_groups WHERE id = ? AND status = 'active' LIMIT 1",
      [groupId]
    );
    if (gRows.length === 0) {
      throw new NotFoundError("Group not found.");
    }
    const [existing] = await conn.execute(
      "SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ? LIMIT 1",
      [groupId, userId]
    );
    let joined = false;
    if (existing.length > 0) {
      await conn.execute("DELETE FROM group_memberships WHERE id = ?", [existing[0].id]);
      joined = false;
    } else {
      await conn.execute(
        "INSERT INTO group_memberships (group_id, user_id, role) VALUES (?, ?, 'member')",
        [groupId, userId]
      );
      joined = true;
    }
    const [[cntRow]] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM group_memberships WHERE group_id = ?",
      [groupId]
    );
    const memberCount = Number(cntRow?.cnt ?? 0);
    await conn.execute("UPDATE community_groups SET member_count = ? WHERE id = ?", [
      memberCount,
      groupId
    ]);
    return { joined, memberCount };
  });
}
async function toggleFollowUser(followerId, targetUserId) {
  if (followerId === targetUserId) {
    throw new ForbiddenError("You cannot follow yourself.");
  }
  return withTransaction(async (conn) => {
    const [existing] = await conn.execute(
      "SELECT id FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1",
      [followerId, targetUserId]
    );
    if (existing.length > 0) {
      await conn.execute("DELETE FROM user_follows WHERE id = ?", [existing[0].id]);
      return { following: false };
    }
    await conn.execute("INSERT INTO user_follows (follower_id, following_id) VALUES (?, ?)", [
      followerId,
      targetUserId
    ]);
    return { following: true };
  });
}
async function blockUser(blockerId, blockedId, reason) {
  if (blockerId === blockedId) {
    throw new ForbiddenError("You cannot block yourself.");
  }
  await withTransaction(async (conn) => {
    await conn.execute(
      "INSERT IGNORE INTO user_blocks (blocker_id, blocked_id, reason) VALUES (?, ?, ?)",
      [blockerId, blockedId, reason ?? null]
    );
    await conn.execute(
      "DELETE FROM user_follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)",
      [blockerId, blockedId, blockedId, blockerId]
    );
  });
}
async function unblockUser(blockerId, blockedId) {
  await queryRows("DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?", [
    blockerId,
    blockedId
  ]);
}
async function createContentReport(params) {
  return withTransaction(async (conn) => {
    const [dup] = await conn.execute(
      "SELECT id FROM content_reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status IN ('open', 'reviewing') LIMIT 1",
      [params.reporterId, params.targetType, params.targetId]
    );
    if (dup.length > 0) {
      throw new ConflictError("You have already submitted an active report for this item.");
    }
    const [res] = await conn.execute(
      `INSERT INTO content_reports (reporter_id, target_type, target_id, reason, details, status)
       VALUES (?, ?, ?, ?, ?, 'open')`,
      [params.reporterId, params.targetType, params.targetId, params.reason, params.details ?? null]
    );
    return { id: Number(res.insertId) };
  });
}

// server/services/learnService.ts
async function listCourseCategories() {
  return queryRows(
    "SELECT id, slug, name_en, name_rw, name_fr, description_en, description_rw, description_fr FROM course_categories WHERE is_active = 1 ORDER BY sort_order ASC"
  );
}
async function listCourses(params) {
  const conditions = ["c.status = 'published'"];
  const values = [];
  if (params.categorySlug) {
    conditions.push("cat.slug = ?");
    values.push(params.categorySlug);
  }
  if (params.level) {
    conditions.push("c.level = ?");
    values.push(params.level);
  }
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push("(c.title_en LIKE ? OR c.title_rw LIKE ? OR c.title_fr LIKE ? OR c.summary_en LIKE ?)");
    values.push(q, q, q, q);
  }
  const enrollJoin = params.userId ? "LEFT JOIN course_enrollments ce ON ce.course_id = c.id AND ce.user_id = ?" : "";
  const queryParams = params.userId ? [params.userId, ...values] : values;
  return queryRows(
    `SELECT
       c.id, c.slug, c.title_en, c.title_rw, c.title_fr,
       c.summary_en, c.summary_rw, c.summary_fr,
       c.level, c.estimated_minutes, c.xp_reward, c.is_sample,
       cat.slug AS category_slug, cat.name_en AS category_name_en, cat.name_rw AS category_name_rw, cat.name_fr AS category_name_fr,
       (SELECT COUNT(*) FROM course_lessons cl WHERE cl.course_id = c.id) AS lesson_count
       ${params.userId ? ", ce.status AS enrollment_status, ce.progress_percent AS enrollment_progress" : ""}
     FROM courses c
     INNER JOIN course_categories cat ON cat.id = c.category_id
     ${enrollJoin}
     WHERE ${conditions.join(" AND ")}
     ORDER BY c.created_at DESC`,
    queryParams
  );
}
async function getCourseDetail(slug, userId) {
  const rows = await queryRows(
    `SELECT
       c.*, cat.slug AS category_slug, cat.name_en AS category_name_en, cat.name_rw AS category_name_rw, cat.name_fr AS category_name_fr
     FROM courses c
     INNER JOIN course_categories cat ON cat.id = c.category_id
     WHERE c.slug = ? AND c.status = 'published'
     LIMIT 1`,
    [slug]
  );
  if (rows.length === 0) {
    throw new NotFoundError("Course not found.");
  }
  const course = rows[0];
  const modules = await queryRows(
    "SELECT * FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC, id ASC",
    [course.id]
  );
  const lessonsRaw = await queryRows(
    "SELECT * FROM course_lessons WHERE course_id = ? ORDER BY sort_order ASC, id ASC",
    [course.id]
  );
  let enrollment = null;
  let completedLessonIds = /* @__PURE__ */ new Set();
  if (userId) {
    const enrollRows = await queryRows(
      "SELECT * FROM course_enrollments WHERE course_id = ? AND user_id = ? LIMIT 1",
      [course.id, userId]
    );
    if (enrollRows.length > 0) {
      enrollment = enrollRows[0];
      const progressRows = await queryRows(
        "SELECT lesson_id FROM lesson_progress WHERE enrollment_id = ? AND completed = 1",
        [enrollment.id]
      );
      completedLessonIds = new Set(progressRows.map((r) => Number(r.lesson_id)));
    }
  }
  const lessons = lessonsRaw.map((l) => {
    const assessment = l.assessment_question_json && typeof l.assessment_question_json === "string" ? JSON.parse(l.assessment_question_json) : l.assessment_question_json;
    const isCompleted = completedLessonIds.has(Number(l.id));
    return {
      id: Number(l.id),
      moduleId: Number(l.module_id),
      titleEn: l.title_en,
      titleRw: l.title_rw,
      titleFr: l.title_fr,
      contentEn: l.content_en,
      contentRw: l.content_rw,
      contentFr: l.content_fr,
      durationMinutes: Number(l.duration_minutes),
      xpReward: Number(l.xp_reward),
      sortOrder: Number(l.sort_order),
      completed: isCompleted,
      assessment: assessment ? {
        question: assessment.question,
        options: assessment.options,
        ...isCompleted ? { correctIndex: assessment.correctIndex, explanation: assessment.explanation } : {}
      } : null
    };
  });
  return { course, modules, lessons, enrollment };
}
async function enrollInCourse(slug, userId) {
  return withTransaction(async (conn) => {
    const [courses] = await conn.execute(
      "SELECT id, title_en FROM courses WHERE slug = ? AND status = 'published' LIMIT 1",
      [slug]
    );
    if (courses.length === 0) {
      throw new NotFoundError("Course not found.");
    }
    const course = courses[0];
    await conn.execute(
      `INSERT IGNORE INTO course_enrollments (course_id, user_id, status, progress_percent)
       VALUES (?, ?, 'enrolled', 0)`,
      [course.id, userId]
    );
    const [enrollRows] = await conn.execute(
      "SELECT * FROM course_enrollments WHERE course_id = ? AND user_id = ? LIMIT 1",
      [course.id, userId]
    );
    return enrollRows[0];
  });
}
async function completeLesson(params) {
  return withTransaction(async (conn) => {
    const [courseRows] = await conn.execute(
      "SELECT id, title_en, xp_reward FROM courses WHERE slug = ? AND status = 'published' LIMIT 1",
      [params.slug]
    );
    if (courseRows.length === 0) {
      throw new NotFoundError("Course not found.");
    }
    const course = courseRows[0];
    const [lessonRows] = await conn.execute(
      "SELECT * FROM course_lessons WHERE id = ? AND course_id = ? LIMIT 1",
      [params.lessonId, course.id]
    );
    if (lessonRows.length === 0) {
      throw new NotFoundError("Lesson not found in this course.");
    }
    const lesson = lessonRows[0];
    await conn.execute(
      `INSERT IGNORE INTO course_enrollments (course_id, user_id, status, progress_percent)
       VALUES (?, ?, 'enrolled', 0)`,
      [course.id, params.userId]
    );
    const [enrollRows] = await conn.execute(
      "SELECT * FROM course_enrollments WHERE course_id = ? AND user_id = ? LIMIT 1",
      [course.id, params.userId]
    );
    const enrollment = enrollRows[0];
    const assessment = lesson.assessment_question_json && typeof lesson.assessment_question_json === "string" ? JSON.parse(lesson.assessment_question_json) : lesson.assessment_question_json;
    let assessmentPassed = true;
    let explanation;
    if (assessment && Array.isArray(assessment.options) && assessment.options.length > 0) {
      if (params.selectedOptionIndex === void 0) {
        throw new ValidationError("Please select an answer to the lesson check question.");
      }
      assessmentPassed = params.selectedOptionIndex === Number(assessment.correctIndex);
      explanation = assessment.explanation;
      if (!assessmentPassed) {
        return {
          passed: false,
          explanation,
          xpAwarded: 0,
          courseCompleted: false,
          progressPercent: Number(enrollment.progress_percent)
        };
      }
    }
    await conn.execute(
      `INSERT IGNORE INTO lesson_progress
        (enrollment_id, lesson_id, user_id, completed, assessment_passed, assessment_score)
       VALUES (?, ?, ?, 1, 1, 100)`,
      [enrollment.id, lesson.id, params.userId]
    );
    const lessonXpRes = await awardXpInTransaction(conn, {
      userId: params.userId,
      sourceType: "lesson_completion",
      sourceId: Number(lesson.id),
      idempotencyKey: `lesson:${params.userId}:${lesson.id}`,
      points: Number(lesson.xp_reward || 20),
      description: `Completed lesson: ${lesson.title_en}`
    });
    const [[totalRow]] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM course_lessons WHERE course_id = ?",
      [course.id]
    );
    const [[doneRow]] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM lesson_progress WHERE enrollment_id = ? AND completed = 1",
      [enrollment.id]
    );
    const totalLessons = Number(totalRow?.cnt ?? 1);
    const doneLessons = Number(doneRow?.cnt ?? 0);
    const progressPercent = Math.min(100, Math.round(doneLessons / Math.max(1, totalLessons) * 100));
    const isNowComplete = doneLessons >= totalLessons;
    await conn.execute(
      `UPDATE course_enrollments
       SET progress_percent = ?,
           status = ?,
           completed_at = ${isNowComplete ? "COALESCE(completed_at, NOW())" : "NULL"}
       WHERE id = ?`,
      [progressPercent, isNowComplete ? "completed" : "enrolled", enrollment.id]
    );
    let courseXpAwarded = 0;
    if (isNowComplete) {
      const courseXpRes = await awardXpInTransaction(conn, {
        userId: params.userId,
        sourceType: "course_completion",
        sourceId: Number(course.id),
        idempotencyKey: `course:${params.userId}:${course.id}`,
        points: Number(course.xp_reward || 100),
        description: `Completed course: ${course.title_en}`
      });
      if (courseXpRes.awarded) {
        courseXpAwarded = Number(course.xp_reward || 100);
      }
    }
    const unlockedAchievements = await evaluateAndUnlockAchievementsInTransaction(conn, params.userId);
    return {
      passed: true,
      explanation,
      xpAwarded: (lessonXpRes.awarded ? Number(lesson.xp_reward || 20) : 0) + courseXpAwarded,
      courseCompleted: isNowComplete,
      progressPercent,
      unlockedAchievements
    };
  });
}

// server/services/opportunityService.ts
async function listOpportunityCategories() {
  return queryRows(
    "SELECT id, slug, name_en, name_rw, name_fr FROM opportunity_categories ORDER BY sort_order ASC"
  );
}
async function listOpportunities(params) {
  const conditions = ["o.approval_status = 'approved'"];
  const values = [];
  if (params.type) {
    conditions.push("o.opportunity_type = ?");
    values.push(params.type);
  }
  if (params.categorySlug) {
    conditions.push("cat.slug = ?");
    values.push(params.categorySlug);
  }
  if (params.remoteOnly) {
    conditions.push("o.is_remote = 1");
  }
  if (params.verifiedOnly) {
    conditions.push("o.verified_status = 'verified'");
  }
  if (!params.includeExpired) {
    conditions.push("(o.deadline_at IS NULL OR o.deadline_at >= NOW())");
  }
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push("(o.title LIKE ? OR o.organization_name LIKE ? OR o.summary LIKE ? OR o.location LIKE ?)");
    values.push(q, q, q, q);
  }
  const savedJoin = params.userId ? "LEFT JOIN saved_opportunities so ON so.opportunity_id = o.id AND so.user_id = ?" : "";
  const queryParams = params.userId ? [params.userId, ...values] : values;
  const rows = await queryRows(
    `SELECT
       o.*,
       (o.deadline_at IS NOT NULL AND o.deadline_at < NOW()) AS is_expired,
       cat.slug AS category_slug, cat.name_en AS category_name_en, cat.name_rw AS category_name_rw, cat.name_fr AS category_name_fr
       ${params.userId ? ", (so.id IS NOT NULL) AS is_saved" : ""}
     FROM opportunities o
     INNER JOIN opportunity_categories cat ON cat.id = o.category_id
     ${savedJoin}
     WHERE ${conditions.join(" AND ")}
     ORDER BY o.is_featured DESC, o.deadline_at IS NULL ASC, o.deadline_at ASC, o.created_at DESC`,
    queryParams
  );
  return rows;
}
async function submitOpportunity(params) {
  return withTransaction(async (conn) => {
    const [res] = await conn.execute(
      `INSERT INTO opportunities
        (category_id, opportunity_type, title, organization_name, location, is_remote, summary, eligibility, application_url, deadline_at, approval_status, verified_status, submitted_by, approved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.categoryId,
        params.opportunityType,
        params.title,
        params.organizationName,
        params.location,
        params.isRemote ? 1 : 0,
        params.summary,
        params.eligibility,
        params.applicationUrl,
        params.deadlineAt || null,
        params.autoApprove ? "approved" : "pending",
        params.autoApprove ? "verified" : "unverified",
        params.userId,
        params.autoApprove ? params.userId : null
      ]
    );
    return { id: Number(res.insertId), status: params.autoApprove ? "approved" : "pending" };
  });
}
async function toggleSavedOpportunity(opportunityId, userId) {
  return withTransaction(async (conn) => {
    const [opps] = await conn.execute(
      "SELECT id FROM opportunities WHERE id = ? LIMIT 1",
      [opportunityId]
    );
    if (opps.length === 0) {
      throw new NotFoundError("Opportunity not found.");
    }
    const [existing] = await conn.execute(
      "SELECT id FROM saved_opportunities WHERE opportunity_id = ? AND user_id = ? LIMIT 1",
      [opportunityId, userId]
    );
    if (existing.length > 0) {
      await conn.execute("DELETE FROM saved_opportunities WHERE id = ?", [existing[0].id]);
      return { saved: false };
    }
    await conn.execute("INSERT INTO saved_opportunities (opportunity_id, user_id) VALUES (?, ?)", [
      opportunityId,
      userId
    ]);
    return { saved: true };
  });
}

// server/services/dashboardService.ts
async function getUnifiedDashboard(userId) {
  const [challenges, courses, posts, opportunities, announcements] = await Promise.all([
    listChallenges({ userId }),
    listCourses({ userId }),
    listPosts({ viewerUserId: userId, limit: 4 }),
    listOpportunities({ userId }),
    queryRows(
      `SELECT id, title_en, title_rw, title_fr, body_en, body_rw, body_fr, audience, created_at
       FROM announcements
       WHERE is_active = 1
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at >= NOW())
       ORDER BY created_at DESC
       LIMIT 3`
    )
  ]);
  const featuredChallenge = challenges.find((c) => c.is_featured) || challenges[0] || null;
  const recommendedCourses = courses.slice(0, 3);
  const featuredOpportunities = opportunities.slice(0, 4);
  let userSummary = null;
  let recentAchievements = [];
  if (userId) {
    const [chDone] = await queryRows(
      "SELECT COUNT(*) AS cnt FROM challenge_submissions WHERE user_id = ?",
      [userId]
    );
    const [coursesDone] = await queryRows(
      "SELECT COUNT(*) AS cnt FROM course_enrollments WHERE user_id = ? AND status = 'completed'",
      [userId]
    );
    const [coursesActive] = await queryRows(
      "SELECT COUNT(*) AS cnt FROM course_enrollments WHERE user_id = ? AND status = 'enrolled'",
      [userId]
    );
    const [postsDone] = await queryRows(
      "SELECT COUNT(*) AS cnt FROM creative_posts WHERE user_id = ? AND moderation_status != 'removed'",
      [userId]
    );
    const [savedOpps] = await queryRows(
      "SELECT COUNT(*) AS cnt FROM saved_opportunities WHERE user_id = ?",
      [userId]
    );
    userSummary = {
      challengesCompleted: Number(chDone?.cnt ?? 0),
      coursesCompleted: Number(coursesDone?.cnt ?? 0),
      coursesInProgress: Number(coursesActive?.cnt ?? 0),
      postsCreated: Number(postsDone?.cnt ?? 0),
      savedOpportunities: Number(savedOpps?.cnt ?? 0)
    };
    recentAchievements = await queryRows(
      `SELECT a.slug, a.title_en, a.title_rw, a.title_fr, a.badge_tier, a.icon_name, ua.unlocked_at
       FROM user_achievements ua
       INNER JOIN achievements a ON a.id = ua.achievement_id
       WHERE ua.user_id = ?
       ORDER BY ua.unlocked_at DESC
       LIMIT 6`,
      [userId]
    );
  }
  return {
    featuredChallenge,
    recommendedCourses,
    recentCommunityActivity: posts,
    featuredOpportunities,
    announcements,
    userSummary,
    recentAchievements
  };
}

// server/services/notificationService.ts
async function listNotifications(userId, limit = 30) {
  const rows = await queryRows(
    `SELECT id, type, title_text, body_text, link_url, is_read, read_at, created_at
     FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, Math.min(100, limit)]
  );
  const [unreadRow] = await queryRows(
    "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0",
    [userId]
  );
  return {
    notifications: rows,
    unreadCount: Number(unreadRow?.cnt ?? 0)
  };
}
async function markNotificationRead(userId, notificationId) {
  await executeSql(
    "UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ?",
    [notificationId, userId]
  );
}
async function markAllNotificationsRead(userId) {
  await executeSql(
    "UPDATE notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0",
    [userId]
  );
}
async function getNotificationPreferences(userId) {
  const rows = await queryRows(
    "SELECT * FROM notification_preferences WHERE user_id = ? LIMIT 1",
    [userId]
  );
  if (rows.length === 0) {
    return {
      challengeReminders: true,
      learningUpdates: true,
      communityActivity: true,
      opportunityAlerts: true,
      announcements: true
    };
  }
  const r = rows[0];
  return {
    challengeReminders: Boolean(r.challenge_reminders),
    learningUpdates: Boolean(r.learning_updates),
    communityActivity: Boolean(r.community_activity),
    opportunityAlerts: Boolean(r.opportunity_alerts),
    announcements: Boolean(r.announcements)
  };
}
async function updateNotificationPreferences(userId, prefs) {
  await executeSql(
    `INSERT INTO notification_preferences
      (user_id, challenge_reminders, learning_updates, community_activity, opportunity_alerts, announcements)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      challenge_reminders = VALUES(challenge_reminders),
      learning_updates = VALUES(learning_updates),
      community_activity = VALUES(community_activity),
      opportunity_alerts = VALUES(opportunity_alerts),
      announcements = VALUES(announcements)`,
    [
      userId,
      prefs.challengeReminders ? 1 : 0,
      prefs.learningUpdates ? 1 : 0,
      prefs.communityActivity ? 1 : 0,
      prefs.opportunityAlerts ? 1 : 0,
      prefs.announcements ? 1 : 0
    ]
  );
}

// server/services/profileService.ts
function parseJsonArray(val) {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}
async function getUserProfileByUsername(username, viewerUserId) {
  const rows = await queryRows(
    `SELECT
       u.id, u.role, u.status, u.age_group, u.preferred_language, u.contact_verified, u.created_at,
       p.display_name, p.username, p.avatar_url, p.bio, p.district,
       p.interests_json, p.skills_json, p.profile_visibility, p.show_activity,
       p.total_xp, p.current_level, p.current_streak, p.longest_streak
     FROM users u
     INNER JOIN user_profiles p ON p.user_id = u.id
     WHERE p.username = ?
     LIMIT 1`,
    [username.toLowerCase()]
  );
  if (rows.length === 0) {
    throw new NotFoundError("User profile not found.");
  }
  const row = rows[0];
  const targetUserId = Number(row.id);
  const isOwner = viewerUserId === targetUserId;
  if (row.profile_visibility === "private" && !isOwner) {
    throw new ForbiddenError("This profile is private.");
  }
  if (row.profile_visibility === "community" && !viewerUserId) {
    throw new ForbiddenError("Sign in to view community member profiles.");
  }
  const achievements = await queryRows(
    `SELECT a.slug, a.title_en, a.title_rw, a.title_fr, a.description_en, a.description_rw, a.description_fr,
            a.icon_name, a.badge_tier, a.xp_bonus, ua.unlocked_at
     FROM user_achievements ua
     INNER JOIN achievements a ON a.id = ua.achievement_id
     WHERE ua.user_id = ?
     ORDER BY ua.unlocked_at DESC`,
    [targetUserId]
  );
  const showActivity = isOwner || Boolean(row.show_activity);
  const challengeHistory = showActivity ? await queryRows(
    `SELECT cs.id, cs.score, cs.max_score, cs.correct_count, cs.total_questions, cs.xp_awarded, cs.submitted_at,
                c.slug, c.title_en, c.title_rw, c.title_fr
         FROM challenge_submissions cs
         INNER JOIN challenges c ON c.id = cs.challenge_id
         WHERE cs.user_id = ?
         ORDER BY cs.submitted_at DESC
         LIMIT 20`,
    [targetUserId]
  ) : [];
  const learningProgress = showActivity ? await queryRows(
    `SELECT ce.status, ce.progress_percent, ce.enrolled_at, ce.completed_at,
                c.slug, c.title_en, c.title_rw, c.title_fr
         FROM course_enrollments ce
         INNER JOIN courses c ON c.id = ce.course_id
         WHERE ce.user_id = ?
         ORDER BY ce.enrolled_at DESC`,
    [targetUserId]
  ) : [];
  const xpHistory = isOwner ? await queryRows(
    `SELECT id, source_type, points, description, created_at
         FROM xp_transactions
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 30`,
    [targetUserId]
  ) : [];
  const savedOpportunities = isOwner ? await queryRows(
    `SELECT o.id, o.title, o.organization_name, o.opportunity_type, o.location, o.deadline_at, o.application_url
         FROM saved_opportunities so
         INNER JOIN opportunities o ON o.id = so.opportunity_id
         WHERE so.user_id = ?
         ORDER BY so.created_at DESC`,
    [targetUserId]
  ) : [];
  const blockedUsers = isOwner ? await queryRows(
    `SELECT ub.blocked_id, up.display_name, up.username, ub.created_at
         FROM user_blocks ub
         INNER JOIN user_profiles up ON up.user_id = ub.blocked_id
         WHERE ub.blocker_id = ?`,
    [targetUserId]
  ) : [];
  const [followerRow] = await queryRows(
    "SELECT COUNT(*) AS cnt FROM user_follows WHERE following_id = ?",
    [targetUserId]
  );
  const [followingRow] = await queryRows(
    "SELECT COUNT(*) AS cnt FROM user_follows WHERE follower_id = ?",
    [targetUserId]
  );
  let isFollowing = false;
  if (viewerUserId && !isOwner) {
    const fRows = await queryRows(
      "SELECT id FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1",
      [viewerUserId, targetUserId]
    );
    isFollowing = fRows.length > 0;
  }
  const levelBounds = xpRangeForLevel(Number(row.current_level));
  return {
    profile: {
      id: targetUserId,
      role: row.role,
      ageGroup: row.age_group,
      preferredLanguage: row.preferred_language,
      contactVerified: Boolean(row.contact_verified),
      createdAt: row.created_at,
      displayName: row.display_name,
      username: row.username,
      avatarUrl: row.avatar_url,
      bio: row.bio || "",
      district: row.district || "",
      interests: parseJsonArray(row.interests_json),
      skills: parseJsonArray(row.skills_json),
      profileVisibility: row.profile_visibility,
      showActivity: Boolean(row.show_activity),
      totalXp: Number(row.total_xp),
      currentLevel: Number(row.current_level),
      currentStreak: Number(row.current_streak),
      longestStreak: Number(row.longest_streak),
      levelProgress: levelBounds,
      followersCount: Number(followerRow?.cnt ?? 0),
      followingCount: Number(followingRow?.cnt ?? 0),
      isFollowing,
      isOwner
    },
    achievements,
    challengeHistory,
    learningProgress,
    xpHistory,
    savedOpportunities,
    blockedUsers
  };
}
async function updateOwnProfile(userId, data) {
  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE user_profiles
       SET display_name = ?, bio = ?, district = ?,
           interests_json = CAST(? AS JSON),
           skills_json = CAST(? AS JSON),
           profile_visibility = ?,
           show_activity = ?
       WHERE user_id = ?`,
      [
        data.displayName,
        data.bio,
        data.district || null,
        JSON.stringify(data.interests),
        JSON.stringify(data.skills),
        data.profileVisibility,
        data.showActivity ? 1 : 0,
        userId
      ]
    );
    if (data.preferredLanguage) {
      await conn.execute("UPDATE users SET preferred_language = ? WHERE id = ?", [
        data.preferredLanguage,
        userId
      ]);
    }
  });
}
async function updateUserAvatar(userId, avatarUrl) {
  await queryRows("UPDATE user_profiles SET avatar_url = ? WHERE user_id = ?", [avatarUrl, userId]);
}
async function updateUserLanguage(userId, language) {
  await queryRows("UPDATE users SET preferred_language = ? WHERE id = ?", [language, userId]);
}

// server/uploads.ts
import { Storage } from "@google-cloud/storage";
import crypto3 from "crypto";
import fs2 from "fs";
import multer from "multer";
import path2 from "path";
var ALLOWED_IMAGE_MIMES = /* @__PURE__ */ new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
var ALLOWED_FOLDERS = /* @__PURE__ */ new Set(["posts", "avatars"]);
var SAFE_FILENAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,160}\.(jpg|png|webp)$/;
var MIME_BY_EXTENSION = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};
var uploadImageMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: appConfig.maxUploadBytes,
    files: 1
  },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_IMAGE_MIMES.has(file.mimetype.toLowerCase())) {
      cb(new ValidationError("Only JPEG, PNG, and WebP images are supported"));
      return;
    }
    cb(null, true);
  }
});
function detectImageExtensionFromMagicBytes(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
    return "jpg";
  }
  if (buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71 && buffer[4] === 13 && buffer[5] === 10 && buffer[6] === 26 && buffer[7] === 10) {
    return "png";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }
  return null;
}
function assertMimeMatchesDetectedExtension(declaredMime, detectedExt) {
  const normalizedDeclared = declaredMime.toLowerCase() === "image/jpg" ? "image/jpeg" : declaredMime.toLowerCase();
  const expectedMime = MIME_BY_EXTENSION[detectedExt];
  if (normalizedDeclared !== expectedMime) {
    throw new ValidationError(
      `Uploaded file MIME type (${declaredMime}) does not match actual ${detectedExt.toUpperCase()} file signature.`
    );
  }
}
function sanitizeMediaCoordinates(folderRaw, filenameRaw) {
  if (!ALLOWED_FOLDERS.has(folderRaw)) {
    throw new ValidationError("Invalid media folder");
  }
  if (!filenameRaw || filenameRaw.includes("..") || filenameRaw.includes("/") || filenameRaw.includes("\\") || !SAFE_FILENAME_REGEX.test(filenameRaw)) {
    throw new ValidationError("Invalid media filename");
  }
  const folder = folderRaw;
  return {
    folder,
    filename: filenameRaw,
    relativeKey: `${folder}/${filenameRaw}`
  };
}
function buildGcsObjectKey(relativeKey, prefix = appConfig.gcsKeyPrefix) {
  const cleanRelative = relativeKey.replace(/^\/+/, "");
  const cleanPrefix = prefix.trim().replace(/^\/+|\/+$/g, "");
  return cleanPrefix ? `${cleanPrefix}/${cleanRelative}` : cleanRelative;
}
function generateSafeMediaUrl(options) {
  const { folder, filename } = sanitizeMediaCoordinates(options.folder, options.filename);
  const visibility = options.visibility ?? "community";
  const driver = options.driver ?? appConfig.uploadStorageDriver;
  const publicBase = (options.gcsPublicBaseUrl ?? appConfig.gcsPublicBaseUrl).trim().replace(/\/+$/, "");
  if (driver === "gcs" && visibility === "public" && publicBase) {
    try {
      const parsed = new URL(publicBase);
      if (parsed.protocol === "https:") {
        const objectKey = buildGcsObjectKey(`${folder}/${filename}`);
        return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}/${objectKey}`;
      }
    } catch {
    }
  }
  return `/api/v1/media/${folder}/${filename}`;
}
var LocalDiskStorageProvider = class {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.driver = "local";
  }
  resolveSafeLocalPath(relativeKey) {
    const [folder, filename] = relativeKey.split("/");
    const sanitized = sanitizeMediaCoordinates(folder, filename);
    const resolvedBase = path2.resolve(this.baseDir);
    const resolvedTarget = path2.resolve(resolvedBase, sanitized.folder, sanitized.filename);
    if (!resolvedTarget.startsWith(`${resolvedBase}${path2.sep}`)) {
      throw new ValidationError("Invalid upload path");
    }
    return resolvedTarget;
  }
  async saveObject(params) {
    const fullPath = this.resolveSafeLocalPath(params.relativeKey);
    await fs2.promises.mkdir(path2.dirname(fullPath), { recursive: true });
    await fs2.promises.writeFile(fullPath, params.buffer);
  }
  async openReadStream(relativeKey) {
    const fullPath = this.resolveSafeLocalPath(relativeKey);
    if (!fs2.existsSync(fullPath)) {
      return null;
    }
    const ext = path2.extname(fullPath).slice(1).toLowerCase();
    const contentType = MIME_BY_EXTENSION[ext] || "application/octet-stream";
    return {
      stream: fs2.createReadStream(fullPath),
      contentType
    };
  }
};
var GcsStorageProvider = class {
  constructor(bucketName, keyPrefix) {
    this.bucketName = bucketName;
    this.keyPrefix = keyPrefix;
    this.driver = "gcs";
    this.storageClient = null;
  }
  getBucket() {
    if (!this.bucketName) {
      throw new ValidationError("GCS_BUCKET_NAME is not configured for GCS upload storage.");
    }
    if (!this.storageClient) {
      this.storageClient = new Storage();
    }
    return this.storageClient.bucket(this.bucketName);
  }
  async saveObject(params) {
    const objectKey = buildGcsObjectKey(params.relativeKey, this.keyPrefix);
    const file = this.getBucket().file(objectKey);
    await file.save(params.buffer, {
      resumable: false,
      contentType: params.contentType,
      metadata: {
        contentType: params.contentType,
        contentDisposition: "inline",
        cacheControl: params.visibility === "public" ? "public, max-age=86400" : "private, max-age=300"
      }
    });
  }
  async openReadStream(relativeKey) {
    const objectKey = buildGcsObjectKey(relativeKey, this.keyPrefix);
    const file = this.getBucket().file(objectKey);
    const [exists] = await file.exists();
    if (!exists) {
      return null;
    }
    const [meta] = await file.getMetadata();
    const ext = path2.extname(relativeKey).slice(1).toLowerCase();
    const contentType = meta.contentType || MIME_BY_EXTENSION[ext] || "application/octet-stream";
    return {
      stream: file.createReadStream(),
      contentType
    };
  }
  async getSignedReadUrl(relativeKey, ttlSeconds) {
    const objectKey = buildGcsObjectKey(relativeKey, this.keyPrefix);
    const file = this.getBucket().file(objectKey);
    const [exists] = await file.exists();
    if (!exists) {
      throw new NotFoundError("Media object not found");
    }
    const [signedUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + ttlSeconds * 1e3,
      responseDisposition: "inline"
    });
    return signedUrl;
  }
};
function createUploadStorageProvider(config = appConfig) {
  if (config.uploadStorageDriver === "gcs") {
    return new GcsStorageProvider(config.gcsBucketName, config.gcsKeyPrefix);
  }
  return new LocalDiskStorageProvider(config.uploadDir);
}
async function saveValidatedUploadedImage(file, subFolder, visibility = "community", provider = createUploadStorageProvider()) {
  const detectedExt = detectImageExtensionFromMagicBytes(file.buffer);
  if (!detectedExt) {
    throw new ValidationError("Invalid image file signature. Upload a genuine JPEG, PNG, or WebP.");
  }
  assertMimeMatchesDetectedExtension(file.mimetype, detectedExt);
  const safeName = `${Date.now()}-${crypto3.randomBytes(12).toString("hex")}.${detectedExt}`;
  const relativeKey = `${subFolder}/${safeName}`;
  const mime = MIME_BY_EXTENSION[detectedExt];
  await provider.saveObject({
    relativeKey,
    buffer: file.buffer,
    contentType: mime,
    visibility
  });
  const url = generateSafeMediaUrl({
    folder: subFolder,
    filename: safeName,
    visibility,
    driver: provider.driver
  });
  return {
    url,
    mime,
    storageKey: relativeKey,
    driver: provider.driver
  };
}
async function authorizeMediaAccess(input) {
  if (!isDatabaseConfigured()) {
    return { visibility: "public" };
  }
  const canonicalUrl = `/api/v1/media/${input.folder}/${input.filename}`;
  const legacyUrl = `/uploads/${input.folder}/${input.filename}`;
  const isStaff = input.viewerRole === "moderator" || input.viewerRole === "admin" || input.viewerRole === "super_admin";
  if (input.folder === "posts") {
    const rows = await queryRows(
      `SELECT p.user_id, p.moderation_status, p.group_id, g.is_private
         FROM creative_posts p
         LEFT JOIN community_groups g ON g.id = p.group_id
        WHERE p.media_url = ? OR p.media_url = ?
        LIMIT 1`,
      [canonicalUrl, legacyUrl]
    );
    if (rows.length === 0) {
      throw new NotFoundError("Media attachment not found");
    }
    const row = rows[0];
    const isOwner2 = Boolean(input.viewerUserId && Number(row.user_id) === input.viewerUserId);
    if (row.moderation_status !== "approved" && !isOwner2 && !isStaff) {
      throw new ForbiddenError("This post image is not publicly available.");
    }
    if (Boolean(row.is_private) && !isOwner2 && !isStaff) {
      if (!input.viewerUserId) {
        throw new UnauthorizedError("Authentication required to view private group media.");
      }
      const memberRows = await queryRows(
        "SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ? LIMIT 1",
        [row.group_id, input.viewerUserId]
      );
      if (memberRows.length === 0) {
        throw new ForbiddenError("Only members of this private group can view this media.");
      }
      return { visibility: "private" };
    }
    return { visibility: row.moderation_status === "approved" ? "public" : "private" };
  }
  const profileRows = await queryRows(
    `SELECT user_id, profile_visibility
       FROM user_profiles
      WHERE avatar_url = ? OR avatar_url = ?
      LIMIT 1`,
    [canonicalUrl, legacyUrl]
  );
  if (profileRows.length === 0) {
    throw new NotFoundError("Avatar not found");
  }
  const profile = profileRows[0];
  const isOwner = Boolean(input.viewerUserId && Number(profile.user_id) === input.viewerUserId);
  const visibility = String(profile.profile_visibility);
  if (visibility === "private" && !isOwner && !isStaff) {
    throw new ForbiddenError("This profile avatar is private.");
  }
  if (visibility === "community" && !input.viewerUserId && !isStaff) {
    throw new UnauthorizedError("Sign in to view community-only member avatars.");
  }
  return { visibility };
}

// server/routes/v1.ts
function asyncHandler(fn) {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
function createV1Router() {
  const router = Router();
  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "levelup-rwanda",
      databaseConfigured: isDatabaseConfigured(),
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  router.get(
    "/ready",
    asyncHandler(async (_req, res) => {
      const db = await pingDatabase();
      if (!db.connected) {
        res.status(503).json({
          ok: false,
          ready: false,
          database: db
        });
        return;
      }
      res.json({
        ok: true,
        ready: true,
        database: db
      });
    })
  );
  router.get(
    "/media/:folder/:filename",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const { folder, filename, relativeKey } = sanitizeMediaCoordinates(
        String(req.params.folder || ""),
        String(req.params.filename || "")
      );
      const { visibility } = await authorizeMediaAccess({
        folder,
        filename,
        viewerUserId: req.user?.id,
        viewerRole: req.user?.role
      });
      const provider = createUploadStorageProvider();
      if (provider.driver === "gcs" && appConfig.gcsDeliveryMode === "signed_url" && provider.getSignedReadUrl) {
        const signedUrl = await provider.getSignedReadUrl(
          relativeKey,
          appConfig.gcsSignedUrlTtlSeconds
        );
        res.setHeader(
          "Cache-Control",
          visibility === "public" ? "public, max-age=60" : "private, no-store"
        );
        res.redirect(302, signedUrl);
        return;
      }
      const object = await provider.openReadStream(relativeKey);
      if (!object) {
        throw new NotFoundError("Media file not found");
      }
      res.setHeader("Content-Type", object.contentType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "inline");
      res.setHeader(
        "Cache-Control",
        visibility === "public" ? "public, max-age=86400" : "private, max-age=300"
      );
      object.stream.on("error", () => {
        if (!res.headersSent) {
          res.status(500).end();
        }
      });
      object.stream.pipe(res);
    })
  );
  router.get(
    "/auth/me",
    optionalAuth,
    asyncHandler(async (req, res) => {
      let superAdminExists = false;
      if (isDatabaseConfigured()) {
        try {
          superAdminExists = await hasAnySuperAdmin();
        } catch {
          superAdminExists = false;
        }
      }
      res.json({
        ok: true,
        data: {
          user: req.user || null,
          superAdminExists,
          databaseConfigured: isDatabaseConfigured()
        }
      });
    })
  );
  router.post(
    "/auth/register",
    authRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = registerSchema.parse(req.body);
      const result = await registerUser({
        ...parsed,
        ipAddress: req.ip
      });
      res.status(201).json({
        ok: true,
        data: result
      });
    })
  );
  router.post(
    "/auth/login",
    authRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = loginSchema.parse(req.body);
      const { sessionToken, userId } = await loginUser({
        identifier: parsed.identifier,
        password: parsed.password,
        ipAddress: req.ip,
        userAgent: req.get("user-agent")
      });
      res.cookie(SESSION_COOKIE_NAME, sessionToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: appConfig.cookieSecure,
        path: "/",
        maxAge: appConfig.sessionTtlHours * 60 * 60 * 1e3
      });
      res.json({
        ok: true,
        data: { userId }
      });
    })
  );
  router.post(
    "/auth/logout",
    authenticateSession,
    asyncHandler(async (req, res) => {
      if (req.sessionId && req.user) {
        await logoutSession(req.sessionId, req.user.id, req.ip);
      }
      res.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        sameSite: "lax",
        secure: appConfig.cookieSecure,
        path: "/"
      });
      res.json({ ok: true, data: { loggedOut: true } });
    })
  );
  router.post(
    "/auth/verify-contact",
    authRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = verifyContactSchema.parse(req.body);
      await verifyUserContact(parsed.identifier, parsed.code);
      res.json({ ok: true, data: { verified: true } });
    })
  );
  router.post(
    "/auth/password-reset/request",
    authRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = requestPasswordResetSchema.parse(req.body);
      const result = await requestPasswordReset(parsed.identifier, req.ip);
      res.json({ ok: true, data: result });
    })
  );
  router.post(
    "/auth/password-reset/confirm",
    authRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = confirmPasswordResetSchema.parse(req.body);
      await confirmPasswordReset({
        ...parsed,
        ipAddress: req.ip
      });
      res.json({ ok: true, data: { reset: true } });
    })
  );
  router.post(
    "/auth/bootstrap-admin",
    authRateLimiter,
    asyncHandler(async (req, res) => {
      if (!appConfig.adminBootstrapToken) {
        throw new ForbiddenError(
          "ADMIN_BOOTSTRAP_TOKEN is not configured in server environment variables."
        );
      }
      const parsed = bootstrapAdminSchema.parse(req.body);
      if (!timingSafeEqualsString(parsed.bootstrapToken, appConfig.adminBootstrapToken)) {
        throw new ForbiddenError("Invalid administrator bootstrap token.");
      }
      const created = await provisionFirstSuperAdmin({
        email: parsed.email,
        displayName: parsed.displayName,
        username: parsed.username,
        password: parsed.password,
        ipAddress: req.ip
      });
      res.status(201).json({ ok: true, data: created });
    })
  );
  router.get(
    "/dashboard",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const data = await getUnifiedDashboard(req.user?.id);
      res.json({ ok: true, data });
    })
  );
  router.get(
    "/challenges/categories",
    asyncHandler(async (_req, res) => {
      const categories = await listChallengeCategories();
      res.json({ ok: true, data: categories });
    })
  );
  router.get(
    "/challenges/leaderboard",
    asyncHandler(async (req, res) => {
      const periodRaw = String(req.query.period || "weekly");
      const period = ["daily", "weekly", "monthly", "all"].includes(periodRaw) ? periodRaw : "weekly";
      const rows = await getLeaderboard(period);
      res.json({ ok: true, data: rows });
    })
  );
  router.get(
    "/challenges",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const challenges = await listChallenges({
        categorySlug: req.query.category ? String(req.query.category) : void 0,
        difficulty: req.query.difficulty ? String(req.query.difficulty) : void 0,
        challengeType: req.query.type ? String(req.query.type) : void 0,
        search: req.query.q ? String(req.query.q) : void 0,
        userId: req.user?.id
      });
      res.json({ ok: true, data: challenges });
    })
  );
  router.get(
    "/challenges/:slug",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const detail = await getChallengeDetail(String(req.params.slug), req.user?.id);
      res.json({ ok: true, data: detail });
    })
  );
  router.post(
    "/challenges/:slug/submit",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const parsed = challengeSubmissionSchema.parse(req.body);
      const result = await submitChallengeAttempt({
        slug: String(req.params.slug),
        userId: req.user.id,
        answers: parsed.answers,
        durationSeconds: parsed.durationSeconds
      });
      res.status(201).json({ ok: true, data: result });
    })
  );
  router.get(
    "/courses/categories",
    asyncHandler(async (_req, res) => {
      const categories = await listCourseCategories();
      res.json({ ok: true, data: categories });
    })
  );
  router.get(
    "/courses",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const courses = await listCourses({
        categorySlug: req.query.category ? String(req.query.category) : void 0,
        level: req.query.level ? String(req.query.level) : void 0,
        search: req.query.q ? String(req.query.q) : void 0,
        userId: req.user?.id
      });
      res.json({ ok: true, data: courses });
    })
  );
  router.get(
    "/courses/:slug",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const detail = await getCourseDetail(String(req.params.slug), req.user?.id);
      res.json({ ok: true, data: detail });
    })
  );
  router.post(
    "/courses/:slug/enroll",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const enrollment = await enrollInCourse(String(req.params.slug), req.user.id);
      res.status(201).json({ ok: true, data: enrollment });
    })
  );
  router.post(
    "/courses/:slug/lessons/:lessonId/complete",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const lessonId = Number.parseInt(String(req.params.lessonId), 10);
      if (!Number.isFinite(lessonId) || lessonId <= 0) {
        throw new ValidationError("Invalid lesson ID");
      }
      const parsed = lessonCompletionSchema.parse(req.body || {});
      const result = await completeLesson({
        slug: String(req.params.slug),
        lessonId,
        userId: req.user.id,
        selectedOptionIndex: parsed.selectedOptionIndex
      });
      res.json({ ok: true, data: result });
    })
  );
  router.get(
    "/community/posts",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const postTypeRaw = req.query.postType ? String(req.query.postType) : void 0;
      const postType = postTypeRaw === "create_showcase" || postTypeRaw === "discussion" ? postTypeRaw : void 0;
      const posts = await listPosts({
        postType,
        category: req.query.category ? String(req.query.category) : void 0,
        groupId: req.query.groupId ? Number.parseInt(String(req.query.groupId), 10) : void 0,
        search: req.query.q ? String(req.query.q) : void 0,
        viewerUserId: req.user?.id,
        limit: req.query.limit ? Number.parseInt(String(req.query.limit), 10) : 20,
        offset: req.query.offset ? Number.parseInt(String(req.query.offset), 10) : 0
      });
      res.json({ ok: true, data: posts });
    })
  );
  router.post(
    "/community/posts",
    authenticateSession,
    uploadRateLimiter,
    uploadImageMiddleware.single("image"),
    asyncHandler(async (req, res) => {
      const parsed = createPostSchema.parse({
        postType: req.body.postType || "create_showcase",
        category: req.body.category,
        title: req.body.title,
        body: req.body.body,
        groupId: req.body.groupId ? Number.parseInt(String(req.body.groupId), 10) : null
      });
      let mediaUrl = null;
      let mediaMime = null;
      if (req.file) {
        const saved = await saveValidatedUploadedImage(
          req.file,
          "posts",
          parsed.groupId ? "community" : "public"
        );
        mediaUrl = saved.url;
        mediaMime = saved.mime;
      }
      const created = await createPost({
        userId: req.user.id,
        postType: parsed.postType,
        category: parsed.category,
        title: parsed.title,
        body: parsed.body,
        groupId: parsed.groupId,
        mediaUrl,
        mediaMime
      });
      res.status(201).json({ ok: true, data: created });
    })
  );
  router.post(
    "/community/posts/:postId/react",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const postId = Number.parseInt(String(req.params.postId), 10);
      if (!Number.isFinite(postId) || postId <= 0) throw new ValidationError("Invalid post ID");
      const reactionRaw = String(req.body?.reactionType || "like");
      const reactionType = ["like", "celebrate", "helpful"].includes(reactionRaw) ? reactionRaw : "like";
      const result = await togglePostReaction({ postId, userId: req.user.id, reactionType });
      res.json({ ok: true, data: result });
    })
  );
  router.get(
    "/community/posts/:postId/comments",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const postId = Number.parseInt(String(req.params.postId), 10);
      if (!Number.isFinite(postId) || postId <= 0) throw new ValidationError("Invalid post ID");
      const comments = await listComments(postId, req.user?.id);
      res.json({ ok: true, data: comments });
    })
  );
  router.post(
    "/community/posts/:postId/comments",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const postId = Number.parseInt(String(req.params.postId), 10);
      if (!Number.isFinite(postId) || postId <= 0) throw new ValidationError("Invalid post ID");
      const parsed = createCommentSchema.parse(req.body);
      const result = await addComment({ postId, userId: req.user.id, body: parsed.body });
      res.status(201).json({ ok: true, data: result });
    })
  );
  router.get(
    "/community/groups",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const groups = await listGroups(req.user?.id);
      res.json({ ok: true, data: groups });
    })
  );
  router.post(
    "/community/groups",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const parsed = createGroupSchema.parse(req.body);
      const created = await createGroup({
        userId: req.user.id,
        ...parsed
      });
      res.status(201).json({ ok: true, data: created });
    })
  );
  router.post(
    "/community/groups/:groupId/toggle-join",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const groupId = Number.parseInt(String(req.params.groupId), 10);
      if (!Number.isFinite(groupId) || groupId <= 0) throw new ValidationError("Invalid group ID");
      const result = await toggleGroupMembership(groupId, req.user.id);
      res.json({ ok: true, data: result });
    })
  );
  router.post(
    "/community/users/:userId/follow",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const targetUserId = Number.parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
        throw new ValidationError("Invalid user ID");
      }
      const result = await toggleFollowUser(req.user.id, targetUserId);
      res.json({ ok: true, data: result });
    })
  );
  router.post(
    "/community/users/:userId/block",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const targetUserId = Number.parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
        throw new ValidationError("Invalid user ID");
      }
      await blockUser(req.user.id, targetUserId, req.body?.reason);
      res.json({ ok: true, data: { blocked: true } });
    })
  );
  router.delete(
    "/community/users/:userId/block",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const targetUserId = Number.parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
        throw new ValidationError("Invalid user ID");
      }
      await unblockUser(req.user.id, targetUserId);
      res.json({ ok: true, data: { blocked: false } });
    })
  );
  router.post(
    "/community/reports",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const parsed = reportContentSchema.parse(req.body);
      const created = await createContentReport({
        reporterId: req.user.id,
        ...parsed
      });
      res.status(201).json({ ok: true, data: created });
    })
  );
  router.get(
    "/opportunities/categories",
    asyncHandler(async (_req, res) => {
      const categories = await listOpportunityCategories();
      res.json({ ok: true, data: categories });
    })
  );
  router.get(
    "/opportunities",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const opportunities = await listOpportunities({
        type: req.query.type ? String(req.query.type) : void 0,
        categorySlug: req.query.category ? String(req.query.category) : void 0,
        remoteOnly: req.query.remote === "true",
        verifiedOnly: req.query.verified === "true",
        includeExpired: req.query.includeExpired === "true",
        search: req.query.q ? String(req.query.q) : void 0,
        userId: req.user?.id
      });
      res.json({ ok: true, data: opportunities });
    })
  );
  router.post(
    "/opportunities",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const parsed = createOpportunitySchema.parse(req.body);
      const isAdmin = req.user.role === "admin" || req.user.role === "super_admin";
      const created = await submitOpportunity({
        userId: req.user.id,
        ...parsed,
        autoApprove: isAdmin
      });
      res.status(201).json({ ok: true, data: created });
    })
  );
  router.post(
    "/opportunities/:id/save",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const oppId = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(oppId) || oppId <= 0) {
        throw new ValidationError("Invalid opportunity ID");
      }
      const result = await toggleSavedOpportunity(oppId, req.user.id);
      res.json({ ok: true, data: result });
    })
  );
  router.get(
    "/profile/:username",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const profileData = await getUserProfileByUsername(String(req.params.username), req.user?.id);
      res.json({ ok: true, data: profileData });
    })
  );
  router.put(
    "/profile/me",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const parsed = updateProfileSchema.parse(req.body);
      await updateOwnProfile(req.user.id, parsed);
      res.json({ ok: true, data: { updated: true } });
    })
  );
  router.post(
    "/profile/me/avatar",
    authenticateSession,
    uploadRateLimiter,
    uploadImageMiddleware.single("avatar"),
    asyncHandler(async (req, res) => {
      if (!req.file) {
        throw new ValidationError("Select an image file to upload");
      }
      const saved = await saveValidatedUploadedImage(req.file, "avatars");
      await updateUserAvatar(req.user.id, saved.url);
      res.json({ ok: true, data: { avatarUrl: saved.url } });
    })
  );
  router.patch(
    "/profile/me/language",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const parsed = z2.object({ language: z2.enum(SUPPORTED_LANGUAGES) }).parse(req.body);
      await updateUserLanguage(req.user.id, parsed.language);
      res.json({ ok: true, data: { preferredLanguage: parsed.language } });
    })
  );
  router.get(
    "/notifications",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const data = await listNotifications(req.user.id);
      res.json({ ok: true, data });
    })
  );
  router.post(
    "/notifications/:id/read",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id) || id <= 0) throw new ValidationError("Invalid notification ID");
      await markNotificationRead(req.user.id, id);
      res.json({ ok: true, data: { read: true } });
    })
  );
  router.post(
    "/notifications/read-all",
    authenticateSession,
    asyncHandler(async (req, res) => {
      await markAllNotificationsRead(req.user.id);
      res.json({ ok: true, data: { readAll: true } });
    })
  );
  router.get(
    "/notifications/preferences",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const prefs = await getNotificationPreferences(req.user.id);
      res.json({ ok: true, data: prefs });
    })
  );
  router.put(
    "/notifications/preferences",
    authenticateSession,
    asyncHandler(async (req, res) => {
      const parsed = updateNotificationPrefsSchema.parse(req.body);
      await updateNotificationPreferences(req.user.id, parsed);
      res.json({ ok: true, data: parsed });
    })
  );
  const adminRouter = Router();
  adminRouter.use(authenticateSession);
  adminRouter.get(
    "/overview",
    requireRole("moderator", "educator", "admin", "super_admin"),
    asyncHandler(async (_req, res) => {
      const overview = await getAdminOverview();
      res.json({ ok: true, data: overview });
    })
  );
  adminRouter.get(
    "/users",
    requireRole("admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const users = await listUsersAdmin(req.query.q ? String(req.query.q) : void 0);
      res.json({ ok: true, data: users });
    })
  );
  adminRouter.patch(
    "/users/:userId",
    requireRole("admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const targetUserId = Number.parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
        throw new ValidationError("Invalid user ID");
      }
      const parsed = z2.object({
        role: z2.enum(USER_ROLES).optional(),
        status: z2.enum(["active", "suspended"]).optional()
      }).parse(req.body);
      await updateUserRoleOrStatusAdmin({
        actorUserId: req.user.id,
        actorRole: req.user.role,
        targetUserId,
        role: parsed.role,
        status: parsed.status,
        ipAddress: req.ip
      });
      res.json({ ok: true, data: { updated: true } });
    })
  );
  adminRouter.get(
    "/challenges",
    requireRole("educator", "admin", "super_admin"),
    asyncHandler(async (_req, res) => {
      const rows = await listAllChallengesAdmin();
      res.json({ ok: true, data: rows });
    })
  );
  adminRouter.post(
    "/challenges",
    requireRole("educator", "admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const parsed = adminCreateChallengeSchema.parse(req.body);
      const created = await createChallengeAdmin(req.user.id, parsed, req.ip);
      res.status(201).json({ ok: true, data: created });
    })
  );
  adminRouter.post(
    "/challenges/questions",
    requireRole("educator", "admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const parsed = adminCreateQuestionSchema.parse(req.body);
      const created = await addQuestionAdmin(req.user.id, parsed, req.ip);
      res.status(201).json({ ok: true, data: created });
    })
  );
  adminRouter.post(
    "/courses",
    requireRole("educator", "admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const parsed = adminCreateCourseSchema.parse(req.body);
      const created = await createCourseAdmin(req.user.id, parsed, req.ip);
      res.status(201).json({ ok: true, data: created });
    })
  );
  adminRouter.get(
    "/moderation",
    requireRole("moderator", "admin", "super_admin"),
    asyncHandler(async (_req, res) => {
      const queue = await listModerationQueueAdmin();
      res.json({ ok: true, data: queue });
    })
  );
  adminRouter.patch(
    "/moderation/posts/:postId",
    requireRole("moderator", "admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const postId = Number.parseInt(String(req.params.postId), 10);
      const parsed = z2.object({ status: z2.enum(["approved", "hidden", "removed"]) }).parse(req.body);
      await moderatePostAdmin(req.user.id, postId, parsed.status, req.ip);
      res.json({ ok: true, data: { updated: true } });
    })
  );
  adminRouter.patch(
    "/moderation/reports/:reportId",
    requireRole("moderator", "admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const reportId = Number.parseInt(String(req.params.reportId), 10);
      const parsed = z2.object({
        status: z2.enum(["reviewing", "resolved", "dismissed"]),
        resolutionNote: z2.string().max(500).optional()
      }).parse(req.body);
      await resolveReportAdmin(req.user.id, reportId, parsed.status, parsed.resolutionNote, req.ip);
      res.json({ ok: true, data: { updated: true } });
    })
  );
  adminRouter.get(
    "/opportunities",
    requireRole("admin", "super_admin"),
    asyncHandler(async (_req, res) => {
      const rows = await listAllOpportunitiesAdmin();
      res.json({ ok: true, data: rows });
    })
  );
  adminRouter.patch(
    "/opportunities/:id",
    requireRole("admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const oppId = Number.parseInt(String(req.params.id), 10);
      const parsed = z2.object({
        approvalStatus: z2.enum(["pending", "approved", "rejected", "expired"]).optional(),
        verifiedStatus: z2.enum(["unverified", "verified"]).optional()
      }).parse(req.body);
      await updateOpportunityStatusAdmin(req.user.id, oppId, parsed, req.ip);
      res.json({ ok: true, data: { updated: true } });
    })
  );
  adminRouter.get(
    "/organizations",
    requireRole("admin", "super_admin"),
    asyncHandler(async (_req, res) => {
      const rows = await listOrganizationsAdmin();
      res.json({ ok: true, data: rows });
    })
  );
  adminRouter.post(
    "/organizations",
    requireRole("admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const parsed = z2.object({
        name: z2.string().trim().min(2).max(140),
        orgType: z2.string().trim().min(2).max(64),
        websiteUrl: z2.string().trim().url().optional().or(z2.literal("")),
        description: z2.string().trim().max(1e3).optional(),
        verified: z2.boolean().default(true)
      }).parse(req.body);
      const created = await createOrganizationAdmin(req.user.id, parsed, req.ip);
      res.status(201).json({ ok: true, data: created });
    })
  );
  adminRouter.get(
    "/announcements",
    requireRole("admin", "super_admin"),
    asyncHandler(async (_req, res) => {
      const rows = await listAnnouncementsAdmin();
      res.json({ ok: true, data: rows });
    })
  );
  adminRouter.post(
    "/announcements",
    requireRole("admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const parsed = adminCreateAnnouncementSchema.parse(req.body);
      const created = await createAnnouncementAdmin(req.user.id, parsed, req.ip);
      res.status(201).json({ ok: true, data: created });
    })
  );
  adminRouter.get(
    "/audit-logs",
    requireRole("admin", "super_admin"),
    asyncHandler(async (_req, res) => {
      const rows = await listAuditLogsAdmin();
      res.json({ ok: true, data: rows });
    })
  );
  adminRouter.get(
    "/settings",
    requireRole("admin", "super_admin"),
    asyncHandler(async (_req, res) => {
      const rows = await listSettingsAdmin();
      res.json({ ok: true, data: rows });
    })
  );
  adminRouter.put(
    "/settings/:key",
    requireRole("super_admin"),
    asyncHandler(async (req, res) => {
      const key = String(req.params.key);
      await updateSettingAdmin(req.user.id, key, req.body?.value ?? {}, req.ip);
      res.json({ ok: true, data: { updated: true } });
    })
  );
  router.use("/admin", adminRouter);
  return router;
}

// server/app.ts
function createApiApp() {
  const app = express();
  if (appConfig.trustProxy) {
    app.set("trust proxy", 1);
  }
  app.use(createHelmetMiddleware());
  app.use(createCorsMiddleware());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(cookieParser());
  app.use(ensureCsrfCookie);
  if (appConfig.uploadStorageDriver === "local") {
    fs3.mkdirSync(appConfig.uploadDir, { recursive: true });
    app.use(
      "/uploads",
      (_req, res, next) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "public, max-age=86400");
        next();
      },
      express.static(appConfig.uploadDir)
    );
  }
  app.use("/api/v1", generalApiLimiter, verifyCsrfToken, createV1Router());
  app.use("/api", (_req, res) => {
    res.status(404).json({
      ok: false,
      error: { code: "NOT_FOUND", message: "API endpoint not found" }
    });
  });
  app.use(centralizedErrorHandler);
  return app;
}

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path3.dirname(__filename);
async function startServer() {
  assertValidProductionConfig(process.env);
  const app = createApiApp();
  if (appConfig.nodeEnv !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path3.resolve(__dirname, "dist");
    app.use(express2.static(distDir, { maxAge: "1d" }));
    app.get("*", (_req, res) => {
      res.sendFile(path3.join(distDir, "index.html"));
    });
  }
  const server = http.createServer(app);
  server.listen(appConfig.port, "0.0.0.0", () => {
    console.log(
      `[LEVELUP RWANDA] Server listening on http://0.0.0.0:${appConfig.port} (${appConfig.nodeEnv}) | MySQL configured: ${isDatabaseConfigured()}`
    );
  });
  const gracefulShutdown = async (signal) => {
    console.log(`[LEVELUP RWANDA] Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      await closePool();
      console.log("[LEVELUP RWANDA] HTTP server and MySQL pool closed.");
      process.exit(0);
    });
    setTimeout(() => {
      console.error("[LEVELUP RWANDA] Forced shutdown after timeout.");
      process.exit(1);
    }, 1e4).unref();
  };
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}
startServer().catch((err) => {
  console.error("[LEVELUP RWANDA] Failed to start server:", err);
  process.exit(1);
});
