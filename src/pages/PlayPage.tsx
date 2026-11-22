import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Flame, Trophy } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { pickLocalizedField, useI18n } from '../i18n/translations';
import { apiRequest } from '../lib/api';

export function PlayPage() {
  const { databaseConfigured } = useAuth();
  const { lang, t } = useI18n();
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('');
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'all'>('weekly');

  const { data: categories = [] } = useQuery<any[]>({
    queryKey: ['challenges', 'categories'],
    queryFn: () => apiRequest('/challenges/categories'),
    enabled: databaseConfigured,
  });

  const { data: challenges = [], isLoading } = useQuery<any[]>({
    queryKey: ['challenges', selectedCategory, selectedDifficulty],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (selectedCategory) qs.set('category', selectedCategory);
      if (selectedDifficulty) qs.set('difficulty', selectedDifficulty);
      return apiRequest(`/challenges?${qs.toString()}`);
    },
    enabled: databaseConfigured,
  });

  const { data: leaderboard = [] } = useQuery<any[]>({
    queryKey: ['challenges', 'leaderboard', leaderboardPeriod],
    queryFn: () => apiRequest(`/challenges/leaderboard?period=${leaderboardPeriod}`),
    enabled: databaseConfigured,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1B3B]">{t.play.title}</h1>
        <p className="text-sm text-slate-600 mt-1">{t.play.subtitle}</p>
      </div>

      {/* Interactive Filter Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setSelectedCategory('')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              selectedCategory === ''
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.common.all}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.slug)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                selectedCategory === cat.slug
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {pickLocalizedField(cat, 'name', lang)}
            </button>
          ))}
        </div>

        <select
          aria-label="Filter by difficulty"
          value={selectedDifficulty}
          onChange={(e) => setSelectedDifficulty(e.target.value)}
          className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700"
        >
          <option value="">{t.common.all} Difficulties</option>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Challenges List */}
        <div className="lg:col-span-8 space-y-4">
          {isLoading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500">
              {t.common.loading}
            </div>
          ) : challenges.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              {t.common.noResults}
            </div>
          ) : (
            challenges.map((ch) => {
              const completed = Boolean(ch.submission_id);
              return (
                <article
                  key={ch.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-medium text-blue-700">
                        {pickLocalizedField(ch, 'category_name', lang)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{ch.challenge_type}</span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{ch.difficulty}</span>
                      {Boolean(ch.is_sample) && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{t.common.sampleLabel}</span>
                        </>
                      )}
                    </div>
                    <h2 className="font-display text-lg font-bold text-[#0B1B3B]">
                      {pickLocalizedField(ch, 'title', lang)}
                    </h2>
                    <p className="text-sm text-slate-600">
                      {pickLocalizedField(ch, 'description', lang)}
                    </p>
                    <div className="flex items-center gap-4 pt-1 text-xs text-slate-500 font-mono-tabular">
                      <span>
                        {ch.question_count} {t.play.questions}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                        {Math.round(ch.time_limit_seconds / 60)} {t.common.minutes}
                      </span>
                      <span className="text-amber-700 font-semibold">
                        +{ch.xp_reward} {t.common.xpLabel}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0">
                    <Link
                      to={`/play/${ch.slug}`}
                      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                        completed
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {completed ? (
                        <>
                          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                          <span>{t.play.reviewResult}</span>
                        </>
                      ) : (
                        <>
                          <Trophy className="w-4 h-4" aria-hidden="true" />
                          <span>{t.play.startChallenge}</span>
                        </>
                      )}
                    </Link>
                  </div>
                </article>
              );
            })
          )}
        </div>

        {/* Leaderboard */}
        <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-[#0B1B3B]">{t.play.leaderboard}</h2>
            <Trophy className="w-5 h-5 text-amber-600" aria-hidden="true" />
          </div>

          <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-lg">
            {(['daily', 'weekly', 'monthly', 'all'] as const).map((period) => (
              <button
                key={period}
                type="button"
                onClick={() => setLeaderboardPeriod(period)}
                className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                  leaderboardPeriod === period
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {period === 'daily'
                  ? t.play.daily
                  : period === 'weekly'
                    ? t.play.weekly
                    : period === 'monthly'
                      ? t.play.monthly
                      : t.play.allTime}
              </button>
            ))}
          </div>

          {leaderboard.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">
              No leaderboard entries for this period yet. Complete a challenge to appear here.
            </p>
          ) : (
            <ol className="divide-y divide-slate-100">
              {leaderboard.map((entry, idx) => (
                <li key={entry.user_id} className="py-2.5 flex items-center justify-between gap-2 text-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono-tabular text-xs font-semibold text-slate-400 w-5">
                      {idx + 1}.
                    </span>
                    <Link
                      to={`/users/${entry.username}`}
                      className="font-medium text-slate-900 hover:text-blue-600 truncate"
                    >
                      {entry.display_name}
                    </Link>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 font-mono-tabular text-xs">
                    <span className="inline-flex items-center gap-0.5 text-slate-500">
                      <Flame className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                      {entry.current_streak}
                    </span>
                    <span className="font-semibold text-[#0B1B3B]">
                      {entry.period_xp} {t.common.xpLabel}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}
