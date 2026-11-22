import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useI18n } from '../i18n/translations';
import { apiRequest, queryClient } from '../lib/api';

export function NotificationsPage() {
  const { t } = useI18n();

  const { data, isLoading } = useQuery<{ notifications: any[]; unreadCount: number }>({
    queryKey: ['notifications', 'list'],
    queryFn: () => apiRequest('/notifications'),
  });

  const { data: prefs } = useQuery<{
    challengeReminders: boolean;
    learningUpdates: boolean;
    communityActivity: boolean;
    opportunityAlerts: boolean;
    announcements: boolean;
  }>({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => apiRequest('/notifications/preferences'),
  });

  const handleMarkRead = async (id: number) => {
    await apiRequest(`/notifications/${id}/read`, { method: 'POST' });
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const handleMarkAllRead = async () => {
    await apiRequest('/notifications/read-all', { method: 'POST' });
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const togglePref = async (key: keyof NonNullable<typeof prefs>) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    await apiRequest('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(next),
    });
    await queryClient.invalidateQueries({ queryKey: ['notifications', 'preferences'] });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-bold text-[#0B1B3B]">{t.nav.notifications}</h1>
        <button
          type="button"
          onClick={handleMarkAllRead}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700"
        >
          <CheckCheck className="w-4 h-4 text-blue-600" aria-hidden="true" />
          <span>Mark all as read</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {isLoading ? (
            <p className="p-6 text-sm text-slate-500">{t.common.loading}</p>
          ) : !data?.notifications || data.notifications.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              <Bell className="w-7 h-7 text-slate-300 mx-auto mb-2" />
              No notifications yet.
            </div>
          ) : (
            data.notifications.map((n) => (
              <div
                key={n.id}
                className={`p-4 sm:p-5 flex items-start justify-between gap-4 ${
                  n.is_read ? 'bg-white' : 'bg-blue-50/40'
                }`}
              >
                <div className="space-y-1 text-sm">
                  <p className="font-semibold text-[#0B1B3B]">{n.title_text}</p>
                  <p className="text-slate-600">{n.body_text}</p>
                  <div className="flex items-center gap-3 text-xs text-slate-400 pt-1">
                    <span>{new Date(n.created_at).toLocaleString()}</span>
                    {n.link_url && (
                      <Link to={n.link_url} className="text-blue-600 hover:underline font-medium">
                        View
                      </Link>
                    )}
                  </div>
                </div>
                {!n.is_read && (
                  <button
                    type="button"
                    onClick={() => handleMarkRead(n.id)}
                    className="text-xs font-medium text-blue-600 hover:underline shrink-0"
                  >
                    Mark read
                  </button>
                )}
              </div>
            ))
          )}
        </section>

        <section className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="font-display text-base font-bold text-[#0B1B3B]">
            Notification Preferences
          </h2>
          {prefs && (
            <div className="space-y-3 text-sm">
              {(
                [
                  ['challengeReminders', 'Daily Challenge Reminders'],
                  ['learningUpdates', 'Course & Lesson Updates'],
                  ['communityActivity', 'Community Replies & Mentions'],
                  ['opportunityAlerts', 'Verified Opportunity Alerts'],
                  ['announcements', 'Platform Announcements'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="text-slate-700">{label}</span>
                  <input
                    type="checkbox"
                    checked={prefs[key]}
                    onChange={() => togglePref(key)}
                  />
                </label>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
