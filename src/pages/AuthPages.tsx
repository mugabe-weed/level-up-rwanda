import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  bootstrapAdminSchema,
  confirmPasswordResetSchema,
  loginSchema,
  registerSchema,
  requestPasswordResetSchema,
  verifyContactSchema,
} from '../../shared/schemas';
import { z } from 'zod';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/translations';
import { ApiError, apiRequest } from '../lib/api';

export function LoginPage() {
  const { t } = useI18n();
  const { refreshAuth, superAdminExists } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from || '/';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (values: z.infer<typeof loginSchema>) => {
    setServerError(null);
    try {
      await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      await refreshAuth();
      navigate(from, { replace: true });
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Unable to sign in');
    }
  };

  return (
    <div className="max-w-md mx-auto my-8 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
      <h1 className="font-display text-2xl font-bold text-[#0B1B3B]">{t.auth.signInTitle}</h1>
      <p className="text-sm text-slate-600 mt-1">{t.tagline}</p>

      {serverError && (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <div>
          <label htmlFor="login-identifier" className="block text-sm font-medium text-slate-800 mb-1">
            {t.auth.emailOrPhone}
          </label>
          <input
            id="login-identifier"
            type="text"
            autoComplete="username"
            {...register('identifier')}
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
          />
          {errors.identifier && (
            <p className="text-xs text-red-600 mt-1">{errors.identifier.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="login-password" className="block text-sm font-medium text-slate-800 mb-1">
            {t.auth.passwordLabel}
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            {...register('password')}
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
          />
          {errors.password && (
            <p className="text-xs text-red-600 mt-1">{errors.password.message}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {isSubmitting ? t.common.loading : t.nav.signIn}
        </button>
      </form>

      <div className="mt-6 pt-5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <Link to="/auth/reset-password" className="text-blue-600 hover:underline">
          {t.auth.forgotPassword}
        </Link>
        <Link to="/auth/verify-contact" className="text-blue-600 hover:underline">
          {t.auth.needVerify}
        </Link>
        <Link to="/auth/register" className="text-blue-600 hover:underline font-medium">
          {t.nav.register}
        </Link>
      </div>

      {!superAdminExists && (
        <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-500">
          First-time deployment?{' '}
          <Link to="/auth/bootstrap-admin" className="text-purple-700 font-medium hover:underline">
            Provision first super administrator
          </Link>
        </div>
      )}
    </div>
  );
}

export function RegisterPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [previewCode, setPreviewCode] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      ageGroup: 'adult_18_plus',
      preferredLanguage: lang,
    },
  });

  const onSubmit = async (values: z.input<typeof registerSchema>) => {
    setServerError(null);
    try {
      const res = await apiRequest<{ userId: number; verificationPreviewCode?: string }>(
        '/auth/register',
        {
          method: 'POST',
          body: JSON.stringify(values),
        },
      );
      if (res.verificationPreviewCode) {
        setPreviewCode(res.verificationPreviewCode);
      } else {
        navigate('/auth/login');
      }
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Registration failed');
    }
  };

  return (
    <div className="max-w-lg mx-auto my-8 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
      <h1 className="font-display text-2xl font-bold text-[#0B1B3B]">{t.auth.registerTitle}</h1>
      <p className="text-sm text-slate-600 mt-1">{t.common.freeAccess}</p>

      {serverError && (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {serverError}
        </div>
      )}

      {previewCode && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 space-y-2">
          <p className="font-semibold">Account created successfully.</p>
          <p>
            Development verification code:{' '}
            <span className="font-mono-tabular font-bold">{previewCode}</span>
          </p>
          <div className="flex gap-3 pt-1">
            <Link
              to="/auth/verify-contact"
              className="px-3 py-1.5 bg-emerald-700 text-white text-xs font-medium rounded-lg"
            >
              Verify Contact Now
            </Link>
            <Link
              to="/auth/login"
              className="px-3 py-1.5 border border-emerald-300 text-emerald-900 text-xs font-medium rounded-lg"
            >
              Go to Sign In
            </Link>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="reg-display" className="block text-sm font-medium text-slate-800 mb-1">
              {t.auth.displayNameLabel}
            </label>
            <input
              id="reg-display"
              type="text"
              {...register('displayName')}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
            />
            {errors.displayName && (
              <p className="text-xs text-red-600 mt-1">{errors.displayName.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="reg-username" className="block text-sm font-medium text-slate-800 mb-1">
              {t.auth.usernameLabel}
            </label>
            <input
              id="reg-username"
              type="text"
              {...register('username')}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
            />
            {errors.username && (
              <p className="text-xs text-red-600 mt-1">{errors.username.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="reg-email" className="block text-sm font-medium text-slate-800 mb-1">
              {t.auth.emailLabel}
            </label>
            <input
              id="reg-email"
              type="email"
              {...register('email')}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
            />
            {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <label htmlFor="reg-phone" className="block text-sm font-medium text-slate-800 mb-1">
              {t.auth.phoneLabel}
            </label>
            <input
              id="reg-phone"
              type="tel"
              placeholder="+250788000000"
              {...register('phone')}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
            />
            {errors.phone && <p className="text-xs text-red-600 mt-1">{errors.phone.message}</p>}
          </div>
        </div>

        <div>
          <label htmlFor="reg-password" className="block text-sm font-medium text-slate-800 mb-1">
            {t.auth.passwordLabel}
          </label>
          <input
            id="reg-password"
            type="password"
            {...register('password')}
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
          />
          <p className="text-xs text-slate-500 mt-1">
            Minimum 8 characters with uppercase, lowercase, and a number.
          </p>
          {errors.password && (
            <p className="text-xs text-red-600 mt-1">{errors.password.message}</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="reg-age" className="block text-sm font-medium text-slate-800 mb-1">
              {t.auth.ageGroupLabel}
            </label>
            <select
              id="reg-age"
              {...register('ageGroup')}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:border-blue-600 focus:outline-none"
            >
              <option value="adult_18_plus">{t.auth.adultOption}</option>
              <option value="youth_13_17">{t.auth.youthOption}</option>
            </select>
          </div>

          <div>
            <label htmlFor="reg-district" className="block text-sm font-medium text-slate-800 mb-1">
              {t.profile.district}
            </label>
            <input
              id="reg-district"
              type="text"
              placeholder="Gasabo"
              {...register('district')}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {isSubmitting ? t.common.loading : t.nav.register}
        </button>
      </form>
    </div>
  );
}

export function VerifyContactPage() {
  const { t } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof verifyContactSchema>>({
    resolver: zodResolver(verifyContactSchema),
  });

  const onSubmit = async (values: z.infer<typeof verifyContactSchema>) => {
    setError(null);
    setMessage(null);
    try {
      await apiRequest('/auth/verify-contact', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setMessage('Contact verified. You may now sign in.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed');
    }
  };

  return (
    <div className="max-w-md mx-auto my-8 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
      <h1 className="font-display text-2xl font-bold text-[#0B1B3B]">{t.auth.verifyTitle}</h1>
      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {message && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {message}
        </div>
      )}
      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <div>
          <label htmlFor="vc-id" className="block text-sm font-medium text-slate-800 mb-1">
            {t.auth.emailOrPhone}
          </label>
          <input
            id="vc-id"
            type="text"
            {...register('identifier')}
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
          />
          {errors.identifier && (
            <p className="text-xs text-red-600 mt-1">{errors.identifier.message}</p>
          )}
        </div>
        <div>
          <label htmlFor="vc-code" className="block text-sm font-medium text-slate-800 mb-1">
            Verification Code
          </label>
          <input
            id="vc-code"
            type="text"
            {...register('code')}
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg font-mono-tabular"
          />
          {errors.code && <p className="text-xs text-red-600 mt-1">{errors.code.message}</p>}
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg"
        >
          {t.common.submit}
        </button>
      </form>
    </div>
  );
}

export function ResetPasswordPage() {
  const { t } = useI18n();
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reqForm = useForm<z.infer<typeof requestPasswordResetSchema>>({
    resolver: zodResolver(requestPasswordResetSchema),
  });

  const confirmForm = useForm<z.infer<typeof confirmPasswordResetSchema>>({
    resolver: zodResolver(confirmPasswordResetSchema),
  });

  const onRequest = async (values: z.infer<typeof requestPasswordResetSchema>) => {
    setError(null);
    try {
      const res = await apiRequest<{ requested: boolean; resetPreviewCode?: string }>(
        '/auth/password-reset/request',
        { method: 'POST', body: JSON.stringify(values) },
      );
      confirmForm.setValue('identifier', values.identifier);
      if (res.resetPreviewCode) setPreviewCode(res.resetPreviewCode);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to request password reset');
    }
  };

  const onConfirm = async (values: z.infer<typeof confirmPasswordResetSchema>) => {
    setError(null);
    try {
      await apiRequest('/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setMessage('Password updated cleanly. You can now sign in with your new password.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reset password');
    }
  };

  return (
    <div className="max-w-md mx-auto my-8 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
      <h1 className="font-display text-2xl font-bold text-[#0B1B3B]">{t.auth.resetTitle}</h1>
      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {message && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {message}
        </div>
      )}
      {previewCode && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          Development reset code: <span className="font-mono-tabular font-bold">{previewCode}</span>
        </div>
      )}

      {step === 'request' ? (
        <form onSubmit={reqForm.handleSubmit(onRequest)} className="mt-6 space-y-4">
          <div>
            <label htmlFor="rp-id" className="block text-sm font-medium text-slate-800 mb-1">
              {t.auth.emailOrPhone}
            </label>
            <input
              id="rp-id"
              type="text"
              {...reqForm.register('identifier')}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="submit"
            disabled={reqForm.formState.isSubmitting}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg"
          >
            Request Reset Code
          </button>
        </form>
      ) : (
        <form onSubmit={confirmForm.handleSubmit(onConfirm)} className="mt-6 space-y-4">
          <div>
            <label htmlFor="rpc-id" className="block text-sm font-medium text-slate-800 mb-1">
              {t.auth.emailOrPhone}
            </label>
            <input
              id="rpc-id"
              type="text"
              {...confirmForm.register('identifier')}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="rpc-token" className="block text-sm font-medium text-slate-800 mb-1">
              Reset Code
            </label>
            <input
              id="rpc-token"
              type="text"
              {...confirmForm.register('token')}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg font-mono-tabular"
            />
          </div>
          <div>
            <label htmlFor="rpc-pass" className="block text-sm font-medium text-slate-800 mb-1">
              New Password
            </label>
            <input
              id="rpc-pass"
              type="password"
              {...confirmForm.register('newPassword')}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="submit"
            disabled={confirmForm.formState.isSubmitting}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg"
          >
            Save New Password
          </button>
        </form>
      )}
    </div>
  );
}

export function BootstrapAdminPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof bootstrapAdminSchema>>({
    resolver: zodResolver(bootstrapAdminSchema),
  });

  const onSubmit = async (values: z.infer<typeof bootstrapAdminSchema>) => {
    setError(null);
    try {
      await apiRequest('/auth/bootstrap-admin', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      navigate('/auth/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to provision administrator');
    }
  };

  return (
    <div className="max-w-lg mx-auto my-8 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
      <h1 className="font-display text-2xl font-bold text-[#0B1B3B]">{t.auth.bootstrapTitle}</h1>
      <p className="text-sm text-slate-600 mt-1">
        Requires the server’s <code className="font-mono-tabular">ADMIN_BOOTSTRAP_TOKEN</code> and works only when zero super administrators exist.
      </p>

      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <div>
          <label htmlFor="ba-token" className="block text-sm font-medium text-slate-800 mb-1">
            Bootstrap Token
          </label>
          <input
            id="ba-token"
            type="password"
            {...register('bootstrapToken')}
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg font-mono-tabular"
          />
          {errors.bootstrapToken && (
            <p className="text-xs text-red-600 mt-1">{errors.bootstrapToken.message}</p>
          )}
        </div>
        <div>
          <label htmlFor="ba-email" className="block text-sm font-medium text-slate-800 mb-1">
            Administrator Email
          </label>
          <input
            id="ba-email"
            type="email"
            {...register('email')}
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
          />
          {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="ba-name" className="block text-sm font-medium text-slate-800 mb-1">
              Display Name
            </label>
            <input
              id="ba-name"
              type="text"
              {...register('displayName')}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="ba-username" className="block text-sm font-medium text-slate-800 mb-1">
              Username
            </label>
            <input
              id="ba-username"
              type="text"
              {...register('username')}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
            />
          </div>
        </div>
        <div>
          <label htmlFor="ba-pass" className="block text-sm font-medium text-slate-800 mb-1">
            Strong Password (12+ characters)
          </label>
          <input
            id="ba-pass"
            type="password"
            {...register('password')}
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
          />
          {errors.password && (
            <p className="text-xs text-red-600 mt-1">{errors.password.message}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 px-4 bg-[#0B1B3B] hover:bg-[#142D61] text-white text-sm font-semibold rounded-lg"
        >
          {t.auth.bootstrapTitle}
        </button>
      </form>
    </div>
  );
}
