import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const token = authService.getToken();

  // Only add token for admin API endpoints
  const outgoingReq =
    token && req.url.includes('/admin/')
      ? req.clone({
          setHeaders: {
            Authorization: `Bearer ${token}`,
          },
        })
      : req;

  return next(outgoingReq).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && req.url.includes('/admin/')) {
        authService.logout();
        router.navigateByUrl('/login');
      }
      return throwError(() => err);
    })
  );
};