import { RowDataPacket } from 'mysql2/promise';
import { localStore } from '../db/localStore.ts';
import { isDatabaseConfigured, queryRows } from '../db/pool.ts';
import { listChallenges } from './challengeService.ts';
import { listCourses } from './learnService.ts';
import { listOpportunities } from './opportunityService.ts';
import { listPosts } from './communityService.ts';

export async function getUnifiedDashboard(userId?: number) {
  if (!isDatabaseConfigured()) {
    return localStore.getUnifiedDashboard(userId);
  }
  const [challenges, courses, posts, opportunities, announcements] = await Promise.all([
    listChallenges({ userId }),
    listCourses({ userId }),
    listPosts({ viewerUserId: userId, limit: 4 }),
    listOpportunities({ userId }),
    queryRows<RowDataPacket[]>(
      `SELECT id, title_en, title_rw, title_fr, body_en, body_rw, body_fr, audience, created_at
       FROM announcements
       WHERE is_active = 1
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at >= NOW())
       ORDER BY created_at DESC
       LIMIT 3`,
    ),
  ]);

  const featuredChallenge = challenges.find((c) => c.is_featured) || challenges[0] || null;
  const recommendedCourses = courses.slice(0, 3);
  const featuredOpportunities = opportunities.slice(0, 4);

  let userSummary: Record<string, unknown> | null = null;
  let recentAchievements: RowDataPacket[] = [];

  if (userId) {
    const [chDone] = await queryRows<RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM challenge_submissions WHERE user_id = ?',
      [userId],
    );
    const [coursesDone] = await queryRows<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM course_enrollments WHERE user_id = ? AND status = 'completed'",
      [userId],
    );
    const [coursesActive] = await queryRows<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM course_enrollments WHERE user_id = ? AND status = 'enrolled'",
      [userId],
    );
    const [postsDone] = await queryRows<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM creative_posts WHERE user_id = ? AND moderation_status != 'removed'",
      [userId],
    );
    const [savedOpps] = await queryRows<RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM saved_opportunities WHERE user_id = ?',
      [userId],
    );

    userSummary = {
      challengesCompleted: Number(chDone?.cnt ?? 0),
      coursesCompleted: Number(coursesDone?.cnt ?? 0),
      coursesInProgress: Number(coursesActive?.cnt ?? 0),
      postsCreated: Number(postsDone?.cnt ?? 0),
      savedOpportunities: Number(savedOpps?.cnt ?? 0),
    };

    recentAchievements = await queryRows<RowDataPacket[]>(
      `SELECT a.slug, a.title_en, a.title_rw, a.title_fr, a.badge_tier, a.icon_name, ua.unlocked_at
       FROM user_achievements ua
       INNER JOIN achievements a ON a.id = ua.achievement_id
       WHERE ua.user_id = ?
       ORDER BY ua.unlocked_at DESC
       LIMIT 6`,
      [userId],
    );
  }

  return {
    featuredChallenge,
    recommendedCourses,
    recentCommunityActivity: posts,
    featuredOpportunities,
    announcements,
    userSummary,
    recentAchievements,
  };
}
