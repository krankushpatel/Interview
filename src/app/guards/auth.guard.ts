import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Protects routes so only authenticated users with an allowed role can enter.
 * Unauthenticated requests (e.g. copied URL opened in a new tab) redirect to /login.
 */
export function roleGuard(allowedRoles: Array<'admin' | 'student'>): CanActivateFn {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    if (!authService.isLoggedIn()) {
      return router.createUrlTree(['/login']);
    }

    const role = authService.getRole();
    if (!role || !allowedRoles.includes(role)) {
      return router.createUrlTree([role === 'admin' ? '/admin' : '/student']);
    }

    return true;
  };
}

/**
 * Keeps already-authenticated tabs on their role's home page when visiting /login,
 * while fresh tabs (empty sessionStorage) open /login normally.
 */
export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isLoggedIn()) {
    const role = authService.getRole();
    return router.createUrlTree([role === 'admin' ? '/admin' : '/student']);
  }

  return true;
};
