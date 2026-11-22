import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Award, BookOpen, Flame, MapPin, Trophy, Upload, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { pickLocalizedField, useI18n } from '../i18n/translations';
import { ApiError, apiRequest, queryClient } from '../lib/api';

export function ProfilePage() {
  const { username: routeUsername } = useParams<{ username?: string }>();
  const { user, refreshAuth } = useAuth();
  const { lang, t } = useI18n();

  const targetUsername = routeUsername || user?.username;
  const [editing, setEditing] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [district, setDistrict] = useState('');
  const [bio, setBio] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [interestsText, setInterestsText] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'community' | 'private'>('community');
  const [showActivity, setShowActivity] = useState(true);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ['profile', targetUsername],
    queryFn: () => apiRequest(`/profile/${targetUsername}`),
    enabled: Boolean(targetUsername),
  });

  if (!targetUsername) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-600">
        {t.common.signInRequired}
      </div>
    );
  }

  if (isLoading) return <div className="py-10 text-sm text-slate-600">{t.common.loading}</div>;
  if (error || !data) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-red-700">
        {error instanceof Error ? error.message : 'Profile unavailable'}
      </div>
    );
  }

  const {
    profile,
    achievements,
    challengeHistory,
    learningProgress,
    xpHistory,
    savedOpportunities,
    blockedUsers,
  } = data;

  const startEditing = () => {
    setDisplayName(profile.displayName || '');
    setDistrict(profile.district || '');
    setBio(profile.bio || '');
    setSkillsText((profile.skills || []).join(', '));
    setInterestsText((profile.interests || []).join(', '));
    setVisibility(profile.profileVisibility || 'community');
    setShowActivity(Boolean(profile.showActivity));
    setEditing(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveMessage(null);
    try {
      await apiRequest('/profile/me', {
        method: 'PUT',
        body: JSON.stringify({
          displayName,
          district,
          bio,
          skills: skillsText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          interests: interestsText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          profileVisibility: visibility,
          showActivity,
        }),
      });
      setEditing(false);
      setSaveMessage('Profile updated.');
      await queryClient.invalidateQueries({ queryKey: ['profile', targetUsername] });
      await refreshAuth();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Unable to save profile');
    }
  };

  const handleAvatarUpload = async (file: File) => {
    const fd = new FormData();
    fd.append('avatar', file);
    await apiRequest('/profile/me/avatar', { method: 'POST', body: fd });
    await queryClient.invalidateQueries({ queryKey: ['profile', targetUsername] });
    await refreshAuth();
  };

  const handleUnblock = async (blockedId: number) => {
    await apiRequest(`/community/users/${blockedId}/block`, { method: 'DELETE' });
    await queryClient.invalidateQueries({ queryKey: ['profile', targetUsername] });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-start sm:items-center gap-5">
          <div className="w-20 h-20 rounded-xl bg-[#0B1B3B] text-white flex items-center justify-center overflow-hidden shrink-0">
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profile.displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <User className="w-9 h-9 text-slate-300" aria-hidden="true" />
            )}
          </div>

          <div className="space-y-1.5">
            <h1 className="font-display text-2xl font-bold text-[#0B1B3B]">{profile.displayName}</h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>@{profile.username}</span>
              {profile.district && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                    {profile.district}
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="capitalize">{profile.role.replace('_', ' ')}</span>
            </div>
            {profile.bio && <p className="text-sm text-slate-600 max-w-xl pt-1">{profile.bio}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="text-right font-mono-tabular">
            <div className="text-xs text-slate-500">
              {t.common.levelLabel} {profile.currentLevel}
            </div>
            <div className="text-xl font-bold text-[#0B1B3B]">
              {profile.totalXp} {t.common.xpLabel}
            </div>
            <div className="text-xs text-amber-700 inline-flex items-center gap-1">
              <Flame className="w-3.5 h-3.5" aria-hidden="true" />
              {profile.currentStreak} {t.common.streakLabel}
            </div>
          </div>

          {profile.isOwner && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={startEditing}
                className="px-4 py-2 rounded-lg bg-[#0B1B3B] text-white text-xs font-semibold"
              >
                {t.profile.editProfile}
              </button>
              <label className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-xs font-medium cursor-pointer hover:bg-slate-50">
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t.profile.uploadAvatar}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleAvatarUpload(f);
                  }}
                />
              </label>
            </div>
          )}
        </div>
      </section>

      {saveMessage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {saveMessage}
        </div>
      )}

      {editing && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-lg font-bold text-[#0B1B3B]">{t.profile.editProfile}</h2>
          {saveError && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800">
              {saveError}
            </div>
          )}
          <form onSubmit={handleSaveProfile} className="space-y-4 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {t.profile.displayName}
                </label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {t.profile.district}
                </label>
                <input
                  type="text"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {t.profile.bio}
              </label>
              <textarea
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {t.profile.skills}
                </label>
                <input
                  type="text"
                  value={skillsText}
                  onChange={(e) => setSkillsText(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {t.profile.interests}
                </label>
                <input
                  type="text"
                  value={interestsText}
                  onChange={(e) => setInterestsText(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {t.profile.visibility}
                </label>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="public">Public (anyone)</option>
                  <option value="community">Community members only</option>
                  <option value="private">Private (only me)</option>
                </select>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 pt-4">
                <input
                  type="checkbox"
                  checked={showActivity}
                  onChange={(e) => setShowActivity(e.target.checked)}
                />
                <span>{t.profile.showActivity}</span>
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold"
              >
                {t.common.save}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Skills & Interests + Achievements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-lg font-bold text-[#0B1B3B]">Skills & Interests</h2>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-semibold text-slate-500">Skills</p>
              <p className="text-slate-800 mt-1">
                {profile.skills.length > 0 ? profile.skills.join(' · ') : 'None added yet.'}
              </p>
            </div>
            <div className="pt-2 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-500">Interests</p>
              <p className="text-slate-800 mt-1">
                {profile.interests.length > 0 ? profile.interests.join(' · ') : 'None added yet.'}
              </p>
            </div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-lg font-bold text-[#0B1B3B]">
            {t.dashboard.achievements}
          </h2>
          {achievements.length === 0 ? (
            <p className="text-sm text-slate-500">No achievements unlocked yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {achievements.map((ach: any) => (
                <li key={ach.slug} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Award className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {pickLocalizedField(ach, 'title', lang)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {pickLocalizedField(ach, 'description', lang)}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono-tabular text-xs font-semibold text-amber-700">
                    +{ach.xp_bonus} XP
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Challenge & Learning History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-lg font-bold text-[#0B1B3B] flex items-center gap-2">
            <Trophy className="w-4 h-4 text-blue-600" aria-hidden="true" />
            <span>{t.profile.challengeHistory}</span>
          </h2>
          {challengeHistory.length === 0 ? (
            <p className="text-sm text-slate-500">No completed challenges yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {challengeHistory.map((ch: any) => (
                <li key={ch.id} className="py-2.5 flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-800 truncate">
                    {pickLocalizedField(ch, 'title', lang)}
                  </span>
                  <span className="font-mono-tabular text-xs text-slate-600 shrink-0">
                    {ch.score}/{ch.max_score} · +{ch.xp_awarded} XP
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-lg font-bold text-[#0B1B3B] flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-600" aria-hidden="true" />
            <span>{t.profile.learningHistory}</span>
          </h2>
          {learningProgress.length === 0 ? (
            <p className="text-sm text-slate-500">Not enrolled in any courses yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {learningProgress.map((lp: any) => (
                <li key={lp.slug} className="py-2.5 flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-800 truncate">
                    {pickLocalizedField(lp, 'title', lang)}
                  </span>
                  <span className="font-mono-tabular text-xs text-emerald-700 font-semibold shrink-0">
                    {lp.progress_percent}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Owner-only XP History, Saved Opportunities, Blocked Users */}
      {profile.isOwner && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="font-display text-lg font-bold text-[#0B1B3B]">{t.profile.xpHistory}</h2>
            {xpHistory.length === 0 ? (
              <p className="text-sm text-slate-500">No XP transactions yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {xpHistory.map((xt: any) => (
                  <li key={xt.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-slate-800">{xt.description}</p>
                      <p className="text-xs text-slate-400">
                        {new Date(xt.created_at).toLocaleString()}
                      </p>
                    </div>
                    <span className="font-mono-tabular text-xs font-semibold text-amber-700 shrink-0">
                      +{xt.points} XP
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            <div>
              <h2 className="font-display text-lg font-bold text-[#0B1B3B]">
                {t.profile.savedOpps}
              </h2>
              {savedOpportunities.length === 0 ? (
                <p className="text-sm text-slate-500 mt-2">No saved opportunities.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm mt-2">
                  {savedOpportunities.map((o: any) => (
                    <li key={o.id} className="py-2 flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800 truncate">{o.title}</span>
                      <a
                        href={o.application_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline shrink-0"
                      >
                        Open
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {blockedUsers.length > 0 && (
              <div className="pt-4 border-t border-slate-200">
                <h3 className="font-display text-sm font-bold text-[#0B1B3B]">
                  {t.profile.blockedUsers}
                </h3>
                <ul className="divide-y divide-slate-100 text-sm mt-2">
                  {blockedUsers.map((bu: any) => (
                    <li key={bu.blocked_id} className="py-2 flex items-center justify-between">
                      <span>{bu.display_name}</span>
                      <button
                        type="button"
                        onClick={() => handleUnblock(bu.blocked_id)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {t.profile.unblock}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
