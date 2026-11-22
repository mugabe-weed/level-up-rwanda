import { NextFunction, Request, Response, Router } from 'express';
import {
  adminCreateAnnouncementSchema,
  adminCreateChallengeSchema,
  adminCreateCourseSchema,
  adminCreateQuestionSchema,
  bootstrapAdminSchema,
  challengeSubmissionSchema,
  confirmPasswordResetSchema,
  createCommentSchema,
  createGroupSchema,
  createOpportunitySchema,
  createPostSchema,
  lessonCompletionSchema,
  loginSchema,
  registerSchema,
  reportContentSchema,
  requestPasswordResetSchema,
  SUPPORTED_LANGUAGES,
  updateNotificationPrefsSchema,
  updateProfileSchema,
  USER_ROLES,
  verifyContactSchema,
} from '../../shared/schemas.ts';
import { z } from 'zod';
import { appConfig } from '../config.ts';
import { provisionFirstSuperAdmin } from '../db/bootstrapAdmin.ts';
import { isDatabaseConfigured, pingDatabase } from '../db/pool.ts';
import { authenticateSession, optionalAuth, requireRole } from '../middleware/auth.ts';
import {
  authRateLimiter,
  SESSION_COOKIE_NAME,
  uploadRateLimiter,
} from '../middleware/security.ts';
import {
  addQuestionAdmin,
  createAnnouncementAdmin,
  createChallengeAdmin,
  createCourseAdmin,
  createOrganizationAdmin,
  getAdminOverview,
  listAllChallengesAdmin,
  listAllOpportunitiesAdmin,
  listAnnouncementsAdmin,
  listAuditLogsAdmin,
  listModerationQueueAdmin,
  listOrganizationsAdmin,
  listSettingsAdmin,
  listUsersAdmin,
  moderatePostAdmin,
  resolveReportAdmin,
  updateOpportunityStatusAdmin,
  updateSettingAdmin,
  updateUserRoleOrStatusAdmin,
} from '../services/adminService.ts';
import {
  confirmPasswordReset,
  hasAnySuperAdmin,
  loginUser,
  logoutSession,
  registerUser,
  requestPasswordReset,
  verifyUserContact,
} from '../services/authService.ts';
import {
  getChallengeDetail,
  getLeaderboard,
  listChallengeCategories,
  listChallenges,
  submitChallengeAttempt,
} from '../services/challengeService.ts';
import {
  addComment,
  blockUser,
  createContentReport,
  createGroup,
  createPost,
  listComments,
  listGroups,
  listPosts,
  toggleFollowUser,
  toggleGroupMembership,
  togglePostReaction,
  unblockUser,
} from '../services/communityService.ts';
import { getUnifiedDashboard } from '../services/dashboardService.ts';
import {
  completeLesson,
  enrollInCourse,
  getCourseDetail,
  listCourseCategories,
  listCourses,
} from '../services/learnService.ts';
import {
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationPreferences,
} from '../services/notificationService.ts';
import {
  listOpportunities,
  listOpportunityCategories,
  submitOpportunity,
  toggleSavedOpportunity,
} from '../services/opportunityService.ts';
import {
  getUserProfileByUsername,
  updateOwnProfile,
  updateUserAvatar,
  updateUserLanguage,
} from '../services/profileService.ts';
import {
  authorizeMediaAccess,
  createUploadStorageProvider,
  sanitizeMediaCoordinates,
  saveValidatedUploadedImage,
  uploadImageMiddleware,
} from '../uploads.ts';
import { timingSafeEqualsString } from '../utils/crypto.ts';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.ts';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createV1Router(): Router {
  const router = Router();

  // ---------------------------------------------------------------------------
  // Health & Readiness
  // ---------------------------------------------------------------------------
  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'levelup-rwanda',
      databaseConfigured: isDatabaseConfigured(),
      timestamp: new Date().toISOString(),
    });
  });

  router.get(
    '/ready',
    asyncHandler(async (_req, res) => {
      const db = await pingDatabase();
      if (!db.connected) {
        res.status(503).json({
          ok: false,
          ready: false,
          database: db,
        });
        return;
      }
      res.json({
        ok: true,
        ready: true,
        database: db,
      });
    }),
  );

  // ---------------------------------------------------------------------------
  // Permission-Aware Persistent Media Delivery (GCS / Local)
  // ---------------------------------------------------------------------------
  router.get(
    '/media/:folder/:filename',
    optionalAuth,
    asyncHandler(async (req, res) => {
      const { folder, filename, relativeKey } = sanitizeMediaCoordinates(
        String(req.params.folder || ''),
        String(req.params.filename || ''),
      );

      const { visibility } = await authorizeMediaAccess({
        folder,
        filename,
        viewerUserId: req.user?.id,
        viewerRole: req.user?.role,
      });

      const provider = createUploadStorageProvider();

      if (
        provider.driver === 'gcs' &&
        appConfig.gcsDeliveryMode === 'signed_url' &&
        provider.getSignedReadUrl
      ) {
        const signedUrl = await provider.getSignedReadUrl(
          relativeKey,
          appConfig.gcsSignedUrlTtlSeconds,
        );
        res.setHeader(
          'Cache-Control',
          visibility === 'public' ? 'public, max-age=60' : 'private, no-store',
        );
        res.redirect(302, signedUrl);
        return;
      }

      const object = await provider.openReadStream(relativeKey);
      if (!object) {
        throw new NotFoundError('Media file not found');
      }

      res.setHeader('Content-Type', object.contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader(
        'Cache-Control',
        visibility === 'public' ? 'public, max-age=86400' : 'private, max-age=300',
      );
      object.stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).end();
        }
      });
      object.stream.pipe(res);
    }),
  );

  // ---------------------------------------------------------------------------
  // Authentication & Session
  // ---------------------------------------------------------------------------
  router.get(
    '/auth/me',
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
          databaseConfigured: isDatabaseConfigured(),
        },
      });
    }),
  );

  router.post(
    '/auth/register',
    authRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = registerSchema.parse(req.body);
      const result = await registerUser({
        ...parsed,
        ipAddress: req.ip,
      });
      res.status(201).json({
        ok: true,
        data: result,
      });
    }),
  );

  router.post(
    '/auth/login',
    authRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = loginSchema.parse(req.body);
      const { sessionToken, userId } = await loginUser({
        identifier: parsed.identifier,
        password: parsed.password,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.cookie(SESSION_COOKIE_NAME, sessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: appConfig.cookieSecure,
        path: '/',
        maxAge: appConfig.sessionTtlHours * 60 * 60 * 1000,
      });

      res.json({
        ok: true,
        data: { userId },
      });
    }),
  );

  router.post(
    '/auth/logout',
    authenticateSession,
    asyncHandler(async (req, res) => {
      if (req.sessionId && req.user) {
        await logoutSession(req.sessionId, req.user.id, req.ip);
      }
      res.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        sameSite: 'lax',
        secure: appConfig.cookieSecure,
        path: '/',
      });
      res.json({ ok: true, data: { loggedOut: true } });
    }),
  );

  router.post(
    '/auth/verify-contact',
    authRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = verifyContactSchema.parse(req.body);
      await verifyUserContact(parsed.identifier, parsed.code);
      res.json({ ok: true, data: { verified: true } });
    }),
  );

  router.post(
    '/auth/password-reset/request',
    authRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = requestPasswordResetSchema.parse(req.body);
      const result = await requestPasswordReset(parsed.identifier, req.ip);
      res.json({ ok: true, data: result });
    }),
  );

  router.post(
    '/auth/password-reset/confirm',
    authRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = confirmPasswordResetSchema.parse(req.body);
      await confirmPasswordReset({
        ...parsed,
        ipAddress: req.ip,
      });
      res.json({ ok: true, data: { reset: true } });
    }),
  );

  router.post(
    '/auth/bootstrap-admin',
    authRateLimiter,
    asyncHandler(async (req, res) => {
      if (!appConfig.adminBootstrapToken) {
        throw new ForbiddenError(
          'ADMIN_BOOTSTRAP_TOKEN is not configured in server environment variables.',
        );
      }
      const parsed = bootstrapAdminSchema.parse(req.body);
      if (!timingSafeEqualsString(parsed.bootstrapToken, appConfig.adminBootstrapToken)) {
        throw new ForbiddenError('Invalid administrator bootstrap token.');
      }
      const created = await provisionFirstSuperAdmin({
        email: parsed.email,
        displayName: parsed.displayName,
        username: parsed.username,
        password: parsed.password,
        ipAddress: req.ip,
      });
      res.status(201).json({ ok: true, data: created });
    }),
  );

  // ---------------------------------------------------------------------------
  // Unified Dashboard
  // ---------------------------------------------------------------------------
  router.get(
    '/dashboard',
    optionalAuth,
    asyncHandler(async (req, res) => {
      const data = await getUnifiedDashboard(req.user?.id);
      res.json({ ok: true, data });
    }),
  );

  // ---------------------------------------------------------------------------
  // Play (Challenges, Scoring, Leaderboards)
  // ---------------------------------------------------------------------------
  router.get(
    '/challenges/categories',
    asyncHandler(async (_req, res) => {
      const categories = await listChallengeCategories();
      res.json({ ok: true, data: categories });
    }),
  );

  router.get(
    '/challenges/leaderboard',
    asyncHandler(async (req, res) => {
      const periodRaw = String(req.query.period || 'weekly');
      const period = ['daily', 'weekly', 'monthly', 'all'].includes(periodRaw)
        ? (periodRaw as 'daily' | 'weekly' | 'monthly' | 'all')
        : 'weekly';
      const rows = await getLeaderboard(period);
      res.json({ ok: true, data: rows });
    }),
  );

  router.get(
    '/challenges',
    optionalAuth,
    asyncHandler(async (req, res) => {
      const challenges = await listChallenges({
        categorySlug: req.query.category ? String(req.query.category) : undefined,
        difficulty: req.query.difficulty ? String(req.query.difficulty) : undefined,
        challengeType: req.query.type ? String(req.query.type) : undefined,
        search: req.query.q ? String(req.query.q) : undefined,
        userId: req.user?.id,
      });
      res.json({ ok: true, data: challenges });
    }),
  );

  router.get(
    '/challenges/:slug',
    optionalAuth,
    asyncHandler(async (req, res) => {
      const detail = await getChallengeDetail(String(req.params.slug), req.user?.id);
      res.json({ ok: true, data: detail });
    }),
  );

  router.post(
    '/challenges/:slug/submit',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const parsed = challengeSubmissionSchema.parse(req.body);
      const result = await submitChallengeAttempt({
        slug: String(req.params.slug),
        userId: req.user!.id,
        answers: parsed.answers,
        durationSeconds: parsed.durationSeconds,
      });
      res.status(201).json({ ok: true, data: result });
    }),
  );

  // ---------------------------------------------------------------------------
  // Learn (Courses, Modules, Lessons, Assessments)
  // ---------------------------------------------------------------------------
  router.get(
    '/courses/categories',
    asyncHandler(async (_req, res) => {
      const categories = await listCourseCategories();
      res.json({ ok: true, data: categories });
    }),
  );

  router.get(
    '/courses',
    optionalAuth,
    asyncHandler(async (req, res) => {
      const courses = await listCourses({
        categorySlug: req.query.category ? String(req.query.category) : undefined,
        level: req.query.level ? String(req.query.level) : undefined,
        search: req.query.q ? String(req.query.q) : undefined,
        userId: req.user?.id,
      });
      res.json({ ok: true, data: courses });
    }),
  );

  router.get(
    '/courses/:slug',
    optionalAuth,
    asyncHandler(async (req, res) => {
      const detail = await getCourseDetail(String(req.params.slug), req.user?.id);
      res.json({ ok: true, data: detail });
    }),
  );

  router.post(
    '/courses/:slug/enroll',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const enrollment = await enrollInCourse(String(req.params.slug), req.user!.id);
      res.status(201).json({ ok: true, data: enrollment });
    }),
  );

  router.post(
    '/courses/:slug/lessons/:lessonId/complete',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const lessonId = Number.parseInt(String(req.params.lessonId), 10);
      if (!Number.isFinite(lessonId) || lessonId <= 0) {
        throw new ValidationError('Invalid lesson ID');
      }
      const parsed = lessonCompletionSchema.parse(req.body || {});
      const result = await completeLesson({
        slug: String(req.params.slug),
        lessonId,
        userId: req.user!.id,
        selectedOptionIndex: parsed.selectedOptionIndex,
      });
      res.json({ ok: true, data: result });
    }),
  );

  // ---------------------------------------------------------------------------
  // Create & Connect (Posts, Media Uploads, Reactions, Comments, Groups, Safety)
  // ---------------------------------------------------------------------------
  router.get(
    '/community/posts',
    optionalAuth,
    asyncHandler(async (req, res) => {
      const postTypeRaw = req.query.postType ? String(req.query.postType) : undefined;
      const postType =
        postTypeRaw === 'create_showcase' || postTypeRaw === 'discussion' ? postTypeRaw : undefined;
      const posts = await listPosts({
        postType,
        category: req.query.category ? String(req.query.category) : undefined,
        groupId: req.query.groupId ? Number.parseInt(String(req.query.groupId), 10) : undefined,
        search: req.query.q ? String(req.query.q) : undefined,
        viewerUserId: req.user?.id,
        limit: req.query.limit ? Number.parseInt(String(req.query.limit), 10) : 20,
        offset: req.query.offset ? Number.parseInt(String(req.query.offset), 10) : 0,
      });
      res.json({ ok: true, data: posts });
    }),
  );

  router.post(
    '/community/posts',
    authenticateSession,
    uploadRateLimiter,
    uploadImageMiddleware.single('image'),
    asyncHandler(async (req, res) => {
      const parsed = createPostSchema.parse({
        postType: req.body.postType || 'create_showcase',
        category: req.body.category,
        title: req.body.title,
        body: req.body.body,
        groupId: req.body.groupId ? Number.parseInt(String(req.body.groupId), 10) : null,
      });

      let mediaUrl: string | null = null;
      let mediaMime: string | null = null;
      if (req.file) {
        const saved = await saveValidatedUploadedImage(
          req.file,
          'posts',
          parsed.groupId ? 'community' : 'public',
        );
        mediaUrl = saved.url;
        mediaMime = saved.mime;
      }

      const created = await createPost({
        userId: req.user!.id,
        postType: parsed.postType,
        category: parsed.category,
        title: parsed.title,
        body: parsed.body,
        groupId: parsed.groupId,
        mediaUrl,
        mediaMime,
      });

      res.status(201).json({ ok: true, data: created });
    }),
  );

  router.post(
    '/community/posts/:postId/react',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const postId = Number.parseInt(String(req.params.postId), 10);
      if (!Number.isFinite(postId) || postId <= 0) throw new ValidationError('Invalid post ID');
      const reactionRaw = String(req.body?.reactionType || 'like');
      const reactionType = ['like', 'celebrate', 'helpful'].includes(reactionRaw)
        ? (reactionRaw as 'like' | 'celebrate' | 'helpful')
        : 'like';
      const result = await togglePostReaction({ postId, userId: req.user!.id, reactionType });
      res.json({ ok: true, data: result });
    }),
  );

  router.get(
    '/community/posts/:postId/comments',
    optionalAuth,
    asyncHandler(async (req, res) => {
      const postId = Number.parseInt(String(req.params.postId), 10);
      if (!Number.isFinite(postId) || postId <= 0) throw new ValidationError('Invalid post ID');
      const comments = await listComments(postId, req.user?.id);
      res.json({ ok: true, data: comments });
    }),
  );

  router.post(
    '/community/posts/:postId/comments',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const postId = Number.parseInt(String(req.params.postId), 10);
      if (!Number.isFinite(postId) || postId <= 0) throw new ValidationError('Invalid post ID');
      const parsed = createCommentSchema.parse(req.body);
      const result = await addComment({ postId, userId: req.user!.id, body: parsed.body });
      res.status(201).json({ ok: true, data: result });
    }),
  );

  router.get(
    '/community/groups',
    optionalAuth,
    asyncHandler(async (req, res) => {
      const groups = await listGroups(req.user?.id);
      res.json({ ok: true, data: groups });
    }),
  );

  router.post(
    '/community/groups',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const parsed = createGroupSchema.parse(req.body);
      const created = await createGroup({
        userId: req.user!.id,
        ...parsed,
      });
      res.status(201).json({ ok: true, data: created });
    }),
  );

  router.post(
    '/community/groups/:groupId/toggle-join',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const groupId = Number.parseInt(String(req.params.groupId), 10);
      if (!Number.isFinite(groupId) || groupId <= 0) throw new ValidationError('Invalid group ID');
      const result = await toggleGroupMembership(groupId, req.user!.id);
      res.json({ ok: true, data: result });
    }),
  );

  router.post(
    '/community/users/:userId/follow',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const targetUserId = Number.parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
        throw new ValidationError('Invalid user ID');
      }
      const result = await toggleFollowUser(req.user!.id, targetUserId);
      res.json({ ok: true, data: result });
    }),
  );

  router.post(
    '/community/users/:userId/block',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const targetUserId = Number.parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
        throw new ValidationError('Invalid user ID');
      }
      await blockUser(req.user!.id, targetUserId, req.body?.reason);
      res.json({ ok: true, data: { blocked: true } });
    }),
  );

  router.delete(
    '/community/users/:userId/block',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const targetUserId = Number.parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
        throw new ValidationError('Invalid user ID');
      }
      await unblockUser(req.user!.id, targetUserId);
      res.json({ ok: true, data: { blocked: false } });
    }),
  );

  router.post(
    '/community/reports',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const parsed = reportContentSchema.parse(req.body);
      const created = await createContentReport({
        reporterId: req.user!.id,
        ...parsed,
      });
      res.status(201).json({ ok: true, data: created });
    }),
  );

  // ---------------------------------------------------------------------------
  // Opportunities
  // ---------------------------------------------------------------------------
  router.get(
    '/opportunities/categories',
    asyncHandler(async (_req, res) => {
      const categories = await listOpportunityCategories();
      res.json({ ok: true, data: categories });
    }),
  );

  router.get(
    '/opportunities',
    optionalAuth,
    asyncHandler(async (req, res) => {
      const opportunities = await listOpportunities({
        type: req.query.type ? String(req.query.type) : undefined,
        categorySlug: req.query.category ? String(req.query.category) : undefined,
        remoteOnly: req.query.remote === 'true',
        verifiedOnly: req.query.verified === 'true',
        includeExpired: req.query.includeExpired === 'true',
        search: req.query.q ? String(req.query.q) : undefined,
        userId: req.user?.id,
      });
      res.json({ ok: true, data: opportunities });
    }),
  );

  router.post(
    '/opportunities',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const parsed = createOpportunitySchema.parse(req.body);
      const isAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';
      const created = await submitOpportunity({
        userId: req.user!.id,
        ...parsed,
        autoApprove: isAdmin,
      });
      res.status(201).json({ ok: true, data: created });
    }),
  );

  router.post(
    '/opportunities/:id/save',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const oppId = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(oppId) || oppId <= 0) {
        throw new ValidationError('Invalid opportunity ID');
      }
      const result = await toggleSavedOpportunity(oppId, req.user!.id);
      res.json({ ok: true, data: result });
    }),
  );

  // ---------------------------------------------------------------------------
  // User Profiles & Preferences
  // ---------------------------------------------------------------------------
  router.get(
    '/profile/:username',
    optionalAuth,
    asyncHandler(async (req, res) => {
      const profileData = await getUserProfileByUsername(String(req.params.username), req.user?.id);
      res.json({ ok: true, data: profileData });
    }),
  );

  router.put(
    '/profile/me',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const parsed = updateProfileSchema.parse(req.body);
      await updateOwnProfile(req.user!.id, parsed);
      res.json({ ok: true, data: { updated: true } });
    }),
  );

  router.post(
    '/profile/me/avatar',
    authenticateSession,
    uploadRateLimiter,
    uploadImageMiddleware.single('avatar'),
    asyncHandler(async (req, res) => {
      if (!req.file) {
        throw new ValidationError('Select an image file to upload');
      }
      const saved = await saveValidatedUploadedImage(req.file, 'avatars');
      await updateUserAvatar(req.user!.id, saved.url);
      res.json({ ok: true, data: { avatarUrl: saved.url } });
    }),
  );

  router.patch(
    '/profile/me/language',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const parsed = z.object({ language: z.enum(SUPPORTED_LANGUAGES) }).parse(req.body);
      await updateUserLanguage(req.user!.id, parsed.language);
      res.json({ ok: true, data: { preferredLanguage: parsed.language } });
    }),
  );

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------
  router.get(
    '/notifications',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const data = await listNotifications(req.user!.id);
      res.json({ ok: true, data });
    }),
  );

  router.post(
    '/notifications/:id/read',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id) || id <= 0) throw new ValidationError('Invalid notification ID');
      await markNotificationRead(req.user!.id, id);
      res.json({ ok: true, data: { read: true } });
    }),
  );

  router.post(
    '/notifications/read-all',
    authenticateSession,
    asyncHandler(async (req, res) => {
      await markAllNotificationsRead(req.user!.id);
      res.json({ ok: true, data: { readAll: true } });
    }),
  );

  router.get(
    '/notifications/preferences',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const prefs = await getNotificationPreferences(req.user!.id);
      res.json({ ok: true, data: prefs });
    }),
  );

  router.put(
    '/notifications/preferences',
    authenticateSession,
    asyncHandler(async (req, res) => {
      const parsed = updateNotificationPrefsSchema.parse(req.body);
      await updateNotificationPreferences(req.user!.id, parsed);
      res.json({ ok: true, data: parsed });
    }),
  );

  // ---------------------------------------------------------------------------
  // Administration Console (Strict RBAC)
  // ---------------------------------------------------------------------------
  const adminRouter = Router();
  adminRouter.use(authenticateSession);

  adminRouter.get(
    '/overview',
    requireRole('moderator', 'educator', 'admin', 'super_admin'),
    asyncHandler(async (_req, res) => {
      const overview = await getAdminOverview();
      res.json({ ok: true, data: overview });
    }),
  );

  adminRouter.get(
    '/users',
    requireRole('admin', 'super_admin'),
    asyncHandler(async (req, res) => {
      const users = await listUsersAdmin(req.query.q ? String(req.query.q) : undefined);
      res.json({ ok: true, data: users });
    }),
  );

  adminRouter.patch(
    '/users/:userId',
    requireRole('admin', 'super_admin'),
    asyncHandler(async (req, res) => {
      const targetUserId = Number.parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
        throw new ValidationError('Invalid user ID');
      }
      const parsed = z
        .object({
          role: z.enum(USER_ROLES).optional(),
          status: z.enum(['active', 'suspended']).optional(),
        })
        .parse(req.body);
      await updateUserRoleOrStatusAdmin({
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        targetUserId,
        role: parsed.role,
        status: parsed.status,
        ipAddress: req.ip,
      });
      res.json({ ok: true, data: { updated: true } });
    }),
  );

  adminRouter.get(
    '/challenges',
    requireRole('educator', 'admin', 'super_admin'),
    asyncHandler(async (_req, res) => {
      const rows = await listAllChallengesAdmin();
      res.json({ ok: true, data: rows });
    }),
  );

  adminRouter.post(
    '/challenges',
    requireRole('educator', 'admin', 'super_admin'),
    asyncHandler(async (req, res) => {
      const parsed = adminCreateChallengeSchema.parse(req.body);
      const created = await createChallengeAdmin(req.user!.id, parsed, req.ip);
      res.status(201).json({ ok: true, data: created });
    }),
  );

  adminRouter.post(
    '/challenges/questions',
    requireRole('educator', 'admin', 'super_admin'),
    asyncHandler(async (req, res) => {
      const parsed = adminCreateQuestionSchema.parse(req.body);
      const created = await addQuestionAdmin(req.user!.id, parsed, req.ip);
      res.status(201).json({ ok: true, data: created });
    }),
  );

  adminRouter.post(
    '/courses',
    requireRole('educator', 'admin', 'super_admin'),
    asyncHandler(async (req, res) => {
      const parsed = adminCreateCourseSchema.parse(req.body);
      const created = await createCourseAdmin(req.user!.id, parsed, req.ip);
      res.status(201).json({ ok: true, data: created });
    }),
  );

  adminRouter.get(
    '/moderation',
    requireRole('moderator', 'admin', 'super_admin'),
    asyncHandler(async (_req, res) => {
      const queue = await listModerationQueueAdmin();
      res.json({ ok: true, data: queue });
    }),
  );

  adminRouter.patch(
    '/moderation/posts/:postId',
    requireRole('moderator', 'admin', 'super_admin'),
    asyncHandler(async (req, res) => {
      const postId = Number.parseInt(String(req.params.postId), 10);
      const parsed = z.object({ status: z.enum(['approved', 'hidden', 'removed']) }).parse(req.body);
      await moderatePostAdmin(req.user!.id, postId, parsed.status, req.ip);
      res.json({ ok: true, data: { updated: true } });
    }),
  );

  adminRouter.patch(
    '/moderation/reports/:reportId',
    requireRole('moderator', 'admin', 'super_admin'),
    asyncHandler(async (req, res) => {
      const reportId = Number.parseInt(String(req.params.reportId), 10);
      const parsed = z
        .object({
          status: z.enum(['reviewing', 'resolved', 'dismissed']),
          resolutionNote: z.string().max(500).optional(),
        })
        .parse(req.body);
      await resolveReportAdmin(req.user!.id, reportId, parsed.status, parsed.resolutionNote, req.ip);
      res.json({ ok: true, data: { updated: true } });
    }),
  );

  adminRouter.get(
    '/opportunities',
    requireRole('admin', 'super_admin'),
    asyncHandler(async (_req, res) => {
      const rows = await listAllOpportunitiesAdmin();
      res.json({ ok: true, data: rows });
    }),
  );

  adminRouter.patch(
    '/opportunities/:id',
    requireRole('admin', 'super_admin'),
    asyncHandler(async (req, res) => {
      const oppId = Number.parseInt(String(req.params.id), 10);
      const parsed = z
        .object({
          approvalStatus: z.enum(['pending', 'approved', 'rejected', 'expired']).optional(),
          verifiedStatus: z.enum(['unverified', 'verified']).optional(),
        })
        .parse(req.body);
      await updateOpportunityStatusAdmin(req.user!.id, oppId, parsed, req.ip);
      res.json({ ok: true, data: { updated: true } });
    }),
  );

  adminRouter.get(
    '/organizations',
    requireRole('admin', 'super_admin'),
    asyncHandler(async (_req, res) => {
      const rows = await listOrganizationsAdmin();
      res.json({ ok: true, data: rows });
    }),
  );

  adminRouter.post(
    '/organizations',
    requireRole('admin', 'super_admin'),
    asyncHandler(async (req, res) => {
      const parsed = z
        .object({
          name: z.string().trim().min(2).max(140),
          orgType: z.string().trim().min(2).max(64),
          websiteUrl: z.string().trim().url().optional().or(z.literal('')),
          description: z.string().trim().max(1000).optional(),
          verified: z.boolean().default(true),
        })
        .parse(req.body);
      const created = await createOrganizationAdmin(req.user!.id, parsed, req.ip);
      res.status(201).json({ ok: true, data: created });
    }),
  );

  adminRouter.get(
    '/announcements',
    requireRole('admin', 'super_admin'),
    asyncHandler(async (_req, res) => {
      const rows = await listAnnouncementsAdmin();
      res.json({ ok: true, data: rows });
    }),
  );

  adminRouter.post(
    '/announcements',
    requireRole('admin', 'super_admin'),
    asyncHandler(async (req, res) => {
      const parsed = adminCreateAnnouncementSchema.parse(req.body);
      const created = await createAnnouncementAdmin(req.user!.id, parsed, req.ip);
      res.status(201).json({ ok: true, data: created });
    }),
  );

  adminRouter.get(
    '/audit-logs',
    requireRole('admin', 'super_admin'),
    asyncHandler(async (_req, res) => {
      const rows = await listAuditLogsAdmin();
      res.json({ ok: true, data: rows });
    }),
  );

  adminRouter.get(
    '/settings',
    requireRole('admin', 'super_admin'),
    asyncHandler(async (_req, res) => {
      const rows = await listSettingsAdmin();
      res.json({ ok: true, data: rows });
    }),
  );

  adminRouter.put(
    '/settings/:key',
    requireRole('super_admin'),
    asyncHandler(async (req, res) => {
      const key = String(req.params.key);
      await updateSettingAdmin(req.user!.id, key, req.body?.value ?? {}, req.ip);
      res.json({ ok: true, data: { updated: true } });
    }),
  );

  router.use('/admin', adminRouter);

  return router;
}
