import { RowDataPacket } from 'mysql2/promise';
import { localStore } from '../db/localStore.ts';
import { isDatabaseConfigured, queryRows, withTransaction } from '../db/pool.ts';
import { NotFoundError, ValidationError } from '../utils/errors.ts';
import {
  awardXpInTransaction,
  evaluateAndUnlockAchievementsInTransaction,
} from './gamificationService.ts';

export async function listCourseCategories() {
  if (!isDatabaseConfigured()) {
    return localStore.listCourseCategories();
  }
  return queryRows<RowDataPacket[]>(
    'SELECT id, slug, name_en, name_rw, name_fr, description_en, description_rw, description_fr FROM course_categories WHERE is_active = 1 ORDER BY sort_order ASC',
  );
}

export async function listCourses(params: {
  categorySlug?: string;
  level?: string;
  search?: string;
  userId?: number;
}) {
  if (!isDatabaseConfigured()) {
    return localStore.listCourses(params);
  }
  const conditions: string[] = ["c.status = 'published'"];
  const values: unknown[] = [];

  if (params.categorySlug) {
    conditions.push('cat.slug = ?');
    values.push(params.categorySlug);
  }
  if (params.level) {
    conditions.push('c.level = ?');
    values.push(params.level);
  }
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push('(c.title_en LIKE ? OR c.title_rw LIKE ? OR c.title_fr LIKE ? OR c.summary_en LIKE ?)');
    values.push(q, q, q, q);
  }

  const enrollJoin = params.userId
    ? 'LEFT JOIN course_enrollments ce ON ce.course_id = c.id AND ce.user_id = ?'
    : '';
  const queryParams = params.userId ? [params.userId, ...values] : values;

  return queryRows<RowDataPacket[]>(
    `SELECT
       c.id, c.slug, c.title_en, c.title_rw, c.title_fr,
       c.summary_en, c.summary_rw, c.summary_fr,
       c.level, c.estimated_minutes, c.xp_reward, c.is_sample,
       cat.slug AS category_slug, cat.name_en AS category_name_en, cat.name_rw AS category_name_rw, cat.name_fr AS category_name_fr,
       (SELECT COUNT(*) FROM course_lessons cl WHERE cl.course_id = c.id) AS lesson_count
       ${params.userId ? ', ce.status AS enrollment_status, ce.progress_percent AS enrollment_progress' : ''}
     FROM courses c
     INNER JOIN course_categories cat ON cat.id = c.category_id
     ${enrollJoin}
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.created_at DESC`,
    queryParams,
  );
}

export async function getCourseDetail(slug: string, userId?: number) {
  if (!isDatabaseConfigured()) {
    return localStore.getCourseDetail(slug, userId);
  }
  const rows = await queryRows<RowDataPacket[]>(
    `SELECT
       c.*, cat.slug AS category_slug, cat.name_en AS category_name_en, cat.name_rw AS category_name_rw, cat.name_fr AS category_name_fr
     FROM courses c
     INNER JOIN course_categories cat ON cat.id = c.category_id
     WHERE c.slug = ? AND c.status = 'published'
     LIMIT 1`,
    [slug],
  );
  if (rows.length === 0) {
    throw new NotFoundError('Course not found.');
  }
  const course = rows[0];

  const modules = await queryRows<RowDataPacket[]>(
    'SELECT * FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC, id ASC',
    [course.id],
  );
  const lessonsRaw = await queryRows<RowDataPacket[]>(
    'SELECT * FROM course_lessons WHERE course_id = ? ORDER BY sort_order ASC, id ASC',
    [course.id],
  );

  let enrollment: RowDataPacket | null = null;
  let completedLessonIds = new Set<number>();

  if (userId) {
    const enrollRows = await queryRows<RowDataPacket[]>(
      'SELECT * FROM course_enrollments WHERE course_id = ? AND user_id = ? LIMIT 1',
      [course.id, userId],
    );
    if (enrollRows.length > 0) {
      enrollment = enrollRows[0];
      const progressRows = await queryRows<RowDataPacket[]>(
        'SELECT lesson_id FROM lesson_progress WHERE enrollment_id = ? AND completed = 1',
        [enrollment.id],
      );
      completedLessonIds = new Set(progressRows.map((r) => Number(r.lesson_id)));
    }
  }

  const lessons = lessonsRaw.map((l) => {
    const assessment =
      l.assessment_question_json && typeof l.assessment_question_json === 'string'
        ? JSON.parse(l.assessment_question_json)
        : l.assessment_question_json;
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
      assessment: assessment
        ? {
            question: assessment.question,
            options: assessment.options,
            ...(isCompleted
              ? { correctIndex: assessment.correctIndex, explanation: assessment.explanation }
              : {}),
          }
        : null,
    };
  });

  return { course, modules, lessons, enrollment };
}

