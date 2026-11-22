import { RowDataPacket } from 'mysql2/promise';
import { UserRole } from '../../shared/schemas.ts';
import { localStore } from '../db/localStore.ts';
import { isDatabaseConfigured, queryRows, withTransaction } from '../db/pool.ts';
import { ForbiddenError, NotFoundError } from '../utils/errors.ts';
import { recordAuditLog } from './auditService.ts';

export async function getAdminOverview() {
  if (!isDatabaseConfigured()) {
    return localStore.getAdminOverview();
  }
  const [usersCount] = await queryRows<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM users');
  const [challengesCount] = await queryRows<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM challenges');
  const [submissionsCount] = await queryRows<RowDataPacket[]>(
    'SELECT COUNT(*) AS cnt FROM challenge_submissions',
  );
  const [coursesCount] = await queryRows<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM courses');
  const [enrollmentsCount] = await queryRows<RowDataPacket[]>(
    'SELECT COUNT(*) AS cnt FROM course_enrollments',
  );
  const [postsCount] = await queryRows<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM creative_posts');
  const [openReportsCount] = await queryRows<RowDataPacket[]>(
    "SELECT COUNT(*) AS cnt FROM content_reports WHERE status IN ('open', 'reviewing')",
  );
  const [pendingOppsCount] = await queryRows<RowDataPacket[]>(
    "SELECT COUNT(*) AS cnt FROM opportunities WHERE approval_status = 'pending'",
  );

  const xpBreakdown = await queryRows<RowDataPacket[]>(
    `SELECT source_type, COUNT(*) AS count, COALESCE(SUM(points), 0) AS total_points
     FROM xp_transactions
     GROUP BY source_type`,
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
      pendingOpportunities: Number(pendingOppsCount?.cnt ?? 0),
    },
    xpBreakdown,
  };
}

export async function listUsersAdmin(search?: string) {
  if (!isDatabaseConfigured()) {
    return localStore.listUsersAdmin(search);
  }
  const q = search?.trim() ? `%${search.trim()}%` : null;
  const where = q ? 'WHERE u.email LIKE ? OR up.username LIKE ? OR up.display_name LIKE ?' : '';
  const params = q ? [q, q, q] : [];
  return queryRows<RowDataPacket[]>(
    `SELECT u.id, u.email, u.phone, u.role, u.status, u.age_group, u.contact_verified, u.last_login_at, u.created_at,
            up.display_name, up.username, up.district, up.total_xp, up.current_level
     FROM users u
     INNER JOIN user_profiles up ON up.user_id = u.id
     ${where}
     ORDER BY u.created_at DESC
     LIMIT 100`,
    params,
  );
}

export async function updateUserRoleOrStatusAdmin(params: {
  actorUserId: number;
  actorRole: UserRole;
  targetUserId: number;
  role?: UserRole;
  status?: 'active' | 'suspended';
  ipAddress?: string;
}) {
  if (!isDatabaseConfigured()) {
    return localStore.updateUserRoleOrStatusAdmin(params);
  }
  if (params.actorUserId === params.targetUserId && params.status === 'suspended') {
    throw new ForbiddenError('You cannot suspend your own administrator account.');
  }
  if (params.role === 'super_admin' && params.actorRole !== 'super_admin') {
    throw new ForbiddenError('Only a super_admin can assign the super_admin role.');
  }

  await withTransaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>('SELECT role, status FROM users WHERE id = ? LIMIT 1', [
      params.targetUserId,
    ]);
    if (rows.length === 0) {
      throw new NotFoundError('User not found.');
    }
    if (rows[0].role === 'super_admin' && params.actorRole !== 'super_admin') {
      throw new ForbiddenError('Only a super_admin can modify another super_admin.');
    }

    if (params.role) {
      await conn.execute('UPDATE users SET role = ? WHERE id = ?', [params.role, params.targetUserId]);
    }
    if (params.status) {
      await conn.execute('UPDATE users SET status = ? WHERE id = ?', [params.status, params.targetUserId]);
      if (params.status === 'suspended') {
        await conn.execute('UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = ?', [
          params.targetUserId,
        ]);
      }
    }

    await recordAuditLog({
      actorUserId: params.actorUserId,
      action: 'ADMIN_USER_UPDATED',
      targetType: 'user',
      targetId: params.targetUserId,
      metadata: { role: params.role, status: params.status },
      ipAddress: params.ipAddress,
      conn,
    });
  });
}

