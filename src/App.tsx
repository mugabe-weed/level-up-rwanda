/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/AppShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import { I18nProvider } from './i18n/translations';
import { queryClient } from './lib/api';
import { AdminPage } from './pages/AdminPage';
import {
  BootstrapAdminPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyContactPage,
} from './pages/AuthPages';
import { ChallengePlayPage } from './pages/ChallengePlayPage';
import { ConnectPage } from './pages/ConnectPage';
import { CreatePage } from './pages/CreatePage';
import { DashboardPage } from './pages/DashboardPage';
import { CourseDetailPage, LearnPage } from './pages/LearnPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { OpportunitiesPage } from './pages/OpportunitiesPage';
import { PlayPage } from './pages/PlayPage';
import { ProfilePage } from './pages/ProfilePage';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppShell>
              <Routes>
                <Route path="/" element={<DashboardPage />} />

                {/* Auth Routes */}
                <Route path="/auth/login" element={<LoginPage />} />
                <Route path="/auth/register" element={<RegisterPage />} />
                <Route path="/auth/verify-contact" element={<VerifyContactPage />} />
                <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
                <Route path="/auth/bootstrap-admin" element={<BootstrapAdminPage />} />

                {/* 5 Activity Areas */}
                <Route path="/play" element={<PlayPage />} />
                <Route path="/play/:slug" element={<ChallengePlayPage />} />
                <Route path="/learn" element={<LearnPage />} />
                <Route path="/learn/:slug" element={<CourseDetailPage />} />
                <Route path="/create" element={<CreatePage />} />
                <Route path="/connect" element={<ConnectPage />} />
                <Route path="/opportunities" element={<OpportunitiesPage />} />

                {/* Profile & Notifications */}
                <Route
                  path="/profile"
                  element={
                    <ProtectedRoute>
                      <ProfilePage />
                    </ProtectedRoute>
                  }
                />
                <Route path="/users/:username" element={<ProfilePage />} />
                <Route
                  path="/notifications"
                  element={
                    <ProtectedRoute>
                      <NotificationsPage />
                    </ProtectedRoute>
                  }
                />

                {/* Administration Console */}
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute allowedRoles={['moderator', 'educator', 'admin', 'super_admin']}>
                      <AdminPage />
                    </ProtectedRoute>
                  }
                />

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShell>
          </BrowserRouter>
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
