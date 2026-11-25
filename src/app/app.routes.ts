import { Routes } from '@angular/router';
import { guestGuard, roleGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login.page').then(m => m.LoginPage),
  },
  {
    path: 'student',
    canActivate: [roleGuard(['student'])],
    loadComponent: () => import('./pages/student/student.page').then(m => m.StudentPage),
  },
  {
    path: 'admin',
    canActivate: [roleGuard(['admin'])],
    loadComponent: () => import('./pages/admin/admin.page').then(m => m.AdminPage),
  },
  {
    path: 'results',
    canActivate: [roleGuard(['student', 'admin'])],
    loadComponent: () => import('./pages/results/results.page').then(m => m.ResultsPage),
  },
  {
    path: 'zoom-app',
    loadComponent: () => import('./pages/zoom-app/zoom-app.page').then(m => m.ZoomAppPage),
  },
  { path: '**', redirectTo: 'login' },
];