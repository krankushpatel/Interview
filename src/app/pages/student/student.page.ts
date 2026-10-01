import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, NavController, ToastController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { QuestionService, Question, AnswerRecord } from '../../services/question.service';
import { ProctoringService, ProctorWarning, ProctorEvent } from '../../services/proctoring.service';
import { RecordingService } from '../../services/recording.service';
import { SpeechService } from '../../services/speech.service';
import { DiarizationService } from '../../services/diarization.service';
import { ProgressiveEvaluationService, ProgressiveScore } from '../../services/progressive-evaluation.service';
import { Subscription } from 'rxjs';
import * as faceapi from 'face-api.js';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { environment } from '../../../environments/environment';
import { EyeTrackingService } from '../../services/eye-tracking.service';
import { EyeViolationEvent } from '../../models/eye-tracking.models'; // You already have this, just ensure it's imported

@Component({
  selector: 'app-student',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  templateUrl: './student.page.html',
  styleUrls: ['./student.page.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class StudentPage implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('videoPreview') videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('testVideo') testVideoRef!: ElementRef<HTMLVideoElement>;

  userName = '';
  userAvatar = '';
  questions: Question[] = [];
  currentIndex = 0;
  currentQuestion!: Question;
  answerText = '';
  submitted = false;
  isSubmittingAnswer = false;
  isFinishingExam = false;
  isTransitioningQuestion = false;
  answeredBuffer: AnswerRecord[] = [];
  timerSeconds = 300;
  questionTimerSeconds = 300;
  timerInterval: any;
  isLoading = true;
  showStartOverlay = true;
  showWarningModal = false;
  warningMessage = '';
  warningCount = 0;
  showTerminationModal = false;
  terminationReason = '';
  showEvaluation = false;
  cameraReady = false;
  progressiveScores: ProgressiveScore[] = [];
  cachedBackgroundScores: any[] = [];
  showProgressiveScore = false;
  lastScore = 0;
  lastFeedback = '';
  private hasPendingAnswer = false;
  isEligible = true;
  blockReason = '';
  attemptsUsed = 0;
  maxAttempts = 1;
  isTerminated = false;
  examSchedule: any = null;

  formatScheduleDateTime(val: any): string {
    if (!val) return 'Not set';
    if (typeof val === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(val.trim())) {
      const parts = val.trim().split(':');
      const hours = parseInt(parts[0], 10);
      const minutes = parts[1];
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const formattedHours = hours % 12 || 12;
      return `${formattedHours}:${minutes} ${ampm}`;
    }
    const d = new Date(val);
    if (isNaN(d.getTime())) {
      return String(val);
    }
    return d.toLocaleString('en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  //tying
  allowTyping = true;

  // Face verification properties
  referenceFaceDescriptor: Float32Array | null = null;
  faceVerificationInterval: any = null;
  faceMismatchCount = 0;

  step: 'instructions' | 'mic-check' | 'camera-check' | 'exam' = 'instructions';
  instructionsAccepted = false;
  micTestPassed = false;
  faceDetected = false;

  micTestBlob: Blob | null = null;
  micTestRecorder: MediaRecorder | null = null;
  micTestChunks: Blob[] = [];
  micLevel = 0;
  micTestRunning = false;
  micTestTranscript: string = '';
  micTestVerificationStatus: 'idle' | 'pending' | 'passed' | 'failed' = 'idle';
  micTestSpeechRecognition: any = null;
  private micTestStream: MediaStream | null = null;
  private cameraCheckStream: MediaStream | null = null;
  private micAnalyserInterval: any;
  private micTestTimeoutId: any = null;
  micTestRetryCount = 0;
  readonly MAX_MIC_RETRIES = 3;

  proctorLogs: string[] = [];
  faceCount = 0;
  proctorEventsCount = 0;
  multipleSpeakersAlert = false;
  public globalSessionId: string = '';

  isSpeechListening = false;
  private textBeforeSpeech = '';
  private speechSubscription!: Subscription;
  private finalTranscriptSubscription!: Subscription;
  examDuration = 0;
  private durationInterval: any;
  private sessionStartTime = Date.now();
  private sessionTimerInterval: any;
  private examSessionId: string = '';
  private examStarted = false;

  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private audioProcessor: ScriptProcessorNode | null = null;
  private proctoringAudioStream: MediaStream | null = null;
  private proctoringAudioContext: AudioContext | null = null;
  private proctoringAudioSource: MediaStreamAudioSourceNode | null = null;
  private proctoringAudioProcessor: ScriptProcessorNode | null = null;
  private soundDetectionRunning = false;
  private soundDetectionIntervalId: any = null;

  private screenStream: MediaStream | null = null;
  private screenRecorder: MediaRecorder | null = null;
  private screenChunks: Blob[] = [];
  private screenStreamWs: WebSocket | null = null;
  private cameraStreamWs: WebSocket | null = null;
  private screenStreamInterval: any;
  private cameraStreamInterval: any;
  private hiddenCanvas = document.createElement('canvas');
  private cameraCanvas = document.createElement('canvas');
  private isStreaming = false;
  private cameraCheckInterval: any = null;
  private evaluationPollInterval: any = null;
  private evaluationPolling = false;
  private evaluationPollInFlight = false;
  private evaluationToast: HTMLIonToastElement | null = null;
  private eyeTrackingSub!: Subscription;
  private eyeWarningSub!: Subscription;
  charCount = 0;
  wordCount = 0;
  readonly MAX_WORDS = 1000;
  preferredCategories: string[] = [];
  examKeywords: string[] = [];
  private permissionsGranted = false;
  Math = Math;


  gazeStatistics: any = null;

  // Voice verification properties
  voiceVerificationInterval: any = null;
  voiceMismatchCount = 0;

  // Unified violation tracking
  violationCounts = {
    face: 0,
    voice: 0,
    multiple_speakers: 0,
    eye_contact: 0 
  };

  constructor(
    private http: HttpClient,
    private qService: QuestionService,
    private proctor: ProctoringService,
    private recorder: RecordingService,
    public speech: SpeechService,
    private diarization: DiarizationService,
    private navCtrl: NavController,
    private toastCtrl: ToastController,
    private progressiveEval: ProgressiveEvaluationService,
    private eyeTracking: EyeTrackingService
  ) {}

  async ngOnInit() {
    const existingSession = sessionStorage.getItem('active_exam_session_id');
    if (existingSession) {
      this.globalSessionId = existingSession;
    } else {
      this.globalSessionId = `SESS_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;
      sessionStorage.setItem('active_exam_session_id', this.globalSessionId);
    }
    this.examSessionId = this.globalSessionId;
    this.userName = sessionStorage.getItem('name') || 'Student';
    this.userAvatar = this.userName.charAt(0).toUpperCase();
    const role = sessionStorage.getItem('role');
    if (role === 'admin') {
      this.navCtrl.navigateRoot('/admin');
      return;
    }
    await this.requestPermissionsEarly();
    const canProceed = await this.checkEligibilityBeforeExam();
    if (!canProceed) {
      this.isLoading = false;
      return;
    }
    this.speechSubscription = this.speech.transcript$.subscribe(transcript => {
      if (!transcript) return;
      const prefix = this.textBeforeSpeech || '';
      const separator = (prefix && transcript && !prefix.endsWith(' ') && !prefix.endsWith('\n')) ? ' ' : '';
      const combined = prefix + separator + transcript;
      const clamped = this.clampToMaxWords(combined);
      if (clamped.exceeded && this.wordCount < this.MAX_WORDS) {
        this.showToast(`Maximum word limit (${this.MAX_WORDS} words) reached.`, 'warning');
      }
      this.answerText = clamped.text;
      this.updateCharCount();
    });

    this.finalTranscriptSubscription = this.speech.finalTranscript$.subscribe(final => {
      if (!final) return;
      const prefix = this.textBeforeSpeech || '';
      const separator = (prefix && final && !prefix.endsWith(' ') && !prefix.endsWith('\n')) ? ' ' : '';
      const combined = prefix + separator + final;
      const clamped = this.clampToMaxWords(combined);
      this.answerText = clamped.text;
      this.textBeforeSpeech = this.answerText;
      this.updateCharCount();
    });
    this.startSessionTimer();
    await this.logActivity('login', `User logged in`);
    await this.loadStudentPreferences();
    await this.loadQuestions();
    await this.loadExamSettings();
    this.initProctoring();
    this.proctor.reset();
    const username = sessionStorage.getItem('username');
    if (username) {
      try {
        const fd = new FormData();
        fd.append('username', username);
        await lastValueFrom(this.http.post(`${environment.apiUrl}/proctoring/clear-proctoring`, fd));
      } catch (err) {
        console.warn('Could not clear proctoring events', err);
      }
    }
    this.isLoading = false;
  }

  get maxProctorWarnings(): number {
    return this.proctor.maxWarnings;
  }

  private async requestPermissionsEarly(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach(t => t.stop());
      this.permissionsGranted = true;
      console.log('[Permissions] Camera + mic granted early');
    } catch (err) {
      console.warn('[Permissions] Could not get early permission', err);
    }
  }

  async checkEligibilityBeforeExam(): Promise<boolean> {
    const username = sessionStorage.getItem('username');
    if (!username) return false;
    try {
      const schedule = await lastValueFrom(
        this.http.get<any>(`${environment.apiUrl}/student/exam-schedule/${username}`)
      );
      this.examSchedule = schedule;
      if (!schedule.has_schedule) {
        this.isEligible = false;
        this.blockReason = schedule.message;
        this.showToast(this.blockReason, 'warning');
        return false;
      }
      if (!schedule.can_take_exam) {
        this.isEligible = false;
        this.blockReason = schedule.message;
        if (schedule.schedule) {
          const startTime = new Date(schedule.start_time);
          const endTime = new Date(schedule.end_time);
          this.blockReason = `${schedule.message}\n\n📅 Schedule:\nStart: ${startTime.toLocaleString()}\nEnd: ${endTime.toLocaleString()}\nTopics: ${schedule.schedule.topics?.join(', ') || 'Not specified'}`;
        }
        this.showToast(this.blockReason, 'warning');
        return false;
      }
      const status = await lastValueFrom(
        this.http.get<any>(`${environment.apiUrl}/student/exam-status?username=${username}`)
      );
      // ✅ Group-specific allowTyping setting apply karne ke liye
      if (status?.settings?.allowTyping !== undefined) {
        this.allowTyping = status.settings.allowTyping;
      }
      if (status.is_terminated === true) {
        this.isEligible = false;
        this.blockReason = '❌ Account terminated. Please contact your teacher.';
        this.showToast(this.blockReason, 'danger');
        return false;
      }
      if (status.attempts_taken >= status.max_attempts) {
        this.isEligible = false;
        this.blockReason = `❌ Attempts exhausted (${status.attempts_taken}/${status.max_attempts}). Please contact teacher.`;
        this.showToast(this.blockReason, 'danger');
        return false;
      }
      this.isEligible = true;
      return true;
    } catch (err) {
      console.error('Eligibility check failed', err);
      this.isEligible = false;
      this.blockReason = 'Failed to verify eligibility. Please try again later.';
      return false;
    }
  }

  ngAfterViewInit() {}

  async loadStudentPreferences() {
    const username = sessionStorage.getItem('username');
    if (!username) return;
    try {
      const status = await lastValueFrom(this.http.get<any>(`${environment.apiUrl}/student/attempt-status?username=${username}`));
      this.preferredCategories = status.preferred_categories || [];
    } catch (err) { console.error('Failed to load preferences', err); }
  }

  async loadQuestions() {
    try {
      const username = sessionStorage.getItem('username') || 'anonymous';
      
      // Keep your original URL with preferred categories intact
      let url = `${environment.apiUrl}/questions/all`;
      if (this.preferredCategories.length > 0) {
        url += `?categories=${encodeURIComponent(this.preferredCategories.join(','))}`;
      }

      // Fetch ALL questions and the student's status (which contains group settings) in parallel
      const [questionsRes, statusRes] = await Promise.all([
        lastValueFrom(this.http.get<{ questions: Question[] }>(url)),
        lastValueFrom(this.http.get<any>(`${environment.apiUrl}/student/exam-status?username=${username}`)).catch(() => null)
      ]);

      const allQ = questionsRes.questions || [];
      if (allQ.length === 0) {
        this.showToast('No questions available for selected categories.', 'warning');
        return;
      }

      const getRandom = (arr: Question[], count: number) => {
        const shuffled = [...arr];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled.slice(0, count);
      };

      const isIntroQ = (q: any): boolean => {
        if (!q) return false;
        if (q.id === 1 || String(q.id) === '1') return true;
        const cat = (q.category || '').toLowerCase().trim();
        if (cat === 'introduction' || cat === 'intro' || cat === 'self-introduction' || cat === 'self introduction') return true;
        const text = (q.question || q.text || '').toLowerCase().trim();
        return text.includes('introduce yourself') || text.includes('tell me about yourself') || text.includes('describe yourself') || text.includes('walk me through your background');
      };

      const defaultIntroQ: Question = {
        id: 1,
        question: 'Please introduce yourself, describing your background, key technical strengths, and recent software projects.',
        category: 'Introduction',
        difficulty: 'Easy',
        keywords: ['introduce', 'background', 'education', 'experience', 'projects', 'skills', 'strengths']
      };

      let finalQuestions: Question[] = [];
      const topicDistribution = statusRes?.settings?.topicDistribution;
      const topicCounts = statusRes?.settings?.topicCounts;

      // 🟢 SCENARIO A: TOPIC + CLASS DISTRIBUTION FOUND (Strict Random Filter)
      if (topicDistribution && Array.isArray(topicDistribution) && topicDistribution.length > 0) {
        console.log('[ExamEngine] Active Topic Distribution:', topicDistribution);

        for (const rule of topicDistribution) {
          const topic = rule.topic;
          // 🚀 Ab classes seedha rule ke andar se mil jayengi!
          const targetClasses = rule.targetClasses || []; 
          
          const l1Count = rule.l1 || 0; 
          const l2Count = rule.l2 || 0; 
          const l3Count = rule.l3 || 0; 
          const target = l1Count + l2Count + l3Count;

          if (target === 0) continue;

          // 1. ULTRA FAST FILTERING
          let topicQ = allQ.filter(q => {
            // Intro question never acts as technical question
            if (isIntroQ(q)) return false;
            // Topic match karo
            const qTopic = (q.category || '').toLowerCase().trim();
            if (qTopic !== (topic || '').toLowerCase().trim()) return false;

            // Class match karo (Agar rule me class hai toh hi filter karo)
            if (targetClasses.length > 0) {
              const qClass = ((q as any).class_name || (q as any).className || (q as any).class || 'All').toLowerCase().trim();
              if (!targetClasses.some((c: string) => c.toLowerCase().trim() === qClass)) {
                return false; 
              }
            }
            return true;
          });

          // 2. SPLIT & PICK BY DIFFICULTY
          const easyQ = topicQ.filter(q => (q.difficulty || '').toLowerCase().trim() === 'easy');
          const medQ = topicQ.filter(q => (q.difficulty || '').toLowerCase().trim() === 'medium');
          const hardQ = topicQ.filter(q => (q.difficulty || '').toLowerCase().trim() === 'hard');

          let eSel = getRandom(easyQ, l1Count);
          let mSel = getRandom(medQ, l2Count);
          let hSel = getRandom(hardQ, l3Count);
          let selected = [...eSel, ...mSel, ...hSel];

          // Fallback for missing questions
          if (selected.length < target) {
              const remaining = topicQ.filter(q => !selected.some(s => s.id === q.id));
              selected.push(...getRandom(remaining, target - selected.length));
          }

          finalQuestions.push(...selected);
        }

        const intro = allQ.find(isIntroQ) || { ...defaultIntroQ };
        finalQuestions.unshift(intro);
      }

      // 🔵 SCENARIO B: ONLY TOPIC COUNTS FOUND (Legacy/Fallback Support)
      else if (topicCounts && typeof topicCounts === 'object' && Object.keys(topicCounts).length > 0) {
        console.log('[ExamEngine] Custom Group Settings (Topic Counts) Active:', topicCounts);

        for (const [topic, requestedCount] of Object.entries(topicCounts)) {
          let target = requestedCount as number;
          const topicQ = allQ.filter(q => q.category && q.category.toLowerCase() === topic.toLowerCase() && !isIntroQ(q));
          
          target = Math.min(target, topicQ.length);
          if (target === 0) continue;

          const easyQ = topicQ.filter(q => q.difficulty === 'Easy');
          const medQ = topicQ.filter(q => q.difficulty === 'Medium');
          const hardQ = topicQ.filter(q => q.difficulty === 'Hard');

          // Old logic: Divide by 3
          let eReq = Math.ceil(target / 3);
          let mReq = Math.round(target / 3);
          let hReq = target - eReq - mReq;

          let eSel = getRandom(easyQ, eReq);
          let leftover = eReq - eSel.length; 

          mReq += leftover;
          let mSel = getRandom(medQ, mReq);
          leftover = mReq - mSel.length;

          hReq += leftover;
          let hSel = getRandom(hardQ, hReq);

          let selected = [...eSel, ...mSel, ...hSel];

          if (selected.length < target) {
              const remaining = topicQ.filter(q => !selected.some(s => s.id === q.id));
              selected.push(...getRandom(remaining, target - selected.length));
          }

          finalQuestions.push(...selected);
        }

        const intro = allQ.find(isIntroQ) || { ...defaultIntroQ };
        finalQuestions.unshift(intro);

      } else {
        // 🔵 SCENARIO C: NO GROUP SETTINGS (Default Original Fallback)
        console.log('[ExamEngine] Using Original Fallback (1 Intro + 3 Easy + 3 Med + 3 Hard)');
        const intro = allQ.find(isIntroQ) || { ...defaultIntroQ };
        const easy = allQ.filter(q => (q.difficulty || '').toLowerCase() === 'easy' && !isIntroQ(q));
        const medium = allQ.filter(q => (q.difficulty || '').toLowerCase() === 'medium' && !isIntroQ(q));
        const hard = allQ.filter(q => (q.difficulty || '').toLowerCase() === 'hard' && !isIntroQ(q));

        finalQuestions.push(intro);
        finalQuestions.push(...getRandom(easy, 3), ...getRandom(medium, 3), ...getRandom(hard, 3));
      }

      // 🛡️ GUARANTEE: Ensure Question 1 is ALWAYS the Introduce Yourself question
      if (!isIntroQ(finalQuestions[0])) {
        const introIdx = finalQuestions.findIndex(isIntroQ);
        if (introIdx !== -1) {
          const [foundIntro] = finalQuestions.splice(introIdx, 1);
          finalQuestions.unshift(foundIntro);
        } else {
          finalQuestions.unshift({ ...defaultIntroQ });
        }
      }

      if (finalQuestions.length === 0) throw new Error('No questions available');
      
      this.questions = finalQuestions;
      this.currentQuestion = this.questions[0];
      this.currentIndex = 0;
      this.buildExamKeywords(allQ);

    } catch (err) {
      console.error('Failed to load questions', err);
      this.showToast('Failed to load questions. Please refresh.', 'danger');
    }
  }

  private buildExamKeywords(categoryPool: Question[] = []) {
    const tier1: string[] = [];
    const tier2: string[] = [];
    const tier3: string[] = [];

    // TIER 1: Keywords from student's selected exam questions (highest priority)
    if (this.questions && this.questions.length > 0) {
      for (const q of this.questions) {
        if (q.keywords && Array.isArray(q.keywords)) {
          tier1.push(...q.keywords);
        }
      }
    }

    // TIER 2 & 3: Keywords from the entire category pool (e.g. Computer Science + AI)
    if (categoryPool && categoryPool.length > 0) {
      for (const q of categoryPool) {
        if (q.keywords && Array.isArray(q.keywords)) {
          for (const kw of q.keywords) {
            // Acronyms (e.g. PMOS, NMOS, CMOS, SQL, VHDL) or terms with uppercase/hyphen
            if (/^[A-Z0-9\-]{2,8}$/.test(kw.trim())) {
              tier2.push(kw);
            } else {
              tier3.push(kw);
            }
          }
        }
      }
    }

    // Combine in priority order and deduplicate case-insensitively, capped at 100 keywords
    const combined = [...tier1, ...tier2, ...tier3];
    this.examKeywords = this.speech.deduplicateKeywords(combined).slice(0, 100);
    console.log(`[ExamEngine] Generated ${this.examKeywords.length} optimized keywords for Deepgram:`, this.examKeywords);
  }

  initProctoring() {
    this.proctor.start(
      (warning: ProctorWarning) => this.onProctorWarning(warning),
      (info: any) => this.onProctorTerminate(info),
      (event: ProctorEvent) => this.addProctorLog(event.event, event.detail, event.event_id),
      (msg: string) => this.updateFaceStatus(msg),
      (secs: number) => this.handleNoFaceCountdown(secs)
    );
  }

  nextStep() {
    switch (this.step) {
      case 'instructions':
        if (this.instructionsAccepted) {
          this.step = 'mic-check';
          this.micTestRetryCount = 0;
          this.startMicCheck();
        } else {
          this.showToast('Please accept the instructions to continue', 'warning');
        }
        break;
      case 'mic-check':
        if (this.micTestPassed) {
          this.step = 'camera-check';
          this.startCameraCheck();
        } else {
          this.showToast('Please complete the microphone check first', 'warning');
        }
        break;
      case 'camera-check':
        if (this.faceDetected) {
          if (this.cameraCheckInterval) {
            clearInterval(this.cameraCheckInterval);
            this.cameraCheckInterval = null;
          }
          this.step = 'exam';
          this.startExam();
        } else {
          this.showToast('Please ensure your face is visible in the camera', 'warning');
        }
        break;
    }
  }

  async startMicCheck() {
    if (this.micTestTimeoutId) clearTimeout(this.micTestTimeoutId);
    this.stopMicCheckCleanup();
    this.micTestPassed = false;
    this.micTestVerificationStatus = 'pending';
    this.micTestChunks = [];
    const expectedSentence = "i am ready for the test";
    try {
      // this.micTestStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.micTestStream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true } 
      });
      this.micTestRecorder = new MediaRecorder(this.micTestStream);
      this.micTestRecorder.ondataavailable = (e) => { if (e.data.size) this.micTestChunks.push(e.data); };
      this.micTestRecorder.start(250);
      this.micTestRunning = true;
      this.startMicLevelIndicator();
      this.startMicTestSpeechRecognition(expectedSentence);
      this.micTestTimeoutId = setTimeout(() => {
        if (this.micTestRunning && !this.micTestPassed) {
          this.stopMicCheckCleanup();
          this.micTestVerificationStatus = 'failed';
          this.showToast('Mic check timed out. Please speak clearly.', 'warning');
        }
      }, 15000);
    } catch (err) {
      this.micTestVerificationStatus = 'failed';
      this.showToast('Microphone access denied.', 'danger');
    }
  }

  private startMicTestSpeechRecognition(expectedSentence: string) {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.showToast('Speech recognition not supported in this browser.', 'warning');
      return;
    }
    this.micTestSpeechRecognition = new SpeechRecognition();
    this.micTestSpeechRecognition.continuous = false;
    this.micTestSpeechRecognition.interimResults = false;
    this.micTestSpeechRecognition.lang = 'en-IN';
    this.micTestSpeechRecognition.maxAlternatives = 5;
    this.micTestSpeechRecognition.onresult = async (event: any) => {
      let bestMatch = false;
      let bestTranscript = '';
      for (let altIdx = 0; altIdx < (event.results[0]?.length || 0); altIdx++) {
        const transcript = event.results[0][altIdx].transcript.toLowerCase().trim();
        const similarity = this.calculateSimilarity(
          this.normalizeText(transcript),
          this.normalizeText(expectedSentence)
        );
        const wordOverlap = this.calculateWordOverlap(transcript, expectedSentence);
        console.log(`[MicCheck] Alt ${altIdx}: "${transcript}" | similarity: ${similarity.toFixed(2)} | word-overlap: ${wordOverlap.toFixed(2)}`);
        if (similarity >= 0.65 || wordOverlap >= 0.70) {
          bestMatch = true;
          bestTranscript = transcript;
          break;
        }
        if (altIdx === 0) bestTranscript = transcript;
      }
      this.micTestTranscript = bestTranscript;
      if (bestMatch) {
        if (this.micTestTimeoutId) clearTimeout(this.micTestTimeoutId);
        this.micTestVerificationStatus = 'passed';
        this.micTestPassed = true;
        this.showToast('✅ Microphone check passed! Enrolling voice...', 'success');
        
        // Flush remaining audio chunks from recorder before enrolling
        if (this.micTestRecorder && this.micTestRecorder.state !== 'inactive') {
          await new Promise<void>((resolve) => {
            if (this.micTestRecorder) {
              this.micTestRecorder.onstop = () => resolve();
              try { this.micTestRecorder.stop(); } catch (e) { resolve(); }
            } else {
              resolve();
            }
          });
        }
        await this.enrollVoiceSample();
        this.stopMicCheckCleanup();
      } else {
        this.micTestVerificationStatus = 'failed';
        this.micTestPassed = false;
        this.showToast(`❌ Didn't match. Try saying the sentence again.`, 'warning');
      }
    };
    this.micTestSpeechRecognition.onerror = (err: any) => {
      console.warn('[MicCheck] Speech error:', err.error);
      if (err.error === 'no-speech') {
        this.micTestVerificationStatus = 'failed';
        this.showToast('No speech detected. Please speak clearly.', 'warning');
      }
    };
    this.micTestSpeechRecognition.onend = () => {
      if (this.micTestRunning && !this.micTestPassed) {
        setTimeout(() => {
          if (this.micTestRunning && !this.micTestPassed && this.micTestSpeechRecognition) {
            try { this.micTestSpeechRecognition.start(); } catch (e) {}
          }
        }, 200);
      }
    };
    try { this.micTestSpeechRecognition.start(); } catch (e) { console.warn('[MicCheck] Recognition start failed', e); }
  }

  // ==================== VOICE ENROLLMENT ====================
  private async enrollVoiceSample() {
    if (this.micTestChunks.length === 0) return;
    
    try {
      const audioBlob = new Blob(this.micTestChunks, { type: 'audio/webm' });
      const fd = new FormData();
      fd.append('username', sessionStorage.getItem('username') || '');
      fd.append('audio', audioBlob, 'mic_check.webm');
      
      console.log('[Voice] Sending audio for enrollment...');
      const response = await lastValueFrom(
        this.http.post<any>(`${environment.apiUrl}/speaker/enroll`, fd)
      );
      
      if (response.success) {
        console.log('[Voice] ✅ Voice enrolled successfully on server!');
      } else {
        console.warn('[Voice] ⚠️ Enrollment failed:', response.message);
      }
    } catch (err) {
      console.error('[Voice] ❌ Enrollment error:', err);
    }
  }

  // ==================== PERIODIC VOICE VERIFICATION ====================
  startPeriodicVoiceVerification() {
    if (this.voiceVerificationInterval) clearInterval(this.voiceVerificationInterval);
    
    this.voiceVerificationInterval = setInterval(async () => {
      if (this.showEvaluation || !this.mediaStream) return;
      await this.captureAndVerifyVoiceChunk();
    }, 10000); // Har 10 seconds me check karega
  }

  private async captureAndVerifyVoiceChunk() {
    let chunkStream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let timeoutId: any = null;
    let stopped = false;

    // ✅ FIX: Single cleanup function — guaranteed to run exactly once
    const cleanupChunk = () => {
      if (stopped) return;
      stopped = true;
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (e) {}
      }
      if (chunkStream) {
        chunkStream.getTracks().forEach(t => {
          try { t.enabled = false; t.stop(); } catch (e) {}
        });
        chunkStream = null;
      }
    };

    try {
      if (!this.mediaStream) return;
      const audioTrack = this.mediaStream.getAudioTracks()[0];
      if (!audioTrack) return;

      // ✅ FIX: If the source track is already dead, skip cloning
      if (audioTrack.readyState === 'ended') {
        console.warn('[Voice] Source audio track ended, skipping chunk');
        return;
      }

      chunkStream = new MediaStream([audioTrack.clone()]);
      recorder = new MediaRecorder(chunkStream, { mimeType: 'audio/webm' });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      await new Promise<void>((resolve) => {
        if (!recorder) { resolve(); return; }

        recorder.onstop = async () => {
          try {
            const blob = new Blob(chunks, { type: 'audio/webm' });

            if (blob.size < 25600) {
              console.log('[Voice] Silence/Noise detected. Skipping verification.');
              return;
            }

            const fd = new FormData();
            fd.append('username', sessionStorage.getItem('username') || '');
            fd.append('audio', blob, 'verify_chunk.webm');

            try {
              const res = await lastValueFrom(
                this.http.post<any>(`${environment.apiUrl}/speaker/verify`, fd)
              );
              console.log(`[Voice] Similarity: ${res.similarity?.toFixed(3)}, Match: ${res.is_same}`);
              if (!res.is_same) {
                this.handleViolation('voice', `Similarity: ${res.similarity?.toFixed(3)}`);
              } else {
                this.violationCounts.voice = Math.max(0, this.violationCounts.voice - 1);
              }
            } catch (err) {
              console.error('[Voice] Verification error:', err);
            }
          } finally {
            resolve();
          }
        };

        // ✅ FIX: Wrap start() in try/catch — if it throws, onstop will never fire
        try {
          recorder.start();
        } catch (startErr) {
          console.error('[Voice] Recorder.start() failed:', startErr);
          resolve();
          return;
        }

        timeoutId = setTimeout(() => {
          if (recorder && recorder.state === 'recording') {
            try { recorder.stop(); } catch (e) {}
          }
        }, 3000);
      });

      // ✅ FIX: Always cleanup after the promise chain completes
      cleanupChunk();
    } catch (err) {
      console.error('[Voice] Chunk capture failed:', err);
    } finally {
      // ✅ FIX: Belt-and-suspenders — even if the try block throws, we cleanup
      cleanupChunk();
    }
  }

  private handleViolation(type: 'face' | 'voice' | 'multiple_speakers' | 'eye_contact', detail: string) {
    const logMsg = `[${new Date().toLocaleTimeString()}] ${type.toUpperCase()}: ${detail}`;
    this.proctorLogs.unshift(logMsg);
    console.warn(logMsg);

    // Forward to proctor stream so it reaches the backend and capture descriptive evidence
    if (type === 'face') {
      const evName = /multiple faces/i.test(detail) ? 'multiple_faces_detected' : 'face_mismatch';
      this.captureEvidence(evName, detail);
      this.proctor.logEvent(evName, detail);
    } else if (type === 'voice') {
      this.captureEvidence('voice_mismatch', detail);
      this.proctor.logEvent('voice_mismatch', detail);
    } else if (type === 'multiple_speakers') {
      this.captureEvidence('multiple_speakers_detected', detail);
      this.proctor.logEvent('multiple_speakers_detected', detail);
    } else if (type === 'eye_contact') {
      this.captureEvidence('eye_contact_violation', detail);
      this.proctor.logEvent('eye_contact_violation', detail);
      // Optional: Show a toast to the student immediately
      this.showToast(`⚠️ Eye Tracking: ${detail}`, 'warning');
    }

    if (type === 'multiple_speakers') {
      console.log('[Multiple Speakers] ⏸️ PAUSED — Logging only, no termination');
      return;
    }

    this.violationCounts[type] = (this.violationCounts[type] || 0) + 1;

    const faceThreshold = 50;
    const voiceThreshold = 500;
    const eyeThreshold = 500; // Add a threshold for eye contact violations

    if (this.violationCounts.face >= faceThreshold || 
        this.violationCounts.voice >= voiceThreshold ||
        (this.violationCounts['eye_contact'] || 0) >= eyeThreshold) {
        
      this.showToast(`❌ Exam Terminated: Repeated ${type.replace('_', ' ')} detected!`, 'danger');
      this.terminateExam('multiple_violations', `Threshold exceeded: Face=${this.violationCounts.face}, Voice=${this.violationCounts.voice}, Eye=${this.violationCounts['eye_contact'] || 0}`);
    }
  }

  private startMicLevelIndicator() {
    if (!this.micTestStream) return;
    try {
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(this.micTestStream);
      const analyser = audioCtx.createAnalyser();
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const update = () => {
        if (!this.micTestRunning) { audioCtx.close(); return; }
        analyser.getByteTimeDomainData(dataArray);
        let max = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          max = Math.max(max, Math.abs(v));
        }
        this.micLevel = max * 100;
        this.micAnalyserInterval = requestAnimationFrame(update);
      };
      update();
    } catch (e) { console.warn('[MicCheck] Level indicator failed', e); }
  }

  private stopMicCheckCleanup() {
    this.micTestRunning = false;
    if (this.micAnalyserInterval) { cancelAnimationFrame(this.micAnalyserInterval); this.micAnalyserInterval = null; }
    if (this.micTestSpeechRecognition) { try { this.micTestSpeechRecognition.stop(); } catch (e) {} this.micTestSpeechRecognition = null; }
    if (this.micTestRecorder && this.micTestRecorder.state !== 'inactive') { try { this.micTestRecorder.stop(); } catch (e) {} }
    this.micTestRecorder = null;
    if (this.micTestStream) { this.micTestStream.getTracks().forEach(t => t.stop()); this.micTestStream = null; }
  }

  stopMicCheck() {
    if (this.micTestTimeoutId) clearTimeout(this.micTestTimeoutId);
    this.stopMicCheckCleanup();
    if (!this.micTestPassed) this.micTestVerificationStatus = 'idle';
  }

  retryMicCheck() {
    this.micTestRetryCount++;
    this.micTestVerificationStatus = 'idle';
    this.micTestTranscript = '';
    this.micTestPassed = false;
    this.startMicCheck();
  }

  playMicTest() {
    if (this.micTestBlob) {
      const audio = new Audio(URL.createObjectURL(this.micTestBlob));
      audio.play();
    }
  }

  private calculateWordOverlap(spoken: string, expected: string): number {
    const spokenWords = this.normalizeText(spoken).split(' ').filter(Boolean);
    const expectedWords = this.normalizeText(expected).split(' ').filter(Boolean);
    if (expectedWords.length === 0) return 0;
    let matches = 0;
    for (const word of spokenWords) {
      if (expectedWords.includes(word)) matches++;
    }
    return matches / expectedWords.length;
  }

  private normalizeText(text: string): string {
    return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    if (longer.length === 0) return 1.0;
    return (longer.length - this.levenshteinDistance(longer, shorter)) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length, n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + cost);
      }
    }
    return dp[m][n];
  }
  
  async startCameraCheck() {
    try {
      this.showToast('Starting camera...', 'primary');
      await this.proctor.loadFaceModels();
      console.log('[CameraCheck] Face models loaded');

      // ✅ FIX: Stop any previously leaked camera-check stream first
      this.stopCameraCheckStream();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });

      // ✅ FIX: Store the stream in a class property so we can stop it later
      this.cameraCheckStream = stream;

      if (!this.testVideoRef?.nativeElement) {
        // ✅ FIX: If the video element isn't ready, don't leak the stream
        this.stopCameraCheckStream();
        return;
      }
      const videoEl = this.testVideoRef.nativeElement;
      videoEl.srcObject = stream;
      videoEl.onloadedmetadata = () => {
        videoEl.play();
        this.runFaceEnrollment(videoEl);
      };
    } catch (err) {
      this.showToast('Camera access denied.', 'danger');
    }
  }

  // ✅ NEW: Helper to stop the camera-check stream and detach from DOM
  private stopCameraCheckStream() {
    if (this.cameraCheckStream) {
      this.cameraCheckStream.getTracks().forEach(t => {
        t.enabled = false;
        t.stop();
      });
      this.cameraCheckStream = null;
    }
    if (this.testVideoRef?.nativeElement) {
      const videoEl = this.testVideoRef.nativeElement;
      try {
        videoEl.pause();
        videoEl.srcObject = null;
        videoEl.removeAttribute('src');
        videoEl.load();
      } catch (e) {}
    }
  }

  private async runFaceEnrollment(videoEl: HTMLVideoElement) {
    let attempts = 0;
    const maxAttempts = 40;
    this.cameraCheckInterval = setInterval(async () => {
      attempts++;
      if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        if (!faceapi.nets.tinyFaceDetector.isLoaded || !faceapi.nets.faceRecognitionNet.isLoaded) {
          return;
        }
        try {
          const detection = await (faceapi as any).detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 }))
            .withFaceLandmarks()
            .withFaceDescriptor();
            
          if (detection) {
            this.faceDetected = true;
            this.referenceFaceDescriptor = detection.descriptor;
            clearInterval(this.cameraCheckInterval);
            
            console.log('[Face] ✅ Candidate face enrolled successfully with descriptor');
            this.captureEvidence('face_enrolled', 'Baseline candidate face enrolled during camera setup');

            this.showToast('✅ Face detected! Calibrating eye tracking...', 'success');
            
            // 1. Initialize MediaPipe
            await this.eyeTracking.initialize(videoEl);
            
            // 2. Run 5-Point Calibration
            await this.runEyeTrackingCalibration();
            
            this.showToast('✅ Calibration complete! Ready to start exam.', 'success');
            return;
          } else {
            if (attempts % 6 === 0) {
              this.showToast('😕 No face detected. Ensure good lighting and look at camera.', 'warning');
            }
          }
        } catch (err) {
          console.error('[Face] Detection error:', err);
        }
      }
      if (attempts >= maxAttempts && !this.faceDetected) {
        clearInterval(this.cameraCheckInterval);
        this.showToast('❌ Face detection failed. Please refresh and try again.', 'danger');
      }
    }, 500);
  }

  private async runEyeTrackingCalibration(): Promise<void> {
    return new Promise(async (resolve) => {
      const dot = document.createElement('div');
      dot.style.cssText = `
        position: fixed; width: 20px; height: 20px; background-color: #00ff00; 
        border-radius: 50%; z-index: 99999; transform: translate(-50%, -50%); 
        transition: all 0.5s ease; box-shadow: 0 0 10px rgba(0,255,0,0.5);
      `;
      document.body.appendChild(dot);

      const points = [
        { x: '50%', y: '50%' }, { x: '20%', y: '20%' }, 
        { x: '80%', y: '20%' }, { x: '20%', y: '80%' }, { x: '80%', y: '80%' }
      ];

      // ✅ FIX: Only sample at center for offset
      let hSum = 0, vSum = 0, samples = 0, earSamples: number[] = [];
      
      this.eyeTracking.startTracking();

      // 1. Center point — sample for offset
      dot.style.left = points[0].x;
      dot.style.top = points[0].y;
      await new Promise(r => setTimeout(r, 1000)); // let eyes settle

      const sampleInterval = setInterval(() => {
        const m = this.eyeTracking.getCurrentMetrics();
        if (m) {
          hSum += m.gaze.horizontal;
          vSum += m.gaze.vertical;
          earSamples.push(m.ear.average);
          samples++;
        }
      }, 50);

      await new Promise(r => setTimeout(r, 800));
      clearInterval(sampleInterval);

      // 2. Corner dots — just for user to look at, don't sample
      for (let i = 1; i < points.length; i++) {
        dot.style.left = points[i].x;
        dot.style.top = points[i].y;
        await new Promise(r => setTimeout(r, 800));
      }

      const avgH = samples ? hSum / samples : 0;
      const avgV = samples ? vSum / samples : 0;
      const avgEar = earSamples.length ? earSamples.reduce((a, b) => a + b, 0) / earSamples.length : 0.2;

      this.eyeTracking.setCalibration({
        baselineEar: avgEar,
        gazeHOffset: avgH,
        gazeVOffset: avgV
      });

      this.eyeTracking.stopTracking();
      document.body.removeChild(dot);
      resolve();
    });
  }

  async startExam() {
    if (this.micTestStream) {
      this.micTestStream.getTracks().forEach(t => t.stop());
      this.micTestStream = null;
    }
    const started = await this.markExamStarted();
    if (!started) return;
    this.examStarted = true;
    const screenStarted = await this.startScreenRecording();
    if (!screenStarted) return;
    await this.initCameraAndRecording();
    this.startLiveStreaming();
    this.proctor.requestFullscreen();
    this.startTimer();
    this.startSpeechRecognition();
    this.updateProgressUI();
    this.durationInterval = setInterval(() => { this.examDuration++; }, 1000);
    
    if (this.videoRef?.nativeElement) {
      this.proctor.startFaceDetection(this.videoRef.nativeElement);
    }
    this.updateStatus('status-proctor', 'ok', 'Active');
    this.updateStatus('status-rec', 'ok', 'REC ●');
    this.startPeriodicFaceVerification();
    this.startPeriodicVoiceVerification();

    // ✅ NEW: Start Eye Tracking & Listen for Violations
    if (this.videoRef?.nativeElement) {
      this.eyeTracking.setVideoElement(this.videoRef.nativeElement);
    }

    this.eyeTrackingSub = this.eyeTracking.violations$.subscribe((v) => {
      if (v && this.examStarted) {
        this.handleViolation('eye_contact', `[${v.type}] ${v.detail}`);
      }
    });

    this.eyeWarningSub = this.eyeTracking.warnings$.subscribe((w) => {
      if (w && this.examStarted) {
          this.showToast(`⚠️ ${w.detail}`, 'warning');
      }
    });

    this.eyeTracking.startTracking();
    this.eyeTracking.isSettled = false;
      setTimeout(() => {
        this.eyeTracking.isSettled = true;
        console.log('[EyeTracking] Settled');
        this.captureEvidence('exam_started', 'Baseline snapshot at the start of exam');    // to capture the snapshot
    }, 5000);
  }

  startPeriodicFaceVerification() {
    if (this.faceVerificationInterval) clearInterval(this.faceVerificationInterval);
    this.faceMismatchCount = 0;
    this.faceVerificationInterval = setInterval(async () => {
      if (this.showEvaluation || !this.referenceFaceDescriptor) return;
      const videoEl = this.videoRef?.nativeElement;
      if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) return;
      
      // ✅ NEW: Pause MediaPipe to free up GPU for face-api.js
      this.eyeTracking.pauseTracking();
      
      try {
        const detections = await (faceapi as any).detectAllFaces(
          videoEl, 
          new faceapi.TinyFaceDetectorOptions({ inputSize: 224 })
        )
        .withFaceLandmarks()
        .withFaceDescriptors();

        if (!detections || detections.length === 0) return;

        if (detections.length > 1) {
          this.handleViolation('face', `Multiple faces detected: ${detections.length}`);
          return;
        }

        const detection = detections[0];
        const distance = faceapi.euclideanDistance(this.referenceFaceDescriptor, detection.descriptor);
        const threshold = 0.65;
        
        if (distance > threshold) {
          this.faceMismatchCount++;
          console.warn(`[Face] Mismatch warning (count: ${this.faceMismatchCount}/2, distance: ${distance.toFixed(3)})`);
          if (this.faceMismatchCount >= 2) {
            this.handleViolation('face', `Different person detected (distance: ${distance.toFixed(3)})`);
          }
        } else {
          this.faceMismatchCount = 0;
          this.violationCounts.face = Math.max(0, this.violationCounts.face - 1);
        }
      } catch (err) {
        console.error('[Face] Verification error:', err);
      } finally {
        // ✅ NEW: Resume MediaPipe
        this.eyeTracking.resumeTracking();
      }
    }, 8000);
  }

  private async performFinalUploads() {
    const username = sessionStorage.getItem('username') || '';
    if (!this.examStarted || !this.examSessionId) return;
    console.log('[Upload] Starting final uploads for session:', this.examSessionId);

    // ✅ FIX: Stop the MediaRecorder FIRST so onstop fires and produces the final blob,
    // BUT release the camera hardware IMMEDIATELY (don't wait for upload).
    // The upload itself happens in the background while the camera light is already off.

    // 1. Stop screen recorder → produces blob → starts upload in background
    if (this.screenRecorder && this.screenRecorder.state === 'recording') {
      try {
        await this.stopAndUploadScreenRecording(username, this.examSessionId);
      } catch (e) {
        console.error('Screen upload error', e);
      }
    }

    // 2. Stop main recorder → produces blob → starts upload in background
    try {
      await this.recorder.stopAndUpload(username, this.examDuration, this.examSessionId);
    } catch (e) {
      console.error('Video upload error', e);
    }

    console.log('[Upload] All recordings submitted successfully');
  }

  async markExamStarted(): Promise<boolean> {
    const username = sessionStorage.getItem('username');
    if (!username) return false;
    try {
      const fd = new FormData();
      fd.append('username', username);
      fd.append('session_id', this.examSessionId);
      fd.append('total_questions', this.questions.length.toString());
      const result = await lastValueFrom(this.http.post<any>(`${environment.apiUrl}/student/start-exam`, fd));
      console.log('[EXAM] Attempt:', result.attempts_taken);
      return true;
    } catch (err) {
      console.error('Failed to mark exam started:', err);
      return false;
    }
  }

  async markExamEnded(completed: boolean = false) {
    const username = sessionStorage.getItem('username');
    if (!username) return;
    try {
      const fd = new FormData();
      fd.append('username', username);
      fd.append('completed', String(completed));
      await lastValueFrom(this.http.post(`${environment.apiUrl}/student/end-exam`, fd));
    } catch (err) { console.error('Failed to mark exam ended', err); }
  }

  async startScreenRecording(): Promise<boolean> {
    try {
      this.proctor.allowScreenShareDialog();
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always', displaySurface: 'monitor' } as MediaTrackConstraints,
        audio: false,
      } as DisplayMediaStreamOptions);
      this.proctor.disallowScreenShareDialog();
      this.screenRecorder = new MediaRecorder(this.screenStream, { mimeType: this.getScreenMimeType() });
      this.screenChunks = [];
      this.screenRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.screenChunks.push(e.data); };
      this.screenRecorder.start(1000);
      this.screenStream.getVideoTracks()[0].onended = () => {
        this.showToast('Screen sharing stopped. Exam will be terminated.', 'danger');
        this.terminateExam('screen_sharing_stopped', 'User stopped screen sharing');
      };
      return true;
    } catch (err) {
      this.proctor.disallowScreenShareDialog();
      console.error('[SCREEN] Failed to start screen recording:', err);
      this.showToast('Screen recording permission denied. Exam cannot proceed.', 'danger');
      return false;
    }
  }

  private getScreenMimeType(): string {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
  }

  async stopAndUploadScreenRecording(username: string, sessionId: string): Promise<void> {
    if (!this.screenRecorder || this.screenRecorder.state !== 'recording') return;
    return new Promise((resolve) => {
      this.screenRecorder!.onstop = async () => {
        const blob = new Blob(this.screenChunks, { type: this.getScreenMimeType() });
        const fd = new FormData();
        fd.append('username', username);
        fd.append('session_id', sessionId);
        fd.append('video', blob, `screen_${username}.webm`);
        try {
          await lastValueFrom(this.http.post(`${environment.apiUrl}/recording/submit/screen-recording`, fd));
        } catch (err) { console.error('[SCREEN] Upload failed:', err); }
        if (this.screenStream) {
          this.screenStream.getTracks().forEach(t => t.stop());
          this.screenStream = null;
        }
        resolve();
      };
      this.screenRecorder!.stop();
    });
  }

  async initCameraAndRecording() {
    console.log('[CAMERA] initCameraAndRecording called');
    this.cameraReady = false;
    const overlay = document.getElementById('video-overlay');
    if (overlay) overlay.classList.remove('hidden');
      this.stopCameraCheckStream();
    // Also kill the camera-check polling interval if it's still running
    if (this.cameraCheckInterval) {
      clearInterval(this.cameraCheckInterval);
      this.cameraCheckInterval = null;
    }
    try {
      const fullStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true }
      });
      const audioTrack = fullStream.getAudioTracks()[0];
      if (audioTrack) {
        const clonedStream = new MediaStream([audioTrack.clone()]);
        await this.startProctoringAudio(clonedStream);
      }
      if (this.videoRef?.nativeElement) {
        const videoEl = this.videoRef.nativeElement;
        // videoEl.srcObject = fullStream;
        const videoOnlyStream = new MediaStream(fullStream.getVideoTracks());
        videoEl.srcObject = videoOnlyStream;
        this.mediaStream = fullStream;
        videoEl.onloadedmetadata = () => {
          videoEl.play();
          this.cameraReady = true;
          if (overlay) overlay.classList.add('hidden');
          this.updateStatus('status-camera', 'ok', 'Active');
          this.eyeTracking.setVideoElement(videoEl);
        };
      }
      this.recorder.initWithStream(fullStream);
      this.recorder.startRecording();
    } catch (err) {
      console.error('[CAMERA] Setup failed', err);
      this.updateStatus('status-camera', 'warn', 'Failed');
      if (overlay) overlay.classList.add('hidden');
    }
  }

  // Proctoring audio & sound detection (keep existing implementations – truncated for brevity, but you can keep your original methods)
  private async startProctoringAudio(clonedStream?: MediaStream): Promise<void> {
    const username = sessionStorage.getItem('username') || '';
    if (!username) return;
    try {
      this.proctoringAudioStream = clonedStream || await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, sampleRate: 16000 },
        video: false,
      });
      console.log('[ProctoringAudio] Cloned/Dedicated stream started');
      this.diarization.start(
        username,
        this.proctoringAudioStream,
        (type: string, detail: string) => {
          if (type === 'multiple_speakers_detected') {
            // Unified handler use karo taaki counter aur log dono update hon
            this.handleViolation('multiple_speakers', detail);
          }
        },
        this.examSessionId
      );
    } catch (err) {
      console.warn('[ProctoringAudio] Failed to setup audio proctoring:', err);
    }
  }

  private cleanupProctoringAudio(): void {
    this.soundDetectionRunning = false;
    if (this.soundDetectionIntervalId) {
      clearInterval(this.soundDetectionIntervalId);
      this.soundDetectionIntervalId = null;
    }
    if (this.proctoringAudioProcessor) {
      this.proctoringAudioProcessor.disconnect();
      this.proctoringAudioProcessor = null;
    }
    if (this.proctoringAudioSource) {
      this.proctoringAudioSource.disconnect();
      this.proctoringAudioSource = null;
    }
    if (this.proctoringAudioContext) {
      this.proctoringAudioContext.close().catch(() => {});
      this.proctoringAudioContext = null;
    }
    if (this.proctoringAudioStream) {
      this.proctoringAudioStream.getTracks().forEach(t => t.stop());
      this.proctoringAudioStream = null;
      console.log('[ProctoringAudio] Stopped');
    }
  }

  // startSpeechRecognition() {
  //   if (this.speech.isSupported() && !this.isSpeechListening) {
  //     this.textBeforeSpeech = this.answerText;
  //     this.speech.startListening();
  //     this.isSpeechListening = true;
  //     this.updateStatus('status-mic', 'ok', 'Active');
  //     this.updateStatus('status-speech', 'ok', 'Listening');
  //   }
  // }

  startSpeechRecognition() {
    if (this.speech.isSupported() && !this.isSpeechListening) {
      this.textBeforeSpeech = this.answerText;
      const endsWithSentence = /[.!?]\s*$/.test(this.answerText.trim());
      this.speech.clearTranscript(endsWithSentence || !this.answerText.trim());
      
      // ✅ Pass username, sessionId, and examKeywords
      const username = sessionStorage.getItem('username') || '';
      this.speech.startListening(username, this.examSessionId, this.examKeywords);
      
      this.isSpeechListening = true;
      this.updateStatus('status-mic', 'ok', 'Active');
      this.updateStatus('status-speech', 'ok', 'Listening');
    }
  }

  stopSpeechRecognition() {
    if (this.isSpeechListening) {
      this.speech.stopListening();
      this.isSpeechListening = false;
      this.textBeforeSpeech = this.answerText;
      this.updateStatus('status-mic', 'ok', 'Ready');
      this.updateStatus('status-speech', 'ok', 'Ready');
    }
  }

  /**
   * Exam is over (finished / terminated / logout / page left): fully close the
   * STT socket and release the microphone. Per-question pauses must keep using
   * stopSpeechRecognition(), which keeps the connection warm.
   */
  private shutdownSpeechEngine() {
    this.stopSpeechRecognition();
    this.speech.shutdown();
  }

  startSessionTimer() {
    this.sessionTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.sessionStartTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      const timerEl = document.getElementById('session-timer');
      if (timerEl) timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
  }

  toggleMic() {
    if (this.isSpeechListening) {
      this.speech.stopListening();
      this.isSpeechListening = false;
      this.textBeforeSpeech = this.answerText;
      this.updateStatus('status-mic', 'ok', 'Ready');
    } else {
      if (this.speech.isSupported()) {
        this.textBeforeSpeech = this.answerText;
        const endsWithSentence = /[.!?]\s*$/.test(this.answerText.trim());
        this.speech.clearTranscript(endsWithSentence || !this.answerText.trim());
        const username = sessionStorage.getItem('username') || '';
        // This will start Deepgram if not already, or just resume
        this.speech.startListening(username, this.examSessionId, this.examKeywords);
        this.speech.setMicActive(true);
        this.isSpeechListening = true;
        this.updateStatus('status-mic', 'ok', 'Active');
      } else {
        this.showToast('Speech recognition not supported.', 'warning');
      }
    }
  }

  async loadExamSettings(): Promise<void> {
    const username = sessionStorage.getItem('username');
    try {
      // 1. Fetch global exam settings
      const res = await lastValueFrom(this.http.get<{ settings: any }>(`${environment.apiUrl}/exam-settings`));
      const s = res.settings;
      if (s?.question_timer_seconds) this.questionTimerSeconds = s.question_timer_seconds;
      if (s?.max_violations && this.proctor) this.proctor.maxWarnings = s.max_violations;
      
      // Global default allow_typing
      let computedAllowTyping = s?.allow_typing ?? true;

      // 2. Fetch student status to check if a Group/Batch override exists for allowTyping
      if (username) {
        const statusRes = await lastValueFrom(
          this.http.get<any>(`${environment.apiUrl}/student/exam-status?username=${username}`)
        ).catch(() => null);

        if (statusRes?.settings?.allowTyping !== undefined) {
          computedAllowTyping = statusRes.settings.allowTyping;
          console.log('[Settings] Override found from Batch settings -> allowTyping:', computedAllowTyping);
        }
      }

      this.allowTyping = computedAllowTyping;
      console.log('[Settings] Final Allow Typing:', this.allowTyping);

    } catch (err) {
      console.warn('[Settings] Could not load settings, using defaults');
      this.questionTimerSeconds = 300;
      this.allowTyping = true; 
    }
  }

  startTimer() {
    this.timerSeconds = this.questionTimerSeconds;
    this.updateTimerDisplay();
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (this.timerSeconds <= 0) {
        clearInterval(this.timerInterval);
        this.autoSubmit();
      } else {
        this.timerSeconds--;
        this.updateTimerDisplay();
      }
    }, 1000);
  }

  updateTimerDisplay() {
    const timerValue = document.getElementById('timer-value');
    if (timerValue) {
      const mins = Math.floor(this.timerSeconds / 60);
      const secs = this.timerSeconds % 60;
      timerValue.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    const timerWrap = document.getElementById('timer-display');
    if (timerWrap) {
      if (this.timerSeconds <= 30) timerWrap.className = 'timer-display timer-urgent';
      else if (this.timerSeconds <= 60) timerWrap.className = 'timer-display timer-warning';
      else timerWrap.className = 'timer-display';
    }
  }

  async submitAnswer() {
    if (!this.answerText.trim()) { this.showToast('Empty answer', 'danger'); return; }
    if (this.submitted || this.isSubmittingAnswer || this.isFinishingExam || this.isTransitioningQuestion) return;
    this.isSubmittingAnswer = true;
    this.submitted = true;
    this.stopSpeechRecognition();
    clearInterval(this.timerInterval);
    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) submitBtn.innerHTML = '<span>Submitting…</span>';
    
    try {
      await this.qService.submitAnswer(
        this.answerText,
        this.currentQuestion,
        this.answeredBuffer.length,
        this.currentIndex,
        this.examSessionId
      );
      
      const answerRecord: AnswerRecord = {
        question_id: this.currentQuestion.id,
        question_text: this.currentQuestion.question || (this.currentQuestion as any).text || '',
        category: this.currentQuestion.category,
        answer: this.answerText,
        session_id: this.examSessionId,
      };
      const existingIdx = this.answeredBuffer.findIndex(a => String(a.question_id) === String(this.currentQuestion.id));
      if (existingIdx !== -1) {
        this.answeredBuffer[existingIdx] = answerRecord;
      } else {
        this.answeredBuffer.push(answerRecord);
      }

      // Evaluation will be done cleanly in 2 API calls at finishExam()
      // (1 for Intro + 1 batch call for the 9 technical questions)


      const banner = document.getElementById('submitted-banner');
      if (banner) banner.classList.add('visible');
      const textarea = document.getElementById('answer-text');
      if (textarea) textarea.setAttribute('disabled', 'true');
      const submitBtnEl = document.getElementById('submit-btn') as HTMLButtonElement;
      const nextBtnEl = document.getElementById('next-btn') as HTMLButtonElement;
      if (submitBtnEl) submitBtnEl.style.display = 'none';
      if (nextBtnEl) nextBtnEl.style.display = 'inline-flex';
      
      const isLast = this.currentIndex >= this.questions.length - 1;
      if (nextBtnEl) {
        nextBtnEl.innerHTML = isLast
          ? '<span>Finish & Get Results 🎉</span>'
          : `<span>Next (${this.currentIndex + 2}/${this.questions.length})</span> <span>→</span>`;
      }
      this.updateStatus('status-answer', 'ok', 'Submitted');
      this.showToast('Answer submitted!', 'success');
    } catch (err) {
      console.error('Submit error', err);
      this.showToast('Submission failed', 'danger');
      this.submitted = false;
      if (submitBtn) submitBtn.innerHTML = '<span>Submit Answer</span> <span>→</span>';
    } finally {
      this.isSubmittingAnswer = false;
    }
  }

  nextQuestion() {
    if (this.isFinishingExam || this.isTransitioningQuestion) return;
    this.isTransitioningQuestion = true;

    // Immediately disable next and submit buttons in UI to prevent rapid spam clicks
    const nextBtnEl = document.getElementById('next-btn') as HTMLButtonElement;
    if (nextBtnEl) {
      nextBtnEl.disabled = true;
      nextBtnEl.style.pointerEvents = 'none';
    }
    const submitBtnEl = document.getElementById('submit-btn') as HTMLButtonElement;
    if (submitBtnEl) {
      submitBtnEl.disabled = true;
      submitBtnEl.style.pointerEvents = 'none';
    }
    const skipBtnEl = document.getElementById('skip-btn') as HTMLButtonElement;
    if (skipBtnEl) {
      skipBtnEl.disabled = true;
      skipBtnEl.style.pointerEvents = 'none';
    }

    if (this.currentIndex + 1 >= this.questions.length) {
      this.finishExam();
    } else {
      this.currentIndex++;
      this.currentQuestion = this.questions[this.currentIndex];
      this.answerText = '';
      this.submitted = false;
      this.timerSeconds = 300;
      this.startTimer();
      this.updateProgressUI();
      const banner = document.getElementById('submitted-banner');
      if (banner) banner.classList.remove('visible');
      const textarea = document.getElementById('answer-text');
      if (textarea) textarea.removeAttribute('disabled');
      const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
      const nextBtn = document.getElementById('next-btn') as HTMLButtonElement;
      const skipBtn = document.getElementById('skip-btn') as HTMLButtonElement;
      if (submitBtn) {
        submitBtn.style.display = 'inline-flex';
        submitBtn.innerHTML = '<span>Submit Answer</span> <span>→</span>';
        submitBtn.disabled = false;
        submitBtn.style.pointerEvents = 'auto';
      }
      if (nextBtn) {
        nextBtn.style.display = 'none';
        nextBtn.disabled = false;
        nextBtn.style.pointerEvents = 'auto';
      }
      if (skipBtn) {
        skipBtn.disabled = false;
        skipBtn.style.pointerEvents = 'auto';
      }
      this.updateStatus('status-answer', 'off', 'Empty');
      this.updateCharCount();
      this.speech.clearTranscript();
      if (this.isSpeechListening) this.textBeforeSpeech = '';
      this.isTransitioningQuestion = false;
    }
  }

  skipQuestion() {
    if (this.submitted || this.isFinishingExam || this.isTransitioningQuestion || this.isSubmittingAnswer) {
      return;
    }
    
    this.isTransitioningQuestion = true;

    // Immediately disable action buttons to prevent rapid clicks
    const skipBtnEl = document.getElementById('skip-btn') as HTMLButtonElement;
    if (skipBtnEl) {
      skipBtnEl.disabled = true;
      skipBtnEl.style.pointerEvents = 'none';
    }
    const submitBtnEl = document.getElementById('submit-btn') as HTMLButtonElement;
    if (submitBtnEl) {
      submitBtnEl.disabled = true;
      submitBtnEl.style.pointerEvents = 'none';
    }

    this.stopSpeechRecognition();
    clearInterval(this.timerInterval);
    
    const skipRecord: AnswerRecord = {
      question_id: this.currentQuestion.id,
      question_text: this.currentQuestion.question || (this.currentQuestion as any).text || '',
      category: this.currentQuestion.category,
      answer: '[Skipped by student]',
      session_id: this.examSessionId
    };
    
    const existingIdx = this.answeredBuffer.findIndex(a => String(a.question_id) === String(this.currentQuestion.id));
    if (existingIdx !== -1) {
      this.answeredBuffer[existingIdx] = skipRecord;
    } else {
      this.answeredBuffer.push(skipRecord);
    }
    
    // If skipping the last question, finish the exam directly
    if (this.currentIndex + 1 >= this.questions.length) {
      this.finishExam();
    } else {
      // ✅ FIX: Reset transition flag so nextQuestion() can actually execute!
      this.isTransitioningQuestion = false; 
      this.nextQuestion();
    }
  }

  clearAnswer() {
    if (!this.submitted) { this.answerText = ''; this.updateCharCount(); }
  }

  autoSubmit() {
    if (!this.submitted) { this.showToast('Time up! Auto-submitting...', 'warning'); this.submitAnswer(); }
  }

  async sendBackgroundChunk(chunk: any[]) {
    const username = sessionStorage.getItem('username');
    if (!username || chunk.length === 0) return;

    const chunkData = chunk.map(q => ({
      id: q.question_id,
      question_text: q.question_text,
      category: q.category,
      answer: q.answer
    }));

    const fd = new FormData();
    fd.append('username', username);
    fd.append('answers_json', JSON.stringify(chunkData));

    try {
      console.log(`[Batch] Sending ${chunkData.length} valid answers for background evaluation...`);
      const res: any = await lastValueFrom(this.http.post(`${environment.apiUrl}/evaluation/evaluate-chunk`, fd));
      
      if (res && res.success && res.results) {
        console.log(`[Batch] Background evaluation success for ${res.results.length} questions!`);
        this.cachedBackgroundScores = [...this.cachedBackgroundScores, ...res.results];
      }
    } catch (err) {
      console.warn('[Batch] Background evaluation chunk failed. Will fallback on final submit.', err);
    }
  }

  async finishExam() {
    if (this.isFinishingExam) return;
    this.isFinishingExam = true;

    // Immediately disable interactive action buttons
    const nextBtnEl = document.getElementById('next-btn') as HTMLButtonElement;
    if (nextBtnEl) {
      nextBtnEl.disabled = true;
      nextBtnEl.style.pointerEvents = 'none';
      nextBtnEl.innerHTML = '<span>Finishing & Saving... ⏳</span>';
    }
    const submitBtnEl = document.getElementById('submit-btn') as HTMLButtonElement;
    if (submitBtnEl) {
      submitBtnEl.disabled = true;
      submitBtnEl.style.pointerEvents = 'none';
    }
    const skipBtnEl = document.getElementById('skip-btn') as HTMLButtonElement;
    if (skipBtnEl) {
      skipBtnEl.disabled = true;
      skipBtnEl.style.pointerEvents = 'none';
    }

    // Immediately show evaluation screen so student sees instant progress
    this.showEvaluation = true;

    clearInterval(this.timerInterval);
    if (this.durationInterval) clearInterval(this.durationInterval);
    this.shutdownSpeechEngine();
    this.gazeStatistics = this.eyeTracking.getGazeStatistics();
    this.diarization.stop();
    this.cleanupProctoringAudio();
    this.proctor.stop();
    await this.notifyExamEnded(true);
    await this.performFinalUploads();
    this.stopLiveStreaming();
    this.fullCameraShutdown();
    
    const user = sessionStorage.getItem('username') || '';
    const events = this.proctor.getEvents();
    
    if (this.faceVerificationInterval) {
      clearInterval(this.faceVerificationInterval);
      this.faceVerificationInterval = null;
    }
    if (this.voiceVerificationInterval) { 
      clearInterval(this.voiceVerificationInterval); 
      this.voiceVerificationInterval = null; 
    }
    
    await this.qService.storeProctoring(user, events, this.examSessionId);
    
    // 🚀 Send the background cache to the backend
    const cachedScores = this.cachedBackgroundScores;
    console.log(`[finishExam] Background Cached: ${cachedScores?.length || 0} questions`);

    // Deduplicate answeredBuffer by question_id before sending for evaluation
    const uniqueAnswersMap = new Map<string, AnswerRecord>();
    for (const ans of this.answeredBuffer) {
      const qid = String(ans.question_id);
      uniqueAnswersMap.set(qid, ans);
    }
    const dedupedAnswers = Array.from(uniqueAnswersMap.values());
    
    const evalResponse = await this.qService.evaluate(user, dedupedAnswers, events, this.examSessionId, cachedScores);
    
    if (evalResponse.success) { 
      this.pollEvaluationStatus(user); 
    } else { 
      this.navCtrl.navigateRoot(['/results'], { queryParams: { session_id: this.examSessionId } }); 
    }
  }

  private async pollEvaluationStatus(username: string) {
      // Prevent duplicate finish-exam flows from creating parallel polls.
      if (this.evaluationPolling) return;
      this.evaluationPolling = true;

      // ✅ Show "Processing..." toast (stays until dismissed)
      this.evaluationToast = await this.toastCtrl.create({
          message: '⏳ Your answers are being evaluated by AI. Please wait...',
          duration: 0,          // indefinite
          color: 'primary',
          buttons: [{ text: 'OK', role: 'cancel' }]
      });
      await this.evaluationToast.present();

      const stopPolling = async () => {
          if (this.evaluationPollInterval) {
              clearTimeout(this.evaluationPollInterval);
              this.evaluationPollInterval = null;
          }
          this.evaluationPolling = false;
          this.evaluationPollInFlight = false;
          await this.evaluationToast?.dismiss();
          this.evaluationToast = null;
      };

      const scheduleNextPoll = (delayMs: number) => {
          if (this.evaluationPolling) {
              this.evaluationPollInterval = setTimeout(checkStatus, delayMs);
          }
      };

      const checkStatus = async () => {
          // setTimeout prevents overlap; this guard also protects against a
          // delayed callback while a request is still pending.
          if (!this.evaluationPolling || this.evaluationPollInFlight) return;
          this.evaluationPollInFlight = true;
          try {
              // ✅ Include session_id to get correct status
              const status = await lastValueFrom(
                  this.http.get<{ status: string; done: boolean }>(
                      `${environment.apiUrl}/evaluation/status/${username}?session_id=${this.examSessionId}`
                  )
              );
              
              if (status.done) {
                  await stopPolling();
                  sessionStorage.setItem('last_exam_session_id', this.examSessionId);
                  sessionStorage.removeItem('active_exam_session_id');
                  this.showToast('✅ Evaluation complete!', 'success');
                  this.navCtrl.navigateRoot(['/results'], { queryParams: { session_id: this.examSessionId } });
                  return;
              }

              // A completed request waits 4 seconds before the next check.
              scheduleNextPoll(4000);
          } catch (err) {
              console.error('Status check error:', err);
              // Transient errors back off to reduce load while still retrying.
              scheduleNextPoll(8000);
          } finally {
              this.evaluationPollInFlight = false;
          }
      };

      // Check once immediately, then continue sequentially.
      await checkStatus();
  }

  updateProgressUI() {
    const questionTextEl = document.getElementById('question-text');
    if (questionTextEl) questionTextEl.textContent = this.currentQuestion.question || (this.currentQuestion as any).text || '';
    const badgeEl = document.getElementById('question-badge');
    if (badgeEl) badgeEl.innerHTML = `💡 ${this.currentQuestion.category} · <span style="color:var(--text2);font-size:.65rem">${this.currentQuestion.difficulty || 'Medium'}</span>`;
    const counterEl = document.getElementById('q-counter-label');
    if (counterEl) counterEl.textContent = `Question ${this.currentIndex + 1} of ${this.questions.length}`;
    const fillEl = document.getElementById('progress-fill');
    if (fillEl) fillEl.style.width = `${(this.currentIndex / this.questions.length) * 100}%`;
    for (let i = 0; i < this.questions.length; i++) {
      const dot = document.getElementById(`qdot-${i}`);
      if (dot) dot.className = i < this.currentIndex ? 'q-dot done' : i === this.currentIndex ? 'q-dot current' : 'q-dot';
    }
  }

  clampToMaxWords(text: string): { text: string; count: number; exceeded: boolean } {
    if (!text) return { text: '', count: 0, exceeded: false };
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length <= this.MAX_WORDS) {
      return { text, count: words.length, exceeded: false };
    }
    // Trim text to exactly MAX_WORDS
    let count = 0;
    let cutoff = text.length;
    const regex = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      count++;
      if (count === this.MAX_WORDS) {
        cutoff = regex.lastIndex;
        break;
      }
    }
    return {
      text: text.substring(0, cutoff),
      count: this.MAX_WORDS,
      exceeded: true
    };
  }

  onAnswerInput(): void {
    const clamped = this.clampToMaxWords(this.answerText);
    if (clamped.exceeded) {
      this.answerText = clamped.text;
      this.showToast(`Maximum word limit (${this.MAX_WORDS} words) reached.`, 'warning');
    }
    this.updateCharCount();
    // If student manually edits the answer textarea while mic is listening:
    if (this.isSpeechListening) {
      // Synchronize the base prefix to the user's latest edited text
      this.textBeforeSpeech = this.answerText;
      // Reset speech engine accumulator so new spoken words append cleanly to edited text
      const endsWithSentence = /[.!?]\s*$/.test(this.answerText.trim());
      this.speech.clearTranscript(endsWithSentence || !this.answerText.trim());
    }
  }

  updateCharCount() {
    this.charCount = this.answerText.length;
    const trimmed = this.answerText.trim();
    this.wordCount = trimmed ? trimmed.split(/\s+/).filter(w => w.length > 0).length : 0;
    const wordSpan = document.getElementById('word-count');
    if (wordSpan) wordSpan.textContent = String(this.wordCount);
    this.updateStatus(
      'status-answer',
      this.wordCount > 0 ? 'ok' : 'off',
      this.wordCount > 0 ? `${this.wordCount}/${this.MAX_WORDS} words` : 'Empty'
    );
  }

  updateStatus(id: string, type: string, label: string) {
    const el = document.getElementById(id);
    if (el) { el.className = `status-badge ${type}`; el.textContent = label; }
  }

  onProctorWarning(warning: ProctorWarning) {
    this.warningCount = warning.count;
    this.warningMessage = warning.message;
    this.proctorEventsCount = warning.count;

    // ✅ NEW: Show "1/3" style for multiple-face warnings
    if (warning.type === 'multiple_faces_detected') {
      this.updateStatus('status-proctor', 'warn', `⚠ Faces ${warning.count}/3`);
      this.showToast(`⚠ MULTIPLE FACES (${warning.count}/3): ${warning.message}`, 'warning');
    } else {
      this.updateStatus('status-proctor', 'warn', `⚠ ${warning.count} violation(s)`);
      this.showToast(warning.message, 'warning');
    }

    this.showWarningModal = true;
    setTimeout(() => this.showWarningModal = false, 4000);
  }

  async onProctorTerminate(info: any) {
    this.terminationReason = info.reason;
    this.showTerminationModal = true;
    this.shutdownSpeechEngine();
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.durationInterval) clearInterval(this.durationInterval);
    await this.markExamEnded(false);
    this.cleanupProctoringAudio();

    // ✅ FIX: performFinalUploads() already stops both screen + camera recorders.
    // The duplicate calls below were re-invoking stopAndUpload() which is a no-op
    // (guard returns early) but wasted cycles. Removed.
    await this.performFinalUploads();

    this.stopLiveStreaming();
    this.fullCameraShutdown();
    ['submit-btn', 'next-btn', 'skip-btn', 'clear-btn'].forEach(id => {
      const btn = document.getElementById(id) as HTMLButtonElement;
      if (btn) btn.disabled = true;
    });
    const textarea = document.getElementById('answer-text') as HTMLTextAreaElement;
    if (textarea) textarea.disabled = true;
    await this.logActivity('exam_terminated', info.reason);
    await this.sendTerminationStatus(info.reason);
    setTimeout(() => { this.navCtrl.navigateRoot('/login'); }, 3000);
  }

  async sendTerminationStatus(reason: string) {
    const username = sessionStorage.getItem('username');
    if (!username) return;
    try {
      const fd = new FormData();
      fd.append('username', username);
      fd.append('reason', reason);
      await lastValueFrom(this.http.post(`${environment.apiUrl}/student/terminate`, fd));
    } catch (err) { console.error('Termination call failed', err); }
  }

  addProctorLog(event: string, detail: string = '', eventId: string = '') {
    // Drop irrelevant normal-state events completely
    const droppedEvents = ['tab_return', 'devtools_exit'];
    if (droppedEvents.includes(event)) return;

    this.proctorLogs.unshift(event);

    // Define events that require immediate backend logging and storage
    const immediateBackendEvents = [
      'tab_switch', 'fullscreen_exit', 'devtools_attempt', 
      'multiple_faces_detected', 'multiple_speakers_detected', 
      'no_face_detected', 'face_mismatch', 'voice_mismatch', 
      'eye_contact_violation', 'split_screen_detected', 'app_switcher_detected'
    ];

    const username = sessionStorage.getItem('username');
    
    // Only sync to MongoDB if it belongs to the critical list
    if (username && immediateBackendEvents.includes(event)) {
      // 👇 FIX: Screenshot Capture Logic Restored Here 👇
      const visualEventsToCapture = [
        'no_face_detected', 'multiple_faces_detected', 'fullscreen_exit', 
        'app_switcher_detected', 'tab_switch', 'devtools_attempt', 'new_window_attempt'
      ];
      if (visualEventsToCapture.includes(event)) {
        this.captureEvidence(event, detail || 'Visual evidence captured');
      }

      const fd = new FormData();
      fd.append('username', username);
      fd.append('event_type', event);
      fd.append('session_id', this.examSessionId);
      fd.append('detail', detail);   // exact reason (e.g. "Turn-taking: 0->1", "Face missing") kept in DB
      if (eventId) fd.append('event_id', eventId);   // lets the backend skip the later bulk duplicate
      this.http.post(`${environment.apiUrl}/proctoring/log-event`, fd).subscribe({
        next: () => console.log(`[SYNC] Critical security event logged: ${event}`),
        error: (err) => console.error('Proctor sync failed', err)
      });
    }
  }

  updateFaceStatus(msg: string) {
    if (msg.includes('OK')) { this.faceCount = 1; this.updateStatus('status-proctor', 'ok', 'Active'); }
    else if (msg.includes('Multiple')) { this.faceCount = 2; this.updateStatus('status-proctor', 'warn', '⚠ Multiple faces'); }
    else if (msg.includes('No face')) { this.faceCount = 0; this.updateStatus('status-proctor', 'warn', '⚠ Face missing'); }
    const faceEl = document.getElementById('face-count');
    if (faceEl) faceEl.textContent = String(this.faceCount);
  }

  handleNoFaceCountdown(secs: number) {
    if (secs > 0) console.log(`No face detected, will terminate in ${secs}s`);
  }

  async showToast(message: string, color: string = 'danger') {
    const toast = await this.toastCtrl.create({ message, duration: 3000, position: 'bottom', color, buttons: [{ text: 'OK', role: 'cancel' }] });
    await toast.present();
  }

  async logout() {
    const username = sessionStorage.getItem('username') || '';
    const sessionDuration = Math.floor((Date.now() - this.sessionStartTime) / 1000);
    const durationStr = `${Math.floor(sessionDuration / 60)}m ${sessionDuration % 60}s`;
    const toast = await this.toastCtrl.create({ message: 'Saving your session and recordings...', duration: 2000, color: 'primary' });
    await toast.present();
    if (!this.submitted && this.answerText && this.answerText.trim() !== '') {
      await this.submitAnswer();
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (this.examStarted && !this.showEvaluation) {
      await this.notifyExamEnded(false);
      if (this.screenRecorder && this.screenRecorder.state === 'recording') {
        try { await this.stopAndUploadScreenRecording(username, this.examSessionId); } catch (e) {}
      }
      try { await this.recorder.stopAndUpload(username, this.examDuration, this.examSessionId); } catch (e) {}
    }
    if (this.faceVerificationInterval) { clearInterval(this.faceVerificationInterval); this.faceVerificationInterval = null; }
    this.stopLiveStreaming();
    if (this.durationInterval) clearInterval(this.durationInterval);
    if (this.sessionTimerInterval) clearInterval(this.sessionTimerInterval);
    this.cleanupProctoringAudio();
    this.proctor.stop();
    this.proctor.reset();
    this.shutdownSpeechEngine();
    this.diarization.stop();
    this.fullCameraShutdown();
    if (this.voiceVerificationInterval) { 
      clearInterval(this.voiceVerificationInterval); 
      this.voiceVerificationInterval = null; 
    }
    if (this.audioProcessor) { this.audioProcessor.disconnect(); this.audioProcessor = null; }
    if (this.audioSource) { this.audioSource.disconnect(); this.audioSource = null; }
    if (this.audioContext) { this.audioContext.close(); this.audioContext = null; }
    await this.logActivity('logout', `User logged out (session: ${durationStr})`);
    try {
      const fd = new FormData();
      fd.append('username', username);
      await lastValueFrom(this.http.post(`${environment.apiUrl}/proctoring/clear-proctoring`, fd));
    } catch (e) {}
    sessionStorage.clear();
    this.navCtrl.navigateRoot('/login');
  }

  private fullCameraShutdown() {
    console.log('[Hardware] 🔴 NUCLEAR SHUTDOWN starting...');

    // ✅ NEW: Stop Eye Tracking
    this.eyeTracking.stopTracking();
    if (this.eyeTrackingSub) this.eyeTrackingSub.unsubscribe();
    if (this.eyeWarningSub) this.eyeWarningSub.unsubscribe();

    // 1. Cleanup proctoring audio
    this.cleanupProctoringAudio();

    // 2. Stop mic test stream
    if (this.micTestStream) {
      this.micTestStream.getTracks().forEach(t => { t.enabled = false; t.stop(); });
      this.micTestStream = null;
    }

    this.stopCameraCheckStream();

    // 3. Stop main camera/mic stream
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => { t.enabled = false; t.stop(); });
      this.mediaStream = null;
    }
    
    // 4. ✅ NEW: Stop screen share stream
    if (this.screenStream) { 
      this.screenStream.getTracks().forEach(t => { t.enabled = false; t.stop(); }); 
      this.screenStream = null; 
    }
    
    // 5. ✅ NEW: Stop screen recorder
    if (this.screenRecorder && this.screenRecorder.state !== 'inactive') {
      try { this.screenRecorder.stop(); } catch (e) {}
    }
    this.screenRecorder = null;
    this.screenChunks = [];
    
    // 6. Stop recording service
    try { this.recorder.stopCamera(); } catch (e) {}
    try { this.recorder.stopAllBrowserTracks(); } catch (e) {}
    
    // 7. Clear video elements
    const refs = [this.videoRef, this.testVideoRef];
    refs.forEach(ref => {
      if (ref?.nativeElement) {
        const videoEl = ref.nativeElement;
        if (videoEl.srcObject) {
          const s = videoEl.srcObject as MediaStream;
          s.getTracks().forEach(t => { t.enabled = false; t.stop(); });
          videoEl.srcObject = null;
        }
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.removeAttribute('srcObject');
        videoEl.load();
      }
    });
    
    // 8. ✅ NEW: Close audio contexts
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try { this.audioContext.close(); } catch (e) {}
      this.audioContext = null;
    }
    if (this.proctoringAudioContext && this.proctoringAudioContext.state !== 'closed') {
      try { this.proctoringAudioContext.close(); } catch (e) {}
      this.proctoringAudioContext = null;
    }
    
    // 9. ✅ NEW: Close WebSockets
    if (this.screenStreamWs?.readyState === WebSocket.OPEN) {
      this.screenStreamWs.close();
    }
    this.screenStreamWs = null;
    
    if (this.cameraStreamWs?.readyState === WebSocket.OPEN) {
      this.cameraStreamWs.close();
    }
    this.cameraStreamWs = null;
    
    // 10. ✅ NEW: Clear streaming intervals
    if (this.screenStreamInterval) { clearInterval(this.screenStreamInterval); this.screenStreamInterval = null; }
    if (this.cameraStreamInterval) { clearInterval(this.cameraStreamInterval); this.cameraStreamInterval = null; }
    this.isStreaming = false;
    
    console.log('[Hardware] ✅ All tracks stopped, hardware released.');
  }

  ngOnDestroy() {
    console.log('[Lifecycle] Page destroyed — releasing all hardware...');

    // ✅ NEW: Stop Eye Tracking
    this.eyeTracking.stopTracking();
    if (this.eyeTrackingSub) this.eyeTrackingSub.unsubscribe();
    if (this.eyeWarningSub) this.eyeWarningSub.unsubscribe();
    
    // ✅ STEP 1: Clear all intervals
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    if (this.sessionTimerInterval) { clearInterval(this.sessionTimerInterval); this.sessionTimerInterval = null; }
    if (this.durationInterval) { clearInterval(this.durationInterval); this.durationInterval = null; }
    if (this.cameraCheckInterval) { clearInterval(this.cameraCheckInterval); this.cameraCheckInterval = null; }
    if (this.faceVerificationInterval) { clearInterval(this.faceVerificationInterval); this.faceVerificationInterval = null; }
    if (this.voiceVerificationInterval) { clearInterval(this.voiceVerificationInterval); this.voiceVerificationInterval = null; }
    
    // ✅ STEP 2: Stop all services
    this.proctor.stop();
    this.shutdownSpeechEngine();
    this.diarization.stop();
    this.cleanupProctoringAudio();
    
    if (this.speechSubscription) this.speechSubscription.unsubscribe();
    if (this.finalTranscriptSubscription) this.finalTranscriptSubscription.unsubscribe();
    
    // ✅ STEP 3: Disconnect audio nodes
    if (this.audioProcessor) { this.audioProcessor.disconnect(); this.audioProcessor = null; }
    if (this.audioSource) { this.audioSource.disconnect(); this.audioSource = null; }
    if (this.audioContext && this.audioContext.state !== 'closed') { 
      this.audioContext.close().catch(() => {}); 
      this.audioContext = null; 
    }
    // ✅ Stop evaluation-status polling and its processing toast
    if (this.evaluationPollInterval) {
        clearTimeout(this.evaluationPollInterval);
        this.evaluationPollInterval = null;
    }
    this.evaluationPolling = false;
    this.evaluationPollInFlight = false;
    this.evaluationToast?.dismiss();
    this.evaluationToast = null;
    
    // ✅ STEP 4: CRITICAL — Stop live streaming & nuclear shutdown
    this.stopLiveStreaming();
    this.fullCameraShutdown();
  }

  private async terminateExam(reason: string, detail: string) {
    this.gazeStatistics = this.eyeTracking.getGazeStatistics();
    this.showToast(`Exam Terminated: ${detail}`, 'danger');
    this.showTerminationModal = true;
    this.terminationReason = detail;
    
    // ✅ STEP 1: Stop all services
    this.shutdownSpeechEngine();
    this.proctor.stop();
    this.diarization.stop();
    this.cleanupProctoringAudio();
    
    // ✅ STEP 2: Clear all intervals
    if (this.durationInterval) { clearInterval(this.durationInterval); this.durationInterval = null; }
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    if (this.voiceVerificationInterval) { clearInterval(this.voiceVerificationInterval); this.voiceVerificationInterval = null; }
    if (this.faceVerificationInterval) { clearInterval(this.faceVerificationInterval); this.faceVerificationInterval = null; }
    
    // ✅ STEP 3: CRITICAL — Stop live streaming & release hardware
    this.stopLiveStreaming();
    this.fullCameraShutdown();
    
    await this.logActivity('exam_terminated', detail);
    
    ['submit-btn', 'next-btn', 'skip-btn', 'clear-btn'].forEach(id => {
      const btn = document.getElementById(id) as HTMLButtonElement;
      if (btn) btn.disabled = true;
    });
    const textarea = document.getElementById('answer-text') as HTMLTextAreaElement;
    if (textarea) textarea.disabled = true;
    
    setTimeout(() => { this.navCtrl.navigateRoot('/login'); }, 3000);
  }

  async logActivity(action: string, details: string = '') {
    const username = sessionStorage.getItem('username');
    if (!username) return;
    const fd = new FormData();
    fd.append('username', username); fd.append('action', action); fd.append('details', details); fd.append('session_id', this.globalSessionId);
    try { await lastValueFrom(this.http.post(`${environment.apiUrl}/student/log-activity`, fd)); } catch (err) {}
  }

  preventLinkClick(event: MouseEvent): void {
    let target = event.target as HTMLElement;
    while (target && target.tagName !== 'A') target = target.parentElement as HTMLElement;
    if (target && target.tagName === 'A') {
      event.preventDefault(); event.stopPropagation();
      this.proctor.logEvent('external_link_attempt', 'Clicked link');
    }
  }

  async startLiveStreaming() {
    if (this.isStreaming) return;
    const username = sessionStorage.getItem('username');
    if (!username) return;
    this.isStreaming = true;
    await this.startScreenStream(username);
    let attempts = 0;
    while (!this.mediaStream && attempts < 20) { await new Promise(r => setTimeout(r, 250)); attempts++; }
    if (this.mediaStream) await this.startCameraStream(username);
  }

  async startScreenStream(username: string) {
    try {
      const stream = this.screenStream;
      if (!stream) return;
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) return;
      const imageCapture = new (window as any).ImageCapture(videoTrack);
      this.screenStreamWs = new WebSocket(this.getWebSocketUrl(`/ws/stream-screen/${username}`));
      this.screenStreamWs.onopen = () => {
        this.screenStreamInterval = setInterval(async () => {
          if (this.screenStreamWs?.readyState === WebSocket.OPEN) {
            try {
              const bitmap = await imageCapture.grabFrame();
              const canvas = this.hiddenCanvas;
              canvas.width = bitmap.width; canvas.height = bitmap.height;
              const ctx = canvas.getContext('2d');
              ctx?.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
              this.screenStreamWs.send(canvas.toDataURL('image/jpeg', 0.3));
            } catch (e) {}
          }
        }, 2000);
      };
      this.screenStreamWs.onerror = (err) => console.warn('[LIVE] Screen WS unavailable');
    } catch (err) { console.warn('[LIVE] Screen stream unavailable'); }
  }

  async startCameraStream(username: string) {
    try {
      const videoEl = this.videoRef?.nativeElement;
      if (!videoEl || !this.mediaStream) return;
      this.cameraStreamWs = new WebSocket(this.getWebSocketUrl(`/ws/stream-camera/${username}`));
      this.cameraStreamWs.onopen = () => {
        this.cameraStreamInterval = setInterval(() => {
          if (this.cameraStreamWs?.readyState === WebSocket.OPEN) {
            try {
              if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
                const canvas = this.cameraCanvas;
                canvas.width = videoEl.videoWidth; canvas.height = videoEl.videoHeight;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
                  this.cameraStreamWs.send(canvas.toDataURL('image/jpeg', 0.3));
                }
              }
            } catch (e) {}
          }
        }, 1000);
      };
      this.cameraStreamWs.onerror = (err) => console.warn('[LIVE] Camera WS unavailable');
      this.cameraStreamWs.onclose = () => console.log('[LIVE] Camera WS closed');
    } catch (err) { console.warn('[LIVE] Camera stream setup unavailable'); }
  }

  stopLiveStreaming() {
    if (this.screenStreamInterval) clearInterval(this.screenStreamInterval);
    if (this.cameraStreamInterval) clearInterval(this.cameraStreamInterval);
    this.screenStreamInterval = null;
    this.cameraStreamInterval = null;
    if (this.screenStream) { this.screenStream.getTracks().forEach(t => t.stop()); this.screenStream = null; }
    if (this.screenStreamWs?.readyState === WebSocket.OPEN) { this.screenStreamWs.close(); this.screenStreamWs = null; }
    if (this.cameraStreamWs?.readyState === WebSocket.OPEN) { this.cameraStreamWs.close(); this.cameraStreamWs = null; }
    this.isStreaming = false;
  }

  async notifyExamEnded(completed: boolean) {
    const username = sessionStorage.getItem('username');
    if (!username) return;
    try {
      const fd = new FormData();
      fd.append('username', username); fd.append('completed', String(completed));
      await lastValueFrom(this.http.post(`${environment.apiUrl}/student/end-exam`, fd));
    } catch (err) { console.error('Failed to notify exam ended', err); }
  }

  private getWebSocketUrl(path: string): string {
    const base = environment.apiUrl.replace('http', 'ws');
    return `${base}${path}`;
  }

  // ==================== EVIDENCE CAPTURE (SNAPSHOTS) ====================
  async captureEvidence(eventName: string, detail: string = 'Captured from proctoring event') {
    const username = sessionStorage.getItem('username');
    if (!username || !this.examSessionId) return;

    // Sirf visual/screen events ke liye image leni hai, audio ke liye nahi
    const audioEvents = ['voice_mismatch', 'multiple_speakers_detected'];
    if (audioEvents.includes(eventName)) return;

    const fd = new FormData();
    fd.append('username', username);
    fd.append('session_id', this.examSessionId);
    fd.append('event_name', eventName);
    fd.append('detail', detail);
    fd.append('timestamp', new Date().toISOString());

    try {
      // 1. Capture Camera Snapshot
      const videoEl = this.videoRef?.nativeElement || this.testVideoRef?.nativeElement;
      if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
          const camBlob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.5));
          if (camBlob) fd.append('camera_image', camBlob, `cam_${Date.now()}.jpg`);
        }
      }

      // 2. Capture Screen Snapshot (Using ImageCapture API)
      if (this.screenStream) {
        const videoTrack = this.screenStream.getVideoTracks()[0];
        if (videoTrack) {
          const imageCapture = new (window as any).ImageCapture(videoTrack);
          const bitmap = await imageCapture.grabFrame();
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const screenBlob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.5));
            if (screenBlob) fd.append('screen_image', screenBlob, `screen_${Date.now()}.jpg`);
          }
        }
      }

      // 3. Upload to Backend API (Parallel, background me chalega)
      await lastValueFrom(this.http.post(`${environment.apiUrl}/recording/proctoring/upload-evidence`, fd));
      console.log(`📸 [Evidence] Snapshots uploaded for: ${eventName}`);
      
    } catch (err) {
      console.warn('📸 [Evidence] Snapshot capture/upload failed:', err);
    }
  }
}
