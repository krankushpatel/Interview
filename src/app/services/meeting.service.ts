import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ZoomMeetingDetails {
  meeting_id: string;
  topic: string;
  host_url: string;
  join_url: string;
  app_url?: string;
  password?: string;
  candidate_username: string;
  provider: 'zoom' | 'google_meet' | 'teams' | 'webrtc';
  created_at: number;
  status: 'active' | 'ended';
}

@Injectable({
  providedIn: 'root'
})
export class MeetingService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // 1. Test Zoom Credentials
  async testZoomCredentials(accountId: string, clientId: string, clientSecret: string): Promise<any> {
    return firstValueFrom(
      this.http.post(`${this.apiUrl}/meetings/zoom/test`, {
        account_id: accountId,
        client_id: clientId,
        client_secret: clientSecret
      })
    );
  }

  // 2. Save Zoom Credentials
  async saveZoomCredentials(accountId: string, clientId: string, clientSecret: string): Promise<any> {
    return firstValueFrom(
      this.http.post(`${this.apiUrl}/meetings/zoom/save-credentials`, {
        account_id: accountId,
        client_id: clientId,
        client_secret: clientSecret
      })
    );
  }

  // 3. Create Instant Zoom Meeting
  async createZoomMeeting(candidateUsername: string, topic?: string, durationMinutes: number = 60): Promise<{ success: boolean; meeting: ZoomMeetingDetails }> {
    return firstValueFrom(
      this.http.post<{ success: boolean; meeting: ZoomMeetingDetails }>(`${this.apiUrl}/meetings/zoom/create`, {
        candidate_username: candidateUsername,
        topic: topic || `Interview Session: ${candidateUsername}`,
        duration_minutes: durationMinutes
      })
    );
  }

  // 4. Poll / Get Active Meeting for Candidate
  async getActiveMeeting(candidateUsername: string): Promise<{ active: boolean; meeting: ZoomMeetingDetails | null }> {
    return firstValueFrom(
      this.http.get<{ active: boolean; meeting: ZoomMeetingDetails | null }>(`${this.apiUrl}/meetings/active/${encodeURIComponent(candidateUsername)}`)
    );
  }

  // 5. End Active Meeting
  async endMeeting(candidateUsername: string): Promise<{ success: boolean }> {
    return firstValueFrom(
      this.http.post<{ success: boolean }>(`${this.apiUrl}/meetings/end/${encodeURIComponent(candidateUsername)}`, {})
    );
  }

  // 6. Get Zoom Video SDK Session Token (role: 0 = Student Silent Broadcaster, 1 = Admin Proctor)
  async getZoomSessionToken(userIdentity: string, role: number = 0, sessionName?: string): Promise<{
    success: boolean;
    token: string;
    session_name: string;
    sdk_key: string;
    user_identity: string;
    role: number;
    expires_at: number;
  }> {
    return firstValueFrom(
      this.http.post<any>(`${this.apiUrl}/meetings/zoom/session-token`, {
        user_identity: userIdentity,
        role: role,
        session_name: sessionName
      })
    );
  }

  // 7. Get Zoom Configuration status
  async getZoomConfig(): Promise<{ has_video_sdk: boolean; has_oauth: boolean; has_jwt: boolean }> {
    return firstValueFrom(
      this.http.get<{ has_video_sdk: boolean; has_oauth: boolean; has_jwt: boolean }>(`${this.apiUrl}/meetings/zoom/config`)
    );
  }

  // 8. Schedule Zoom Interview & Email Candidate Invite
  async scheduleZoomInterview(data: {
    username: string;
    start_time: string;
    end_time: string;
    topics?: string[];
    custom_message?: string;
    send_email?: boolean;
  }): Promise<any> {
    return firstValueFrom(
      this.http.post<any>(`${this.apiUrl}/meetings/zoom/schedule`, data)
    );
  }

  // 9. Schedule Google Meet Interview & Email Candidate Invite
  async scheduleGoogleMeetInterview(data: {
    username: string;
    start_time: string;
    end_time: string;
    meeting_url?: string;
    topics?: string[];
    custom_message?: string;
    send_email?: boolean;
  }): Promise<any> {
    return firstValueFrom(
      this.http.post<any>(`${this.apiUrl}/meetings/meet/schedule`, data)
    );
  }

  // 10. Schedule Microsoft Teams Interview & Email Candidate Invite
  async scheduleTeamsInterview(data: {
    username: string;
    start_time: string;
    end_time: string;
    meeting_url?: string;
    topics?: string[];
    custom_message?: string;
    send_email?: boolean;
  }): Promise<any> {
    return firstValueFrom(
      this.http.post<any>(`${this.apiUrl}/meetings/teams/schedule`, data)
    );
  }

  // 11. Dispatch AI Bot On-Demand when candidate joins meeting
  async dispatchBot(username: string): Promise<any> {
    try {
      return await firstValueFrom(
        this.http.post<any>(`${this.apiUrl}/meetings/dispatch-bot`, { username })
      );
    } catch (e) {
      console.warn('[MeetingService] Bot dispatch notice:', e);
      return null;
    }
  }
}

