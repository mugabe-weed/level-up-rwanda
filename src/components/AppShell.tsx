import React, { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Award,
  Bell,
  BookOpen,
  Briefcase,
  Compass,
  Globe,
  LogOut,
  Menu,
  Palette,
  Search,
  Shield,
  Trophy,
  User,
  Users,
  X,
} from 'lucide-react';
import { SUPPORTED_LANGUAGES, SupportedLanguage } from '../../shared/schemas';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/translations';
import { apiRequest } from '../lib/api';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout, changeLanguage } = useAuth();
  const { lang, t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchTerm, setSearchTerm] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: notifData } = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => apiRequest<{ unreadCount: number }>('/notifications'),
    enabled: Boolean(user),
  });

  const unreadCount = notifData?.unreadCount ?? 0;

  const isAdminStaff =
    user && ['moderator', 'educator', 'admin', 'super_admin'].includes(user.role);

  const navItems = [
    { to: '/', label: t.nav.dashboard, icon: Compass, exact: true },
    { to: '/play', label: t.nav.play, icon: Trophy },
    { to: '/learn', label: t.nav.learn, icon: BookOpen },
    { to: '/create', label: t.nav.create, icon: Palette },
    { to: '/connect', label: t.nav.connect, icon: Users },
    { to: '/opportunities', label: t.nav.opportunities, icon: Briefcase },
  ];

  const handleGlobalSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;
    navigate(`/opportunities?q=${encodeURIComponent(searchTerm.trim())}`);
  };

  const langLabels: Record<SupportedLanguage, string> = {
    rw: 'Kinyarwanda',
    en: 'English',
    fr: 'Français',
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-[#0B1B3B] focus:text-white focus:px-4 focus:py-2 focus:rounded-lg"
      >
        {t.common.skipToContent}
      </a>

      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#0B1B3B] text-white border-r border-slate-800">
        <div className="h-16 px-6 flex items-center border-b border-white/10">
          <Link
            to="/"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            {t.brand}
          </Link>
        </div>

        <nav aria-label="Primary navigation" className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.exact}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}

          {user && (
            <div className="pt-4 mt-4 border-t border-white/10 space-y-1">
              <NavLink
                to="/profile"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                <User className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{t.nav.profile}</span>
              </NavLink>
              <NavLink
                to="/notifications"
                className={({ isActive }) =>
                  `flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                <span className="flex items-center gap-3">
                  <Bell className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{t.nav.notifications}</span>
                </span>
                {unreadCount > 0 && (
                  <span className="font-mono-tabular text-xs font-semibold text-amber-300">
                    {unreadCount}
                  </span>
                )}
              </NavLink>
              {isAdminStaff && (
                <NavLink
                  to="/admin"
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-purple-700 text-white'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  <Shield className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{t.nav.admin}</span>
                </NavLink>
              )}
            </div>
          )}
        </nav>

        {/* User XP summary or Free Access note at sidebar bottom */}
        <div className="p-4 border-t border-white/10 text-xs text-slate-300">
          {user ? (
            <div className="space-y-1.5">
              <div className="font-medium text-white truncate">{user.displayName}</div>
              <div className="flex items-center gap-2 text-amber-300 font-mono-tabular">
                <Award className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {t.common.levelLabel} {user.currentLevel} · {user.totalXp} {t.common.xpLabel}
                </span>
              </div>
              <button
                type="button"
                onClick={() => logout()}
                className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t.nav.signOut}</span>
              </button>
            </div>
          ) : (
            <p className="text-slate-300 leading-relaxed">{t.common.freeAccess}</p>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen pb-20 lg:pb-0">
        {/* Top Bar (Clean, single-row, non-crowded) */}
        <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="p-2 rounded-lg text-slate-700 hover:bg-slate-100 min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <Menu className="w-5 h-5" />
            </button>
            <Link
              to="/"
              className="font-display text-base font-bold tracking-tight text-[#0B1B3B] whitespace-nowrap shrink-0"
            >
              {t.brand}
            </Link>
          </div>

          <form onSubmit={handleGlobalSearch} className="hidden md:flex flex-1 max-w-md items-center">
            <label htmlFor="global-search" className="sr-only">
              {t.common.searchPlaceholder}
            </label>
            <div className="relative w-full">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="global-search"
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t.common.searchPlaceholder}
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-blue-600 focus:outline-none"
              />
            </div>
          </form>

          <div className="flex items-center gap-3 shrink-0 ml-auto">
            {/* Language selector */}
            <div className="flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-slate-500 hidden sm:block" aria-hidden="true" />
              <label htmlFor="lang-select" className="sr-only">
                Language
              </label>
              <select
                id="lang-select"
                value={lang}
                onChange={(e) => changeLanguage(e.target.value as SupportedLanguage)}
                className="text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-slate-700 hover:border-slate-300 focus:border-blue-600 focus:outline-none"
              >
                {SUPPORTED_LANGUAGES.map((code) => (
                  <option key={code} value={code}>
                    {langLabels[code]}
                  </option>
                ))}
              </select>
            </div>

            {user ? (
              <div className="flex items-center gap-2">
                <Link
                  to="/notifications"
                  aria-label={t.nav.notifications}
                  className="relative p-2 rounded-lg text-slate-600 hover:bg-slate-100 min-w-[40px] min-h-[40px] flex items-center justify-center"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-blue-600 text-white text-[10px] font-mono-tabular font-semibold px-1.5 rounded-full">
                      {unreadCount}
                    </span>
                  )}
                </Link>
                <Link
                  to="/profile"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm font-medium text-slate-800 whitespace-nowrap shrink-0"
                >
                  <User className="w-4 h-4 text-blue-600" aria-hidden="true" />
                  <span className="hidden sm:inline max-w-[140px] truncate">{user.displayName}</span>
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/auth/login"
                  state={{ from: location.pathname }}
                  className="px-3 py-2 text-sm font-medium text-slate-700 hover:text-[#0B1B3B] whitespace-nowrap shrink-0"
                >
                  {t.nav.signIn}
                </Link>
                <Link
                  to="/auth/register"
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {t.nav.register}
                </Link>
              </div>
            )}
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div
              className="fixed inset-0 bg-slate-900/50"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />
            <div className="relative w-72 max-w-[85vw] bg-[#0B1B3B] text-white h-full flex flex-col p-4">
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <span className="font-display font-bold text-base">{t.brand}</span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label={t.common.close}
                  className="p-2 rounded-lg text-slate-300 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex-1 py-4 space-y-1 overflow-y-auto">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.exact}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium ${
                          isActive ? 'bg-blue-600 text-white' : 'text-slate-200 hover:bg-white/10'
                        }`
                      }
                    >
                      <Icon className="w-4 h-4" aria-hidden="true" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
                {user && (
                  <>
                    <NavLink
                      to="/profile"
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-slate-200 hover:bg-white/10"
                    >
                      <User className="w-4 h-4" aria-hidden="true" />
                      <span>{t.nav.profile}</span>
                    </NavLink>
                    <NavLink
                      to="/notifications"
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-slate-200 hover:bg-white/10"
                    >
                      <Bell className="w-4 h-4" aria-hidden="true" />
                      <span>{t.nav.notifications}</span>
                    </NavLink>
                    {isAdminStaff && (
                      <NavLink
                        to="/admin"
                        onClick={() => setMobileMenuOpen(false)}
                        className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-purple-200 hover:bg-white/10"
                      >
                        <Shield className="w-4 h-4" aria-hidden="true" />
                        <span>{t.nav.admin}</span>
                      </NavLink>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        logout();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-slate-200 hover:bg-white/10"
                    >
                      <LogOut className="w-4 h-4" aria-hidden="true" />
                      <span>{t.nav.signOut}</span>
                    </button>
                  </>
                )}
              </nav>
            </div>
          </div>
        )}

        {/* Main Viewport */}
        <main id="main-content" className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          {children}
        </main>

        {/* Quiet Footer */}
        <footer className="border-t border-slate-200 bg-white px-4 lg:px-8 py-5 text-xs text-slate-500">
          <div className="max-w-[1280px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <p className="font-medium text-slate-700">
              {t.brand} — {t.tagline}
            </p>
            <p>{t.common.freeAccess}</p>
          </div>
        </footer>
      </div>

      {/* Compact Mobile Bottom Navigation (<= 15% viewport height, >=44px targets) */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 grid grid-cols-5 h-16"
      >
        {[
          { to: '/', label: t.nav.dashboard, icon: Compass, exact: true },
          { to: '/play', label: t.nav.play, icon: Trophy },
          { to: '/learn', label: t.nav.learn, icon: BookOpen },
          { to: '/create', label: t.nav.create, icon: Palette },
          { to: '/opportunities', label: t.nav.opportunities, icon: Briefcase },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium min-h-[44px] ${
                  isActive ? 'text-blue-600' : 'text-slate-600'
                }`
              }
            >
              <Icon className="w-5 h-5" aria-hidden="true" />
              <span className="truncate max-w-[64px]">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
