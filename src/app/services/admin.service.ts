import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Submission {
  id: string;
  username: string;
  student_name: string;
  question_id: number;
  question_text: string;
  question_category: string;
  answer: string;
  video_file: string | null;
  has_video: boolean;
  submitted_at: string;
  score?: number;
  feedback?: string;
}

export interface Student {
  username: string;
  name: string;
  email: string;
  is_terminated?: boolean; 
  termination_reason?: string;  
  attempts_taken?: number; 
  max_attempts?: number;
  isLive?: boolean; 
}

export interface Question {
  id: number;
  question: string;
  category: string;
  difficulty: string;
  keywords?: string[];
  class_name?: string;
  image?: string;
  hide_from_student?: boolean;        // ✅ NEW
  send_text_only_to_ai?: boolean;     // ✅ NEW
}

export interface ExamRecording {
  id: string;
  username: string;
  student_name: string;
  video_file: string;
  duration_sec: number;
  size_mb: number;
  submitted_at: string;
}

export interface ScreenRecording {
  id: string;
  username: string;
  student_name: string;
  video_file: string;
  size_mb: number;
  submitted_at: string;
}

export interface Timetable {
  schedule: {
    start_time: string;
    end_time: string;
    topics: string[];
    is_active: boolean;
    created_at: string;
    updated_at: string;
  };
}

@Injectable({ providedIn: 'root' })
export class AdminService {

  constructor(private http: HttpClient) {}

  // ============================================
  // SMART DATA FETCHING 
  // ============================================

  // Helper method: Backend kisi bhi format mein data bheje, ye usko sahi Array mein convert karega
  private extractArray(res: any, key: string): any[] {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (res[key] && Array.isArray(res[key])) return res[key];
    // Agar backend Object/Dictionary bhej raha hai, toh usko list banayega
    if (typeof res === 'object') {
      const vals = Object.values(res);
      if (vals.length > 0 && typeof vals[0] === 'object') {
        return Object.keys(res).map(k => ({ dictKey: k, ...(res[k] as any) }));
      }
    }
    return [];
  }

  async getSubmissions(): Promise<Submission[]> {
    const res = await lastValueFrom(this.http.get<{ submissions: Submission[] }>(`${environment.apiUrl}/admin/submissions`));
    return (res.submissions || []).map(s => ({
      ...s,
      student_name: s.student_name || s.username || 'Student'
    }));
  }

  async getStudents(): Promise<Student[]> {
    const res = await lastValueFrom(this.http.get<{ students: Student[] }>(`${environment.apiUrl}/admin/students`));
    return (res.students || []).map(st => ({
      ...st,
      name: st.name || st.username || 'Student',
      email: st.email || 'No email'
    }));
  }

  // async getQuestions(): Promise<Question[]> {
  //   const res = await lastValueFrom(this.http.get<{ questions: any[] }>(`${environment.apiUrl}/questions/all`));
  //   return (res.questions || []).map(q => {
  //     const qText = q.question || q.text || 'Blank Question';
  //     return {
  //       id: q.id,
  //       question: qText,
  //       category: q.category || 'General',
  //       difficulty: q.difficulty || 'Medium',
  //       keywords: q.keywords,
  //       class_name: q.class_name,
  //       image: q.image
  //     };
  //   });
  // }

  async getQuestions(): Promise<Question[]> {
    const res = await lastValueFrom(this.http.get<{ questions: any[] }>(`${environment.apiUrl}/questions/all`));
    return (res.questions || []).map(q => {
      const qText = q.question || q.text || 'Blank Question';
      return {
        id: q.id,
        question: qText,
        category: q.category || 'General',
        difficulty: q.difficulty || 'Medium',
        keywords: q.keywords,
        class_name: q.class_name,
        image: q.image,
        hide_from_student: q.hide_from_student,          // ✅ NEW
        send_text_only_to_ai: q.send_text_only_to_ai     // ✅ NEW
      };
    });
  }

  async getExamRecordings(): Promise<ExamRecording[]> {
    const res = await lastValueFrom(this.http.get<any>(`${environment.apiUrl}/admin/exam-recordings`));
    return this.extractArray(res, 'recordings');
  }

  async getScreenRecordings(): Promise<ScreenRecording[]> {
    const res = await lastValueFrom(this.http.get<any>(`${environment.apiUrl}/admin/screen-recordings`));
    return this.extractArray(res, 'recordings');
  }

