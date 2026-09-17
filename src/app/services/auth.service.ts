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
    
    // Store basic info in sessionStorage
    sessionStorage.setItem('username', response.username);
    sessionStorage.setItem('name', response.name);
    sessionStorage.setItem('role', response.role);
    if (response.email) sessionStorage.setItem('email', response.email);
    
    // ✅ Store JWT token in localStorage for admin (persists across page reloads)
    if (response.role === 'admin' && response.access_token) {
      localStorage.setItem('admin_token', response.access_token);
      localStorage.setItem('admin_role', 'admin');
    } else {
      // Clear any existing admin token on student login (safety)
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_role');
    }
    
    return response;
  }

  logout(): void {
    sessionStorage.clear();
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_role');
  }

  getRole(): string | null {
    return sessionStorage.getItem('role');
  }

  isLoggedIn(): boolean {
    return !!sessionStorage.getItem('username');
  }
}