import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LoginResponse {
  success: boolean;
  username: string;
  name: string;
  role: 'admin' | 'student';
  email?: string;
  access_token?: string;   // only for admin
  token_type?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  constructor(private http: HttpClient) {}

  async login(username: string, password: string): Promise<LoginResponse> {
    const response = await lastValueFrom(
      this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, { username, password })
    );
    
    // Store session info in sessionStorage (per-tab isolation: survives reload, not shared across new tabs)
    sessionStorage.setItem('username', response.username);
    sessionStorage.setItem('name', response.name);
    sessionStorage.setItem('role', response.role);
    if (response.email) sessionStorage.setItem('email', response.email);

    if (response.role === 'admin' && response.access_token) {
      sessionStorage.setItem('admin_token', response.access_token);
      sessionStorage.setItem('admin_role', 'admin');
    } else {
      sessionStorage.removeItem('admin_token');
      sessionStorage.removeItem('admin_role');
    }

    // Clear any legacy localStorage admin keys so sessions never leak across tabs
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_role');

    return response;
  }

  logout(): void {
    sessionStorage.clear();
    localStorage.removeItem('token');
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_role');
  }

  getRole(): 'admin' | 'student' | null {
    const role = sessionStorage.getItem('role');
    return role === 'admin' || role === 'student' ? role : null;
  }

  getToken(): string | null {
    return sessionStorage.getItem('admin_token');
  }

  isLoggedIn(): boolean {
    const username = sessionStorage.getItem('username');
    const role = this.getRole();
    if (!username || !role) {
      return false;
    }
    if (role === 'admin') {
      return !!this.getToken();
    }
    return true;
  }

  hasRole(expectedRole: 'admin' | 'student'): boolean {
    return this.isLoggedIn() && this.getRole() === expectedRole;
  }
}