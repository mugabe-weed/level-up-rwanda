import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bookmark, CheckCircle2, ExternalLink, MapPin, Plus } from 'lucide-react';
import { OPPORTUNITY_TYPES } from '../../shared/schemas';
import { useAuth } from '../context/AuthContext';
import { pickLocalizedField, useI18n } from '../i18n/translations';
import { ApiError, apiRequest, queryClient } from '../lib/api';
import { PLATFORM_IMAGES } from '../lib/assets';
import { ResilientImage } from '../components/ResilientImage';

export function OpportunitiesPage() {
  const { user, databaseConfigured } = useAuth();
  const { lang, t } = useI18n();
  const [searchParams] = useSearchParams();

  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [selectedType, setSelectedType] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    categoryId: 1,
    opportunityType: 'internship',
    title: '',
    organizationName: '',
    location: 'Kigali, Rwanda',
    isRemote: false,
    summary: '',
    eligibility: '',
    applicationUrl: 'https://',
    deadlineAt: '',
  });

  const { data: categories = [] } = useQuery<any[]>({
    queryKey: ['opportunities', 'categories'],
    queryFn: () => apiRequest('/opportunities/categories'),
    enabled: databaseConfigured,
  });

  const { data: opportunities = [], isLoading } = useQuery<any[]>({
    queryKey: ['opportunities', searchQuery, selectedType, remoteOnly, verifiedOnly],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (searchQuery.trim()) qs.set('q', searchQuery.trim());
      if (selectedType) qs.set('type', selectedType);
      if (remoteOnly) qs.set('remote', 'true');
      if (verifiedOnly) qs.set('verified', 'true');
      return apiRequest(`/opportunities?${qs.toString()}`);
    },
    enabled: databaseConfigured,
  });

  const handleToggleSave = async (id: number) => {
    if (!user) return;
    await apiRequest(`/opportunities/${id}/save`, { method: 'POST' });
    await queryClient.invalidateQueries({ queryKey: ['opportunities'] });
  };

  const handleSubmitOpportunity = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ status: string }>('/opportunities', {
        method: 'POST',
        body: JSON.stringify({
          ...formState,
          categoryId: Number(formState.categoryId || categories[0]?.id || 1),
          deadlineAt: formState.deadlineAt || null,
        }),
      });
      setShowSubmitModal(false);
      setSubmitMessage(
        res.status === 'approved'
          ? 'Opportunity published and verified.'
          : 'Opportunity submitted! An administrator will review and verify it shortly.',
      );
      await queryClient.invalidateQueries({ queryKey: ['opportunities'] });
    } catch (err) {
      setSubmitMessage(err instanceof ApiError ? err.message : 'Unable to submit opportunity');
    }
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-center space-y-4">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1B3B]">
            {t.opportunities.title}
          </h1>
          <p className="text-sm sm:text-base text-slate-600 max-w-xl">{t.opportunities.subtitle}</p>
          {user && (
            <div>
              <button
                type="button"
                onClick={() => setShowSubmitModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0B1B3B] hover:bg-[#142D61] text-white text-xs font-semibold"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>{t.opportunities.submitOpp}</span>
              </button>
            </div>
          )}
        </div>
        <div className="lg:col-span-5 min-h-[180px]">
          <ResilientImage
            src={PLATFORM_IMAGES.opportunitiesCampus}
            alt="Modern Kigali campus overlooking hills at sunset"
            fallbackTitle={t.opportunities.title}
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      {submitMessage && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
          {submitMessage}
        </div>
      )}

      {/* Search & Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          aria-label="Search opportunities"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t.common.searchPlaceholder}
          className="flex-1 min-w-[200px] px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
        />

        <select
          aria-label="Opportunity type"
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        >
          <option value="">{t.common.all} Types</option>
          {OPPORTUNITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace('_', ' ')}
            </option>
          ))}
        </select>

        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 px-2">
          <input
            type="checkbox"
            checked={remoteOnly}
            onChange={(e) => setRemoteOnly(e.target.checked)}
          />
          <span>{t.opportunities.remoteOnly}</span>
        </label>

        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 px-2">
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(e) => setVerifiedOnly(e.target.checked)}
          />
          <span>{t.opportunities.verifiedOnly}</span>
        </label>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="text-sm text-slate-500">{t.common.loading}</div>
      ) : opportunities.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          {t.common.noResults}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {opportunities.map((opp) => (
            <article
              key={opp.id}
              className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-4"
            >
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-purple-700 capitalize">
                      {String(opp.opportunity_type).replace('_', ' ')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{pickLocalizedField(opp, 'category_name', lang)}</span>
                    {opp.verified_status === 'verified' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{t.common.verified}</span>
                        </span>
                      </>
                    )}
                    {Boolean(opp.is_sample) && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{t.common.sampleLabel}</span>
                      </>
                    )}
                  </div>

                  {user && (
                    <button
                      type="button"
                      onClick={() => handleToggleSave(opp.id)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-medium ${
                        opp.is_saved
                          ? 'bg-blue-50 border-blue-200 text-blue-700'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{opp.is_saved ? t.opportunities.saved : t.opportunities.save}</span>
                    </button>
                  )}
                </div>

                <h2 className="font-display text-lg font-bold text-[#0B1B3B]">{opp.title}</h2>

                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                  <span className="font-medium text-slate-800">{opp.organization_name}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                    {opp.location}
                  </span>
                </div>

                <p className="text-sm text-slate-600 leading-relaxed">{opp.summary}</p>
                <p className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{t.opportunities.eligibility}: </span>
                  {opp.eligibility}
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-500 font-mono-tabular">
                  {opp.deadline_at
                    ? `${t.opportunities.deadline}: ${new Date(opp.deadline_at).toLocaleDateString()}`
                    : 'Open rolling deadline'}
                </div>

                <a
                  href={opp.application_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  <span>{t.opportunities.applyNow}</span>
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Submit Opportunity Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-slate-200 max-w-lg w-full p-6 space-y-4 my-8">
            <h2 className="font-display text-lg font-bold text-[#0B1B3B]">
              {t.opportunities.submitOpp}
            </h2>
            <form onSubmit={handleSubmitOpportunity} className="space-y-3 text-sm">
              <input
                type="text"
                required
                placeholder="Opportunity title"
                value={formState.title}
                onChange={(e) => setFormState({ ...formState, title: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={formState.opportunityType}
                  onChange={(e) =>
                    setFormState({ ...formState, opportunityType: e.target.value })
                  }
                  className="px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  {OPPORTUNITY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type.replace('_', ' ')}
                    </option>
                  ))}
                </select>
                <select
                  value={formState.categoryId}
                  onChange={(e) =>
                    setFormState({ ...formState, categoryId: Number(e.target.value) })
                  }
                  className="px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {pickLocalizedField(c, 'name', lang)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Organization name"
                  value={formState.organizationName}
                  onChange={(e) =>
                    setFormState({ ...formState, organizationName: e.target.value })
                  }
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  required
                  placeholder="Location"
                  value={formState.location}
                  onChange={(e) => setFormState({ ...formState, location: e.target.value })}
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <textarea
                rows={3}
                required
                placeholder="Summary (at least 20 characters)"
                value={formState.summary}
                onChange={(e) => setFormState({ ...formState, summary: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                required
                placeholder="Eligibility requirements"
                value={formState.eligibility}
                onChange={(e) => setFormState({ ...formState, eligibility: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              <input
                type="url"
                required
                placeholder="https://official-application-link"
                value={formState.applicationUrl}
                onChange={(e) =>
                  setFormState({ ...formState, applicationUrl: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSubmitModal(false)}
                  className="px-4 py-2 text-xs border border-slate-300 rounded-lg"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg"
                >
                  {t.common.submit}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
