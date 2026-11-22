import React, { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, CheckCircle2, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { pickLocalizedField, useI18n } from '../i18n/translations';
import { ApiError, apiRequest, queryClient } from '../lib/api';
import { PLATFORM_IMAGES } from '../lib/assets';
import { ResilientImage } from '../components/ResilientImage';

export function LearnPage() {
  const { lang, t } = useI18n();
  const [categorySlug, setCategorySlug] = useState('');
  const [level, setLevel] = useState('');

  const { data: categories = [] } = useQuery<any[]>({
    queryKey: ['courses', 'categories'],
    queryFn: () => apiRequest('/courses/categories'),
  });

  const { data: courses = [], isLoading } = useQuery<any[]>({
    queryKey: ['courses', categorySlug, level],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (categorySlug) qs.set('category', categorySlug);
      if (level) qs.set('level', level);
      return apiRequest(`/courses?${qs.toString()}`);
    },
  });

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-center space-y-3">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1B3B]">{t.learn.title}</h1>
          <p className="text-sm sm:text-base text-slate-600 max-w-xl">{t.learn.subtitle}</p>
        </div>
        <div className="lg:col-span-5 min-h-[180px]">
          <ResilientImage
            src={PLATFORM_IMAGES.learnDigitalSkills}
            alt="Learner studying practical digital skills in a sunlit library"
            fallbackTitle={t.learn.title}
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setCategorySlug('')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              categorySlug === '' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            {t.common.all}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategorySlug(cat.slug)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                categorySlug === cat.slug ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {pickLocalizedField(cat, 'name', lang)}
            </button>
          ))}
        </div>

        <select
          aria-label="Filter by course level"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg"
        >
          <option value="">{t.common.all} Levels</option>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-500">{t.common.loading}</div>
      ) : courses.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          {t.common.noResults}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {courses.map((course) => (
            <article
              key={course.id}
              className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-4"
            >
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-medium text-blue-700">
                    {pickLocalizedField(course, 'category_name', lang)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="capitalize">{course.level}</span>
                </div>
                <h2 className="font-display text-lg font-bold text-[#0B1B3B]">
                  {pickLocalizedField(course, 'title', lang)}
                </h2>
                <p className="text-sm text-slate-600">
                  {pickLocalizedField(course, 'summary', lang)}
                </p>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between text-xs text-slate-500 font-mono-tabular">
                  <span className="inline-flex items-center gap-1">
                    <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                    {course.lesson_count} {t.learn.lessons}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                    {course.estimated_minutes} {t.common.minutes}
                  </span>
                  <span className="text-amber-700 font-semibold">
                    +{course.xp_reward} {t.common.xpLabel}
                  </span>
                </div>

                {course.enrollment_status && (
                  <div className="text-xs font-medium text-emerald-700">
                    {course.enrollment_status === 'completed'
                      ? t.learn.completed
                      : `${t.learn.progress}: ${course.enrollment_progress}%`}
                  </div>
                )}

                <Link
                  to={`/learn/${course.slug}`}
                  className="block w-full text-center py-2.5 px-4 rounded-lg bg-[#0B1B3B] hover:bg-[#142D61] text-white text-sm font-medium transition-colors"
                >
                  {course.enrollment_status ? 'Continue Course' : t.learn.enroll}
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function CourseDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const { user, refreshAuth } = useAuth();
  const { lang, t } = useI18n();
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [lessonFeedback, setLessonFeedback] = useState<Record<number, { ok: boolean; text: string }>>({});
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ['course', slug],
    queryFn: () => apiRequest(`/courses/${slug}`),
    enabled: Boolean(slug),
  });

  if (isLoading) return <div className="py-10 text-sm text-slate-600">{t.common.loading}</div>;
  if (error || !data) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-red-700">
        {error instanceof Error ? error.message : 'Unable to load course'}
      </div>
    );
  }

  const { course, modules, lessons, enrollment } = data;

  const handleEnroll = async () => {
    if (!user) return;
    setEnrolling(true);
    setEnrollError(null);
    try {
      await apiRequest(`/courses/${slug}/enroll`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: ['course', slug] });
      await queryClient.invalidateQueries({ queryKey: ['courses'] });
    } catch (err) {
      setEnrollError(err instanceof ApiError ? err.message : 'Unable to enroll in course');
    } finally {
      setEnrolling(false);
    }
  };

  const handleCompleteLesson = async (lessonId: number) => {
    if (!user) return;
    try {
      const res = await apiRequest<{
        passed: boolean;
        explanation?: string;
        xpAwarded: number;
        courseCompleted: boolean;
      }>(`/courses/${slug}/lessons/${lessonId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ selectedOptionIndex: selectedAnswers[lessonId] }),
      });
      if (!res.passed) {
        setLessonFeedback((prev) => ({
          ...prev,
          [lessonId]: {
            ok: false,
            text: `Not quite yet. ${res.explanation || 'Review the lesson above and try again.'}`,
          },
        }));
      } else {
        setLessonFeedback((prev) => ({
          ...prev,
          [lessonId]: {
            ok: true,
            text: `Completed (+${res.xpAwarded} XP). ${res.explanation || ''}`,
          },
        }));
        await queryClient.invalidateQueries({ queryKey: ['course', slug] });
        await queryClient.invalidateQueries({ queryKey: ['courses'] });
        await refreshAuth();
      }
    } catch (err) {
      setLessonFeedback((prev) => ({
        ...prev,
        [lessonId]: {
          ok: false,
          text: err instanceof ApiError ? err.message : 'Unable to complete lesson',
        },
      }));
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link
        to="/learn"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-[#0B1B3B]"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        <span>{t.common.back}</span>
      </Link>

      <header className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="text-xs text-slate-500">
          {pickLocalizedField(course, 'category_name', lang)} ·{' '}
          <span className="capitalize">{course.level}</span> ·{' '}
          <span className="font-mono-tabular">
            {course.estimated_minutes} {t.common.minutes}
          </span>{' '}
          ·{' '}
          <span className="font-mono-tabular text-amber-700 font-semibold">
            +{course.xp_reward} {t.common.xpLabel}
          </span>
        </div>

        <h1 className="font-display text-2xl font-bold text-[#0B1B3B]">
          {pickLocalizedField(course, 'title', lang)}
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          {pickLocalizedField(course, 'summary', lang)}
        </p>

        {user ? (
          enrollment ? (
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between text-xs font-medium text-slate-700">
                <span>
                  {enrollment.status === 'completed' ? t.learn.completed : t.learn.enrolled}
                </span>
                <span className="font-mono-tabular">{enrollment.progress_percent}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{ width: `${enrollment.progress_percent}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {enrollError && (
                <p role="alert" className="text-xs text-red-700">
                  {enrollError}
                </p>
              )}
              <button
                type="button"
                disabled={enrolling}
                onClick={handleEnroll}
                className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
              >
                {enrolling ? t.common.loading : t.learn.enroll}
              </button>
            </div>
          )
        ) : (
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-950 flex items-center justify-between gap-3">
            <span>{t.common.signInRequired}</span>
            <Link
              to="/auth/login"
              state={{ from: location.pathname }}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold"
            >
              {t.nav.signIn}
            </Link>
          </div>
        )}
      </header>

      {/* Modules & Lessons */}
      <div className="space-y-6">
        {modules.map((mod: any) => {
          const modLessons = lessons.filter((l: any) => l.moduleId === Number(mod.id));
          return (
            <section key={mod.id} className="space-y-4">
              <h2 className="font-display text-lg font-bold text-[#0B1B3B]">
                {pickLocalizedField(mod, 'title', lang)}
              </h2>

              {modLessons.map((lesson: any) => (
                <article
                  key={lesson.id}
                  className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-display text-base font-bold text-slate-900">
                        {pickLocalizedField(lesson, 'title', lang)}
                      </h3>
                      <p className="text-xs text-slate-500 font-mono-tabular mt-0.5">
                        {lesson.durationMinutes} {t.common.minutes} · +{lesson.xpReward} {t.common.xpLabel}
                      </p>
                    </div>
                    {lesson.completed && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                        <span>{t.play.completed}</span>
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                    {pickLocalizedField(lesson, 'content', lang)}
                  </p>

                  {lesson.assessment && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                      <p className="text-xs font-semibold text-slate-700">
                        {t.learn.assessmentPrompt}
                      </p>
                      <p className="text-sm font-medium text-slate-900">
                        {lesson.assessment.question}
                      </p>
                      <div className="space-y-2">
                        {lesson.assessment.options.map((opt: string, idx: number) => (
                          <label
                            key={idx}
                            className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer"
                          >
                            <input
                              type="radio"
                              name={`lesson-${lesson.id}`}
                              disabled={lesson.completed || !user}
                              checked={
                                lesson.completed
                                  ? lesson.assessment.correctIndex === idx
                                  : selectedAnswers[lesson.id] === idx
                              }
                              onChange={() =>
                                setSelectedAnswers((prev) => ({ ...prev, [lesson.id]: idx }))
                              }
                            />
                            <span>{opt}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {lessonFeedback[lesson.id] && (
                    <div
                      className={`text-xs p-3 rounded-lg border ${
                        lessonFeedback[lesson.id].ok
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-amber-50 border-amber-200 text-amber-900'
                      }`}
                    >
                      {lessonFeedback[lesson.id].text}
                    </div>
                  )}

                  {user && !lesson.completed && (
                    <button
                      type="button"
                      onClick={() => handleCompleteLesson(lesson.id)}
                      className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                    >
                      {t.learn.completeLesson}
                    </button>
                  )}
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
