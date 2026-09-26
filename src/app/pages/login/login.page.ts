import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, NavController } from '@ionic/angular';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss']
})
export class LoginPage {
  username = '';
  password = '';
  errorMessage = '';
  isLoading = false;
  showPassword = false; // Password visibility toggle variable

  constructor(
    private authService: AuthService,
    private navCtrl: NavController
  ) {}

  // Toggle password visibility
  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  quickAdminLogin() {
    this.username = 'admin';
    this.password = 'admin';
    this.attemptLogin();
  }

  async attemptLogin() {
    if (!this.username.trim() || !this.password.trim()) {
      this.errorMessage = 'Please enter both username and password.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      const user = await this.authService.login(this.username, this.password);
      // Role-based navigation
      const target = user.role === 'admin' ? '/admin' : '/student';
      this.navCtrl.navigateRoot(target);
    } catch (err: any) {
      if (err.status === 401) {
        this.errorMessage = err.error?.detail || 'Invalid credentials. Try again.';
      } else {
        this.errorMessage = 'Unable to connect to the server. Please try again later.';
      }
    } finally {
      this.isLoading = false;
    }
  }
}