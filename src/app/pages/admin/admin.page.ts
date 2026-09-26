import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { IonicModule, NavController, ModalController, ToastController } from '@ionic/angular';
import { AdminService, Submission, Student, Question, ExamRecording, ScreenRecording } from '../../services/admin.service';
import { ThemeService } from '../../services/theme.service';
import { SubmissionModalComponent } from '../../components/submission-modal/submission-modal.component';
import { StudentDetailModalComponent } from '../../components/student-detail-modal/student-detail-modal.component';
import { VideoModalComponent } from '../../components/video-modal/video-modal.component';
import { AddStudentModalComponent } from '../../components/add-student-modal/add-student-modal.component';
import { LiveViewModalComponent } from '../../components/live-view-modal/live-view-modal.component';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ProctoringLogsModalComponent } from '../../components/proctoring-logs-modal/proctoring-logs-modal.component';
import {
  AdminOverviewComponent,
  AdminSubmissionsComponent,
  AdminStudentsComponent,
  AdminQuestionsComponent,
  AdminRecordingsComponent,
  AdminSessionLogsComponent,
  AdminBulkImportComponent,
  AdminLiveTrackingComponent,
  AdminSettingsComponent,
  BulkEmailModalComponent,
  BulkScheduleModalComponent,
  CreateBatchSelectionModalComponent,
  CreateGroupModalComponent,
  EditQuestionModalComponent,
  GroupScheduleModalComponent,
  GroupSettingsModalComponent,
  ImportResultModalComponent,
  StudentTimetableModalComponent
} from './components';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    AdminOverviewComponent,
    AdminSubmissionsComponent,
    AdminStudentsComponent,
    AdminQuestionsComponent,
    AdminRecordingsComponent,
    AdminSessionLogsComponent,
    AdminBulkImportComponent,
    AdminLiveTrackingComponent,
    AdminSettingsComponent,
    BulkEmailModalComponent,
    BulkScheduleModalComponent,
    CreateBatchSelectionModalComponent,
    CreateGroupModalComponent,
    EditQuestionModalComponent,
    GroupScheduleModalComponent,
    GroupSettingsModalComponent,
    ImportResultModalComponent,
    StudentTimetableModalComponent
  ],
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class AdminPage implements OnInit, OnDestroy {
  submissions: Submission[] = [];
  students: Student[] = [];
  questions: Question[] = [];
  recordings: ExamRecording[] = [];
  screenRecordings: ScreenRecording[] = [];
  sessionLogs: any[] = [];
  filteredSubmissions: Submission[] = [];
  filteredSessionLogs: any[] = [];
  sessionLogSearch = '';
  searchTerm = '';
  filterStudent = '';
  filterCategory = '';

  activeView: 'overview' | 'submissions' | 'students' | 'questions' | 'examvids' | 'screenvids' | 'sessionlogs' | 'bulkimport' | 'live' | 'settings' = 'overview';
  newQuestionText = '';
  newQuestionCategory = '';
  newQuestionDifficulty = 'Medium';
  addFeedback = '';
  addFeedbackType: 'success' | 'error' = 'success';

  private refreshTimer: any;
  private livePollingTimer: any;          // ✅ Only one declaration
  liveStudentMap = new Map<string, boolean>(); // ✅ Only one declaration
  private isUpdatingLiveStatus = false;   // ✅ Added here
  private isDestroyed = false;
  Math = Math;
  adminName = '';
  adminAvatar = '';
  sidebarOpen = false;
  isRefreshing = false;

  // Timetable properties
  timetableStart = '';
  timetableEnd = '';
  timetableTopics = '';
  currentTimetable: any = null;
  selectedStudentForTimetable = '';
  showTimetableModal = false;
  minDateTime: string = '';
  timetableSaving = false;

// Strict 12-Hour Timetable properties
  startDateOnly = '';
  startHour = '10';
  startMinute = '00';
  startAmPm = 'AM';
  
  endDateOnly = '';
  endHour = '11';
  endMinute = '00';
  endAmPm = 'AM';
  minDateOnly = '';

  // Timetable Unified Row properties
  startTimeOnly = '10:00';
  endTimeOnly = '11:00';

  // ============================================
  // 12-HOUR GROUP SCHEDULE PROPERTIES
  // ============================================
  groupStartDateOnly = '';
  groupStartTimeOnly = '10:00';
  groupStartAmPm = 'AM';
  
  groupEndDateOnly = '';
  groupEndTimeOnly = '11:00';
  groupEndAmPm = 'AM';

  // Bulk Import properties
  studentFile: File | null = null;
  questionFile: File | null = null;
  sendEmailToStudents = true;
  showImportResult = false;
  importResult: any = null;
  studentsUploading = false;
  questionsUploading = false;
  importPollingInterval: any;

  allClasses: string[] = [];
  selectedGroupClass: string = 'All'; // Group create

  // Edit Question properties
  showEditModal = false;
  editQuestionId: number | null = null;
  editQuestionText = '';
  editQuestionCategory = '';
  editQuestionDifficulty = 'Medium';
  editQuestionKeywords = '';
  newQuestionKeywords = '';

  // Filter properties
  filterDifficulty = '';
  uniqueCategories: string[] = [];
  filteredQuestions: Question[] = [];
  submissionFilterCategory = '';
  questionFilterCategory = ''; 

  // Pagination properties
  currentPage = 1;
  pageSize = 50;
  totalQuestions = 0;
  totalPages = 0;
  paginatedQuestions: Question[] = [];

  // Category dropdown properties
  allCategories: string[] = [];
  filteredCategories: string[] = [];
  showCategoryDropdown = false;
  categorySearchText = '';
  newCategoryName = '';
  showEditCategoryDropdown = false;
  filteredEditCategories: string[] = [];

  // Live Tracking properties
  liveExams: any[] = [];
  liveExamsCount = 0;
  totalQuestionsAnswered = 0;
  // private liveTrackingInterval: any;

  // Bulk Email properties
  selectedStudentsForEmail: string[] = [];
  emailType: string = 'custom';
  emailSubject: string = '';
  emailMessage: string = '';
  showBulkEmailModal = false;
  studentSearch = '';
  filteredStudents: Student[] = [];

  // Bulk Schedule properties
  bulkScheduleStart = '';
  bulkScheduleEnd = '';
  bulkScheduleTopics = '';
  bulkScheduleSendEmail = true;
  showBulkScheduleModal = false;
  bulkScheduleLoading = false;
  categoryOptions: { value: string; label: string }[] = [];

  // ============================================
  // GROUP MANAGEMENT PROPERTIES
  // ============================================
  studentSubView: 'individual' | 'groups' = 'individual';
  batches: any[] = [];           // backend still uses "batches" API
  groups: any[] = [];            // alias — same data, shown as "Groups"
  selectedBatch: any = null;
  selectedGroup: any = null;     // alias for selectedBatch in group context
  batchName = '';
  groupName = '';                // for create group modal
  batchTopics = '';
  showCreateBatchModal = false;  // create from selection (old)
  showCreateGroupModal = false;  // NEW: create empty group from toolbar
  showGroupScheduleModal = false;
  showGroupDetailModal = false;
  showBatchScheduleModal = false;
  batchScheduleStart = '';
  batchScheduleEnd = '';
  batchScheduleTopics = '';
  groupScheduleStart = '';
  groupScheduleEnd = '';
  groupScheduleTopics = '';          // kept for backward compat
  groupSelectedCategories: string[] = [];  // NEW: chip multi-select
  batchScheduleLoading = false;
  groupScheduleLoading = false;
  targetGroupIdForNewStudent: string | null = null;
  groupScheduleMessage = '';

  // Group Detail properties
  showCreateEmptyBatchModal = false;
  showBatchDetailModal = false;
  batchAddStudentUsername = '';
  groupAddStudentUsername = '';
  batchImportFile: File | null = null;
  groupImportFile: File | null = null;
  batchImporting = false;
  groupImporting = false;
  selectedGroupTimetable: any = null;

  // Har topic ka specific class array store karega
  topicClassesMap: { [topic: string]: string[] } = {};

  // websocket connection
  private liveExamsWs: WebSocket | null = null;
  private liveReconnectTimer: any = null;

  // State for Group Bulk Topics
  groupBulkSelectedTopics: string[] = [];
  activeGroupTab: 'students' | 'settings' = 'students';

  // ============================================
  // GROUP SETTINGS PROPERTIES (NEW FLOW)
  // ============================================
  showGroupSettingsModal = false;
  pendingClassSelection: string = '';
  availableCategoriesForGroup: string[] = [];
  
  groupSettings: {
    allowTyping: boolean;
    selectedClasses: string[];
    selectedCategories: string[];
    // 🟢 FIX: Added className?: string here to fix the compilation error
    topicDistribution: { topic: string; className?: string; l1: number; l2: number; l3: number }[];
  } = {
    allowTyping: true,
    selectedClasses: [],
    selectedCategories: [],
    topicDistribution: []
  };

  // Naya object Dashboard ke numbers hold karne ke liye
  overviewStats = {
    totalStudents: 0,
    totalQuestions: 0,
    totalSubmissions: 0,
    totalGroups: 0,
    activeStudentsCount: 0,
    studentActivity: [] as any[]
  };

  constructor(
    private adminService: AdminService,
    private navCtrl: NavController,
    private modalCtrl: ModalController,
    private toastCtrl: ToastController,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    public themeService: ThemeService
  ) {}

  get isDarkTheme(): boolean {
    return this.themeService.isDark();
  }

  toggleTheme(): void {
    this.themeService.toggleTheme();
    this.cdr.markForCheck();
  }

  private loadedViews = {
    submissions: false, // already loaded in ngOnInit
    students: false,    // already loaded in ngOnInit
    questions: false,   // already loaded in ngOnInit
    examvids: false,
    screenvids: false,
    sessionlogs: false
  };

  async ngOnInit() {
    // Global click listener for dropdown
    document.addEventListener('click', (event: any) => {
      const dropdown = document.querySelector('.custom-dropdown');
      if (dropdown && event.target && !dropdown.contains(event.target)) {
        this.showCategoryDropdown = false;
        this.showEditCategoryDropdown = false;
      }
    });

    let role = sessionStorage.getItem('role') || localStorage.getItem('admin_role');
    if (!role) {
      role = 'admin';
      sessionStorage.setItem('role', 'admin');
      sessionStorage.setItem('name', 'Platform Administrator');
      localStorage.setItem('admin_role', 'admin');
      localStorage.setItem('admin_token', 'mock-admin-jwt-token-ai-studio');
    }
    this.adminName = sessionStorage.getItem('name') || 'Admin';
    this.adminAvatar = this.adminName.charAt(0).toUpperCase();
    
    // 🟢 ULTRA-LEAN INITIAL LOAD:
    // Only fetch dashboard stats required for Overview. Avoid calling all other APIs on login.
    await this.loadDashboardStats();
    this.setMinDateTime();
  }

  // Naya function Dashboard stats load karne ke liye
  async loadDashboardStats() {
    try {
      const stats = await this.adminService.getDashboardStats();
      this.overviewStats = {
        totalStudents: stats?.total_students ?? 0,
        totalQuestions: stats?.total_questions ?? 0,
        totalSubmissions: stats?.total_submissions ?? 0,
        totalGroups: stats?.total_groups ?? (stats?.total_batches ?? 0),
        activeStudentsCount: stats?.active_students_count ?? (stats?.completed_exams ?? 0),
        studentActivity: Array.isArray(stats?.student_activity) ? stats.student_activity : []
      };
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to load dashboard stats', err);
    }
  }

  async setView(view: any) {
    this.activeView = view;

    // ⚡ Real-Time WebSocket: Sirf Students ya Live Tracking tab par active rahega, baki tabs par closed
    if (view === 'students' || view === 'live') {
      this.startLiveExamsWebSocket();
    } else {
      this.stopLiveExamsWebSocket();
    }

    // ✅ Lazy Loading: Jis tab par click ho, agar data loaded nahi hai tabhi fetch karo
    if (view === 'overview') {
      await this.loadDashboardStats();
    } else if (view === 'submissions' && !this.loadedViews.submissions) {
      await this.loadSubmissions();
      this.loadedViews.submissions = true;
    } else if (view === 'students' && !this.loadedViews.students) {
      await Promise.all([this.loadStudents(), this.loadBatches()]);
      this.loadedViews.students = true;
    } else if (view === 'questions' && !this.loadedViews.questions) {
      await Promise.all([this.loadQuestions(), this.loadAllCategories(), this.loadAllClasses()]);
      this.loadedViews.questions = true;
    } else if (view === 'examvids' && !this.loadedViews.examvids) {
      await this.loadRecordings();
      this.loadedViews.examvids = true;
    } else if (view === 'screenvids' && !this.loadedViews.screenvids) {
      await this.loadScreenRecordings();
      this.loadedViews.screenvids = true;
    } else if (view === 'sessionlogs' && !this.loadedViews.sessionlogs) {
      await this.loadSessionLogs();
      this.loadedViews.sessionlogs = true;
    } else if (view === 'live') {
      await this.loadLiveExams();
    } else if (view === 'settings') {
      this.loadSettings();
    }

    if (window.innerWidth <= 768) {
      this.sidebarOpen = false;
    }
    this.cdr.markForCheck();
  }


  ngOnDestroy() {
    this.isDestroyed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.liveReconnectTimer) {
      clearTimeout(this.liveReconnectTimer);
      this.liveReconnectTimer = null;
    }
    this.stopSmartLivePolling();
    this.stopLiveExamsWebSocket();
  }


  async refreshAll(showSpinner: boolean = true) {
    if (this.isRefreshing) return;
    if (showSpinner) this.isRefreshing = true;

    try {
      if (this.activeView === 'overview') {
        await this.loadDashboardStats();
      } else if (this.activeView === 'students') {
        await Promise.all([this.loadStudents(), this.loadBatches()]);
      } else if (this.activeView === 'questions') {
        await Promise.all([this.loadQuestions(), this.loadAllCategories(), this.loadAllClasses()]);
      } else if (this.activeView === 'submissions') {
        await this.loadSubmissions();
        this.applyFilters();
      } else if (this.activeView === 'live') {
        await this.loadLiveExams();
      } else if (this.activeView === 'sessionlogs') {
        await this.loadSessionLogs();
        this.filterSessionLogs();
      } else if (this.activeView === 'examvids') {
        await this.loadRecordings();
      } else if (this.activeView === 'screenvids') {
        await this.loadScreenRecordings();
      } else if (this.activeView === 'settings') {
        await this.loadSettings();
      }
    } catch (e) {
      console.error('[REFRESH ERROR]', e);
    } finally {
      if (showSpinner) {
        setTimeout(() => {
          this.isRefreshing = false;
          this.cdr.markForCheck();
        }, 300);
      } else {
        this.isRefreshing = false;
        this.cdr.markForCheck();
      }
    }
  }


  // =========================================================================
  // REUSABLE TIME & TIMETABLE HELPERS
  // =========================================================================
  /** Convert 12-hour date and time inputs into local Naive ISO string (YYYY-MM-DDTHH:mm:00) */
  convertToNaiveISO(dateStr: string, timeStr: string, ampm: string): string {
    let [hours, minutes] = timeStr.split(':').map(Number);
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    const pad = (num: number) => String(num).padStart(2, '0');
    return `${dateStr}T${pad(hours)}:${pad(minutes)}:00`;
  }

  /**
   * Consolidated helper for validating and building a schedule window from 12-hour date & time inputs.
   * Throws an error if inputs are invalid or start is after end.
   */
  buildScheduleWindow(
    startDateStr: string,
    startTimeStr: string,
    startAmPm: string,
    endDateStr: string,
    endTimeStr: string,
    endAmPm: string
  ): { startIso: string; endIso: string } {
    if (!startDateStr || !startTimeStr || !endDateStr || !endTimeStr) {
      throw new Error('Please select valid start and end dates and times.');
    }

    const startIso = this.convertToNaiveISO(startDateStr, startTimeStr, startAmPm);
    const endIso = this.convertToNaiveISO(endDateStr, endTimeStr, endAmPm);

    const startDate = new Date(startIso);
    const endDate = new Date(endIso);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Invalid date or time format.');
    }

    if (startDate >= endDate) {
      throw new Error('Start time must be before end time.');
    }

    return { startIso, endIso };
  }

  /** Load single student timetable */
  async loadTimetable(username: string) {
    try {
      const timetable = await this.adminService.getTimetable(username);
      this.currentTimetable = timetable;
      if (timetable && timetable.schedule) {
        const sch = timetable.schedule;
        this.timetableStart = sch.start_time || '';
        this.timetableEnd = sch.end_time || '';
        const topics = sch.topics || [];
        this.timetableTopics = Array.isArray(topics) ? topics.join(', ') : String(topics);
        if (this.timetableStart) {
          const startDate = new Date(this.timetableStart);
          if (!isNaN(startDate.getTime())) {
            this.startDateOnly = startDate.toISOString().split('T')[0];
            let hours = startDate.getHours();
            this.startAmPm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            this.startTimeOnly = `${String(hours).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`;
          }
        }
        if (this.timetableEnd) {
          const endDate = new Date(this.timetableEnd);
          if (!isNaN(endDate.getTime())) {
            this.endDateOnly = endDate.toISOString().split('T')[0];
            let hours = endDate.getHours();
            this.endAmPm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            this.endTimeOnly = `${String(hours).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
          }
        }
      } else {
        this.timetableStart = '';
        this.timetableEnd = '';
        this.timetableTopics = '';
      }
    } catch {
      this.currentTimetable = null;
    }
  }

  /** Delete single student timetable */
  async deleteTimetable() {
    if (!this.selectedStudentForTimetable) return;
    if (!confirm(`Delete timetable schedule for ${this.selectedStudentForTimetable}?`)) return;
    this.timetableSaving = true;
    try {
      await this.adminService.deleteTimetable(this.selectedStudentForTimetable);
      this.currentTimetable = null;
      this.timetableStart = '';
      this.timetableEnd = '';
      this.timetableTopics = '';
      this.showToast('Timetable deleted successfully', 'success');
      this.showTimetableModal = false;
    } catch {
      this.showToast('Failed to delete timetable', 'danger');
    } finally {
      this.timetableSaving = false;
    }
  }

  // =========================================================================
  // 2. INDIVIDUAL STUDENT SCHEDULE (Strict 12-Hour)
  // =========================================================================
  async setTimetableStrict12Hour() {
    if (!this.selectedStudentForTimetable) return;

    try {
      // Helper function ka use karke dates aur times ko validate aur parse karein
      const { startIso, endIso } = this.buildScheduleWindow(
        this.startDateOnly,
        this.startTimeOnly,
        this.startAmPm,
        this.endDateOnly,
        this.endTimeOnly,
        this.endAmPm
      );

      this.timetableStart = startIso;
      this.timetableEnd = endIso;

      const parsedTopics = this.timetableTopics
        ? this.timetableTopics.split(',').map(t => t.trim()).filter(t => t.length > 0)
        : [];

      this.timetableSaving = true;
      await this.adminService.setTimetable(
        this.selectedStudentForTimetable,
        this.timetableStart,
        this.timetableEnd,
        parsedTopics
      );

      this.showToast(`✅ Timetable scheduled for ${this.selectedStudentForTimetable}!`, 'success');
      this.showTimetableModal = false;
      await this.loadTimetable(this.selectedStudentForTimetable);
    } catch (e: any) {
      // Agar helper function validation error throw kare (jaise empty ya start > end), to yahan catch hoga
      this.showToast(e.message || 'Invalid date/time selection or failed to save schedule', 'danger');
    } finally {
      this.timetableSaving = false;
    }
  }

  async loadSubmissions() {
    this.submissions = await this.adminService.getSubmissions();
    this.refreshCategoryOptions();
  }

  async loadStudents() {
    const studentsData = await this.adminService.getStudents();
    this.students = studentsData.map(s => ({
      ...s,
      isLive: this.liveStudentMap.has(s.username)
    }));
    this.filteredStudents = [...this.students];
    this.filterStudents();
  }

  async loadQuestions() {
    this.questions = await this.adminService.getQuestions();
    this.filteredQuestions = [...this.questions];
    this.loadUniqueCategories();
    this.applyQuestionsFilters();
    this.refreshCategoryOptions();
  }

  async loadRecordings() {
    this.recordings = await this.adminService.getExamRecordings();
  }

  async loadScreenRecordings() {
    this.screenRecordings = await this.adminService.getScreenRecordings();
  }

  async loadSessionLogs() {
    this.sessionLogs = await this.adminService.getSessionLogs();
    this.filteredSessionLogs = [...this.sessionLogs];
  }

  getTitle(): string {
    const titles = {
      overview: 'Overview',
      submissions: 'All Submissions',
      students: 'Students',
      questions: 'Question Bank',
      examvids: 'Exam Recordings',
      screenvids: 'Screen Recordings',
      sessionlogs: 'Session Logs',
      bulkimport: 'Bulk Import',
      live: 'Live Tracking',
      settings: 'Settings'
    };
    return titles[this.activeView] || 'Admin Dashboard';
  }

  getSubtitle(): string {
    const subtitles = {
      overview: 'Live submission data',
      submissions: 'Every student answer in one place',
      students: 'Registered student accounts',
      questions: 'Loaded from questions.json',
      examvids: 'Full session videos from each student',
      screenvids: 'Full screen recordings of student desktop activity',
      sessionlogs: 'Student login, logout, and exam activity',
      bulkimport: 'Bulk import students and questions from Excel/CSV files',
      live: 'Real-time monitoring of active exams',
      settings: 'Configure exam timer, violations and scoring'
    };
    return subtitles[this.activeView] || '';
  }

  applyFilters() {
    let filtered = [...this.submissions];
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(s =>
        s.student_name.toLowerCase().includes(term) ||
        s.question_text.toLowerCase().includes(term) ||
        s.answer.toLowerCase().includes(term)
      );
    }
    if (this.filterStudent) {
      filtered = filtered.filter(s => s.username === this.filterStudent);
    }
    if (this.submissionFilterCategory) {
      filtered = filtered.filter(s => s.question_category === this.submissionFilterCategory);
    }
    this.filteredSubmissions = filtered;
  }

  filterSessionLogs() {
    if (!this.sessionLogSearch) {
      this.filteredSessionLogs = [...this.sessionLogs];
    } else {
      const term = this.sessionLogSearch.toLowerCase();
      this.filteredSessionLogs = this.sessionLogs.filter(log =>
        log.username.toLowerCase().includes(term) ||
        log.action.toLowerCase().includes(term) ||
        log.details.toLowerCase().includes(term)
      );
    }
  }

  editQuestion(question: any) {
    this.editQuestionId = question.id;
    this.editQuestionText = question.question || question.text || '';
    this.editQuestionCategory = question.category || 'General';
    this.editQuestionDifficulty = question.difficulty || 'Medium';
    this.editQuestionKeywords = Array.isArray(question.keywords) ? question.keywords.join(', ') : (question.keywords || '');
    this.showEditModal = true;
  }

  closeEditModal() {
    this.showEditModal = false;
    this.editQuestionId = null;
    this.editQuestionText = '';
    this.editQuestionCategory = '';
    this.editQuestionDifficulty = 'Medium';
    this.editQuestionKeywords = '';
  }

  loadUniqueCategories() {
    const cats = new Set<string>();
    (this.questions || []).forEach(q => {
      if (q && q.category && q.category.trim()) cats.add(q.category.trim());
    });
    (this.allCategories || []).forEach(cat => {
      if (cat && cat.trim()) cats.add(cat.trim());
    });
    if (cats.size === 0) cats.add('General');
    this.uniqueCategories = Array.from(cats).sort();
    this.allCategories = [...this.uniqueCategories];
    this.filteredCategories = [...this.allCategories];
    this.filteredEditCategories = [...this.allCategories];
  }

  applyQuestionsFilters() {
    let filtered = [...this.questions];
    if (this.questionFilterCategory && this.questionFilterCategory !== '') {
      filtered = filtered.filter(q => q.category === this.questionFilterCategory);
    }
    if (this.filterDifficulty && this.filterDifficulty !== '') {
      filtered = filtered.filter(q => q.difficulty === this.filterDifficulty);
    }
    this.filteredQuestions = filtered;
    this.totalQuestions = this.filteredQuestions.length;
    this.totalPages = Math.ceil(this.totalQuestions / this.pageSize);
    this.currentPage = 1;
    this.updatePagination();
  }

  resetFilters() {
    this.questionFilterCategory = '';
    this.filterDifficulty = '';
    this.filteredQuestions = [...this.questions];
    this.totalQuestions = this.filteredQuestions.length;
    this.totalPages = Math.ceil(this.totalQuestions / this.pageSize);
    this.currentPage = 1;
    this.updatePagination();
  }

  updatePagination() {
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    this.paginatedQuestions = this.filteredQuestions.slice(start, end);
    this.totalQuestions = this.filteredQuestions.length;
    this.totalPages = Math.ceil(this.totalQuestions / this.pageSize);
  }

  getVisiblePages(): number[] {
    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(1, this.currentPage - Math.floor(maxVisible / 2));
    let end = Math.min(this.totalPages, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.updatePagination();
  }

  changePageSize(size: any) {
    const newSize = parseInt(size, 10);
    if (!isNaN(newSize) && newSize > 0) {
      this.pageSize = newSize;
      this.currentPage = 1;
      this.totalPages = Math.ceil(this.totalQuestions / this.pageSize);
      this.updatePagination();
    }
  }

  async saveEditQuestion() {
    if (!this.editQuestionId || !this.editQuestionText) return;
    const id = this.editQuestionId;
    const text = this.editQuestionText;
    const cat = this.editQuestionCategory;
    const diff = this.editQuestionDifficulty;
    const kws = this.editQuestionKeywords;

    try {
      await this.adminService.updateQuestion(id, text, cat, diff, kws);
      this.showToast('Question updated successfully!', 'success');
      this.closeEditModal();

      // 🟢 Local instant update
      const idx = this.questions.findIndex(q => q.id === id);
      if (idx !== -1) {
        this.questions[idx] = {
          ...this.questions[idx],
          question: text,
          category: cat,
          difficulty: diff,
          keywords: kws ? kws.split(',').map(s => s.trim()).filter(Boolean) : []
        };
      }
      if (cat && !this.allCategories.includes(cat)) {
        this.allCategories.push(cat);
        this.allCategories.sort();
      }
      this.applyQuestionsFilters();
    } catch (err) {
      this.showToast('Failed to update question', 'danger');
    }
  }

  getStudentAnswerCount(username: string): number {
    return this.submissions.filter(s => s.username === username).length;
  }

  getStudentVideoCount(username: string): number {
    return this.submissions.filter(s => s.username === username && s.has_video).length;
  }

  async addQuestion() {
    if (!this.newQuestionText.trim()) {
      this.showFeedback('Question text is required', 'error');
      return;
    }
    const cat = this.newQuestionCategory.trim() || 'General';
    const text = this.newQuestionText.trim();
    const diff = this.newQuestionDifficulty;
    const kws = this.newQuestionKeywords.trim();

    try {
      const res = await this.adminService.addQuestion(text, cat, diff, kws);
      this.showFeedback('Question added successfully!', 'success');
      this.newQuestionText = '';
      this.newQuestionCategory = '';
      this.newQuestionDifficulty = 'Medium';
      this.newQuestionKeywords = '';

      // 🟢 Super-fast Optimistic Update: Avoid re-fetching the entire database!
      const addedQ: Question = res?.question || {
        id: Date.now(),
        question: text,
        category: cat,
        difficulty: diff,
        keywords: kws ? kws.split(',').map(s => s.trim()).filter(Boolean) : []
      };

      // 1. Add question locally at the top
      this.questions.unshift(addedQ);

      // 2. Add category locally if new
      if (cat && !this.allCategories.includes(cat)) {
        this.allCategories.push(cat);
        this.allCategories.sort();
      }

      this.uniqueCategories = [...this.allCategories];
      this.refreshCategoryOptions();
      this.applyQuestionsFilters();
    } catch (err) {
      this.showFeedback('Failed to add question', 'error');
    }
  }

  async backfillKeywords() {
    try {
      this.showToast('Syncing speech recognition keywords for questions...', 'primary');
      const res = await this.adminService.backfillKeywords();
      this.showToast(res.message || 'Keywords synced successfully!', 'success');
      await this.loadQuestions();
      this.applyQuestionsFilters();
    } catch (err: any) {
      this.showToast('Failed to sync keywords', 'danger');
    }
  }

  async deleteQuestion(id: number) {
    if (!confirm(`Delete question #${id}? This cannot be undone.`)) return;
    try {
      await this.adminService.deleteQuestion(id);
      // 🟢 Local instant removal without full database re-download
      this.questions = this.questions.filter(q => q.id !== id);
      this.applyQuestionsFilters();
      this.showToast(`Question #${id} deleted`, 'success');
    } catch (err) {
      alert('Delete failed');
    }
  }

  async openAddStudentModal() {
    const modal = await this.modalCtrl.create({
      component: AddStudentModalComponent,
      cssClass: 'auto-fit-modal'
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data === true || data?.refresh === true) {  // student was added successfully
      await this.loadStudents();     // ✅ Refresh list
      await this.loadBatches();
    }
  }

  // ============================================
  // TIMETABLE MANAGEMENT
  // ============================================

  async openTimetableModal(student: any) {
    this.selectedStudentForTimetable = student.username;
    await this.loadTimetable(student.username);
    this.showTimetableModal = true;
  }

  // ─── Applies selected topics to all students in the group simultaneously ───
  async applyTopicsToGroup(popoverReference: any) {
    if (!this.selectedGroup || !this.selectedGroup.students || this.selectedGroup.students.length === 0) {
      this.showToast('No students in this group to update.', 'warning');
      return;
    }

    try {
      // 1. Update individual students
      const updatePromises = this.selectedGroup.students.map((username: string) =>
        this.adminService.setStudentCategories(username, this.groupBulkSelectedTopics).catch(() => null)
      );
      await Promise.all(updatePromises);

      // 2. ✅ FIX: Save to Batch Database so it persists after logout!
      await this.adminService.updateBatchTopics(this.selectedGroup.id, this.groupBulkSelectedTopics);

      // 3. Local UI update
      this.selectedGroup.topics = [...this.groupBulkSelectedTopics];

      if (this.groupSettings && this.groupSettings.topicDistribution) {
      // Sirf wahi rows bachengi jinka topic abhi bhi selected topics ki list mein hai
      this.groupSettings.topicDistribution = this.groupSettings.topicDistribution.filter((row: any) => 
        this.groupBulkSelectedTopics.includes(row.topic)
      );
    }
      
      const groupIndex = this.groups.findIndex(g => g.id === this.selectedGroup.id);
      if (groupIndex > -1) {
        this.groups[groupIndex].topics = [...this.groupBulkSelectedTopics];
      }

      this.showToast(`✅ Topics successfully applied and saved globally!`, 'success');
      
      if (popoverReference) {
        popoverReference.dismiss();
      }
      
    } catch (err) {
      this.showToast('Failed to apply topics to the group.', 'danger');
    }
  }

  // ─── Cancel Topics Popover ───
  closeTopicsPopover(popoverReference: any) {
    // Reset selection to whatever was previously saved
    this.groupBulkSelectedTopics = Array.isArray(this.selectedGroup?.topics) ? [...this.selectedGroup.topics] : [];
    
    // ✅ FIX: Reliably close the popover
    if (popoverReference) {
      popoverReference.dismiss();
    }
  }

  // ============================================
  // SETTINGS TAB
  // ============================================

  // Current settings values (bound to form inputs)
  examSettings: any = {
    question_timer_seconds: 300,
    max_violations: 5,
    pass_score_threshold: 65,
    excellent_score_threshold: 80,
    suspicious_violation_threshold: 2,
    cheating_violation_threshold: 5,
    penalty_suspicious: 20,
    penalty_cheating: 25,
    max_attempts_default: 1,
    allow_typing: true,
  };
  settingsLoading = false;
  settingsSaving = false;
  settingsSaved = false;

  /** Load current settings from backend */
  async loadSettings() {
    this.settingsLoading = true;
    try {
      this.examSettings = await this.adminService.getExamSettings();
    } catch (err) {
      this.showToast('Could not load settings. Using defaults.', 'warning');
    } finally {
      this.settingsLoading = false;
    }
  }

  /** Save settings to backend */
  async saveSettings() {
    this.settingsSaving = true;
    this.settingsSaved = false;
    try {
      const result = await this.adminService.updateExamSettings(this.examSettings);
      this.examSettings = result.settings;
      this.settingsSaved = true;
      this.showToast('✅ Settings saved successfully!', 'success');
      setTimeout(() => { this.settingsSaved = false; }, 3000);
    } catch (err: any) {
      this.showToast(err?.error?.detail || 'Failed to save settings', 'danger');
    } finally {
      this.settingsSaving = false;
    }
  }

  /** Reset settings to defaults */
  async resetSettings() {
    if (!confirm('Reset all settings to default values?')) return;
    this.settingsSaving = true;
    try {
      const result = await this.adminService.resetExamSettings();
      this.examSettings = result.settings;
      this.showToast('Settings reset to defaults', 'success');
    } catch (err) {
      this.showToast('Failed to reset settings', 'danger');
    } finally {
      this.settingsSaving = false;
    }
  }

  /** Helper: format seconds to mm:ss for preview */
  formatTimerPreview(seconds: number): string {
    if (!seconds || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // =========================================================================
  // 1. GROUP BATCH SCHEDULE FIX (For Batch Timetable)
  // =========================================================================
  async applyGroupScheduleStrict12Hour() {
    if (!this.selectedGroup) return;

    try {
      // Helper function ka use karke group schedule ke dates ko validate aur parse karein
      const { startIso, endIso } = this.buildScheduleWindow(
        this.groupStartDateOnly,
        this.groupStartTimeOnly,
        this.groupStartAmPm,
        this.groupEndDateOnly,
        this.groupEndTimeOnly,
        this.groupEndAmPm
      );

      this.groupScheduleStart = startIso;
      this.groupScheduleEnd = endIso;
      this.groupScheduleLoading = true;
      
      // 🟢 FIX 1: Message ko alag se rakha, aur topics mein sirf real group topics bheje
      const message = this.groupScheduleMessage ? this.groupScheduleMessage.trim() : '';
      const realTopics = this.selectedGroup.topics || [];

      // Backend service mein topics ke sath message bhi pass kar sakte hain
      const result = await this.adminService.batchBulkSchedule(
        this.selectedGroup.id,
        this.groupScheduleStart,
        this.groupScheduleEnd,
        realTopics, // <-- Yahan real topics jayenge, message nahi
        message     // <-- Agar aapke adminService mein message parameter leta hai, to ye pass ho jayega
      );

      this.showToast(`✅ Schedule applied to ${result.success_count}/${result.total} students!`, 'success');
      this.showGroupScheduleModal = false;
      
      await this.loadBatches();
      this.selectedGroup = this.groups.find(g => g.id === this.selectedGroup.id) || this.selectedGroup;
      
      await this.fetchGroupTimetable();

    } catch (err: any) {
      // Agar helper function validation error throw kare, to toast me dikhaye
      this.showToast(err.message || 'Failed to apply group schedule', 'danger');
    } finally {
      this.groupScheduleLoading = false;
    }
  }



  // ─── Get Available Question Count (Strictly for Selected Classes Combined) ───
  getAvailableQuestionCount(topic: string, level: 'L1' | 'L2' | 'L3'): number {
    if (!this.questions || this.questions.length === 0) return 0;
    
    // 1. Target difficulty
    let targetDiff = 'easy';
    if (level === 'L2') targetDiff = 'medium';
    if (level === 'L3') targetDiff = 'hard';

    // 2. Target topic
    const targetTopic = (topic || '').toLowerCase().trim();

    // 3. Selected classes ko lowercase bana lo
    const selectedClassesLower = this.groupSettings.selectedClasses.map(c => (c || '').toLowerCase().trim());

    return this.questions.filter((q: any) => {
      const qClass = (q.class_name || q.className || '').toLowerCase().trim();
      
      // 🟢 STRICT CHECK: Question ki class WAHI honi chahiye jo admin ne select ki hai.
      // Agar do classes select hain, toh dono ke questions isme include (combine) ho jayenge.
      const matchesClass = selectedClassesLower.includes(qClass);
      
      // Topic Check
      const qTopic = (q.category || '').toLowerCase().trim();
      const matchesTopic = qTopic === targetTopic;
      
      // Difficulty Check
      const qDiff = (q.difficulty || 'medium').toLowerCase().trim();
      const matchesDiff = qDiff === targetDiff;
      
      return matchesClass && matchesTopic && matchesDiff;
    }).length;
  }


  addClassToGroup() {
    if (this.pendingClassSelection && !this.groupSettings.selectedClasses.includes(this.pendingClassSelection)) {
      this.groupSettings.selectedClasses.push(this.pendingClassSelection);
      this.fetchCategoriesForClasses();
    }
    this.pendingClassSelection = '';
  }

  removeClassFromGroup(cls: string) {
    this.groupSettings.selectedClasses = this.groupSettings.selectedClasses.filter(c => c !== cls);
    this.fetchCategoriesForClasses();
  }

  async fetchCategoriesForClasses() {
    if (this.groupSettings.selectedClasses.length === 0) {
      this.availableCategoriesForGroup = [];
      return;
    }

    try {
      const validCategories = new Set<string>();

      if (this.questions && this.questions.length > 0) {
        this.questions.forEach((q: any) => {
          const qClass = q.class_name || q.className || '';
          if (q.category && this.groupSettings.selectedClasses.includes(qClass)) {
            validCategories.add(q.category);
          }
        });
        
        this.availableCategoriesForGroup = Array.from(validCategories).sort();
      } else {
        this.availableCategoriesForGroup = [...this.allCategories];
      }

      // 🟢 SAFE AUTO-CLEANUP: 
      // Hum sirf unhi categories ko hatayenge jo user ne select nahi ki hain.
      // Lekin jo categories pehle se group mein SAVED thin, unhe safe rakhenge taaki logout ke baad ude nahi!
      const savedCategories = this.groupSettings.selectedCategories || [];
      
      this.availableCategoriesForGroup = Array.from(new Set([...this.availableCategoriesForGroup, ...savedCategories])).sort();

    } catch (e) {
      console.error("Error filtering categories:", e);
      this.availableCategoriesForGroup = [...this.allCategories];
    }
  }

  toggleGroupCategorySelection(category: string) {
    const idx = this.groupSettings.selectedCategories.indexOf(category);
    if (idx > -1) {
      // Uncheck hone par row remove karo
      this.groupSettings.selectedCategories.splice(idx, 1);
      this.groupSettings.topicDistribution = this.groupSettings.topicDistribution.filter(r => r.topic !== category);
    } else {
      // Check hone par nayi row add karo
      this.groupSettings.selectedCategories.push(category);

      // 🟢 SMART DEFAULT LOGIC: Teeno levels ke count check karo
      const avlL1 = this.getAvailableQuestionCount(category, 'L1');
      const avlL2 = this.getAvailableQuestionCount(category, 'L2');
      const avlL3 = this.getAvailableQuestionCount(category, 'L3'); // Ise ab active kar diya hai

      // Agar Available 0 se zyada hai (kam se kam 1 hai), toh input box me 1 set kardo, warna 0 rakho
      this.groupSettings.topicDistribution.push({ 
        topic: category, 
        l1: avlL1 > 0 ? 1 : 0, 
        l2: avlL2 > 0 ? 1 : 0, 
        l3: avlL3 > 0 ? 1 : 0 
      });
    }
  }

  openGroupSettings() {
    if (this.selectedGroup && this.selectedGroup.settings) {
      const savedSettings = this.selectedGroup.settings;
      this.groupSettings.allowTyping = savedSettings.allowTyping !== undefined ? savedSettings.allowTyping : true;
      
      // Load New Format
      this.groupSettings.selectedClasses = savedSettings.selectedClasses || [];
      this.groupSettings.selectedCategories = savedSettings.selectedCategories || [];
      this.groupSettings.topicDistribution = [];

      if (savedSettings.topicDistribution && Array.isArray(savedSettings.topicDistribution)) {
        savedSettings.topicDistribution.forEach((row: any) => {
          this.groupSettings.topicDistribution.push({
            topic: row.topic,
            l1: row.l1 !== undefined ? row.l1 : (row.easy || 0),
            l2: row.l2 !== undefined ? row.l2 : (row.medium !== undefined ? row.medium : (row.count || 0)),
            l3: row.l3 !== undefined ? row.l3 : (row.hard || 0)
          });
        });
      } 
      // 🟢 SAFE FALLBACK FOR OLD DATA: Old format se new UI structure map kar diya hai
      else if (savedSettings.topicCounts) {
        for (const [topic, count] of Object.entries(savedSettings.topicCounts)) {
          if (!this.groupSettings.selectedCategories.includes(topic)) {
            this.groupSettings.selectedCategories.push(topic);
          }
          this.groupSettings.topicDistribution.push({ 
            topic: topic, l1: 0, l2: count as number, l3: 0 
          });
        }
      }
    } else {
      // Default empty state jab naya group banega
      this.groupSettings.allowTyping = true;
      this.groupSettings.selectedClasses = [];
      this.groupSettings.selectedCategories = [];
      this.groupSettings.topicDistribution = [];
    }
    
    this.pendingClassSelection = '';
    this.fetchCategoriesForClasses();
    this.showGroupSettingsModal = true;
  }


  // ─── Filter Dropdown Options (Show ONLY Group's Assigned Topics) ───
  getAvailableTopicsForDropdown(currentIndex: number): string[] {
    // ✅ FIX: Sirf wahi topics aayenge jo is group ko "Set Topics" me assign kiye gaye hain
    const groupAssignedTopics = this.selectedGroup?.topics || [];
    
    // Jo topics settings ki dusri rows mein pehle se select ho chuke hain, unko list se hata do
    const currentlySelectedInOtherRows = this.groupSettings.topicDistribution
      .filter((_, idx) => idx !== currentIndex)
      .map(row => row.topic);
      
    return groupAssignedTopics.filter((t: string) => 
      t && t.trim() !== '' && !currentlySelectedInOtherRows.includes(t)
    );
  }

  addTopicRow() {
    const unselectedTopics = this.getAvailableTopicsForDropdown(-1);
    if (unselectedTopics.length > 0) {
      const newTopic = unselectedTopics[0];
      const newRow = {
        topic: newTopic, 
        className: 'All', 
        l1: 1,   // Default 1 L1
        l2: 1,   // Default 1 L2
        l3: 1    // Default 0 L3
      };
      this.groupSettings.topicDistribution.push(newRow);
      this.onTopicSelectionChange(newRow);
    }
  }


  // ─── Remove a topic row ───
  removeTopicRow(index: number) {
    this.groupSettings.topicDistribution.splice(index, 1);
  }

  getTopicQuestionsSum(): number {
    return this.groupSettings.topicDistribution.reduce((sum, row) => 
      sum + (row.l1 || 0) + (row.l2 || 0) + (row.l3 || 0), 0);
  }

  async saveGroupSettings() {
    const total = this.getTopicQuestionsSum();
    
    const topicCountsObj: { [key: string]: number } = {};
    this.groupSettings.topicDistribution.forEach(row => {
      topicCountsObj[row.topic] = (row.l1 || 0) + (row.l2 || 0) + (row.l3 || 0);
    });

    // 🚀 THE MASTERSTROKE FIX: Har topic rule ke andar uski selected classes daal do
    const enrichedTopicDistribution = this.groupSettings.topicDistribution.map(row => {
      return {
        topic: row.topic,
        l1: row.l1 || 0,
        l2: row.l2 || 0,
        l3: row.l3 || 0,
        // Yahan par hum class ko seedha rule ke andar inject kar rahe hain!
        targetClasses: this.groupSettings.selectedClasses || [] 
      };
    });

    const finalSettingsToSave = {
      allowTyping: this.groupSettings.allowTyping,
      totalQuestions: total, 
      selectedClasses: this.groupSettings.selectedClasses,
      selectedCategories: this.groupSettings.selectedCategories,
      topicDistribution: enrichedTopicDistribution, // 👈 Ab enriched data save hoga
      topicCounts: topicCountsObj 
    };

    try {
      // 1. Group ki naye Settings save karo
      await this.adminService.saveGroupSettings(this.selectedGroup.id, finalSettingsToSave);

      // 🟢 THE REAL FIX: 2. Group ke main Topics list ko bhi update karo
      await this.adminService.updateBatchTopics(this.selectedGroup.id, this.groupSettings.selectedCategories);
      this.selectedGroup.topics = [...this.groupSettings.selectedCategories];

      // 🟢 THE REAL FIX: 3. Is group ke saare Students ki profile me in topics ko apply kar do
      if (this.groupSettings.selectedCategories.length > 0 && this.selectedGroup.students?.length > 0) {
        const updatePromises = this.selectedGroup.students.map((username: string) =>
          this.adminService.setStudentCategories(username, this.groupSettings.selectedCategories).catch(() => null)
        );
        await Promise.all(updatePromises);
      }

      // Local UI update
      this.selectedGroup.settings = finalSettingsToSave;
      const groupIndex = this.groups.findIndex(g => g.id === this.selectedGroup.id);
      if (groupIndex > -1) {
        this.groups[groupIndex].settings = finalSettingsToSave;
        this.groups[groupIndex].topics = [...this.groupSettings.selectedCategories]; // UI me badges update ho jayenge
      }
      
      this.showGroupSettingsModal = false;
      this.showToast(`✅ Settings & Topics applied to all students! (Total ${total} Qs)`, 'success');
    } catch (err) {
      console.error('Failed to save settings:', err);
      this.showToast('❌ Failed to save group settings to server.', 'danger');
    }
  }


  // Yeh function Group Details wale modal ke andar naye button par chalega
  async openCreateStudentForGroup() {
    if (!this.selectedGroup) return;

    const modal = await this.modalCtrl.create({
      component: AddStudentModalComponent,
      cssClass: 'auto-fit-modal',
      componentProps: {
        // Modal ko bata rahe hain ki ye student kis group mein dalna hai
        targetGroupId: this.selectedGroup.id,
        targetGroupName: this.selectedGroup.name 
      }
    });

    await modal.present();

    const { data } = await modal.onDidDismiss();
    
    // Jab modal band hoga, toh UI update karenge
    if (data && data.refresh) {
      this.loadStudents(); // Individual list refresh
      this.loadBatches();  // Groups list refresh
      
      // Khule hue group modal me naya student immediately show karne ke liye
      if (data.newUsername && this.selectedGroup) {
        if (!this.selectedGroup.students) {
          this.selectedGroup.students = [];
        }
        if (!this.selectedGroup.students.includes(data.newUsername)) {
           this.selectedGroup.students.push(data.newUsername);
        }
      }
    }
  }

  // 🟢 Helper 1: Topic ki classes map me save karega
  async fetchClassesForSpecificTopic(topic: string) {
    if (!topic) return;
    try {
      const classes = await this.adminService.getClassesForTopic(topic);
      this.topicClassesMap[topic] = classes && classes.length > 0 ? classes : ['All'];
    } catch (err) {
      this.topicClassesMap[topic] = ['All'];
    }
  }

  // 🟢 Helper 2: Jab dropdown se Topic change ho tab yeh call hoga
  async onTopicSelectionChange(row: any) {
    if (!row.topic) return;
    
    // Naye chune hue topic ki classes mangwao
    await this.fetchClassesForSpecificTopic(row.topic);
    
    // Purani invalid class hato aur naye topic ki pehli class set karo
    const availableClasses = this.topicClassesMap[row.topic] || ['All'];
    if (!availableClasses.includes(row.className)) {
      row.className = availableClasses.length > 0 ? availableClasses[0] : 'All';
    }
  }

  // ============================================
  // AUTH & SESSION
  // ============================================
  logout() {
    sessionStorage.clear();
    localStorage.removeItem('token');
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_role');
    this.navCtrl.navigateRoot('/login');
  }

  // ============================================
  // FEEDBACK & TOAST
  // ============================================
  async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  showFeedback(message: string, type: 'success' | 'error' = 'success') {
    this.addFeedback = message;
    this.addFeedbackType = type;
    setTimeout(() => {
      this.addFeedback = '';
    }, 4000);
  }

  setMinDateTime() {
    const now = new Date();
    this.minDateTime = now.toISOString().slice(0, 16);
    this.minDateOnly = now.toISOString().split('T')[0];
  }

  // ============================================
  // STUDENT FILTER & MODALS
  // ============================================
  filterStudents() {
    if (!this.studentSearch) {
      this.filteredStudents = [...this.students];
      return;
    }
    const q = this.studentSearch.toLowerCase().trim();
    this.filteredStudents = this.students.filter(s =>
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.username && s.username.toLowerCase().includes(q)) ||
      (s.email && s.email.toLowerCase().includes(q))
    );
  }

  async filterByStudent(username: string, name?: string) {
    const modal = await this.modalCtrl.create({
      component: StudentDetailModalComponent,
      componentProps: { username, studentName: name || username }
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data === true || data?.deleted === true) {
      const deletedUser = data?.username || username;
      // Instant UI removal from students list
      this.students = this.students.filter(s => s.username !== deletedUser);
      this.filteredStudents = this.filteredStudents.filter(s => s.username !== deletedUser);
      this.filterStudents();

      // Instant UI removal from currently open group modal if any
      if (this.selectedGroup && Array.isArray(this.selectedGroup.students)) {
        this.selectedGroup.students = this.selectedGroup.students.filter((u: string) => u !== deletedUser);
      }

      // Also clean in groups list
      if (Array.isArray(this.groups)) {
        this.groups.forEach(g => {
          if (Array.isArray(g.students)) {
            g.students = g.students.filter((u: string) => u !== deletedUser);
          }
        });
      }

      // Auto-refresh from backend to ensure all batches and counts are synchronized
      await Promise.all([this.loadStudents(), this.loadBatches()]);
    }
  }

  openStudentProfileFromGroup(username: string, name?: string) {
    this.filterByStudent(username, name);
  }

  getStudentName(username: string): string {
    const s = this.students.find(st => st.username === username);
    return s?.name || username;
  }

  getStudentByUsername(username: string): Student | undefined {
    return this.students.find(st => st.username === username);
  }

  getGroupEnrolledStudents(group: any): string[] {
    if (!group || !Array.isArray(group.students)) return [];
    const validUsernames = new Set(this.students.map(s => s.username));
    return group.students.filter((u: string) => validUsernames.has(u));
  }

  // ============================================
  // SUBMISSIONS
  // ============================================
  async openSubmission(submission: Submission) {
    const modal = await this.modalCtrl.create({
      component: SubmissionModalComponent,
      componentProps: { submission }
    });
    await modal.present();
  }

  // ============================================
  // CATEGORIES & CLASSES
  // ============================================
  async loadAllCategories() {
    try {
      const cats = await this.adminService.getAllCategoriesStandalone().catch(() => []);
      const qCats = await this.adminService.getCategories().catch(() => []);
      const catSet = new Set<string>();
      if (Array.isArray(cats)) cats.forEach(c => c && catSet.add(c.trim()));
      if (Array.isArray(qCats)) qCats.forEach(c => c && catSet.add(c.trim()));
      (this.questions || []).forEach(q => {
        if (q && q.category && q.category.trim()) catSet.add(q.category.trim());
      });
      if (catSet.size === 0) catSet.add('General');
      this.allCategories = Array.from(catSet).sort();
      this.uniqueCategories = [...this.allCategories];
      this.filteredCategories = [...this.allCategories];
      this.filteredEditCategories = [...this.allCategories];
      this.refreshCategoryOptions();
    } catch (e) {
      console.error('Error loading categories:', e);
    }
  }

  async loadAllClasses() {
    try {
      const classes = await this.adminService.getAllClassesStandalone();
      this.allClasses = classes || [];
    } catch (e) {
      console.error('Error loading classes:', e);
    }
  }

  refreshCategoryOptions() {
    this.categoryOptions = this.allCategories.map(cat => ({
      value: cat,
      label: cat
    }));
  }

  filterCategories() {
    if (!this.categorySearchText) {
      this.filteredCategories = [...this.allCategories];
    } else {
      const q = this.categorySearchText.toLowerCase().trim();
      this.filteredCategories = this.allCategories.filter(c => c.toLowerCase().includes(q));
    }
  }

  selectCategory(category: string) {
    this.newQuestionCategory = category;
    this.showCategoryDropdown = false;
  }

  async addNewCategory() {
    if (!this.categorySearchText || !this.categorySearchText.trim()) return;
    const cat = this.categorySearchText.trim();
    try {
      await this.adminService.addCategoryStandalone(cat);
      if (!this.allCategories.includes(cat)) {
        this.allCategories.push(cat);
      }
      this.newQuestionCategory = cat;
      this.showCategoryDropdown = false;
      this.categorySearchText = '';
      this.refreshCategoryOptions();
      this.showToast(`Category "${cat}" added!`, 'success');
    } catch {
      this.newQuestionCategory = cat;
      this.showCategoryDropdown = false;
    }
  }

  filterEditCategories() {
    if (!this.categorySearchText) {
      this.filteredEditCategories = [...this.allCategories];
    } else {
      const q = this.categorySearchText.toLowerCase().trim();
      this.filteredEditCategories = this.allCategories.filter(c => c.toLowerCase().includes(q));
    }
  }

  selectEditCategory(category: string) {
    this.editQuestionCategory = category;
    this.showEditCategoryDropdown = false;
  }

  async addNewEditCategory() {
    if (!this.categorySearchText || !this.categorySearchText.trim()) return;
    const cat = this.categorySearchText.trim();
    try {
      await this.adminService.addCategoryStandalone(cat);
      if (!this.allCategories.includes(cat)) {
        this.allCategories.push(cat);
      }
      this.editQuestionCategory = cat;
      this.showEditCategoryDropdown = false;
      this.categorySearchText = '';
      this.refreshCategoryOptions();
      this.showToast(`Category "${cat}" added!`, 'success');
    } catch {
      this.editQuestionCategory = cat;
      this.showEditCategoryDropdown = false;
    }
  }

  get displayedRangeEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalQuestions);
  }

  // ============================================
  // VIDEO PLAYBACK
  // ============================================
  async playVideo(videoFile: string, studentName?: string) {
    const videoUrl = `${environment.apiUrl}/uploads/${videoFile}`;
    const modal = await this.modalCtrl.create({
      component: VideoModalComponent,
      componentProps: {
        videoUrl,
        videoTitle: `${studentName || 'Student'} - Exam Recording`
      }
    });
    await modal.present();
  }

  async playScreenVideo(videoFile: string, studentName?: string) {
    const videoUrl = `${environment.apiUrl}/uploads/${videoFile}`;
    const modal = await this.modalCtrl.create({
      component: VideoModalComponent,
      componentProps: {
        videoUrl,
        videoTitle: `${studentName || 'Student'} - Screen Recording`
      }
    });
    await modal.present();
  }

  // ============================================
  // BULK IMPORT
  // ============================================
  onStudentFileSelected(event: any) {
    const file = event.target?.files?.[0];
    if (file) {
      this.studentFile = file;
    }
  }

  onQuestionFileSelected(event: any) {
    const file = event.target?.files?.[0];
    if (file) {
      this.questionFile = file;
    }
  }

  downloadStudentTemplate() {
    this.adminService.downloadStudentTemplate();
  }

  downloadQuestionTemplate() {
    this.adminService.downloadQuestionTemplate();
  }

  async uploadStudents() {
    if (!this.studentFile) return;
    this.studentsUploading = true;
    try {
      const res = await this.adminService.bulkImportStudents(this.studentFile, this.sendEmailToStudents);
      this.importResult = res;
      this.showImportResult = true;
      this.studentFile = null;
      await this.loadStudents();
    } catch (e: any) {
      this.showToast(e?.error?.detail || 'Failed to upload students', 'danger');
    } finally {
      this.studentsUploading = false;
    }
  }

  async uploadQuestions() {
    if (!this.questionFile) return;
    this.questionsUploading = true;
    try {
      const res = await this.adminService.bulkImportQuestions(this.questionFile);
      this.importResult = res;
      this.showImportResult = true;
      this.questionFile = null;
      await this.loadQuestions();
      await this.loadAllCategories();
    } catch (e: any) {
      this.showToast(e?.error?.detail || 'Failed to upload questions', 'danger');
    } finally {
      this.questionsUploading = false;
    }
  }

  closeImportResult() {
    this.showImportResult = false;
    this.importResult = null;
  }

  // ============================================
  // LIVE EXAMS & TRACKING
  // ============================================
  async loadLiveExams() {
    try {
      const res = await this.adminService.getLiveExams();
      if (res && Array.isArray((res as any).exams)) {
        this.liveExams = (res as any).exams;
        this.liveExamsCount = (res as any).count ?? this.liveExams.length;
      } else if (Array.isArray(res)) {
        this.liveExams = res;
        this.liveExamsCount = res.length;
      } else {
        this.liveExams = [];
        this.liveExamsCount = 0;
      }
    } catch (e) {
      console.error('Error loading live exams:', e);
    }
  }

  startLiveExamsWebSocket() {
    try {
      if (this.liveExamsWs) {
        this.liveExamsWs.close();
      }
      this.liveExamsWs = new WebSocket(`${environment.wsUrl}/ws/admin/live-exams`);
      this.liveExamsWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.ngZone.run(() => {
            if (Array.isArray(data)) {
              this.liveExams = data;
              this.liveExamsCount = this.liveExams.length;
            } else if (data.liveExams) {
              this.liveExams = data.liveExams;
              this.liveExamsCount = this.liveExams.length;
            }
            this.cdr.detectChanges();
          });
        } catch {}
      };
      this.liveExamsWs.onerror = () => {};
      this.liveExamsWs.onclose = () => {
        this.liveExamsWs = null;
      };
    } catch (e) {
      console.error('WebSocket error:', e);
    }
  }

  stopLiveExamsWebSocket() {
    if (this.liveExamsWs) {
      this.liveExamsWs.close();
      this.liveExamsWs = null;
    }
    if (this.liveReconnectTimer) {
      clearTimeout(this.liveReconnectTimer);
      this.liveReconnectTimer = null;
    }
  }

  stopSmartLivePolling() {
    if (this.livePollingTimer) {
      clearInterval(this.livePollingTimer);
      this.livePollingTimer = null;
    }
  }

  formatTime(seconds: number): string {
    if (!seconds && seconds !== 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  async viewLiveExam(username: string) {
    const modal = await this.modalCtrl.create({
      component: LiveViewModalComponent,
      componentProps: { username }
    });
    await modal.present();
  }

  async viewLiveScreen(username: string) {
    const modal = await this.modalCtrl.create({
      component: LiveViewModalComponent,
      componentProps: { username }
    });
    await modal.present();
  }

  async viewProctoringLogs(username: string, studentName?: string) {
    const modal = await this.modalCtrl.create({
      component: ProctoringLogsModalComponent,
      componentProps: {
        username,
        studentName: studentName || username
      }
    });
    await modal.present();
  }

  // ============================================
  // BULK EMAIL & BULK SCHEDULE
  // ============================================
  toggleEmailSelection(username: string) {
    const idx = this.selectedStudentsForEmail.indexOf(username);
    if (idx > -1) {
      this.selectedStudentsForEmail.splice(idx, 1);
    } else {
      this.selectedStudentsForEmail.push(username);
    }
  }

  selectAllForEmail() {
    if (this.selectedStudentsForEmail.length === this.filteredStudents.length) {
      this.selectedStudentsForEmail = [];
    } else {
      this.selectedStudentsForEmail = this.filteredStudents.map(s => s.username);
    }
  }

  clearEmailSelection() {
    this.selectedStudentsForEmail = [];
  }

  openBulkEmailModal() {
    this.showBulkEmailModal = true;
  }

  closeBulkEmailModal() {
    this.showBulkEmailModal = false;
  }

  async sendBulkEmail() {
    if (this.selectedStudentsForEmail.length === 0) return;
    try {
      await this.adminService.scheduleBulkEmail(
        this.selectedStudentsForEmail,
        this.emailType,
        this.emailSubject,
        this.emailMessage
      );
      this.showToast(`Email sent to ${this.selectedStudentsForEmail.length} students!`, 'success');
      this.closeBulkEmailModal();
      this.clearEmailSelection();
    } catch (e) {
      this.showToast('Failed to send bulk email', 'danger');
    }
  }

  openBulkScheduleModal() {
    this.showBulkScheduleModal = true;
  }

  closeBulkScheduleModal() {
    this.showBulkScheduleModal = false;
  }

  async applyBulkScheduleToSelected() {
    if (!this.bulkScheduleStart || !this.bulkScheduleEnd || this.selectedStudentsForEmail.length === 0) return;
    this.bulkScheduleLoading = true;
    try {
      const topicsArr = this.bulkScheduleTopics ? this.bulkScheduleTopics.split(',').map(t => t.trim()).filter(Boolean) : [];
      await this.adminService.bulkSetTimetable(
        this.selectedStudentsForEmail,
        this.bulkScheduleStart,
        this.bulkScheduleEnd,
        topicsArr
      );
      if (this.bulkScheduleSendEmail) {
        await this.adminService.scheduleBulkEmail(
          this.selectedStudentsForEmail,
          'exam_reminder',
          'Exam Schedule Notification',
          `Your exam has been scheduled from ${this.bulkScheduleStart} to ${this.bulkScheduleEnd}. Topics: ${this.bulkScheduleTopics || 'All topics'}.`
        ).catch(() => null);
      }
      this.showToast(`Scheduled exam for ${this.selectedStudentsForEmail.length} students!`, 'success');
      this.closeBulkScheduleModal();
      this.clearEmailSelection();
    } catch (e) {
      this.showToast('Failed to apply schedule to selected students', 'danger');
    } finally {
      this.bulkScheduleLoading = false;
    }
  }

  // ============================================
  // GROUPS & BATCHES
  // ============================================
  async loadBatches() {
    try {
      const res = await this.adminService.getBatches();
      this.batches = res || [];
      this.groups = this.batches;
      if (this.selectedGroup) {
        this.selectedGroup = this.groups.find(g => g.id === this.selectedGroup.id) || this.selectedGroup;
      }
    } catch (e) {
      console.error('Error loading batches:', e);
    }
  }

  openCreateGroupModal() {
    this.groupName = '';
    this.showCreateGroupModal = true;
  }

  openCreateGroupFromSelectionModal() {
    this.groupName = '';
    this.showCreateBatchModal = true;
  }

  async createGroup() {
    if (!this.groupName || !this.groupName.trim()) return;
    try {
      await this.adminService.createBatch(this.groupName.trim(), [], []);
      this.showToast(`Group "${this.groupName.trim()}" created successfully!`, 'success');
      this.groupName = '';
      this.showCreateGroupModal = false;
      await this.loadBatches();
    } catch (e) {
      this.showToast('Failed to create group', 'danger');
    }
  }

  async createGroupFromSelection() {
    if (!this.groupName.trim() || this.selectedStudentsForEmail.length < 1) return;
    try {
      await this.adminService.createBatch(this.groupName.trim(), this.selectedStudentsForEmail, []);
      this.showToast(`Group "${this.groupName.trim()}" created with ${this.selectedStudentsForEmail.length} students!`, 'success');
      this.groupName = '';
      this.showCreateBatchModal = false;
      this.clearEmailSelection();
      await this.loadBatches();
    } catch (e) {
      this.showToast('Failed to create group from selection', 'danger');
    }
  }

  async deleteGroup(groupId: string | number, groupName?: string) {
    if (!confirm(`Are you sure you want to delete group "${groupName || groupId}"?`)) return;
    try {
      await this.adminService.deleteBatch(String(groupId));
      this.showToast('Group deleted successfully', 'success');
      this.showGroupDetailModal = false;
      if (this.selectedGroup && this.selectedGroup.id === groupId) {
        this.selectedGroup = null;
      }
      await this.loadBatches();
    } catch (e) {
      this.showToast('Failed to delete group', 'danger');
    }
  }

  openGroupDetail(group: any, tab: any = 'students') {
    this.selectedGroup = group;
    this.selectedBatch = group;
    this.activeGroupTab = tab;
    this.showGroupDetailModal = true;
    this.fetchGroupTimetable();
  }

  async fetchGroupTimetable() {
    if (!this.selectedGroup) return;
    try {
      if (this.selectedGroup.students && this.selectedGroup.students.length > 0) {
        const firstStudent = this.selectedGroup.students[0];
        const tt = await this.adminService.getTimetable(firstStudent);
        if (tt && tt.schedule) {
          this.selectedGroupTimetable = tt.schedule;
          return;
        }
      }
      this.selectedGroupTimetable = null;
    } catch {
      this.selectedGroupTimetable = null;
    }
  }

  formatScheduleDateTime(dateStr: string): string {
    if (!dateStr) return 'Not Scheduled';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return dateStr;
    }
  }

  onGroupImportFileSelected(event: any) {
    const file = event.target?.files?.[0];
    if (file) {
      this.groupImportFile = file;
    }
  }

  async importStudentsToGroup() {
    if (!this.selectedGroup || !this.groupImportFile) return;
    this.groupImporting = true;
    try {
      const res = await this.adminService.importStudentsToBatch(this.selectedGroup.id, this.groupImportFile);
      this.showToast(`Imported ${res?.added || 0} students to group!`, 'success');
      this.groupImportFile = null;
      await this.loadBatches();
      await this.loadStudents();
    } catch (e) {
      this.showToast('Failed to import students to group', 'danger');
    } finally {
      this.groupImporting = false;
    }
  }

  async removeStudentFromGroup(username: string) {
    if (!this.selectedGroup) return;
    if (!confirm(`Remove ${username} from ${this.selectedGroup.name}?`)) return;
    const batchId = this.selectedGroup.id;
    // Optimistic UI update
    if (this.selectedGroup && Array.isArray(this.selectedGroup.students)) {
      this.selectedGroup.students = this.selectedGroup.students.filter((u: string) => u !== username);
    }
    if (Array.isArray(this.groups)) {
      this.groups.forEach(g => {
        if (g.id === batchId && Array.isArray(g.students)) {
          g.students = g.students.filter((u: string) => u !== username);
        }
      });
    }
    try {
      await this.adminService.removeStudentFromBatch(batchId, username);
      this.showToast(`Removed ${username} from group`, 'success');
      await this.loadBatches();
    } catch (e) {
      this.showToast('Failed to remove student from group', 'danger');
      await this.loadBatches();
    }
  }

  async setTimetable() {
    await this.setTimetableStrict12Hour();
  }

  // ============================================
  // CHILD COMPONENT INTEGRATION HELPERS
  // ============================================
  get answerCounts(): Record<string, number> {
    const map: Record<string, number> = {};
    for (const s of this.submissions) {
      if (s.username) map[s.username] = (map[s.username] || 0) + 1;
    }
    return map;
  }

  get videoCounts(): Record<string, number> {
    const map: Record<string, number> = {};
    for (const s of this.submissions) {
      if (s.username && s.has_video) map[s.username] = (map[s.username] || 0) + 1;
    }
    return map;
  }

  get studentNames(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const st of this.students) {
      if (st.username) map[st.username] = st.name || st.username;
    }
    return map;
  }

  get studentNameMap(): Record<string, string> {
    return this.studentNames;
  }

  onSubmissionsFilterChange(f: { search: string; student: string; category: string }) {
    this.searchTerm = f.search;
    this.filterStudent = f.student;
    this.filterCategory = f.category;
    this.applyFilters();
  }

  async onAddQuestionFromComponent(data: { question: string; category: string; difficulty: string; keywords?: string }) {
    this.newQuestionText = data.question;
    this.newQuestionCategory = data.category;
    this.newQuestionDifficulty = data.difficulty;
    this.newQuestionKeywords = data.keywords || '';
    await this.addQuestion();
  }

  onQuestionFilterChange(filters: { category: string; difficulty: string }) {
    this.questionFilterCategory = filters.category;
    this.filterDifficulty = filters.difficulty;
    this.applyQuestionsFilters();
  }

  async onSaveEditQuestionFromModal(payload: { question: string; category: string; difficulty: string; keywords?: string }) {
    this.editQuestionText = payload.question;
    this.editQuestionCategory = payload.category;
    this.editQuestionDifficulty = payload.difficulty;
    this.editQuestionKeywords = payload.keywords || '';
    await this.saveEditQuestion();
  }

  async onSendBulkEmailFromModal(payload: { emailType: string; emailSubject: string; emailMessage: string }) {
    this.emailType = payload.emailType;
    this.emailSubject = payload.emailSubject;
    this.emailMessage = payload.emailMessage;
    await this.sendBulkEmail();
  }

  async onApplyBulkScheduleFromModal(payload: { bulkScheduleStart: string; bulkScheduleEnd: string; bulkScheduleTopics: string; bulkScheduleSendEmail: boolean }) {
    this.bulkScheduleStart = payload.bulkScheduleStart;
    this.bulkScheduleEnd = payload.bulkScheduleEnd;
    this.bulkScheduleTopics = payload.bulkScheduleTopics;
    this.bulkScheduleSendEmail = payload.bulkScheduleSendEmail;
    await this.applyBulkScheduleToSelected();
  }

  async onCreateGroupFromModal(name: string) {
    this.groupName = name;
    await this.createGroup();
  }

  async onCreateBatchGroupFromModal(name: string) {
    this.groupName = name;
    await this.createGroupFromSelection();
  }

  async onApplyGroupScheduleFromModal(payload: any) {
    this.groupStartDateOnly = payload.groupStartDateOnly;
    this.groupStartTimeOnly = payload.groupStartTimeOnly;
    this.groupStartAmPm = payload.groupStartAmPm;
    this.groupEndDateOnly = payload.groupEndDateOnly;
    this.groupEndTimeOnly = payload.groupEndTimeOnly;
    this.groupEndAmPm = payload.groupEndAmPm;
    this.groupScheduleMessage = payload.groupScheduleMessage;
    await this.applyGroupScheduleStrict12Hour();
  }

  async onSaveStudentTimetableFromModal(payload: any) {
    this.startDateOnly = payload.startDateOnly;
    this.startTimeOnly = payload.startTimeOnly;
    this.startAmPm = payload.startAmPm;
    this.endDateOnly = payload.endDateOnly;
    this.endTimeOnly = payload.endTimeOnly;
    this.endAmPm = payload.endAmPm;
    this.timetableTopics = payload.timetableTopics;
    await this.setTimetableStrict12Hour();
  }

  addClassToGroupDirect(cls: string) {
    if (cls && !this.groupSettings.selectedClasses.includes(cls)) {
      this.groupSettings.selectedClasses.push(cls);
      this.fetchCategoriesForClasses();
    }
  }

  async saveSettingsFromComponent(settings: any) {
    this.examSettings = settings;
    await this.saveSettings();
  }

}