export async function enrollInCourse(slug: string, userId: number) {
  if (!isDatabaseConfigured()) {
    return localStore.enrollInCourse(slug, userId);
  }
  return withTransaction(async (conn) => {
    const [courses] = await conn.execute<RowDataPacket[]>(
      "SELECT id, title_en FROM courses WHERE slug = ? AND status = 'published' LIMIT 1",
      [slug],
    );
    if (courses.length === 0) {
      throw new NotFoundError('Course not found.');
    }
    const course = courses[0];

    await conn.execute(
      `INSERT IGNORE INTO course_enrollments (course_id, user_id, status, progress_percent)
       VALUES (?, ?, 'enrolled', 0)`,
      [course.id, userId],
    );

    const [enrollRows] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM course_enrollments WHERE course_id = ? AND user_id = ? LIMIT 1',
      [course.id, userId],
    );
    return enrollRows[0];
  });
}

export async function completeLesson(params: {
  slug: string;
  lessonId: number;
  userId: number;
  selectedOptionIndex?: number;
}) {
  if (!isDatabaseConfigured()) {
    return localStore.completeLesson(params);
  }
  return withTransaction(async (conn) => {
    const [courseRows] = await conn.execute<RowDataPacket[]>(
      "SELECT id, title_en, xp_reward FROM courses WHERE slug = ? AND status = 'published' LIMIT 1",
      [params.slug],
    );
    if (courseRows.length === 0) {
      throw new NotFoundError('Course not found.');
    }
    const course = courseRows[0];

    const [lessonRows] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM course_lessons WHERE id = ? AND course_id = ? LIMIT 1',
      [params.lessonId, course.id],
    );
    if (lessonRows.length === 0) {
      throw new NotFoundError('Lesson not found in this course.');
    }
    const lesson = lessonRows[0];

    // Ensure enrolled
    await conn.execute(
      `INSERT IGNORE INTO course_enrollments (course_id, user_id, status, progress_percent)
       VALUES (?, ?, 'enrolled', 0)`,
      [course.id, params.userId],
    );
    const [enrollRows] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM course_enrollments WHERE course_id = ? AND user_id = ? LIMIT 1',
      [course.id, params.userId],
    );
    const enrollment = enrollRows[0];

    const assessment =
      lesson.assessment_question_json && typeof lesson.assessment_question_json === 'string'
        ? JSON.parse(lesson.assessment_question_json)
        : lesson.assessment_question_json;

    let assessmentPassed = true;
    let explanation: string | undefined;

    if (assessment && Array.isArray(assessment.options) && assessment.options.length > 0) {
      if (params.selectedOptionIndex === undefined) {
        throw new ValidationError('Please select an answer to the lesson check question.');
      }
      assessmentPassed = params.selectedOptionIndex === Number(assessment.correctIndex);
      explanation = assessment.explanation;
      if (!assessmentPassed) {
        return {
          passed: false,
          explanation,
          xpAwarded: 0,
          courseCompleted: false,
          progressPercent: Number(enrollment.progress_percent),
        };
      }
    }

    await conn.execute(
      `INSERT IGNORE INTO lesson_progress
        (enrollment_id, lesson_id, user_id, completed, assessment_passed, assessment_score)
       VALUES (?, ?, ?, 1, 1, 100)`,
      [enrollment.id, lesson.id, params.userId],
    );

    const lessonXpRes = await awardXpInTransaction(conn, {
      userId: params.userId,
      sourceType: 'lesson_completion',
      sourceId: Number(lesson.id),
      idempotencyKey: `lesson:${params.userId}:${lesson.id}`,
      points: Number(lesson.xp_reward || 20),
      description: `Completed lesson: ${lesson.title_en}`,
    });

    const [[totalRow]] = await conn.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM course_lessons WHERE course_id = ?',
      [course.id],
    );
    const [[doneRow]] = await conn.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM lesson_progress WHERE enrollment_id = ? AND completed = 1',
      [enrollment.id],
    );

    const totalLessons = Number(totalRow?.cnt ?? 1);
    const doneLessons = Number(doneRow?.cnt ?? 0);
    const progressPercent = Math.min(100, Math.round((doneLessons / Math.max(1, totalLessons)) * 100));
    const isNowComplete = doneLessons >= totalLessons;

    await conn.execute(
      `UPDATE course_enrollments
       SET progress_percent = ?,
           status = ?,
           completed_at = ${isNowComplete ? 'COALESCE(completed_at, NOW())' : 'NULL'}
       WHERE id = ?`,
      [progressPercent, isNowComplete ? 'completed' : 'enrolled', enrollment.id],
    );

    let courseXpAwarded = 0;
    if (isNowComplete) {
      const courseXpRes = await awardXpInTransaction(conn, {
        userId: params.userId,
        sourceType: 'course_completion',
        sourceId: Number(course.id),
        idempotencyKey: `course:${params.userId}:${course.id}`,
        points: Number(course.xp_reward || 100),
        description: `Completed course: ${course.title_en}`,
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
      unlockedAchievements,
    };
  });
}
