import React, { createContext, useContext, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AgeGroup, SupportedLanguage, UserRole } from '../../shared/schemas';
import { useI18n } from '../i18n/translations';
import { apiRequest, queryClient } from '../lib/api';

export interface SessionUser {
  id: number;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: 'active' | 'suspended' | 'pending_verification';
  ageGroup: AgeGroup;
  preferredLanguage: SupportedLanguage;
  contactVerified: boolean;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  totalXp: number;
  currentLevel: number;
  currentStreak: number;
}

interface AuthMeResponse {
  user: SessionUser | null;
  superAdminExists: boolean;
  databaseConfigured: boolean;
}

interface AuthContextValue {
  user: SessionUser | null;
  superAdminExists: boolean;
  databaseConfigured: boolean;
  isLoading: boolean;
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
  changeLanguage: (lang: SupportedLanguage) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setLang } = useI18n();

  const { data, isLoading, refetch } = useQuery<AuthMeResponse>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiRequest<AuthMeResponse>('/auth/me'),
  });

  useEffect(() => {
    if (data?.user?.preferredLanguage) {
      setLang(data.user.preferredLanguage);
    }
  }, [data?.user?.preferredLanguage]);

  const refreshAuth = async () => {
    await refetch();
  };

  const logout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } finally {
      await queryClient.invalidateQueries();
      await refetch();
    }
  };

  const changeLanguage = async (lang: SupportedLanguage) => {
    setLang(lang);
    if (data?.user) {
      try {
        await apiRequest('/profile/me/language', {
          method: 'PATCH',
          body: JSON.stringify({ language: lang }),
        });
        await refetch();
      } catch {
        // local UI language still applies if offline/unconfigured
      }
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user: data?.user ?? null,
        superAdminExists: data?.superAdminExists ?? false,
        databaseConfigured: data?.databaseConfigured ?? true,
        isLoading,
        refreshAuth,
        logout,
        changeLanguage,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
