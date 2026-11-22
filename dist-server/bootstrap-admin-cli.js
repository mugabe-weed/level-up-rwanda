// server/db/bootstrap-admin-cli.ts
import dotenv from "dotenv";

// shared/schemas.ts
import { z } from "zod";
var SUPPORTED_LANGUAGES = ["rw", "en", "fr"];
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

// server/utils/crypto.ts
import crypto from "crypto";
var SCRYPT_N = 16384;
var SCRYPT_R = 8;
var SCRYPT_P = 1;
var KEY_LEN = 64;
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derivedKey.toString("hex")}`;
}

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

// server/db/bootstrap-admin-cli.ts
dotenv.config();
function getArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}
async function main() {
  const parsed = bootstrapAdminSchema.safeParse({
    bootstrapToken: getArg("token") || process.env.ADMIN_BOOTSTRAP_TOKEN || "",
    email: getArg("email"),
    displayName: getArg("name"),
    username: getArg("username"),
    password: getArg("password")
  });
  if (!parsed.success) {
    console.error("Validation failed:", parsed.error.flatten().fieldErrors);
    console.error(
      'Usage: npm run bootstrap-admin -- --email=admin@example.rw --name="Platform Admin" --username=rw_admin --password="StrongPassword123!" --token="$ADMIN_BOOTSTRAP_TOKEN"'
    );
    process.exitCode = 1;
    return;
  }
  const admin = await provisionFirstSuperAdmin({
    email: parsed.data.email,
    displayName: parsed.data.displayName,
    username: parsed.data.username,
    password: parsed.data.password
  });
  console.log("First super_admin provisioned:", admin);
}
main().catch((err) => {
  console.error("Bootstrap admin failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}).finally(async () => {
  await closePool();
});
