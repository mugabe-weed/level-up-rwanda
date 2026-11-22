import { RowDataPacket } from 'mysql2/promise';
import { localStore } from '../db/localStore.ts';
import { isDatabaseConfigured, queryRows, withTransaction } from '../db/pool.ts';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.ts';
import {
  awardXpInTransaction,
  evaluateAndUnlockAchievementsInTransaction,
  updateChallengeStreakInTransaction,
} from './gamificationService.ts';

export async function listChallengeCategories() {
  if (!isDatabaseConfigured()) {
    return localStore.listChallengeCategories();
  }
  return queryRows<RowDataPacket[]>(
    'SELECT id, slug, name_en, name_rw, name_fr, description_en, description_rw, description_fr FROM challenge_categories WHERE is_active = 1 ORDER BY sort_order ASC',
  );
}

export async function listChallenges(params: {
  categorySlug?: string;
  difficulty?: string;
  challengeType?: string;
  search?: string;
  userId?: number;
}) {
  if (!isDatabaseConfigured()) {
    return localStore.listChallenges(params);
  }
  const conditions: string[] = ["c.status = 'published'"];
  const values: unknown[] = [];

  if (params.categorySlug) {
    conditions.push('cat.slug = ?');
    values.push(params.categorySlug);
  }
  if (params.difficulty) {
    conditions.push('c.difficulty = ?');
    values.push(params.difficulty);
  }
  if (params.challengeType) {
    conditions.push('c.challenge_type = ?');
    values.push(params.challengeType);
  }
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push('(c.title_en LIKE ? OR c.title_rw LIKE ? OR c.title_fr LIKE ? OR c.description_en LIKE ?)');
    values.push(q, q, q, q);
  }

  const userSubJoin = params.userId
    ? 'LEFT JOIN challenge_submissions cs ON cs.challenge_id = c.id AND cs.user_id = ?'
    : '';
  const queryParams = params.userId ? [params.userId, ...values] : values;

  const rows = await queryRows<RowDataPacket[]>(
    `SELECT
       c.id, c.slug, c.title_en, c.title_rw, c.title_fr,
       c.description_en, c.description_rw, c.description_fr,
       c.difficulty, c.challenge_type, c.time_limit_seconds, c.xp_reward,
       c.active_date, c.is_featured, c.is_sample,
       cat.slug AS category_slug, cat.name_en AS category_name_en, cat.name_rw AS category_name_rw, cat.name_fr AS category_name_fr,
       (SELECT COUNT(*) FROM challenge_questions q WHERE q.challenge_id = c.id) AS question_count
       ${params.userId ? ', cs.id AS submission_id, cs.score AS user_score, cs.max_score AS user_max_score, cs.xp_awarded AS user_xp_awarded, cs.submitted_at AS user_submitted_at' : ''}
     FROM challenges c
     INNER JOIN challenge_categories cat ON cat.id = c.category_id
     ${userSubJoin}
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.is_featured DESC, c.created_at DESC`,
    queryParams,
  );

  return rows;
}