  async getProctoringEvents(username: string): Promise<any[]> {
    try {
      const res = await lastValueFrom(this.http.get<any>(`${environment.apiUrl}/admin/proctoring/${username}`));
      return res.events || [];
    } catch {
      return [];
    }
  }

  // async addQuestion(text: string, category: string, difficulty: string, keywords?: string): Promise<any> {
  //   const fd = new FormData();
  //   fd.append('question', text);
  //   fd.append('category', category);
  //   fd.append('difficulty', difficulty);
  //   if (keywords) {
  //     fd.append('keywords', keywords);
  //   }
  //   return lastValueFrom(this.http.post(`${environment.apiUrl}/admin/questions/add`, fd));
  // }
  async addQuestion(
    text: string,
    category: string,
    difficulty: string,
    keywords?: string,
    image?: File | null,
    hideFromStudent?: boolean,           // ✅ NEW
    sendTextOnlyToAi?: boolean           // ✅ NEW
  ): Promise<any> {
    const fd = new FormData();
    fd.append('question', text);
    fd.append('category', category);
    fd.append('difficulty', difficulty);
    if (keywords) {
      fd.append('keywords', keywords);
    }
    if (image) {
      fd.append('image', image);
    }
    if (hideFromStudent) {                              // ✅ NEW
      fd.append('hide_from_student', 'true');
    }
    if (sendTextOnlyToAi) {                             // ✅ NEW
      fd.append('send_text_only_to_ai', 'true');
    }
    return lastValueFrom(this.http.post(`${environment.apiUrl}/admin/questions/add`, fd));
  }

  async deleteQuestion(id: number): Promise<any> {
    return lastValueFrom(this.http.delete(`${environment.apiUrl}/questions/${id}`));
  }

  async backfillKeywords(): Promise<any> {
    return lastValueFrom(this.http.post(`${environment.apiUrl}/questions/admin/backfill-keywords`, {}));
  }

  async getResults(username: string): Promise<any> {
    return lastValueFrom(this.http.get(`${environment.apiUrl}/results/${username}`));
  }

  async addStudent(name: string, email: string, sendEmail: boolean = true, maxAttempts: number = 1): Promise<any> {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('email', email);
    fd.append('send_email', String(sendEmail));
    fd.append('max_attempts', String(maxAttempts)); 

    return lastValueFrom(this.http.post(`${environment.apiUrl}/admin/students/add`, fd));
  }

  async deleteStudent(username: string): Promise<any> {
    return lastValueFrom(this.http.delete(`${environment.apiUrl}/admin/students/${username}`));
  }

  async getAttemptStatus(username: string): Promise<{ 
    attempts_taken: number; 
    max_attempts: number; 
    preferred_categories: string[];
    is_terminated?: boolean;
    termination_reason?: string;
  }> {
    return lastValueFrom(this.http.get<any>(`${environment.apiUrl}/student/attempt-status?username=${username}`));
  }

  getCategories(): Promise<string[]> {
    return lastValueFrom(this.http.get<string[]>(`${environment.apiUrl}/questions/categories`));
  }

  async increaseAttempts(username: string, incrementBy: number = 1): Promise<any> {
    const fd = new FormData();
    fd.append('username', username);
    fd.append('increment_by', incrementBy.toString());
    return lastValueFrom(this.http.post(`${environment.apiUrl}/admin/student/increase-attempts`, fd));
  }

  async setStudentCategories(username: string, categories: string[]): Promise<any> {
    const fd = new FormData();
    fd.append('username', username);
    fd.append('categories_json', JSON.stringify(categories));
    return lastValueFrom(this.http.post(`${environment.apiUrl}/admin/student/set-categories`, fd));
  }

  async getSessionLogs(): Promise<any[]> {
    const res: any = await lastValueFrom(this.http.get(`${environment.apiUrl}/admin/session-logs`));
    return Array.isArray(res) ? res : (res.logs || []);
  }

  // ============================================
  // ✅ TIMETABLE MANAGEMENT METHODS
  // ============================================

  async setTimetable(username: string, startTime: string, endTime: string, topics: string[]): Promise<any> {
    const fd = new FormData();
    fd.append('username', username);
    fd.append('start_time', startTime);
    fd.append('end_time', endTime);
    fd.append('topics_json', JSON.stringify(topics));
    return lastValueFrom(this.http.post(`${environment.apiUrl}/admin/timetable/set`, fd));
  }

