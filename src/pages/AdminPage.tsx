import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { USER_ROLES } from '../../shared/schemas';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/translations';
import { apiRequest, queryClient } from '../lib/api';

type AdminTab =
  | 'overview'
  | 'users'
  | 'challenges'
  | 'courses'
  | 'moderation'
  | 'opportunities'
  | 'announcements'
  | 'audit'
  | 'settings';

export function AdminPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const isFullAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const { data: overview } = useQuery<any>({
    queryKey: ['admin', 'overview'],
    queryFn: () => apiRequest('/admin/overview'),
  });

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ['admin', 'users'],
    queryFn: () => apiRequest('/admin/users'),
    enabled: tab === 'users' && isFullAdmin,
  });

  const { data: adminChallenges = [] } = useQuery<any[]>({
    queryKey: ['admin', 'challenges'],
    queryFn: () => apiRequest('/admin/challenges'),
    enabled: tab === 'challenges',
  });

  const { data: challengeCats = [] } = useQuery<any[]>({
    queryKey: ['challenges', 'categories'],
    queryFn: () => apiRequest('/challenges/categories'),
  });

  const { data: courseCats = [] } = useQuery<any[]>({
    queryKey: ['courses', 'categories'],
    queryFn: () => apiRequest('/courses/categories'),
  });

  const { data: moderation } = useQuery<{ reports: any[]; posts: any[] }>({
    queryKey: ['admin', 'moderation'],
    queryFn: () => apiRequest('/admin/moderation'),
    enabled: tab === 'moderation',
  });

  const { data: adminOpportunities = [] } = useQuery<any[]>({
    queryKey: ['admin', 'opportunities'],
    queryFn: () => apiRequest('/admin/opportunities'),
    enabled: tab === 'opportunities' && isFullAdmin,
  });

  const { data: announcements = [] } = useQuery<any[]>({
    queryKey: ['admin', 'announcements'],
    queryFn: () => apiRequest('/admin/announcements'),
    enabled: tab === 'announcements' && isFullAdmin,
  });

  const { data: auditLogs = [] } = useQuery<any[]>({
    queryKey: ['admin', 'audit-logs'],
    queryFn: () => apiRequest('/admin/audit-logs'),
    enabled: tab === 'audit' && isFullAdmin,
  });

  const { data: settings = [] } = useQuery<any[]>({
    queryKey: ['admin', 'settings'],
    queryFn: () => apiRequest('/admin/settings'),
    enabled: tab === 'settings' && isFullAdmin,
  });

  // Challenge creation form state
  const [newCh, setNewCh] = useState({
    categoryId: 1,
    slug: '',
    titleEn: '',
    titleRw: '',
    titleFr: '',
    descriptionEn: '',
    descriptionRw: '',
    descriptionFr: '',
    difficulty: 'beginner',
    challengeType: 'daily',
    timeLimitSeconds: 180,
    xpReward: 60,
    isFeatured: false,
  });

  // Question creation form state
  const [newQ, setNewQ] = useState({
    challengeId: 0,
    promptEn: '',
    promptRw: '',
    promptFr: '',
    optionA: '',
    optionB: '',
    optionC: '',
    optionD: '',
    correctOptionIndex: 0,
    explanationEn: '',
    explanationRw: '',
    explanationFr: '',
  });

  // Course creation state
  const [newCourse, setNewCourse] = useState({
    categoryId: 1,
    slug: '',
    titleEn: '',
    titleRw: '',
    titleFr: '',
    summaryEn: '',
    summaryRw: '',
    summaryFr: '',
    level: 'beginner',
    estimatedMinutes: 30,
    xpReward: 100,
  });

  // Announcement creation state
  const [newAnn, setNewAnn] = useState({
    titleEn: '',
    titleRw: '',
    titleFr: '',
    bodyEn: '',
    bodyRw: '',
    bodyFr: '',
    audience: 'all',
  });

  const tabs: Array<{ id: AdminTab; label: string; visible: boolean }> = [
    { id: 'overview', label: t.admin.overview, visible: true },
    { id: 'users', label: t.admin.users, visible: isFullAdmin },
    { id: 'challenges', label: t.admin.challenges, visible: true },
    { id: 'courses', label: t.admin.courses, visible: true },
    { id: 'moderation', label: t.admin.moderation, visible: true },
    { id: 'opportunities', label: t.admin.opportunities, visible: isFullAdmin },
    { id: 'announcements', label: t.admin.announcements, visible: isFullAdmin },
    { id: 'audit', label: t.admin.auditLogs, visible: isFullAdmin },
    { id: 'settings', label: t.admin.settings, visible: isFullAdmin },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1B3B]">
          {t.admin.title}
        </h1>
        <p className="text-sm text-slate-600 mt-1">{t.admin.subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
        {tabs
          .filter((tb) => tb.visible)
          .map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                tab === tb.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {tb.label}
            </button>
          ))}
      </div>

      {actionNotice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {actionNotice}
        </div>
      )}

      {/* Overview */}
      {tab === 'overview' && overview && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              ['Registered Members', overview.counts.users],
              ['Challenges', overview.counts.challenges],
              ['Challenge Submissions', overview.counts.submissions],
              ['Courses', overview.counts.courses],
              ['Course Enrollments', overview.counts.enrollments],
              ['Community Posts', overview.counts.posts],
              ['Open Reports', overview.counts.openReports],
              ['Pending Opportunities', overview.counts.pendingOpportunities],
            ].map(([label, val]) => (
              <div key={String(label)} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="font-mono-tabular text-2xl font-bold text-[#0B1B3B] mt-1">
                  {val}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Users & Roles */}
      {tab === 'users' && isFullAdmin && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">XP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{u.display_name}</div>
                    <div className="text-xs text-slate-500">@{u.username}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{u.email || u.phone}</td>
                  <td className="px-4 py-3">
                    <select
                      aria-label={`Role for ${u.username}`}
                      value={u.role}
                      onChange={async (e) => {
                        await apiRequest(`/admin/users/${u.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ role: e.target.value }),
                        });
                        setActionNotice(`Updated role for ${u.username}`);
                        await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
                      }}
                      className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                    >
                      {USER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={async () => {
                        const nextStatus = u.status === 'suspended' ? 'active' : 'suspended';
                        await apiRequest(`/admin/users/${u.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: nextStatus }),
                        });
                        setActionNotice(`User ${u.username} set to ${nextStatus}`);
                        await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
                      }}
                      className={`px-2.5 py-1 text-xs font-medium rounded border ${
                        u.status === 'suspended'
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {u.status}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right font-mono-tabular text-xs font-semibold">
                    {u.total_xp}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Challenges & Questions */}
      {tab === 'challenges' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="font-display text-lg font-bold text-[#0B1B3B]">Create Challenge</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await apiRequest('/admin/challenges', {
                  method: 'POST',
                  body: JSON.stringify({
                    ...newCh,
                    categoryId: Number(newCh.categoryId || challengeCats[0]?.id || 1),
                    status: 'published',
                  }),
                });
                setActionNotice('Challenge published.');
                await queryClient.invalidateQueries({ queryKey: ['admin', 'challenges'] });
              }}
              className="space-y-3 text-sm"
            >
              <select
                value={newCh.categoryId}
                onChange={(e) => setNewCh({ ...newCh, categoryId: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                {challengeCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_en}
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                placeholder="URL slug (e.g. rwanda-coding-sprint-2)"
                value={newCh.slug}
                onChange={(e) => setNewCh({ ...newCh, slug: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                required
                placeholder="Title (English)"
                value={newCh.titleEn}
                onChange={(e) => setNewCh({ ...newCh, titleEn: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                required
                placeholder="Title (Kinyarwanda)"
                value={newCh.titleRw}
                onChange={(e) => setNewCh({ ...newCh, titleRw: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                required
                placeholder="Title (French)"
                value={newCh.titleFr}
                onChange={(e) => setNewCh({ ...newCh, titleFr: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              <textarea
                rows={2}
                required
                placeholder="Description (English)"
                value={newCh.descriptionEn}
                onChange={(e) =>
                  setNewCh({
                    ...newCh,
                    descriptionEn: e.target.value,
                    descriptionRw: newCh.descriptionRw || e.target.value,
                    descriptionFr: newCh.descriptionFr || e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold"
              >
                Publish Challenge
              </button>
            </form>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="font-display text-lg font-bold text-[#0B1B3B]">Add Question to Challenge</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const chId = newQ.challengeId || adminChallenges[0]?.id;
                if (!chId) return;
                await apiRequest('/admin/challenges/questions', {
                  method: 'POST',
                  body: JSON.stringify({
                    challengeId: Number(chId),
                    promptEn: newQ.promptEn,
                    promptRw: newQ.promptRw || newQ.promptEn,
                    promptFr: newQ.promptFr || newQ.promptEn,
                    options: [newQ.optionA, newQ.optionB, newQ.optionC, newQ.optionD].filter(
                      Boolean,
                    ),
                    correctOptionIndex: Number(newQ.correctOptionIndex),
                    explanationEn: newQ.explanationEn,
                    explanationRw: newQ.explanationRw || newQ.explanationEn,
                    explanationFr: newQ.explanationFr || newQ.explanationEn,
                    pointsWeight: 20,
                    sortOrder: 1,
                  }),
                });
                setActionNotice('Question added to challenge.');
                await queryClient.invalidateQueries({ queryKey: ['admin', 'challenges'] });
              }}
              className="space-y-3 text-sm"
            >
              <select
                value={newQ.challengeId || adminChallenges[0]?.id || ''}
                onChange={(e) => setNewQ({ ...newQ, challengeId: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                {adminChallenges.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title_en} ({c.question_count} Qs)
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                placeholder="Question prompt (English)"
                value={newQ.promptEn}
                onChange={(e) => setNewQ({ ...newQ, promptEn: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  placeholder="Option 1"
                  value={newQ.optionA}
                  onChange={(e) => setNewQ({ ...newQ, optionA: e.target.value })}
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  required
                  placeholder="Option 2"
                  value={newQ.optionB}
                  onChange={(e) => setNewQ({ ...newQ, optionB: e.target.value })}
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Option 3"
                  value={newQ.optionC}
                  onChange={(e) => setNewQ({ ...newQ, optionC: e.target.value })}
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Option 4"
                  value={newQ.optionD}
                  onChange={(e) => setNewQ({ ...newQ, optionD: e.target.value })}
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <select
                value={newQ.correctOptionIndex}
                onChange={(e) =>
                  setNewQ({ ...newQ, correctOptionIndex: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value={0}>Correct Answer: Option 1</option>
                <option value={1}>Correct Answer: Option 2</option>
                <option value={2}>Correct Answer: Option 3</option>
                <option value={3}>Correct Answer: Option 4</option>
              </select>
              <input
                type="text"
                required
                placeholder="Explanation shown after submission"
                value={newQ.explanationEn}
                onChange={(e) => setNewQ({ ...newQ, explanationEn: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-[#0B1B3B] text-white rounded-lg text-xs font-semibold"
              >
                Add Question
              </button>
            </form>
          </section>
        </div>
      )}

      {/* Courses */}
      {tab === 'courses' && (
        <section className="max-w-xl bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-lg font-bold text-[#0B1B3B]">Create Learning Course</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiRequest('/admin/courses', {
                method: 'POST',
                body: JSON.stringify({
                  ...newCourse,
                  categoryId: Number(newCourse.categoryId || courseCats[0]?.id || 1),
                  status: 'published',
                }),
              });
              setActionNotice('Course published.');
            }}
            className="space-y-3 text-sm"
          >
            <select
              value={newCourse.categoryId}
              onChange={(e) => setNewCourse({ ...newCourse, categoryId: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
            >
              {courseCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_en}
                </option>
              ))}
            </select>
            <input
              type="text"
              required
              placeholder="Slug (e.g. mobile-money-business-accounting)"
              value={newCourse.slug}
              onChange={(e) => setNewCourse({ ...newCourse, slug: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
            <input
              type="text"
              required
              placeholder="Title (English)"
              value={newCourse.titleEn}
              onChange={(e) =>
                setNewCourse({
                  ...newCourse,
                  titleEn: e.target.value,
                  titleRw: newCourse.titleRw || e.target.value,
                  titleFr: newCourse.titleFr || e.target.value,
                })
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
            <textarea
              rows={3}
              required
              placeholder="Course summary (English)"
              value={newCourse.summaryEn}
              onChange={(e) =>
                setNewCourse({
                  ...newCourse,
                  summaryEn: e.target.value,
                  summaryRw: newCourse.summaryRw || e.target.value,
                  summaryFr: newCourse.summaryFr || e.target.value,
                })
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold"
            >
              Publish Course
            </button>
          </form>
        </section>
      )}

      {/* Moderation */}
      {tab === 'moderation' && moderation && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h2 className="font-display text-base font-bold text-[#0B1B3B]">Content Reports</h2>
            {moderation.reports.length === 0 ? (
              <p className="text-sm text-slate-500">No reports in queue.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {moderation.reports.map((r) => (
                  <li key={r.id} className="py-3 space-y-1.5">
                    <div className="text-xs text-slate-500">
                      {r.target_type} #{r.target_id} · {r.reason} · Status: {r.status}
                    </div>
                    <div className="flex gap-2">
                      {(['resolved', 'dismissed'] as const).map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={async () => {
                            await apiRequest(`/admin/moderation/reports/${r.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: st }),
                            });
                            await queryClient.invalidateQueries({ queryKey: ['admin', 'moderation'] });
                          }}
                          className="px-2.5 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50"
                        >
                          Mark {st}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h2 className="font-display text-base font-bold text-[#0B1B3B]">Recent Posts</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {moderation.posts.map((p) => (
                <li key={p.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{p.title}</p>
                    <p className="text-xs text-slate-500">
                      @{p.author_username} · {p.moderation_status}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        await apiRequest(`/admin/moderation/posts/${p.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: 'approved' }),
                        });
                        await queryClient.invalidateQueries({ queryKey: ['admin', 'moderation'] });
                      }}
                      className="px-2 py-1 text-xs border border-slate-200 rounded"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiRequest(`/admin/moderation/posts/${p.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: 'hidden' }),
                        });
                        await queryClient.invalidateQueries({ queryKey: ['admin', 'moderation'] });
                      }}
                      className="px-2 py-1 text-xs border border-red-200 text-red-700 rounded"
                    >
                      Hide
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {/* Opportunities Approval */}
      {tab === 'opportunities' && isFullAdmin && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <tr>
                <th className="px-4 py-3">Title & Organization</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Verification</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {adminOpportunities.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{o.title}</div>
                    <div className="text-xs text-slate-500">{o.organization_name}</div>
                  </td>
                  <td className="px-4 py-3 text-xs capitalize">{o.approval_status}</td>
                  <td className="px-4 py-3 text-xs capitalize">{o.verified_status}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await apiRequest(`/admin/opportunities/${o.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ approvalStatus: 'approved', verifiedStatus: 'verified' }),
                        });
                        await queryClient.invalidateQueries({ queryKey: ['admin', 'opportunities'] });
                      }}
                      className="px-2.5 py-1 text-xs bg-emerald-600 text-white rounded"
                    >
                      Approve & Verify
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiRequest(`/admin/opportunities/${o.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ approvalStatus: 'rejected' }),
                        });
                        await queryClient.invalidateQueries({ queryKey: ['admin', 'opportunities'] });
                      }}
                      className="px-2.5 py-1 text-xs border border-red-200 text-red-700 rounded"
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Announcements */}
      {tab === 'announcements' && isFullAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiRequest('/admin/announcements', {
                method: 'POST',
                body: JSON.stringify({
                  ...newAnn,
                  titleRw: newAnn.titleRw || newAnn.titleEn,
                  titleFr: newAnn.titleFr || newAnn.titleEn,
                  bodyRw: newAnn.bodyRw || newAnn.bodyEn,
                  bodyFr: newAnn.bodyFr || newAnn.bodyEn,
                  isActive: true,
                }),
              });
              setActionNotice('Announcement published.');
              await queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
            }}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-3 text-sm"
          >
            <h2 className="font-display text-lg font-bold text-[#0B1B3B]">Publish Announcement</h2>
            <input
              type="text"
              required
              placeholder="Title (English)"
              value={newAnn.titleEn}
              onChange={(e) => setNewAnn({ ...newAnn, titleEn: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
            <textarea
              rows={3}
              required
              placeholder="Announcement message (English)"
              value={newAnn.bodyEn}
              onChange={(e) => setNewAnn({ ...newAnn, bodyEn: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold"
            >
              Publish
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <h2 className="font-display text-lg font-bold text-[#0B1B3B]">Active Announcements</h2>
            {announcements.map((a) => (
              <div key={a.id} className="py-2 border-b border-slate-100 text-sm">
                <div className="font-semibold text-slate-900">{a.title_en}</div>
                <div className="text-slate-600">{a.body_en}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit Logs */}
      {tab === 'audit' && isFullAdmin && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono-tabular">
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="px-4 py-2.5 text-slate-500">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">{log.actor_username || log.actor_user_id || 'system'}</td>
                  <td className="px-4 py-2.5 font-semibold text-[#0B1B3B]">{log.action}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {log.target_type} #{log.target_id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Settings */}
      {tab === 'settings' && isFullAdmin && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-lg font-bold text-[#0B1B3B]">{t.admin.settings}</h2>
          <div className="divide-y divide-slate-100 text-sm">
            {settings.map((s) => (
              <div key={s.setting_key} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="font-mono-tabular font-semibold text-slate-900">
                    {s.setting_key}
                  </div>
                  <div className="text-xs text-slate-500">{s.description}</div>
                </div>
                <code className="text-xs bg-slate-100 px-2.5 py-1 rounded font-mono-tabular">
                  {typeof s.setting_value_json === 'string'
                    ? s.setting_value_json
                    : JSON.stringify(s.setting_value_json)}
                </code>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
