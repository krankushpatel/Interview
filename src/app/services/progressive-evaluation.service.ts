import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { AnswerRecord } from './question.service';
import { environment } from '../../environments/environment';

// ── Updated interface — now carries all 3 dimension scores ──────────────────
export interface ProgressiveScore {
  questionId:    number;
  questionText:  string;
  answer:        string;
  score:         number;
  correctness:   number;   // NEW
  completeness:  number;   // NEW
  clarity:       number;   // NEW
  feedback:      string;
  aiUsed:        boolean;
  evaluatedAt:   Date;
  scoring_engine_version?: string;
}

@Injectable({ providedIn: 'root' })
export class ProgressiveEvaluationService {

  // Cache: questionId → full score object
  private scores: Map<number, ProgressiveScore> = new Map();

  // Track question IDs where the per-question AI call FAILED
  // finishExam will send these to backend for fallback evaluation
  private failedQuestionIds: Set<number> = new Set();

  private evaluationInProgress: Set<number> = new Set();

  constructor(private http: HttpClient) {}

  // ── Main method: called after each answer submit ─────────────────────────
  async evaluateAnswer(answer: AnswerRecord, _questionIndex: number): Promise<ProgressiveScore | null> {

    if (this.evaluationInProgress.has(answer.question_id)) return null;

    // ── Skipped / empty guard ───────────────────────────────────────────────
    const isEmpty =
      !answer.answer ||
      answer.answer.trim() === '' ||
      answer.answer.includes('[Skipped');

    if (isEmpty) {
      const skipScore: ProgressiveScore = {
        questionId:   answer.question_id,
        questionText: answer.question_text,
        answer:       answer.answer,
        score:        0, correctness: 0, completeness: 0, clarity: 0,
        feedback:     'Question was skipped.',
        aiUsed:       false,
        evaluatedAt:  new Date(),
      };
      this.scores.set(answer.question_id, skipScore);
      return skipScore;
    }

    this.evaluationInProgress.add(answer.question_id);

    try {
      const fd = new FormData();
      const username   = sessionStorage.getItem('username') ?? '';
      const questionId = Number.isFinite(answer.question_id) ? String(answer.question_id) : '0';
      const category   = answer.category?.trim() || 'General';

      fd.append('username',      username);
      fd.append('question_id',   questionId);
      fd.append('question_text', answer.question_text ?? '');
      fd.append('answer',        answer.answer);
      fd.append('category',      category);

      // Backend now returns: score, correctness, completeness, clarity, feedback, ai_used
      const result = await lastValueFrom(
        this.http.post<{
          score:        number;
          correctness:  number;
          completeness: number;
          clarity:      number;
          feedback:     string;
          ai_used?:     boolean;
          scoring_engine_version?: string;
        }>(`${environment.apiUrl}/evaluation/evaluate-single`, fd)
      );

      const progressiveScore: ProgressiveScore = {
        questionId:   answer.question_id,
        questionText: answer.question_text,
        answer:       answer.answer,
        score:        result.score        ?? 0,
        correctness:  result.correctness  ?? 0,
        completeness: result.completeness ?? 0,
        clarity:      result.clarity      ?? 0,
        feedback:     result.feedback     ?? '',
        aiUsed:       result.ai_used      ?? true,
        evaluatedAt:  new Date(),
        scoring_engine_version: result.scoring_engine_version,
      };

      this.scores.set(answer.question_id, progressiveScore);
      // Remove from failed set if it was there from a previous retry
      this.failedQuestionIds.delete(answer.question_id);
      return progressiveScore;

    } catch (err) {
      console.error('[ProgressiveEval] Failed for q' + answer.question_id, err);
      // Mark as failed — backend will re-evaluate this one at exam end
      this.failedQuestionIds.add(answer.question_id);
      return null;
    } finally {
      this.evaluationInProgress.delete(answer.question_id);
    }
  }

  // ── Called by finishExam to send cache to backend ──────────────────────
  // Returns the cached scores array ready for the `cached_scores_json` field
  getAllCachedScores(): ProgressiveScore[] {
    return Array.from(this.scores.values());
  }

  // Returns question IDs that need fallback evaluation at exam end
  getFailedQuestionIds(): number[] {
    return Array.from(this.failedQuestionIds);
  }

  // How many questions were successfully evaluated progressively
  getCachedCount(): number {
    return this.scores.size;
  }

  // ── Existing helpers (unchanged) ──────────────────────────────────────────
  getScore(questionId: number): ProgressiveScore | undefined {
    return this.scores.get(questionId);
  }

  getAllScores(): ProgressiveScore[] {
    return Array.from(this.scores.values());
  }

  getAverageScore(): number {
    const scores = this.getAllScores();
    if (!scores.length) return 0;
    return scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
  }

  getAIEvaluatedCount(): number {
    return this.getAllScores().filter(s => s.aiUsed).length;
  }

  clear(): void {
    this.scores.clear();
    this.failedQuestionIds.clear();
    this.evaluationInProgress.clear();
  }
}