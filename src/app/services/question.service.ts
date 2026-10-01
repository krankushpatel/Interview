import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { ProgressiveScore } from './progressive-evaluation.service';

export interface Question {
  id: number;
  question: string;
  category: string;
  difficulty: string;
  keywords?: string[];
  class_name?: string;
}

export interface AnswerRecord {
  question_id: number;
  question_text: string;
  category: string;
  answer: string;
  session_id?: string;
}

@Injectable({ providedIn: 'root' })
export class QuestionService {

  constructor(private http: HttpClient) {}

  // async loadQuestions(): Promise<Question[]> {
  //   const res = await lastValueFrom(this.http.get<{ questions: Question[] }>(`${environment.apiUrl}/questions/all`));
  //   const allQ = res.questions;
  //   // Pick intro (id 11) + 3 easy, 3 medium, 3 hard (same logic as original)
  //   const intro = allQ.find(q => q.id === 1);
  //   const easy = allQ.filter(q => q.difficulty === 'Easy' && q.id !== 1);
  //   const medium = allQ.filter(q => q.difficulty === 'Medium' && q.id !== 1);
  //   const hard = allQ.filter(q => q.difficulty === 'Hard' && q.id !== 1);
  //   const getRandom = (arr: Question[], count: number) => {
  //     const shuffled = [...arr];
  //     for (let i = shuffled.length - 1; i > 0; i--) {
  //       const j = Math.floor(Math.random() * (i + 1));
  //       [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  //     }
  //     return shuffled.slice(0, count);
  //   };
  //   let final: Question[] = [];
  //   if (intro) final.push(intro);
  //   final.push(...getRandom(easy, 3), ...getRandom(medium, 3), ...getRandom(hard, 3));
  //   return final;
  // }

  async loadQuestions(): Promise<Question[]> {
    const username = sessionStorage.getItem('username') || 'anonymous';
    
    // 1. Fetch all questions and student's dynamic settings in parallel
    const [questionsRes, statusRes] = await Promise.all([
      lastValueFrom(this.http.get<{ questions: Question[] }>(`${environment.apiUrl}/questions/all`)),
      lastValueFrom(this.http.get<any>(`${environment.apiUrl}/student/exam-status?username=${username}`)).catch(() => null)
    ]);

    const allQ = (questionsRes.questions || []).map(q => {
      const qText = q.question || (q as any).text || '';
      return { ...q, question: qText };
    });
    const topicCounts = statusRes?.settings?.topicCounts;

    const getRandom = (arr: Question[], count: number) => {
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, count);
    };

    let final: Question[] = [];

    // 2. GROUP OVERRIDE LOGIC: If admin set custom topic counts for this group
    if (topicCounts && typeof topicCounts === 'object' && Object.keys(topicCounts).length > 0) {
      for (const [topic, count] of Object.entries(topicCounts)) {
        const targetCount = count as number;
        // Filter questions belonging to this specific category/topic
        const topicQuestions = allQ.filter(q => q.category && q.category.toLowerCase() === topic.toLowerCase());
        const selectedForTopic = getRandom(topicQuestions, targetCount);
        final.push(...selectedForTopic);
      }
      
      // Safety fallback if topic filters yield 0 questions
      if (final.length === 0) {
        console.warn('Topic counts provided but no matching questions found. Falling back to default.');
      } else {
        return final; // Returns exact custom count (e.g., 6 Python + 4 SQL + 5 Backend = 15 questions)
      }
    }

    // 3. DEFAULT FALLBACK LOGIC (Original 1 Intro + 3 Easy + 3 Medium + 3 Hard)
    const intro = allQ.find(q => q.id === 1);
    const easy = allQ.filter(q => q.difficulty === 'Easy' && q.id !== 1);
    const medium = allQ.filter(q => q.difficulty === 'Medium' && q.id !== 1);
    const hard = allQ.filter(q => q.difficulty === 'Hard' && q.id !== 1);
    
    if (intro) final.push(intro);
    final.push(...getRandom(easy, 3), ...getRandom(medium, 3), ...getRandom(hard, 3));
    
    return final;
  }

  async submitAnswer(answer: string, question: Question, answeredCount: number = 0, currentIndex: number = 0, sessionId: string): Promise<any> {
    const fd = new FormData();
    const qText = question.question || (question as any).text || '';
    fd.append('answer', answer);
    fd.append('username', sessionStorage.getItem('username') || 'anonymous');
    fd.append('question_id', String(question.id));
    fd.append('question_text', qText);
    fd.append('question', qText);
    fd.append('question_category', question.category);
    fd.append('answered_count', String(answeredCount));
    fd.append('current_index', String(currentIndex));
    fd.append('session_id', sessionId);
    // return lastValueFrom(this.http.post(`${environment.apiUrl}/submit`, fd));
    return lastValueFrom(this.http.post(`${environment.apiUrl}/submissions/submit`, fd));
  }

    async evaluate(
    username:      string,
    answers:       AnswerRecord[],
    events:        any[],
    sessionId:     string,
    cachedScores?: any[]   // ← ProgressiveScore[] from progressive eval cache
  ): Promise<any> {
    const fd = new FormData();
    fd.append('username',      username);
    fd.append('answers_json',  JSON.stringify(answers));
    fd.append('events_json',   JSON.stringify(events));
    fd.append('session_id',    sessionId);
 
    // Send cached per-question scores to backend so it skips re-evaluation
    if (cachedScores && cachedScores.length > 0) {
      fd.append('cached_scores_json', JSON.stringify(cachedScores));
    }
 
    return lastValueFrom(
      this.http.post(`${environment.apiUrl}/evaluation/evaluate`, fd)
    );
  }

  async storeProctoring(username: string, events: any[], sessionId: string) {
    const fd = new FormData();
    fd.append('username', username);
    fd.append('events_json', JSON.stringify(events));
    fd.append('session_id', sessionId);
    
    // ✅ Galti 2 Fix: Yahan sahi store-proctoring ka URL aayega
    return lastValueFrom(this.http.post(`${environment.apiUrl}/proctoring/store-proctoring`, fd));
  }

  // async getResults(username: string): Promise<any> {
  //   return lastValueFrom(this.http.get(`${environment.apiUrl}/results/${username}`));
  // }
  
  async getResults(username: string, sessionId?: string): Promise<any> {
    const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
    return lastValueFrom(this.http.get(`${environment.apiUrl}/evaluation/result/${username}${query}`));
  }
  
  async clearProctoring(username: string): Promise<void> {
    const fd = new FormData();
    fd.append('username', username);
    // ✅ Ye bilkul sahi hai
    await lastValueFrom(this.http.post(`${environment.apiUrl}/proctoring/clear-proctoring`, fd));
  }
}