export async function listAllChallengesAdmin() {
  if (!isDatabaseConfigured()) {
    return localStore.listAllChallengesAdmin();
  }
  return queryRows<RowDataPacket[]>(
    `SELECT c.*, cat.name_en AS category_name,
            (SELECT COUNT(*) FROM challenge_questions q WHERE q.challenge_id = c.id) AS question_count
     FROM challenges c
     INNER JOIN challenge_categories cat ON cat.id = c.category_id
     ORDER BY c.created_at DESC`,
  );
}

export async function createChallengeAdmin(
  actorUserId: number,
  data: {
    categoryId: number;
    slug: string;
    titleEn: string;
    titleRw: string;
    titleFr: string;
    descriptionEn: string;
    descriptionRw: string;
    descriptionFr: string;
    difficulty: string;
    challengeType: string;
    timeLimitSeconds: number;
    xpReward: number;
    activeDate?: string | null;
    isFeatured: boolean;
    status: string;
  },
  ipAddress?: string,
) {
  if (!isDatabaseConfigured()) {
    return localStore.createChallengeAdmin(actorUserId, data, ipAddress);
  }
  return withTransaction(async (conn) => {
    const [res] = await conn.execute<any>(
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
        actorUserId,
      ],
    );
    const id = Number(res.insertId);
    await recordAuditLog({
      actorUserId,
      action: 'ADMIN_CHALLENGE_CREATED',
      targetType: 'challenge',
      targetId: id,
      metadata: { slug: data.slug },
      ipAddress,
      conn,
    });
    return { id };
  });
}

export async function addQuestionAdmin(
  actorUserId: number,
  data: {
    challengeId: number;
    promptEn: string;
    promptRw: string;
    promptFr: string;
    options: string[];
    correctOptionIndex: number;
    explanationEn: string;
    explanationRw: string;
    explanationFr: string;
    pointsWeight: number;
    sortOrder: number;
  },
  ipAddress?: string,
) {
  if (!isDatabaseConfigured()) {
    return localStore.addQuestionAdmin(actorUserId, data, ipAddress);
  }
  return withTransaction(async (conn) => {
    const [res] = await conn.execute<any>(
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
        data.sortOrder,
      ],
    );
    await recordAuditLog({
      actorUserId,
      action: 'ADMIN_QUESTION_ADDED',
      targetType: 'challenge',
      targetId: data.challengeId,
      ipAddress,
      conn,
    });
    return { id: Number(res.insertId) };
  });
}

export async function createCourseAdmin(
  actorUserId: number,
  data: {
    categoryId: number;
    slug: string;
    titleEn: string;
    titleRw: string;
    titleFr: string;
    summaryEn: string;
    summaryRw: string;
    summaryFr: string;
    level: string;
    estimatedMinutes: number;
    xpReward: number;
    status: string;
  },
  ipAddress?: string,
) {
  if (!isDatabaseConfigured()) {
    return localStore.createCourseAdmin(actorUserId, data, ipAddress);
  }
  return withTransaction(async (conn) => {
    const [res] = await conn.execute<any>(
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
        actorUserId,
      ],
    );
    const courseId = Number(res.insertId);
    await conn.execute(
      `INSERT INTO course_modules (course_id, title_en, title_rw, title_fr, sort_order)
       VALUES (?, 'Module 1: Core Foundations', 'Igice cya 1: Ibanze', 'Module 1 : Fondamentaux', 1)`,
      [courseId],
    );
    await recordAuditLog({
      actorUserId,
      action: 'ADMIN_COURSE_CREATED',
      targetType: 'course',
      targetId: courseId,
      metadata: { slug: data.slug },
      ipAddress,
      conn,
    });
    return { id: courseId };
  });
}