  async getTimetable(username: string): Promise<Timetable | null> {
    try {
      const res = await lastValueFrom(this.http.get<Timetable>(`${environment.apiUrl}/admin/timetable/${username}`));
      return res;
    } catch {
      return null;
    }
  }

  async deleteTimetable(username: string): Promise<any> {
    return lastValueFrom(this.http.delete(`${environment.apiUrl}/admin/timetable/${username}`));
  }

  // ============================================
  // BULK IMPORT METHODS
  // ============================================

  async bulkImportStudents(file: File, sendEmail: boolean = true): Promise<any> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('send_email', String(sendEmail));
    return lastValueFrom(this.http.post(`${environment.apiUrl}/admin/students/bulk-import`, fd));
  }

  async bulkImportQuestions(file: File): Promise<any> {
    const fd = new FormData();
    fd.append('file', file);
    return lastValueFrom(this.http.post(`${environment.apiUrl}/admin/bulk-import/questions`, fd));
  }

  async downloadStudentTemplate(): Promise<void> {
    const token = sessionStorage.getItem('admin_token');
    if (!token) {
      console.error('No admin token found');
      return;
    }

    const response = await fetch(`${environment.apiUrl}/admin/download-template/student`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      console.error('Download failed:', response.status);
      return;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'student_import_template.xlsx';
    a.click();
    window.URL.revokeObjectURL(url);
  }

  async downloadQuestionTemplate(): Promise<void> {
    console.log('✅ downloadStudentTemplate called with fetch');
    const token = sessionStorage.getItem('admin_token');
    console.log('Token:', token ? 'exists' : 'missing');
    if (!token) {
      console.error('No admin token found');
      return;
    }

    const response = await fetch(`${environment.apiUrl}/admin/download-template/question`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      console.error('Download failed:', response.status);
      return;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'question_import_template.xlsx';
    a.click();
    window.URL.revokeObjectURL(url);
  }

  // Update/Edit Question
  // async updateQuestion(id: number, text: string, category: string, difficulty: string, keywords?: string): Promise<any> {
  //   console.log('✅ downloadupdate question Template called with fetch');
  //   const fd = new FormData();
  //   fd.append('id', id.toString());
  //   fd.append('question', text);
  //   fd.append('category', category);
  //   fd.append('difficulty', difficulty);
  //   if (keywords) {
  //     fd.append('keywords', keywords);
  //   }
  //   return lastValueFrom(this.http.post(`${environment.apiUrl}/admin/questions/update`, fd));
  // }

  async updateQuestion(
    id: number,
    text: string,
    category: string,
    difficulty: string,
    keywords?: string,
    image?: File | null,
    removeImage?: boolean,
    hideFromStudent?: boolean,           // ✅ NEW
    sendTextOnlyToAi?: boolean           // ✅ NEW
  ): Promise<any> {
    const fd = new FormData();
    fd.append('id', id.toString());
    fd.append('question', text);
    fd.append('category', category);
    fd.append('difficulty', difficulty);
    if (keywords) {
      fd.append('keywords', keywords);
    }
    if (image) {
      fd.append('image', image);
    }
    if (removeImage) {
      fd.append('remove_image', 'true');
    }
    if (hideFromStudent !== undefined) {                // ✅ NEW
      fd.append('hide_from_student', hideFromStudent ? 'true' : 'false');
    }
    if (sendTextOnlyToAi !== undefined) {               // ✅ NEW
      fd.append('send_text_only_to_ai', sendTextOnlyToAi ? 'true' : 'false');
    }
    return lastValueFrom(this.http.post(`${environment.apiUrl}/admin/questions/update`, fd));
  }

  // Add this method
  async getAllCategories(): Promise<string[]> {
    const res = await lastValueFrom(this.http.get<{ categories: string[] }>(`${environment.apiUrl}/questions/categories/all`));
    return res.categories;
  }

  // ✅ Category Management APIs (Fast single call)
  async getAllCategoriesStandalone(): Promise<string[]> {
    try {
      const res = await lastValueFrom(this.http.get<{ categories: string[] }>(`${environment.apiUrl}/categories/all`));
      const cats = Array.isArray(res?.categories) ? res.categories : [];
      const set = new Set<string>();
      cats.forEach(c => c && set.add(c.trim()));
      if (set.size === 0) set.add('General');
      return Array.from(set).sort();
    } catch {
      return ['General'];
    }
  }

  // ✅ Class Management API // 🟢 NAYA AUR SAHI CODE (Direct Array handle karega)
  async getAllClassesStandalone(): Promise<string[]> {
    try {
      // Backend direct array bhej raha hai, isliye type ko any ya string[] rakhein
      const res = await lastValueFrom(this.http.get<any>(`${environment.apiUrl}/classes/all`));
      
      // Agar response array hai toh return karo, warna object ke andar classes dhoondho, warna ['All']
      if (Array.isArray(res)) {
        return res;
      } else if (res && Array.isArray(res.classes)) {
        return res.classes;
      }
      return ['All'];
    } catch (e) {
      console.error('Failed to fetch classes', e);
      return ['All']; 
    }
  }

  async addCategoryStandalone(category: string): Promise<any> {
    const fd = new FormData();
    fd.append('category', category);
    return lastValueFrom(this.http.post(`${environment.apiUrl}/categories/add`, fd));
  }

  async deleteCategoryStandalone(category: string): Promise<any> {
    return lastValueFrom(this.http.delete(`${environment.apiUrl}/categories/${encodeURIComponent(category)}`));
  }

  // ============================================
  // LIVE TRACKING METHODS
  // ============================================

  async getLiveExams(): Promise<{ count: number; exams: any[] }> {
    const res = await lastValueFrom(this.http.get<any>(`${environment.apiUrl}/admin/live-exams`));
    return { count: res.count, exams: res.exams };
  }

  async getLiveExamDetails(username: string): Promise<any> {
    return lastValueFrom(this.http.get(`${environment.apiUrl}/admin/live-exam/${username}`));
  }

  // ============================================
  // BULK EMAIL METHODS
  // ============================================

  async scheduleBulkEmail(usernames: string[], subject: string, message: string, emailType: string = 'custom'): Promise<any> {
    const fd = new FormData();
    fd.append('usernames_json', JSON.stringify(usernames));
    fd.append('subject', subject);
    fd.append('message', message);
    fd.append('email_type', emailType);
    return lastValueFrom(this.http.post(`${environment.apiUrl}/admin/bulk-email/send`, fd));
  }

  // ============================================
  // BULK TIMETABLE METHOD
  // ============================================
  async bulkSetTimetable(usernames: string[], startTime: string, endTime: string, topics: string[]): Promise<any> {
    const fd = new FormData();
    fd.append('usernames_json', JSON.stringify(usernames));
    fd.append('start_time', startTime);
    fd.append('end_time', endTime);
    fd.append('topics_json', JSON.stringify(topics));
    return lastValueFrom(this.http.post(`${environment.apiUrl}/admin/timetable/bulk-set`, fd));
  }

  async getSmartStudents(page: number = 1, limit: number = 50, search: string = ""): Promise<any> {
    return lastValueFrom(this.http.get(`${environment.apiUrl}/admin/smart-students?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`));
  }

  async getStudentFullProfile(username: string): Promise<any> {
    return lastValueFrom(this.http.get(`${environment.apiUrl}/admin/student-full-profile/${username}`));
  }

  async reEvaluateAttempt(username: string, sessionId: string, force: boolean = true): Promise<any> {
    const fd = new FormData();
    fd.append('username', username);
    fd.append('session_id', sessionId);
    fd.append('force', String(force));
    return lastValueFrom(
      this.http.post(`${environment.apiUrl}/evaluation/re-evaluate`, fd)
    );
  }

  async getBulkImportStatus(jobId: string): Promise<any> {
    return lastValueFrom(this.http.get(`${environment.apiUrl}/admin/bulk-import/status/${jobId}`));
  }

  // ============================================
  // BATCH MANAGEMENT METHODS
  // ============================================

  async getBatches(): Promise<any[]> {
    const res = await lastValueFrom(
      this.http.get<{ batches: any[] }>(`${environment.apiUrl}/admin/batches`)
    );
    return res.batches || [];
  }

  async createBatch(name: string, usernames: string[], topics: string[]): Promise<any> {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('usernames_json', JSON.stringify(usernames));
    fd.append('topics_json', JSON.stringify(topics));
    return lastValueFrom(this.http.post(`${environment.apiUrl}/admin/batches/create`, fd));
  }

  async batchBulkSchedule(
    batchId: string,
    startTime: string,
    endTime: string,
    topics: string[],
    message: string = '' // 🟢 NAYA: Message parameter add kiya
  ): Promise<any> {
    const fd = new FormData();
    fd.append('batch_id', batchId);
    fd.append('start_time', startTime);
    fd.append('end_time', endTime);
    fd.append('topics_json', JSON.stringify(topics));
    fd.append('message', message); // 🟢 NAYA: Backend ko message bhej rahe hain
    return lastValueFrom(
      this.http.post(`${environment.apiUrl}/admin/batches/bulk-schedule`, fd)
    );
  }

  async getDashboardStats(): Promise<any> {
    const res = await lastValueFrom(this.http.get<any>(`${environment.apiUrl}/admin/dashboard-stats`));
    return res;
  }

  async deleteBatch(batchId: string): Promise<any> {
    return lastValueFrom(
      this.http.delete(`${environment.apiUrl}/admin/batches/${batchId}`)
    );
  }


  async addStudentsToBatch(batchId: string, usernames: string[]): Promise<any> {
    const fd = new FormData();
    fd.append('usernames_json', JSON.stringify(usernames));
    return lastValueFrom(
      this.http.post(`${environment.apiUrl}/admin/batches/${batchId}/add-students`, fd)
    );
  }

  async removeStudentFromBatch(batchId: string, username: string): Promise<any> {
    return lastValueFrom(
      this.http.delete(`${environment.apiUrl}/admin/batches/${batchId}/students/${username}`)
    );
  }

  async importStudentsToBatch(batchId: string, file: File): Promise<any> {
    const fd = new FormData();
    fd.append('file', file);
    return lastValueFrom(
      this.http.post(`${environment.apiUrl}/admin/batches/${batchId}/import-students`, fd)
    );
  }

  // ============================================
  // EXAM SETTINGS
  // ============================================

  async getExamSettings(): Promise<any> {
    const res = await lastValueFrom(
      this.http.get<{ settings: any }>(`${environment.apiUrl}/exam-settings`)
    );
    return res.settings;
  }

  async updateExamSettings(settings: Partial<{
    question_timer_seconds: number;
    max_violations: number;
    pass_score_threshold: number;
    excellent_score_threshold: number;
    suspicious_violation_threshold: number;
    cheating_violation_threshold: number;
    penalty_suspicious: number;
    penalty_cheating: number;
    max_attempts_default: number;
  }>): Promise<any> {
    return lastValueFrom(
      this.http.post(`${environment.apiUrl}/exam-settings`, settings)
    );
  }

  async resetExamSettings(): Promise<any> {
    return lastValueFrom(
      this.http.post(`${environment.apiUrl}/exam-settings/reset`, {})
    );
  }

  // ============================================
  // GROUP SETTINGS API
  // ============================================
  async saveGroupSettings(batchId: string, settings: any): Promise<any> {
    return lastValueFrom(
      this.http.post(`${environment.apiUrl}/admin/batches/${batchId}/settings`, settings)
    );
  }

  // ============================================
  // UPDATE BATCH TOPICS
  // ============================================
  async updateBatchTopics(batchId: string, topics: string[]): Promise<any> {
    const fd = new FormData();
    fd.append('topics_json', JSON.stringify(topics));
    return lastValueFrom(
      this.http.post(`${environment.apiUrl}/admin/batches/${batchId}/topics`, fd)
    );
  }

  // 🟢 NAYA FUNCTION: Specific topic ki classes lane ke liye
  async getClassesForTopic(topic: string): Promise<string[]> {
    try {
      const res = await lastValueFrom(this.http.get<any>(`${environment.apiUrl}/classes/by-topic?topic=${encodeURIComponent(topic)}`));
      if (Array.isArray(res)) {
        return res;
      } else if (res && Array.isArray(res.classes)) {
        return res.classes;
      }
      return ['All'];
    } catch (e) {
      console.error('Failed to fetch classes for topic', e);
      return ['All'];
    }
  }

  // ============================================
  // ✅ IMAGE MANAGER API (NEW)
  // ============================================

  async getAdminImages(): Promise<{ count: number; images: any[] }> {
    return lastValueFrom(
      this.http.get<{ count: number; images: any[] }>(
        `${environment.apiUrl}/admin/images/list`
      )
    );
  }

  async uploadAdminImages(files: File[]): Promise<any> {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    return lastValueFrom(
      this.http.post(`${environment.apiUrl}/admin/images/upload`, fd)
    );
  }

  async deleteAdminImage(filename: string): Promise<any> {
    return lastValueFrom(
      this.http.delete(
        `${environment.apiUrl}/admin/images/${encodeURIComponent(filename)}`
      )
    );
  }

  getAdminImageUrl(filename: string): string {
    if (!filename) return '';
    return `${environment.apiUrl}/uploads/questions/${filename}`;
  }

}