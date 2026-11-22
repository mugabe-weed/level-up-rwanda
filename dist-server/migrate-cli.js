// server/db/migrate-cli.ts
import dotenv from "dotenv";

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
async function closePool() {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}

// server/db/migrations/001_initial_schema.ts
var migration001InitialSchema = {
  id: "001_initial_schema",
  name: "Initial LEVELUP RWANDA normalized MySQL 8 schema",
  upStatements: [
    `CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      email VARCHAR(190) NULL,
      phone VARCHAR(32) NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('member', 'educator', 'moderator', 'admin', 'super_admin') NOT NULL DEFAULT 'member',
      status ENUM('active', 'suspended', 'pending_verification') NOT NULL DEFAULT 'active',
      age_group ENUM('youth_13_17', 'adult_18_plus') NOT NULL DEFAULT 'adult_18_plus',
      preferred_language ENUM('rw', 'en', 'fr') NOT NULL DEFAULT 'en',
      contact_verified TINYINT(1) NOT NULL DEFAULT 0,
      contact_verification_token_hash VARCHAR(128) NULL,
      contact_verification_expires_at DATETIME NULL,
      password_reset_token_hash VARCHAR(128) NULL,
      password_reset_expires_at DATETIME NULL,
      failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0,
      locked_until DATETIME NULL,
      last_login_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_email (email),
      UNIQUE KEY uq_users_phone (phone),
      KEY idx_users_role_status (role, status),
      KEY idx_users_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS user_profiles (
      user_id BIGINT UNSIGNED NOT NULL,
      display_name VARCHAR(80) NOT NULL,
      username VARCHAR(32) NOT NULL,
      avatar_url VARCHAR(500) NULL,
      bio TEXT NULL,
      district VARCHAR(80) NULL,
      interests_json JSON NOT NULL,
      skills_json JSON NOT NULL,
      profile_visibility ENUM('public', 'community', 'private') NOT NULL DEFAULT 'community',
      show_activity TINYINT(1) NOT NULL DEFAULT 1,
      total_xp INT UNSIGNED NOT NULL DEFAULT 0,
      current_level INT UNSIGNED NOT NULL DEFAULT 1,
      current_streak INT UNSIGNED NOT NULL DEFAULT 0,
      longest_streak INT UNSIGNED NOT NULL DEFAULT 0,
      last_challenge_date DATE NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id),
      UNIQUE KEY uq_user_profiles_username (username),
      KEY idx_user_profiles_xp (total_xp DESC),
      CONSTRAINT fk_user_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS user_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      token_hash CHAR(64) NOT NULL,
      ip_address VARCHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      expires_at DATETIME NOT NULL,
      revoked_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_user_sessions_token_hash (token_hash),
      KEY idx_user_sessions_user_expires (user_id, expires_at),
      CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id BIGINT UNSIGNED NOT NULL,
      challenge_reminders TINYINT(1) NOT NULL DEFAULT 1,
      learning_updates TINYINT(1) NOT NULL DEFAULT 1,
      community_activity TINYINT(1) NOT NULL DEFAULT 1,
      opportunity_alerts TINYINT(1) NOT NULL DEFAULT 1,
      announcements TINYINT(1) NOT NULL DEFAULT 1,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id),
      CONSTRAINT fk_notification_prefs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      type VARCHAR(48) NOT NULL,
      title_text VARCHAR(160) NOT NULL,
      body_text VARCHAR(500) NOT NULL,
      link_url VARCHAR(255) NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      read_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_notifications_user_read (user_id, is_read, created_at DESC),
      CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS xp_transactions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      source_type ENUM('challenge_completion', 'lesson_completion', 'course_completion', 'community_post', 'achievement_bonus') NOT NULL,
      source_id BIGINT UNSIGNED NOT NULL,
      idempotency_key VARCHAR(160) NOT NULL,
      points INT UNSIGNED NOT NULL,
      description VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_xp_idempotency (idempotency_key),
      KEY idx_xp_user_created (user_id, created_at DESC),
      KEY idx_xp_created_points (created_at, points),
      CONSTRAINT fk_xp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS achievements (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      slug VARCHAR(64) NOT NULL,
      title_en VARCHAR(120) NOT NULL,
      title_rw VARCHAR(120) NOT NULL,
      title_fr VARCHAR(120) NOT NULL,
      description_en VARCHAR(300) NOT NULL,
      description_rw VARCHAR(300) NOT NULL,
      description_fr VARCHAR(300) NOT NULL,
      icon_name VARCHAR(48) NOT NULL,
      badge_tier ENUM('bronze', 'silver', 'gold', 'platinum') NOT NULL DEFAULT 'bronze',
      xp_bonus INT UNSIGNED NOT NULL DEFAULT 25,
      rule_type VARCHAR(48) NOT NULL,
      rule_threshold INT UNSIGNED NOT NULL DEFAULT 1,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_achievements_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS user_achievements (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      achievement_id BIGINT UNSIGNED NOT NULL,
      unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_user_achievement (user_id, achievement_id),
      CONSTRAINT fk_user_ach_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_user_ach_achievement FOREIGN KEY (achievement_id) REFERENCES achievements (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS challenge_categories (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      slug VARCHAR(64) NOT NULL,
      name_en VARCHAR(100) NOT NULL,
      name_rw VARCHAR(100) NOT NULL,
      name_fr VARCHAR(100) NOT NULL,
      description_en VARCHAR(300) NOT NULL,
      description_rw VARCHAR(300) NOT NULL,
      description_fr VARCHAR(300) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_challenge_categories_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS challenges (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      category_id BIGINT UNSIGNED NOT NULL,
      slug VARCHAR(90) NOT NULL,
      title_en VARCHAR(160) NOT NULL,
      title_rw VARCHAR(160) NOT NULL,
      title_fr VARCHAR(160) NOT NULL,
      description_en TEXT NOT NULL,
      description_rw TEXT NOT NULL,
      description_fr TEXT NOT NULL,
      difficulty ENUM('beginner', 'intermediate', 'advanced') NOT NULL DEFAULT 'beginner',
      challenge_type ENUM('daily', 'weekly', 'practice') NOT NULL DEFAULT 'daily',
      time_limit_seconds INT UNSIGNED NOT NULL DEFAULT 180,
      xp_reward INT UNSIGNED NOT NULL DEFAULT 50,
      active_date DATE NULL,
      is_featured TINYINT(1) NOT NULL DEFAULT 0,
      status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'published',
      is_sample TINYINT(1) NOT NULL DEFAULT 0,
      created_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_challenges_slug (slug),
      KEY idx_challenges_status_featured (status, is_featured, active_date),
      KEY idx_challenges_category (category_id),
      CONSTRAINT fk_challenges_category FOREIGN KEY (category_id) REFERENCES challenge_categories (id),
      CONSTRAINT fk_challenges_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS challenge_questions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      challenge_id BIGINT UNSIGNED NOT NULL,
      prompt_en TEXT NOT NULL,
      prompt_rw TEXT NOT NULL,
      prompt_fr TEXT NOT NULL,
      options_json JSON NOT NULL,
      correct_option_index TINYINT UNSIGNED NOT NULL,
      explanation_en TEXT NOT NULL,
      explanation_rw TEXT NOT NULL,
      explanation_fr TEXT NOT NULL,
      points_weight INT UNSIGNED NOT NULL DEFAULT 10,
      sort_order INT NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      KEY idx_challenge_questions_challenge (challenge_id, sort_order),
      CONSTRAINT fk_challenge_questions_challenge FOREIGN KEY (challenge_id) REFERENCES challenges (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS challenge_submissions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      challenge_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      answers_json JSON NOT NULL,
      score INT UNSIGNED NOT NULL,
      max_score INT UNSIGNED NOT NULL,
      correct_count INT UNSIGNED NOT NULL,
      total_questions INT UNSIGNED NOT NULL,
      duration_seconds INT UNSIGNED NOT NULL,
      xp_awarded INT UNSIGNED NOT NULL,
      submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_challenge_submission_user (challenge_id, user_id),
      KEY idx_submissions_user_date (user_id, submitted_at DESC),
      KEY idx_submissions_submitted_xp (submitted_at, xp_awarded),
      CONSTRAINT fk_submissions_challenge FOREIGN KEY (challenge_id) REFERENCES challenges (id) ON DELETE CASCADE,
      CONSTRAINT fk_submissions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS course_categories (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      slug VARCHAR(64) NOT NULL,
      name_en VARCHAR(100) NOT NULL,
      name_rw VARCHAR(100) NOT NULL,
      name_fr VARCHAR(100) NOT NULL,
      description_en VARCHAR(300) NOT NULL,
      description_rw VARCHAR(300) NOT NULL,
      description_fr VARCHAR(300) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_categories_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS courses (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      category_id BIGINT UNSIGNED NOT NULL,
      slug VARCHAR(90) NOT NULL,
      title_en VARCHAR(160) NOT NULL,
      title_rw VARCHAR(160) NOT NULL,
      title_fr VARCHAR(160) NOT NULL,
      summary_en TEXT NOT NULL,
      summary_rw TEXT NOT NULL,
      summary_fr TEXT NOT NULL,
      level ENUM('beginner', 'intermediate', 'advanced') NOT NULL DEFAULT 'beginner',
      estimated_minutes INT UNSIGNED NOT NULL DEFAULT 45,
      xp_reward INT UNSIGNED NOT NULL DEFAULT 120,
      age_appropriate_min TINYINT UNSIGNED NOT NULL DEFAULT 13,
      status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'published',
      is_sample TINYINT(1) NOT NULL DEFAULT 0,
      created_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_courses_slug (slug),
      KEY idx_courses_category_status (category_id, status),
      CONSTRAINT fk_courses_category FOREIGN KEY (category_id) REFERENCES course_categories (id),
      CONSTRAINT fk_courses_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS course_modules (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      course_id BIGINT UNSIGNED NOT NULL,
      title_en VARCHAR(160) NOT NULL,
      title_rw VARCHAR(160) NOT NULL,
      title_fr VARCHAR(160) NOT NULL,
      sort_order INT NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      KEY idx_course_modules_course (course_id, sort_order),
      CONSTRAINT fk_course_modules_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS course_lessons (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      module_id BIGINT UNSIGNED NOT NULL,
      course_id BIGINT UNSIGNED NOT NULL,
      title_en VARCHAR(160) NOT NULL,
      title_rw VARCHAR(160) NOT NULL,
      title_fr VARCHAR(160) NOT NULL,
      content_en MEDIUMTEXT NOT NULL,
      content_rw MEDIUMTEXT NOT NULL,
      content_fr MEDIUMTEXT NOT NULL,
      duration_minutes INT UNSIGNED NOT NULL DEFAULT 10,
      xp_reward INT UNSIGNED NOT NULL DEFAULT 25,
      assessment_question_json JSON NULL,
      sort_order INT NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      KEY idx_course_lessons_module (module_id, sort_order),
      KEY idx_course_lessons_course (course_id),
      CONSTRAINT fk_course_lessons_module FOREIGN KEY (module_id) REFERENCES course_modules (id) ON DELETE CASCADE,
      CONSTRAINT fk_course_lessons_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS course_enrollments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      course_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      status ENUM('enrolled', 'completed') NOT NULL DEFAULT 'enrolled',
      progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
      enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_enrollment (course_id, user_id),
      KEY idx_enrollments_user (user_id, status),
      CONSTRAINT fk_enrollments_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
      CONSTRAINT fk_enrollments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS lesson_progress (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      enrollment_id BIGINT UNSIGNED NOT NULL,
      lesson_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      completed TINYINT(1) NOT NULL DEFAULT 1,
      assessment_passed TINYINT(1) NOT NULL DEFAULT 1,
      assessment_score TINYINT UNSIGNED NOT NULL DEFAULT 100,
      completed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_lesson_progress_user (user_id, lesson_id),
      KEY idx_lesson_progress_enrollment (enrollment_id),
      CONSTRAINT fk_lesson_progress_enrollment FOREIGN KEY (enrollment_id) REFERENCES course_enrollments (id) ON DELETE CASCADE,
      CONSTRAINT fk_lesson_progress_lesson FOREIGN KEY (lesson_id) REFERENCES course_lessons (id) ON DELETE CASCADE,
      CONSTRAINT fk_lesson_progress_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS community_groups (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      slug VARCHAR(90) NOT NULL,
      name VARCHAR(80) NOT NULL,
      description VARCHAR(600) NOT NULL,
      category VARCHAR(60) NOT NULL,
      created_by BIGINT UNSIGNED NULL,
      is_private TINYINT(1) NOT NULL DEFAULT 0,
      member_count INT UNSIGNED NOT NULL DEFAULT 0,
      status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
      is_sample TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_community_groups_slug (slug),
      KEY idx_groups_status_category (status, category),
      CONSTRAINT fk_groups_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS group_memberships (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      group_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      role ENUM('member', 'moderator') NOT NULL DEFAULT 'member',
      joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_group_membership (group_id, user_id),
      CONSTRAINT fk_group_memberships_group FOREIGN KEY (group_id) REFERENCES community_groups (id) ON DELETE CASCADE,
      CONSTRAINT fk_group_memberships_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS creative_posts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      group_id BIGINT UNSIGNED NULL,
      post_type ENUM('create_showcase', 'discussion') NOT NULL DEFAULT 'create_showcase',
      category VARCHAR(60) NOT NULL,
      title VARCHAR(140) NOT NULL,
      body TEXT NOT NULL,
      media_url VARCHAR(500) NULL,
      media_mime VARCHAR(64) NULL,
      moderation_status ENUM('approved', 'pending', 'hidden', 'removed') NOT NULL DEFAULT 'approved',
      likes_count INT UNSIGNED NOT NULL DEFAULT 0,
      comments_count INT UNSIGNED NOT NULL DEFAULT 0,
      is_sample TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_posts_type_status_created (post_type, moderation_status, created_at DESC),
      KEY idx_posts_group_created (group_id, created_at DESC),
      KEY idx_posts_user_created (user_id, created_at DESC),
      CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_posts_group FOREIGN KEY (group_id) REFERENCES community_groups (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS post_reactions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      post_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      reaction_type ENUM('like', 'celebrate', 'helpful') NOT NULL DEFAULT 'like',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_post_reaction (post_id, user_id),
      CONSTRAINT fk_post_reactions_post FOREIGN KEY (post_id) REFERENCES creative_posts (id) ON DELETE CASCADE,
      CONSTRAINT fk_post_reactions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS post_comments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      post_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      body TEXT NOT NULL,
      moderation_status ENUM('visible', 'hidden', 'removed') NOT NULL DEFAULT 'visible',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_post_comments_post (post_id, created_at ASC),
      CONSTRAINT fk_post_comments_post FOREIGN KEY (post_id) REFERENCES creative_posts (id) ON DELETE CASCADE,
      CONSTRAINT fk_post_comments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS user_follows (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      follower_id BIGINT UNSIGNED NOT NULL,
      following_id BIGINT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_user_follow (follower_id, following_id),
      CONSTRAINT fk_user_follows_follower FOREIGN KEY (follower_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_user_follows_following FOREIGN KEY (following_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS user_blocks (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      blocker_id BIGINT UNSIGNED NOT NULL,
      blocked_id BIGINT UNSIGNED NOT NULL,
      reason VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_user_block (blocker_id, blocked_id),
      CONSTRAINT fk_user_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_user_blocks_blocked FOREIGN KEY (blocked_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS content_reports (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      reporter_id BIGINT UNSIGNED NOT NULL,
      target_type ENUM('post', 'comment', 'user', 'opportunity') NOT NULL,
      target_id BIGINT UNSIGNED NOT NULL,
      reason VARCHAR(64) NOT NULL,
      details TEXT NULL,
      status ENUM('open', 'reviewing', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
      reviewed_by BIGINT UNSIGNED NULL,
      resolution_note VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_reports_status_created (status, created_at DESC),
      CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_reports_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS organizations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(140) NOT NULL,
      slug VARCHAR(90) NOT NULL,
      org_type VARCHAR(64) NOT NULL,
      website_url VARCHAR(500) NULL,
      verified TINYINT(1) NOT NULL DEFAULT 0,
      description TEXT NULL,
      created_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_organizations_slug (slug),
      CONSTRAINT fk_organizations_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS opportunity_categories (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      slug VARCHAR(64) NOT NULL,
      name_en VARCHAR(100) NOT NULL,
      name_rw VARCHAR(100) NOT NULL,
      name_fr VARCHAR(100) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      UNIQUE KEY uq_opportunity_categories_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS opportunities (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      organization_id BIGINT UNSIGNED NULL,
      category_id BIGINT UNSIGNED NOT NULL,
      opportunity_type ENUM('scholarship', 'internship', 'job', 'remote_job', 'fellowship', 'grant', 'volunteering', 'online_course') NOT NULL,
      title VARCHAR(160) NOT NULL,
      organization_name VARCHAR(120) NOT NULL,
      location VARCHAR(120) NOT NULL,
      is_remote TINYINT(1) NOT NULL DEFAULT 0,
      summary TEXT NOT NULL,
      eligibility TEXT NOT NULL,
      application_url VARCHAR(500) NOT NULL,
      deadline_at DATETIME NULL,
      approval_status ENUM('pending', 'approved', 'rejected', 'expired') NOT NULL DEFAULT 'pending',
      verified_status ENUM('unverified', 'verified') NOT NULL DEFAULT 'unverified',
      is_featured TINYINT(1) NOT NULL DEFAULT 0,
      is_sample TINYINT(1) NOT NULL DEFAULT 0,
      submitted_by BIGINT UNSIGNED NULL,
      approved_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_opportunities_approval_deadline (approval_status, deadline_at),
      KEY idx_opportunities_type_remote (opportunity_type, is_remote),
      CONSTRAINT fk_opportunities_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE SET NULL,
      CONSTRAINT fk_opportunities_category FOREIGN KEY (category_id) REFERENCES opportunity_categories (id),
      CONSTRAINT fk_opportunities_submitter FOREIGN KEY (submitted_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_opportunities_approver FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS saved_opportunities (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      opportunity_id BIGINT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_saved_opportunity (user_id, opportunity_id),
      CONSTRAINT fk_saved_opps_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_saved_opps_opp FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS announcements (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      title_en VARCHAR(160) NOT NULL,
      title_rw VARCHAR(160) NOT NULL,
      title_fr VARCHAR(160) NOT NULL,
      body_en TEXT NOT NULL,
      body_rw TEXT NOT NULL,
      body_fr TEXT NOT NULL,
      audience ENUM('all', 'learners', 'moderators') NOT NULL DEFAULT 'all',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      starts_at DATETIME NULL,
      ends_at DATETIME NULL,
      created_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_announcements_active (is_active, created_at DESC),
      CONSTRAINT fk_announcements_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS platform_settings (
      setting_key VARCHAR(80) NOT NULL,
      setting_value_json JSON NOT NULL,
      description VARCHAR(255) NULL,
      updated_by BIGINT UNSIGNED NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (setting_key),
      CONSTRAINT fk_platform_settings_updater FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      actor_user_id BIGINT UNSIGNED NULL,
      action VARCHAR(80) NOT NULL,
      target_type VARCHAR(64) NOT NULL,
      target_id VARCHAR(64) NULL,
      metadata_json JSON NULL,
      ip_address VARCHAR(64) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_audit_logs_actor_created (actor_user_id, created_at DESC),
      KEY idx_audit_logs_action (action, created_at DESC),
      CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ],
  downStatements: [
    "DROP TABLE IF EXISTS audit_logs",
    "DROP TABLE IF EXISTS platform_settings",
    "DROP TABLE IF EXISTS announcements",
    "DROP TABLE IF EXISTS saved_opportunities",
    "DROP TABLE IF EXISTS opportunities",
    "DROP TABLE IF EXISTS opportunity_categories",
    "DROP TABLE IF EXISTS organizations",
    "DROP TABLE IF EXISTS content_reports",
    "DROP TABLE IF EXISTS user_blocks",
    "DROP TABLE IF EXISTS user_follows",
    "DROP TABLE IF EXISTS post_comments",
    "DROP TABLE IF EXISTS post_reactions",
    "DROP TABLE IF EXISTS creative_posts",
    "DROP TABLE IF EXISTS group_memberships",
    "DROP TABLE IF EXISTS community_groups",
    "DROP TABLE IF EXISTS lesson_progress",
    "DROP TABLE IF EXISTS course_enrollments",
    "DROP TABLE IF EXISTS course_lessons",
    "DROP TABLE IF EXISTS course_modules",
    "DROP TABLE IF EXISTS courses",
    "DROP TABLE IF EXISTS course_categories",
    "DROP TABLE IF EXISTS challenge_submissions",
    "DROP TABLE IF EXISTS challenge_questions",
    "DROP TABLE IF EXISTS challenges",
    "DROP TABLE IF EXISTS challenge_categories",
    "DROP TABLE IF EXISTS user_achievements",
    "DROP TABLE IF EXISTS achievements",
    "DROP TABLE IF EXISTS xp_transactions",
    "DROP TABLE IF EXISTS notifications",
    "DROP TABLE IF EXISTS notification_preferences",
    "DROP TABLE IF EXISTS user_sessions",
    "DROP TABLE IF EXISTS user_profiles",
    "DROP TABLE IF EXISTS users"
  ]
};

// server/db/migrator.ts
var ALL_MIGRATIONS = [migration001InitialSchema];
var MigrationSafetyError = class extends Error {
  constructor(message, report) {
    super(message);
    this.name = "MigrationSafetyError";
    this.report = report;
  }
};
function extractExpectedTablesFromMigration(migration) {
  const specs = [];
  const createRegex = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`?([a-zA-Z0-9_]+)`?\s*\(([\s\S]*)\)\s*ENGINE=([a-zA-Z0-9_]+)\s+DEFAULT\s+CHARSET=([a-zA-Z0-9_]+)/i;
  for (const stmt of migration.upStatements) {
    const match = stmt.match(createRegex);
    if (!match) continue;
    const [, tableName, body, engine, charset] = match;
    const columns = [];
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^(PRIMARY\s+KEY|UNIQUE\s+KEY|KEY\s+|INDEX\s+|CONSTRAINT\s+|FULLTEXT\s+)/i.test(line)) {
        continue;
      }
      const colMatch = line.match(/^`?([a-zA-Z0-9_]+)`?\s+/);
      if (colMatch) {
        columns.push(colMatch[1]);
      }
    }
    specs.push({
      migrationId: migration.id,
      tableName,
      columns,
      expectedEngine: engine,
      expectedCharset: charset
    });
  }
  return specs;
}
function extractExpectedTablesRegistry() {
  return ALL_MIGRATIONS.flatMap(extractExpectedTablesFromMigration);
}
function analyzeSchemaCompatibility(input) {
  const appliedSet = new Set(input.appliedMigrationIds);
  const allMigrationIds = ALL_MIGRATIONS.map((m) => m.id);
  const pendingMigrations = allMigrationIds.filter((id) => !appliedSet.has(id));
  const existingTableMap = /* @__PURE__ */ new Map();
  for (const t of input.existingTables) {
    existingTableMap.set(t.tableName.toLowerCase(), t);
  }
  const columnsByTable = /* @__PURE__ */ new Map();
  for (const col of input.existingColumns) {
    const key = col.tableName.toLowerCase();
    if (!columnsByTable.has(key)) {
      columnsByTable.set(key, /* @__PURE__ */ new Set());
    }
    columnsByTable.get(key).add(col.columnName.toLowerCase());
  }
  const expectedTableNames = new Set(input.expectedTables.map((t) => t.tableName.toLowerCase()));
  const existingNonMigrationTables = input.existingTables.map((t) => t.tableName).filter(
    (name) => name.toLowerCase() !== "schema_migrations" && !expectedTableNames.has(name.toLowerCase())
  );
  const untrackedMatchingTables = [];
  const missingTablesOnApplied = [];
  const tableIssues = [];
  for (const expected of input.expectedTables) {
    const key = expected.tableName.toLowerCase();
    const existing = existingTableMap.get(key);
    const migrationAlreadyApplied = appliedSet.has(expected.migrationId);
    if (!migrationAlreadyApplied) {
      if (existing) {
        untrackedMatchingTables.push(expected.tableName);
        tableIssues.push({
          tableName: expected.tableName,
          reason: "UNTRACKED_EXISTING_TABLE",
          detail: `Table "${expected.tableName}" already exists even though migration "${expected.migrationId}" is not recorded in schema_migrations.`
        });
      } else {
        continue;
      }
    } else if (!existing) {
      missingTablesOnApplied.push(expected.tableName);
      tableIssues.push({
        tableName: expected.tableName,
        reason: "MISSING_EXPECTED_TABLE",
        detail: `Migration "${expected.migrationId}" is marked applied, but table "${expected.tableName}" is missing.`
      });
      continue;
    }
    if (existing) {
      if (existing.engine && existing.engine.toLowerCase() !== expected.expectedEngine.toLowerCase()) {
        tableIssues.push({
          tableName: expected.tableName,
          reason: "ENGINE_MISMATCH",
          detail: `Expected engine ${expected.expectedEngine}, found ${existing.engine}.`
        });
      }
      if (existing.collation && !existing.collation.toLowerCase().startsWith(expected.expectedCharset.toLowerCase())) {
        tableIssues.push({
          tableName: expected.tableName,
          reason: "COLLATION_MISMATCH",
          detail: `Expected ${expected.expectedCharset} collation, found ${existing.collation}.`
        });
      }
      const existingCols = columnsByTable.get(key) ?? /* @__PURE__ */ new Set();
      const missingCols = expected.columns.filter((c) => !existingCols.has(c.toLowerCase()));
      if (missingCols.length > 0) {
        tableIssues.push({
          tableName: expected.tableName,
          reason: "MISSING_COLUMNS",
          detail: `Missing expected columns: ${missingCols.join(", ")}.`
        });
      }
    }
  }
  let state;
  if (tableIssues.length > 0) {
    state = "incompatible";
  } else if (!input.hasMigrationsTable && input.existingTables.length === 0 && pendingMigrations.length > 0) {
    state = "fresh_empty";
  } else if (pendingMigrations.length === 0) {
    state = "up_to_date";
  } else {
    state = "pending_clean";
  }
  return {
    compatible: state !== "incompatible",
    state,
    hasMigrationsTable: input.hasMigrationsTable,
    appliedMigrations: [...input.appliedMigrationIds],
    pendingMigrations,
    expectedApplicationTableCount: input.expectedTables.length,
    existingTableCount: input.existingTables.length,
    untrackedMatchingTables,
    missingTablesOnApplied,
    existingNonMigrationTables,
    tableIssues
  };
}
async function ensureMigrationsTable() {
  const pool = getPool();
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(120) NOT NULL,
      name VARCHAR(255) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
async function getAppliedMigrationIds() {
  await ensureMigrationsTable();
  const pool = getPool();
  const [rows] = await pool.execute(
    "SELECT id FROM schema_migrations ORDER BY applied_at ASC, id ASC"
  );
  return rows.map((row) => String(row.id));
}
async function inspectMigrationStatus() {
  const pool = getPool();
  const [tableRows] = await pool.query(
    `SELECT TABLE_NAME AS tableName, ENGINE AS engine, TABLE_COLLATION AS collation
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME ASC`
  );
  const existingTables = tableRows.map((r) => ({
    tableName: String(r.tableName),
    engine: r.engine ? String(r.engine) : null,
    collation: r.collation ? String(r.collation) : null
  }));
  const hasMigrationsTable = existingTables.some(
    (t) => t.tableName.toLowerCase() === "schema_migrations"
  );
  let appliedMigrationIds = [];
  if (hasMigrationsTable) {
    const [migRows] = await pool.query(
      "SELECT id FROM schema_migrations ORDER BY applied_at ASC, id ASC"
    );
    appliedMigrationIds = migRows.map((row) => String(row.id));
  }
  let existingColumns = [];
  if (existingTables.length > 0) {
    const [colRows] = await pool.query(
      `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME ASC, ORDINAL_POSITION ASC`
    );
    existingColumns = colRows.map((r) => ({
      tableName: String(r.tableName),
      columnName: String(r.columnName),
      columnType: r.columnType ? String(r.columnType) : null
    }));
  }
  return analyzeSchemaCompatibility({
    expectedTables: extractExpectedTablesRegistry(),
    existingTables,
    existingColumns,
    appliedMigrationIds,
    hasMigrationsTable
  });
}
async function dryRunMigrations() {
  const report = await inspectMigrationStatus();
  const appliedSet = new Set(report.appliedMigrations);
  const wouldApply = [];
  const wouldSkip = [];
  for (const migration of ALL_MIGRATIONS) {
    if (appliedSet.has(migration.id)) {
      wouldSkip.push(migration.id);
    } else {
      wouldApply.push({
        id: migration.id,
        name: migration.name,
        statementCount: migration.upStatements.length
      });
    }
  }
  return {
    safeToApply: report.compatible,
    wouldApply,
    wouldSkip,
    report
  };
}
async function runMigrations() {
  const preflight = await inspectMigrationStatus();
  if (!preflight.compatible) {
    const summary = preflight.tableIssues.slice(0, 10).map((i) => `${i.tableName}: ${i.detail}`).join(" | ");
    throw new MigrationSafetyError(
      `Refusing to run migrations because pre-existing database schema conflicts were detected (${preflight.tableIssues.length} issue(s)): ${summary}`,
      preflight
    );
  }
  await ensureMigrationsTable();
  const pool = getPool();
  const appliedIds = new Set(await getAppliedMigrationIds());
  const applied = [];
  const skipped = [];
  for (const migration of ALL_MIGRATIONS) {
    if (appliedIds.has(migration.id)) {
      skipped.push(migration.id);
      continue;
    }
    const conn = await pool.getConnection();
    try {
      for (const stmt of migration.upStatements) {
        await conn.execute(stmt);
      }
      await conn.execute("INSERT INTO schema_migrations (id, name) VALUES (?, ?)", [
        migration.id,
        migration.name
      ]);
      applied.push(migration.id);
    } finally {
      conn.release();
    }
  }
  return { applied, skipped };
}
async function rollbackLastMigration() {
  await ensureMigrationsTable();
  const pool = getPool();
  const appliedIds = await getAppliedMigrationIds();
  if (appliedIds.length === 0) {
    return null;
  }
  const lastId = appliedIds[appliedIds.length - 1];
  const migration = ALL_MIGRATIONS.find((m) => m.id === lastId);
  if (!migration) {
    throw new Error(`Migration ${lastId} not found in registry`);
  }
  const conn = await pool.getConnection();
  try {
    for (const stmt of migration.downStatements) {
      await conn.execute(stmt);
    }
    await conn.execute("DELETE FROM schema_migrations WHERE id = ?", [migration.id]);
    return migration.id;
  } finally {
    conn.release();
  }
}

// server/db/migrate-cli.ts
dotenv.config();
function printUsage() {
  console.log(`LEVELUP RWANDA Migration CLI

Commands:
  up                                  Apply pending migrations (runs pre-flight schema compatibility check)
  status                              Read-only inspection of applied/pending migrations and table compatibility
  dry-run                             Read-only preview of pending migrations without modifying the database
  down --confirm-destructive-down     DESTRUCTIVE: Runs DROP TABLE IF EXISTS rollback for latest migration
`);
}
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "up";
  if (command === "--help" || command === "-h" || command === "help") {
    printUsage();
    return;
  }
  if (command === "status") {
    const report = await inspectMigrationStatus();
    console.log(JSON.stringify(report, null, 2));
    if (!report.compatible) {
      process.exitCode = 1;
    }
    return;
  }
  if (command === "dry-run") {
    const preview = await dryRunMigrations();
    console.log(JSON.stringify(preview, null, 2));
    if (!preview.safeToApply) {
      process.exitCode = 1;
    }
    return;
  }
  if (command === "down") {
    const hasCliConfirm = args.includes("--confirm-destructive-down");
    const hasEnvConfirm = process.env.CONFIRM_DESTRUCTIVE_ROLLBACK === "YES_DROP_ALL_TABLES";
    if (!hasCliConfirm && !hasEnvConfirm) {
      console.error(
        'REFUSED: The "down" command is DESTRUCTIVE and executes DROP TABLE IF EXISTS across application tables, permanently deleting all data.'
      );
      console.error(
        "To intentionally execute rollback in a non-production or recovery environment, pass --confirm-destructive-down."
      );
      process.exitCode = 1;
      return;
    }
    const rolledBack = await rollbackLastMigration();
    console.log(rolledBack ? `Rolled back migration: ${rolledBack}` : "No migrations to roll back.");
    return;
  }
  if (command === "up") {
    const result = await runMigrations();
    console.log("Applied migrations:", result.applied);
    console.log("Skipped migrations:", result.skipped);
    return;
  }
  console.error(`Unknown migration command: ${command}`);
  printUsage();
  process.exitCode = 1;
}
main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}).finally(async () => {
  await closePool();
});
