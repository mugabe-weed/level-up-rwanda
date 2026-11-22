import React from 'react';
import { Database } from 'lucide-react';
import { useI18n } from '../i18n/translations';

export function DatabaseNoticeBanner({ missingFields }: { missingFields?: string[] }) {
  const { t } = useI18n();
  const fieldsText =
    missingFields && missingFields.length > 0
      ? missingFields.join(', ')
      : 'MYSQL_URL or MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE';

  return (
    <div
      role="status"
      className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-slate-900"
    >
      <div className="flex items-start gap-3">
        <Database className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-1 text-sm">
          <p className="font-semibold text-amber-950">{t.dbNotice.title}</p>
          <p className="text-amber-900 leading-relaxed">{t.dbNotice.body}</p>
          <p className="text-xs font-mono-tabular text-amber-950 pt-1">
            Required variables: {fieldsText}
          </p>
        </div>
      </div>
    </div>
  );
}
