import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { UserRole } from '../../shared/schemas';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="py-12 text-center text-sm text-slate-600">
        Checking session...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth/login" state={{ from: location.pathname }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <div className="max-w-lg mx-auto my-12 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <h1 className="font-display text-lg font-semibold mb-2">Access Restricted</h1>
        <p>Your account role ({user.role}) does not have permission to open this area.</p>
      </div>
    );
  }

  return <>{children}</>;
}
