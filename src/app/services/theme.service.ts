import { Injectable, signal } from '@angular/core';

export type AppTheme = 'light' | 'dark';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_KEY = 'admin_theme_preference';
  
  readonly currentTheme = signal<AppTheme>('light');

  constructor() {
    this.initTheme();
  }

  private initTheme(): void {
    try {
      const savedTheme = localStorage.getItem(this.THEME_KEY) as AppTheme | null;
      if (savedTheme === 'light' || savedTheme === 'dark') {
        this.applyTheme(savedTheme);
      } else {
        // Default to light theme
        this.applyTheme('light');
      }
    } catch {
      this.applyTheme('light');
    }
  }

  setTheme(theme: AppTheme): void {
    try {
      localStorage.setItem(this.THEME_KEY, theme);
    } catch {}
    this.applyTheme(theme);
  }

  toggleTheme(): void {
    const nextTheme: AppTheme = this.currentTheme() === 'light' ? 'dark' : 'light';
    this.setTheme(nextTheme);
  }

  isDark(): boolean {
    return this.currentTheme() === 'dark';
  }

  isLight(): boolean {
    return this.currentTheme() === 'light';
  }

  private applyTheme(theme: AppTheme): void {
    this.currentTheme.set(theme);

    const docEl = document.documentElement;
    const body = document.body;

    if (theme === 'dark') {
      docEl.classList.remove('light', 'light-theme');
      docEl.classList.add('dark', 'ion-palette-dark');

      body.classList.remove('light', 'light-theme');
      body.classList.add('dark', 'dark-theme', 'ion-palette-dark');
    } else {
      docEl.classList.remove('dark', 'dark-theme', 'ion-palette-dark');
      docEl.classList.add('light', 'light-theme');

      body.classList.remove('dark', 'dark-theme', 'ion-palette-dark');
      body.classList.add('light', 'light-theme');
    }
  }
}