export async function listAllCoursesAdmin() {
  if (!isDatabaseConfigured()) {
    return localStore.listAllCoursesAdmin();
  }
  return queryRows<RowDataPacket[]>(
    `SELECT c.*, cat.name_en AS category_name,
            (SELECT COUNT(*) FROM course_lessons cl WHERE cl.course_id = c.id) AS lesson_count
     FROM courses c
     INNER JOIN course_categories cat ON cat.id = c.category_id
     ORDER BY c.created_at DESC`,
  );
}

export async function addLessonAdmin(
  actorUserId: number,
  data: {
    courseId: number;
    titleEn: string;
    titleRw: string;
    titleFr: string;
    contentEn: string;
    contentRw: string;
    contentFr: string;
    durationMinutes: number;
    xpReward: number;
    assessmentQuestion?: string;
    assessmentOptions?: string[];
    correctOptionIndex?: number;
    assessmentExplanation?: string;
  },
  ipAddress?: string,
) {
  if (!isDatabaseConfigured()) {
    return localStore.addLessonAdmin(actorUserId, data, ipAddress);
  }
  return withTransaction(async (conn) => {
    const [courseRows] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM courses WHERE id = ? LIMIT 1',
      [data.courseId],
    );
    if (courseRows.length === 0) {
      throw new NotFoundError('Course not found.');
    }
    let [modRows] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1',
      [data.courseId],
    );
    let moduleId: number;
    if (modRows.length === 0) {
      const [mRes] = await conn.execute<any>(
        `INSERT INTO course_modules (course_id, title_en, title_rw, title_fr, sort_order)
         VALUES (?, 'Module 1: Core Foundations', 'Igice cya 1: Ibanze', 'Module 1 : Fondamentaux', 1)`,
        [data.courseId],
      );
      moduleId = Number(mRes.insertId);
    } else {
      moduleId = Number(modRows[0].id);
    }

    const [[cntRow]] = await conn.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM course_lessons WHERE course_id = ?',
      [data.courseId],
    );
    const sortOrder = Number(cntRow?.cnt ?? 0) + 1;

    const assessment =
      data.assessmentQuestion && data.assessmentOptions && data.assessmentOptions.length >= 2
        ? JSON.stringify({
            question: data.assessmentQuestion,
            options: data.assessmentOptions,
            correctIndex: data.correctOptionIndex ?? 0,
            explanation: data.assessmentExplanation || 'Good check!',
          })
        : null;

    const [res] = await conn.execute<any>(
      `INSERT INTO course_lessons
        (module_id, course_id, title_en, title_rw, title_fr, content_en, content_rw, content_fr, duration_minutes, xp_reward, assessment_question_json, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        moduleId,
        data.courseId,
        data.titleEn,
        data.titleRw,
        data.titleFr,
        data.contentEn,
        data.contentRw,
        data.contentFr,
        data.durationMinutes,
        data.xpReward,
        assessment,
        sortOrder,
      ],
    );
    await recordAuditLog({
      actorUserId,
      action: 'ADMIN_LESSON_ADDED',
      targetType: 'course',
      targetId: data.courseId,
      ipAddress,
      conn,
    });
    return { id: Number(res.insertId) };
  });
}

export async function listModerationQueueAdmin() {
  if (!isDatabaseConfigured()) {
    return localStore.listModerationQueueAdmin();
  }
  const reports = await queryRows<RowDataPacket[]>(
    `SELECT r.*, up.username AS reporter_username, up.display_name AS reporter_name
     FROM content_reports r
     INNER JOIN user_profiles up ON up.user_id = r.reporter_id
     ORDER BY FIELD(r.status, 'open', 'reviewing', 'resolved', 'dismissed'), r.created_at DESC
     LIMIT 100`,
  );
  const posts = await queryRows<RowDataPacket[]>(
    `SELECT p.id, p.title, p.post_type, p.category, p.moderation_status, p.created_at,
            up.username AS author_username, up.display_name AS author_name
     FROM creative_posts p
     INNER JOIN user_profiles up ON up.user_id = p.user_id
     ORDER BY p.created_at DESC
     LIMIT 60`,
  );
  return { reports, posts };
}

export async function moderatePostAdmin(
  actorUserId: number,
  postId: number,
  status: 'approved' | 'hidden' | 'removed',
  ipAddress?: string,
) {
  if (!isDatabaseConfigured()) {
    return localStore.moderatePostAdmin(actorUserId, postId, status, ipAddress);
  }
  await withTransaction(async (conn) => {
    await conn.execute('UPDATE creative_posts SET moderation_status = ? WHERE id = ?', [status, postId]);
    await recordAuditLog({
      actorUserId,
      action: 'ADMIN_POST_MODERATED',
      targetType: 'post',
      targetId: postId,
      metadata: { status },
      ipAddress,
      conn,
    });
  });
}

export async function resolveReportAdmin(
  actorUserId: number,
  reportId: number,
  status: 'reviewing' | 'resolved' | 'dismissed',
  resolutionNote?: string,
  ipAddress?: string,
) {
  if (!isDatabaseConfigured()) {
    return localStore.resolveReportAdmin(actorUserId, reportId, status, resolutionNote, ipAddress);
  }
  await withTransaction(async (conn) => {
    await conn.execute(
      'UPDATE content_reports SET status = ?, reviewed_by = ?, resolution_note = ? WHERE id = ?',
      [status, actorUserId, resolutionNote || null, reportId],
    );
    await recordAuditLog({
      actorUserId,
      action: 'ADMIN_REPORT_UPDATED',
      targetType: 'report',
      targetId: reportId,
      metadata: { status, resolutionNote },
      ipAddress,
      conn,
    });
  });
}

export async function listAllOpportunitiesAdmin() {
  if (!isDatabaseConfigured()) {
    return localStore.listAllOpportunitiesAdmin();
  }
  return queryRows<RowDataPacket[]>(
    `SELECT o.*, cat.name_en AS category_name
     FROM opportunities o
     INNER JOIN opportunity_categories cat ON cat.id = o.category_id
     ORDER BY FIELD(o.approval_status, 'pending', 'approved', 'rejected', 'expired'), o.created_at DESC`,
  );
}

export async function updateOpportunityStatusAdmin(
  actorUserId: number,
  opportunityId: number,
  params: {
    approvalStatus?: 'pending' | 'approved' | 'rejected' | 'expired';
    verifiedStatus?: 'unverified' | 'verified';
  },
  ipAddress?: string,
) {
  if (!isDatabaseConfigured()) {
    return localStore.updateOpportunityStatusAdmin(actorUserId, opportunityId, params, ipAddress);
  }
  await withTransaction(async (conn) => {
    if (params.approvalStatus) {
      await conn.execute(
        'UPDATE opportunities SET approval_status = ?, approved_by = ? WHERE id = ?',
        [params.approvalStatus, actorUserId, opportunityId],
      );
    }
    if (params.verifiedStatus) {
      await conn.execute('UPDATE opportunities SET verified_status = ? WHERE id = ?', [
        params.verifiedStatus,
        opportunityId,
      ]);
    }
    await recordAuditLog({
      actorUserId,
      action: 'ADMIN_OPPORTUNITY_UPDATED',
      targetType: 'opportunity',
      targetId: opportunityId,
      metadata: params,
      ipAddress,
      conn,
    });
  });
}

export async function listOrganizationsAdmin() {
  if (!isDatabaseConfigured()) {
    return localStore.listOrganizationsAdmin();
  }
  return queryRows<RowDataPacket[]>('SELECT * FROM organizations ORDER BY created_at DESC');
}

export async function createOrganizationAdmin(
  actorUserId: number,
  data: { name: string; orgType: string; websiteUrl?: string; description?: string; verified: boolean },
  ipAddress?: string,
) {
  if (!isDatabaseConfigured()) {
    return localStore.createOrganizationAdmin(actorUserId, data, ipAddress);
  }
  const slug =
    data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 75) +
    '-' +
    Date.now().toString(36);
  return withTransaction(async (conn) => {
    const [res] = await conn.execute<any>(
      'INSERT INTO organizations (name, slug, org_type, website_url, verified, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [data.name, slug, data.orgType, data.websiteUrl || null, data.verified ? 1 : 0, data.description || null, actorUserId],
    );
    await recordAuditLog({
      actorUserId,
      action: 'ADMIN_ORGANIZATION_CREATED',
      targetType: 'organization',
      targetId: Number(res.insertId),
      ipAddress,
      conn,
    });
    return { id: Number(res.insertId) };
  });
}

export async function listAnnouncementsAdmin() {
  if (!isDatabaseConfigured()) {
    return localStore.listAnnouncementsAdmin();
  }
  return queryRows<RowDataPacket[]>('SELECT * FROM announcements ORDER BY created_at DESC');
}

export async function createAnnouncementAdmin(
  actorUserId: number,
  data: {
    titleEn: string;
    titleRw: string;
    titleFr: string;
    bodyEn: string;
    bodyRw: string;
    bodyFr: string;
    audience: string;
    isActive: boolean;
  },
  ipAddress?: string,
) {
  if (!isDatabaseConfigured()) {
    return localStore.createAnnouncementAdmin(actorUserId, data, ipAddress);
  }
  return withTransaction(async (conn) => {
    const [res] = await conn.execute<any>(
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
        actorUserId,
      ],
    );
    await recordAuditLog({
      actorUserId,
      action: 'ADMIN_ANNOUNCEMENT_CREATED',
      targetType: 'announcement',
      targetId: Number(res.insertId),
      ipAddress,
      conn,
    });
    return { id: Number(res.insertId) };
  });
}

export async function listAuditLogsAdmin() {
  if (!isDatabaseConfigured()) {
    return localStore.listAuditLogsAdmin();
  }
  return queryRows<RowDataPacket[]>(
    `SELECT al.*, up.username AS actor_username
     FROM audit_logs al
     LEFT JOIN user_profiles up ON up.user_id = al.actor_user_id
     ORDER BY al.created_at DESC
     LIMIT 100`,
  );
}

export async function listSettingsAdmin() {
  if (!isDatabaseConfigured()) {
    return localStore.listSettingsAdmin();
  }
  return queryRows<RowDataPacket[]>('SELECT * FROM platform_settings ORDER BY setting_key ASC');
}

export async function updateSettingAdmin(
  actorUserId: number,
  key: string,
  valueObj: unknown,
  ipAddress?: string,
) {
  if (!isDatabaseConfigured()) {
    return localStore.updateSettingAdmin(actorUserId, key, valueObj, ipAddress);
  }
  await withTransaction(async (conn) => {
    await conn.execute(
      `INSERT INTO platform_settings (setting_key, setting_value_json, updated_by)
       VALUES (?, CAST(? AS JSON), ?)
       ON DUPLICATE KEY UPDATE setting_value_json = CAST(? AS JSON), updated_by = ?`,
      [key, JSON.stringify(valueObj), actorUserId, JSON.stringify(valueObj), actorUserId],
    );
    await recordAuditLog({
      actorUserId,
      action: 'ADMIN_SETTING_UPDATED',
      targetType: 'setting',
      targetId: key,
      metadata: { valueObj },
      ipAddress,
      conn,
    });
  });
}
