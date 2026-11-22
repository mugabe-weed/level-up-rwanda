import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { pickLocalizedField, useI18n } from '../i18n/translations';
import { ApiError, apiRequest, queryClient } from '../lib/api';

export function ChallengePlayPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user, refreshAuth } = useAuth();
  const { lang, t } = useI18n();

  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [startedAt] = useState<number>(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submissionResult, setSubmissionResult] = useState<any | null>(null);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ['challenge', slug],
    queryFn: () => apiRequest(`/challenges/${slug}`),
    enabled: Boolean(slug),
  });

  useEffect(() => {
    if (data?.challenge && !data.userSubmission && secondsLeft === null) {
      setSecondsLeft(Number(data.challenge.time_limit_seconds));
    }
  }, [data, secondsLeft]);

  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0 || data?.userSubmission || submissionResult) {
      return;
    }
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft, data?.userSubmission, submissionResult]);

  if (isLoading) {
    return <div className="py-12 text-sm text-slate-600">{t.common.loading}</div>;
  }

  if (error || !data) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-red-700">
        {error instanceof Error ? error.message : 'Unable to load challenge.'}
      </div>
    );
  }

  const { challenge, questions, userSubmission } = data;
  const activeResult = submissionResult || null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitError(null);

    const answersPayload = questions.map((q: any) => ({
      questionId: Number(q.id),
      selectedOptionIndex: selectedAnswers[q.id] ?? 0,
    }));

    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));

    setSubmitting(true);
    try {
      const result = await apiRequest(`/challenges/${slug}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers: answersPayload, durationSeconds }),
      });
      setSubmissionResult(result);
      await queryClient.invalidateQueries({ queryKey: ['challenge', slug] });
      await queryClient.invalidateQueries({ queryKey: ['challenges'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await refreshAuth();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Failed to submit challenge');
    } finally {
      setSubmitting(false);
    }
  };

  const breakdownMap = new Map<number, any>(
    (activeResult?.breakdown || []).map((b: any) => [Number(b.questionId), b]),
  );

  const savedAnswerMap = new Map<number, number>(
    (userSubmission?.answers || []).map((a: any) => [Number(a.questionId), Number(a.selectedOptionIndex)]),
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link
        to="/play"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-[#0B1B3B]"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        <span>{t.common.back}</span>
      </Link>

      <header className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {pickLocalizedField(challenge, 'category_name', lang)} ·{' '}
            <span className="capitalize">{challenge.difficulty}</span> ·{' '}
            <span className="font-mono-tabular text-amber-700 font-semibold">
              +{challenge.xp_reward} {t.common.xpLabel}
            </span>
          </div>

          {!userSubmission && !activeResult && secondsLeft !== null && (
            <div className="inline-flex items-center gap-1.5 text-sm font-mono-tabular font-semibold text-[#0B1B3B]">
              <Clock className="w-4 h-4 text-blue-600" aria-hidden="true" />
              <span>
                {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
              </span>
            </div>
          )}
        </div>

        <h1 className="font-display text-2xl font-bold text-[#0B1B3B]">
          {pickLocalizedField(challenge, 'title', lang)}
        </h1>
        <p className="text-sm text-slate-600">
          {pickLocalizedField(challenge, 'description', lang)}
        </p>
      </header>

      {!user && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex flex-wrap items-center justify-between gap-3 text-sm text-blue-950">
          <span>{t.common.signInRequired}</span>
          <Link
            to="/auth/login"
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold"
          >
            {t.nav.signIn}
          </Link>
        </div>
      )}

      {(userSubmission || activeResult) && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 space-y-2 text-emerald-950">
          <p className="font-display font-bold text-lg">
            {t.play.scoreLabel}:{' '}
            <span className="font-mono-tabular">
              {activeResult ? activeResult.score : userSubmission.score} /{' '}
              {activeResult ? activeResult.maxScore : userSubmission.max_score}
            </span>
          </p>
          <p className="text-sm">
            Earned{' '}
            <span className="font-mono-tabular font-semibold">
              +{activeResult ? activeResult.xpAwarded : userSubmission.xp_awarded} {t.common.xpLabel}
            </span>
            {activeResult?.unlockedAchievements?.length > 0 && (
              <span>
                {' '}
                · Unlocked:{' '}
                {activeResult.unlockedAchievements.map((a: any) => a.titleEn).join(', ')}
              </span>
            )}
          </p>
          {userSubmission && !activeResult && (
            <p className="text-xs text-emerald-800">{t.play.alreadyCompleted}</p>
          )}
        </div>
      )}

      {submitError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {questions.map((q: any, qIndex: number) => {
          const reviewed = userSubmission || activeResult;
          const b = breakdownMap.get(Number(q.id));
          const correctIdx =
            b !== undefined ? b.correctOptionIndex : q.correct_option_index;
          const chosenIdx =
            b !== undefined
              ? b.selectedOptionIndex
              : userSubmission
                ? savedAnswerMap.get(Number(q.id))
                : selectedAnswers[q.id];

          return (
            <fieldset
              key={q.id}
              className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4"
            >
              <legend className="font-display font-semibold text-base text-[#0B1B3B]">
                {qIndex + 1}. {pickLocalizedField(q, 'prompt', lang)}
              </legend>

              <div className="space-y-2.5">
                {(q.options || []).map((optionText: string, optIdx: number) => {
                  const isSelected = chosenIdx === optIdx;
                  const isCorrect = reviewed && correctIdx === optIdx;
                  const isWrongSelected = reviewed && isSelected && correctIdx !== optIdx;

                  return (
                    <label
                      key={optIdx}
                      className={`flex items-center justify-between gap-3 p-3.5 rounded-lg border text-sm cursor-pointer transition-colors ${
                        isCorrect
                          ? 'border-emerald-400 bg-emerald-50 text-emerald-950'
                          : isWrongSelected
                            ? 'border-red-300 bg-red-50 text-red-950'
                            : isSelected
                              ? 'border-blue-600 bg-blue-50 text-[#0B1B3B]'
                              : 'border-slate-200 hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type="radio"
                          name={`question-${q.id}`}
                          disabled={Boolean(reviewed) || !user}
                          checked={isSelected}
                          onChange={() =>
                            setSelectedAnswers((prev) => ({ ...prev, [q.id]: optIdx }))
                          }
                          className="h-4 w-4 text-blue-600"
                        />
                        <span>{optionText}</span>
                      </span>
                      {isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                      {isWrongSelected && <XCircle className="w-4 h-4 text-red-600 shrink-0" />}
                    </label>
                  );
                })}
              </div>

              {reviewed && (
                <div className="pt-2 text-xs text-slate-700 bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <span className="font-semibold">{t.play.explanation}: </span>
                  {b
                    ? lang === 'rw'
                      ? b.explanationRw
                      : lang === 'fr'
                        ? b.explanationFr
                        : b.explanationEn
                    : pickLocalizedField(q, 'explanation', lang)}
                </div>
              )}
            </fieldset>
          );
        })}

        {user && !userSubmission && !activeResult && questions.length > 0 && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || Object.keys(selectedAnswers).length < questions.length}
              className="px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {submitting ? t.common.loading : t.play.submitAnswers}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
