import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', loadComponent: () => import('./pages/login/login.page').then(m => m.LoginPage) },
  { path: 'student', loadComponent: () => import('./pages/student/student.page').then(m => m.StudentPage) },
  { path: 'admin', loadComponent: () => import('./pages/admin/admin.page').then(m => m.AdminPage) },
  { path: 'results', loadComponent: () => import('./pages/results/results.page').then(m => m.ResultsPage) },
  { path: 'zoom-app', loadComponent: () => import('./pages/zoom-app/zoom-app.page').then(m => m.ZoomAppPage) }
];