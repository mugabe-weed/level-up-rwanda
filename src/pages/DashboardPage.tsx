import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Award, BookOpen, Briefcase, Flame, Megaphone, Trophy } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { pickLocalizedField, useI18n } from '../i18n/translations';
import { apiRequest } from '../lib/api';
import { PLATFORM_IMAGES } from '../lib/assets';
import { ResilientImage } from '../components/ResilientImage';

interface DashboardData {
  featuredChallenge: any | null;
  recommendedCourses: any[];
  recentCommunityActivity: any[];
  featuredOpportunities: any[];
  announcements: any[];
  userSummary: {
    challengesCompleted: number;
    coursesCompleted: number;
    coursesInProgress: number;
    postsCreated: number;
    savedOpportunities: number;
  } | null;
  recentAchievements: any[];
}

export function DashboardPage() {
  const { user } = useAuth();
  const { lang, t } = useI18n();

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => apiRequest<DashboardData>('/dashboard'),
  });

  return (
    <div className="space-y-10">
      {/* Hero / Welcome Section */}
      <section className="rounded-xl bg-[#0B1B3B] text-white overflow-hidden border border-slate-800">
        <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-7 p-6 sm:p-10 flex flex-col justify-center space-y-5">
            {user ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-blue-300">
                  {t.dashboard.welcomeBack}, {user.displayName}
                </p>
                <h1 className="font-display text-2xl sm:text-3xl font-bold leading-tight text-balance">
                  {t.dashboard.heroTitle}
                </h1>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-medium text-blue-300">{t.common.freeAccess}</p>
                <h1 className="font-display text-2xl sm:text-4xl font-bold leading-tight text-balance">
                  {t.dashboard.heroTitle}
                </h1>
              </div>
            )}

            <p className="text-sm sm:text-base text-slate-200 max-w-2xl leading-relaxed">
              {t.dashboard.heroSubtitle}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                to={
                  data?.featuredChallenge
                    ? `/play/${data.featuredChallenge.slug}`
                    : '/play'
                }
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                <Trophy className="w-4 h-4" aria-hidden="true" />
                <span>{t.dashboard.startDaily}</span>
              </Link>
              <Link
                to="/learn"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <BookOpen className="w-4 h-4" aria-hidden="true" />
                <span>{t.dashboard.exploreCourses}</span>
              </Link>
            </div>
          </div>

          <div className="lg:col-span-5 min-h-[220px] lg:min-h-full">
            <ResilientImage
              src={PLATFORM_IMAGES.heroKigaliLearning}
              alt="Young Rwandan learners collaborating in a bright Kigali hub"
              fallbackTitle={t.brand}
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        {/* Clean 4-column Progress Strip when signed in */}
        {user && (
          <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-white/10 bg-[#0F274F]">
            <div className="p-4 sm:px-6 border-b sm:border-b-0 border-r border-white/10">
              <div className="text-xs text-slate-300">{t.common.levelLabel}</div>
              <div className="font-mono-tabular text-xl font-bold text-amber-300 mt-0.5">
                {user.currentLevel}
              </div>
            </div>
            <div className="p-4 sm:px-6 border-b sm:border-b-0 sm:border-r border-white/10">
              <div className="text-xs text-slate-300">{t.common.xpLabel}</div>
              <div className="font-mono-tabular text-xl font-bold text-white mt-0.5">
                {user.totalXp}
              </div>
            </div>
            <div className="p-4 sm:px-6 border-r border-white/10">
              <div className="text-xs text-slate-300">{t.common.streakLabel}</div>
              <div className="font-mono-tabular text-xl font-bold text-white mt-0.5 flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-amber-400" aria-hidden="true" />
                <span>{user.currentStreak}</span>
              </div>
            </div>
            <div className="p-4 sm:px-6">
              <div className="text-xs text-slate-300">{t.play.completed}</div>
              <div className="font-mono-tabular text-xl font-bold text-white mt-0.5">
                {data?.userSummary?.challengesCompleted ?? 0}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Active Platform Announcements */}
      {data?.announcements && data.announcements.length > 0 && (
        <section aria-label="Announcements" className="space-y-3">
          {data.announcements.map((ann) => (
            <div
              key={ann.id}
              className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 flex items-start gap-3"
            >
              <Megaphone className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-sm">
                <h2 className="font-semibold text-[#0B1B3B]">
                  {pickLocalizedField(ann, 'title', lang)}
                </h2>
                <p className="text-slate-700 mt-0.5">{pickLocalizedField(ann, 'body', lang)}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Onboarding Quick Guide */}
      {!user && (
        <section className="rounded-xl bg-white border border-slate-200 p-6">
          <h2 className="font-display text-lg font-semibold text-[#0B1B3B]">
            {t.dashboard.onboardingTitle}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 text-sm text-slate-700">
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
              {t.dashboard.onboardingStep1}
            </div>
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
              {t.dashboard.onboardingStep2}
            </div>
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
              {t.dashboard.onboardingStep3}
            </div>
          </div>
        </section>
      )}

      {/* Daily Featured Challenge + Unlocked Achievements / Community Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="h-44 overflow-hidden">
              <ResilientImage
                src={PLATFORM_IMAGES.challengeArena}
                alt="Daily Challenge geometric artwork"
                fallbackTitle={t.dashboard.dailyFeatured}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-6 flex-1 flex flex-col justify-between space-y-4">
              {isLoading ? (
                <p className="text-sm text-slate-500">{t.common.loading}</p>
              ) : data?.featuredChallenge ? (
                <>
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                      <span className="font-medium text-blue-700">{t.dashboard.dailyFeatured}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {pickLocalizedField(data.featuredChallenge, 'category_name', lang)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">
                        +{data.featuredChallenge.xp_reward} {t.common.xpLabel}
                      </span>
                    </div>
                    <h2 className="font-display text-xl font-bold text-[#0B1B3B]">
                      {pickLocalizedField(data.featuredChallenge, 'title', lang)}
                    </h2>
                    <p className="text-sm text-slate-600 mt-2">
                      {pickLocalizedField(data.featuredChallenge, 'description', lang)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-slate-500 font-mono-tabular">
                      {data.featuredChallenge.question_count} {t.play.questions} ·{' '}
                      {Math.round(data.featuredChallenge.time_limit_seconds / 60)} {t.common.minutes}
                    </span>
                    <Link
                      to={`/play/${data.featuredChallenge.slug}`}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
                    >
                      <span>{t.play.startChallenge}</span>
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </Link>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">{t.common.noResults}</p>
              )}
            </div>
          </section>

          <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-[#0B1B3B]">
                {user ? t.dashboard.achievements : t.dashboard.communityActivity}
              </h2>
              <Link to={user ? '/profile' : '/connect'} className="text-xs font-medium text-blue-600 hover:underline">
                {t.common.all}
              </Link>
            </div>

            {user ? (
              data?.recentAchievements && data.recentAchievements.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {data.recentAchievements.map((ach) => (
                    <li key={ach.slug} className="py-3 flex items-center gap-3">
                      <Award className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {pickLocalizedField(ach, 'title', lang)}
                        </p>
                        <p className="text-xs text-slate-500 capitalize">{ach.badge_tier}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-slate-600 space-y-3">
                  <p>Complete your first Daily Challenge or Course lesson to unlock badges.</p>
                  <Link
                    to="/play"
                    className="inline-flex items-center gap-1.5 text-blue-600 font-medium hover:underline"
                  >
                    <span>{t.dashboard.startDaily}</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </Link>
                </div>
              )
            ) : data?.recentCommunityActivity && data.recentCommunityActivity.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {data.recentCommunityActivity.map((item) => (
                  <li key={item.id} className="py-3">
                    <Link
                      to={item.post_type === 'create_showcase' ? '/create' : '/connect'}
                      className="group block"
                    >
                      <p className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 truncate">
                        {item.title || item.author_name}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {item.author_name} · <span className="capitalize">{item.post_type}</span>
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500 py-4">{t.common.noResults}</p>
            )}
          </section>
        </div>

      {/* Learning Recommendations & Verified Opportunities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-[#0B1B3B]">
                {t.dashboard.recommendedCourses}
              </h2>
              <Link to="/learn" className="text-xs font-medium text-blue-600 hover:underline">
                {t.nav.learn}
              </Link>
            </div>
            <div className="divide-y divide-slate-100">
              {(data?.recommendedCourses || []).map((course) => (
                <Link
                  key={course.id}
                  to={`/learn/${course.slug}`}
                  className="block py-3.5 hover:bg-slate-50 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div className="text-xs text-slate-500 mb-1">
                    {pickLocalizedField(course, 'category_name', lang)} · {course.level} ·{' '}
                    <span className="font-mono-tabular">
                      {course.estimated_minutes} {t.common.minutes}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {pickLocalizedField(course, 'title', lang)}
                  </h3>
                </Link>
              ))}
              {!isLoading && (!data?.recommendedCourses || data.recommendedCourses.length === 0) && (
                <p className="text-sm text-slate-500 py-4">{t.common.noResults}</p>
              )}
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-[#0B1B3B]">
                {t.dashboard.featuredOpportunities}
              </h2>
              <Link to="/opportunities" className="text-xs font-medium text-blue-600 hover:underline">
                {t.nav.opportunities}
              </Link>
            </div>
            <div className="divide-y divide-slate-100">
              {(data?.featuredOpportunities || []).map((opp) => (
                <Link
                  key={opp.id}
                  to="/opportunities"
                  className="block py-3.5 hover:bg-slate-50 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div className="text-xs text-slate-500 mb-1 flex items-center gap-2">
                    <Briefcase className="w-3.5 h-3.5 text-purple-700" aria-hidden="true" />
                    <span className="capitalize">{String(opp.opportunity_type).replace('_', ' ')}</span>
                    <span aria-hidden="true">·</span>
                    <span>{opp.organization_name}</span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900">{opp.title}</h3>
                </Link>
              ))}
              {!isLoading &&
                (!data?.featuredOpportunities || data.featuredOpportunities.length === 0) && (
                  <p className="text-sm text-slate-500 py-4">{t.common.noResults}</p>
                )}
            </div>
          </section>
      </div>
    </div>
  );
}