export async function getChallengeDetail(slug: string, userId?: number) {
  if (!isDatabaseConfigured()) {
    return localStore.getChallengeDetail(slug, userId);
  }
  const rows = await queryRows<RowDataPacket[]>(
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
    [slug],
  );

  if (rows.length === 0) {
    throw new NotFoundError('Challenge not found.');
  }

  const challenge = rows[0];
  let userSubmission: RowDataPacket | null = null;
  if (userId) {
    const subs = await queryRows<RowDataPacket[]>(
      'SELECT * FROM challenge_submissions WHERE challenge_id = ? AND user_id = ? LIMIT 1',
      [challenge.id, userId],
    );
    if (subs.length > 0) {
      userSubmission = subs[0];
    }
  }

  // Only reveal correct_option_index & explanation if the user has already completed this challenge!
  const questionsRaw = await queryRows<RowDataPacket[]>(
    `SELECT id, prompt_en, prompt_rw, prompt_fr, options_json, points_weight, sort_order
            ${userSubmission ? ', correct_option_index, explanation_en, explanation_rw, explanation_fr' : ''}
     FROM challenge_questions
     WHERE challenge_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [challenge.id],
  );

  const questions = questionsRaw.map((q) => ({
    ...q,
    options: typeof q.options_json === 'string' ? JSON.parse(q.options_json) : q.options_json,
  }));

  return {
    challenge,
    questions,
    userSubmission: userSubmission
      ? {
          ...userSubmission,
          answers:
            typeof userSubmission.answers_json === 'string'
              ? JSON.parse(userSubmission.answers_json)
              : userSubmission.answers_json,
        }
      : null,
  };
}

export function evaluateChallengeAnswers(
  questions: Array<{
    id: number;
    correctOptionIndex: number;
    pointsWeight: number;
    explanationEn: string;
    explanationRw: string;
    explanationFr: string;
  }>,
  submittedAnswers: Array<{ questionId: number; selectedOptionIndex: number }>,
  challengeXpReward: number,
) {
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
      explanationFr: q.explanationFr,
    };
  });

  const ratio = maxScore > 0 ? score / maxScore : 0;
  // Minimum 25% participation XP if completed, scaled up to full xpReward on accuracy
  const xpAwarded = Math.max(Math.round(challengeXpReward * 0.25), Math.round(challengeXpReward * ratio));

  return {
    score,
    maxScore,
    correctCount,
    totalQuestions: questions.length,
    xpAwarded,
    breakdown,
  };
}

export async function submitChallengeAttempt(params: {
  slug: string;
  userId: number;
  answers: Array<{ questionId: number; selectedOptionIndex: number }>;
  durationSeconds: number;
}) {
  if (!isDatabaseConfigured()) {
    return localStore.submitChallengeAttempt(params, evaluateChallengeAnswers);
  }
  return withTransaction(async (conn) => {
    const [chRows] = await conn.execute<RowDataPacket[]>(
      "SELECT id, title_en, xp_reward, time_limit_seconds FROM challenges WHERE slug = ? AND status = 'published' LIMIT 1",
      [params.slug],
    );
    if (chRows.length === 0) {
      throw new NotFoundError('Challenge not found.');
    }
    const challenge = chRows[0];

    const [existingSub] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM challenge_submissions WHERE challenge_id = ? AND user_id = ? LIMIT 1',
      [challenge.id, params.userId],
    );
    if (existingSub.length > 0) {
      throw new ConflictError('You have already submitted an attempt for this challenge.');
    }

    const [qRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, correct_option_index, points_weight, explanation_en, explanation_rw, explanation_fr
       FROM challenge_questions
       WHERE challenge_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [challenge.id],
    );

    if (qRows.length === 0) {
      throw new ValidationError('This challenge does not have questions yet.');
    }

    const evaluation = evaluateChallengeAnswers(
      qRows.map((q) => ({
        id: Number(q.id),
        correctOptionIndex: Number(q.correct_option_index),
        pointsWeight: Number(q.points_weight),
        explanationEn: String(q.explanation_en),
        explanationRw: String(q.explanation_rw),
        explanationFr: String(q.explanation_fr),
      })),
      params.answers,
      Number(challenge.xp_reward),
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
        evaluation.xpAwarded,
      ],
    );

    const xpRes = await awardXpInTransaction(conn, {
      userId: params.userId,
      sourceType: 'challenge_completion',
      sourceId: Number(challenge.id),
      idempotencyKey: `challenge:${params.userId}:${challenge.id}`,
      points: evaluation.xpAwarded,
      description: `Completed challenge: ${challenge.title_en}`,
    });

    const streakRes = await updateChallengeStreakInTransaction(conn, params.userId);
    const unlockedAchievements = await evaluateAndUnlockAchievementsInTransaction(conn, params.userId);

    return {
      ...evaluation,
      newTotalXp: xpRes.newTotalXp,
      newLevel: xpRes.newLevel,
      currentStreak: streakRes.currentStreak,
      unlockedAchievements,
    };
  });
}

export async function getLeaderboard(period: 'daily' | 'weekly' | 'monthly' | 'all') {
  if (!isDatabaseConfigured()) {
    return localStore.getLeaderboard(period);
  }
  let dateCondition = '';
  if (period === 'daily') {
    dateCondition = 'AND xt.created_at >= CURDATE()';
  } else if (period === 'weekly') {
    dateCondition = 'AND xt.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
  } else if (period === 'monthly') {
    dateCondition = 'AND xt.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
  }

  if (period === 'all') {
    return queryRows<RowDataPacket[]>(
      `SELECT
         p.user_id, p.display_name, p.username, p.avatar_url, p.district,
         p.total_xp AS period_xp, p.current_level, p.current_streak
       FROM user_profiles p
       INNER JOIN users u ON u.id = p.user_id
       WHERE u.status = 'active' AND p.profile_visibility != 'private'
       ORDER BY p.total_xp DESC, p.current_streak DESC
       LIMIT 25`,
    );
  }

  return queryRows<RowDataPacket[]>(
    `SELECT
       p.user_id, p.display_name, p.username, p.avatar_url, p.district,
       COALESCE(SUM(xt.points), 0) AS period_xp, p.current_level, p.current_streak
     FROM xp_transactions xt
     INNER JOIN user_profiles p ON p.user_id = xt.user_id
     INNER JOIN users u ON u.id = xt.user_id
     WHERE u.status = 'active' AND p.profile_visibility != 'private' ${dateCondition}
     GROUP BY p.user_id, p.display_name, p.username, p.avatar_url, p.district, p.current_level, p.current_streak
     ORDER BY period_xp DESC
     LIMIT 25`,
  );
}
