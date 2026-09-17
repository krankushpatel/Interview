import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { IonicModule, NavController, ModalController, ToastController } from '@ionic/angular';
import { AdminService, Submission, Student, Question, ExamRecording, ScreenRecording } from '../../services/admin.service';
import { SubmissionModalComponent } from '../../components/submission-modal/submission-modal.component';
import { StudentDetailModalComponent } from '../../components/student-detail-modal/student-detail-modal.component';
import { VideoModalComponent } from '../../components/video-modal/video-modal.component';
import { AddStudentModalComponent } from '../../components/add-student-modal/add-student-modal.component';
import { LiveViewModalComponent } from '../../components/live-view-modal/live-view-modal.component';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ProctoringLogsModalComponent } from '../../components/proctoring-logs-modal/proctoring-logs-modal.component';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
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
  // GROUP SETTINGS PROPERTIES
  // ============================================
  // showGroupSettingsModal = false;
  // groupSettings: {
  //   allowTyping: boolean;
  //   topicDistribution: { topic: string; className: string; count: number }[]; // 🟢 'className' add kiya
  // } = {
  //   allowTyping: true,
  //   topicDistribution: []
  // };

  // ============================================
  // GROUP SETTINGS PROPERTIES
  // ============================================
  // showGroupSettingsModal = false;
  // groupSettings: {
  //   allowTyping: boolean;
  //   topicDistribution: { topic: string; className: string; l1: number; l2: number; l3: number }[]; // 🟢 Updated to l1, l2, l3
  // } = {
  //   allowTyping: true,
  //   topicDistribution: []
  // };

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
    private ngZone: NgZone
  ) {}

  // async ngOnInit() {
  //   // Global click listener for dropdown
  //   document.addEventListener('click', (event: any) => {
  //     const dropdown = document.querySelector('.custom-dropdown');
  //     if (dropdown && event.target && !dropdown.contains(event.target)) {
  //       this.showCategoryDropdown = false;
  //       this.showEditCategoryDropdown = false;
  //     }
  //   });

  //   const role = sessionStorage.getItem('role');
  //   if (role !== 'admin') {
  //     this.navCtrl.navigateRoot('/login');
  //     return;
  //   }
  //   this.adminName = sessionStorage.getItem('name') || 'Admin';
  //   this.adminAvatar = this.adminName.charAt(0).toUpperCase();
    
  //   await this.loadAllCategories();
  //   await this.refreshAll(false);
  //   await this.loadBatches();
    
  //   this.startLiveStudentPolling();
  //   this.setMinDateTime()
  // }

  private loadedViews = {
    submissions: false, // already loaded in ngOnInit
    students: false,    // already loaded in ngOnInit
    questions: false,   // already loaded in ngOnInit
    examvids: false,
    screenvids: false,
    sessionlogs: false
  };

  // async ngOnInit() {
  //   // Global click listener for dropdown
  //   document.addEventListener('click', (event: any) => {
  //     const dropdown = document.querySelector('.custom-dropdown');
  //     if (dropdown && event.target && !dropdown.contains(event.target)) {
  //       this.showCategoryDropdown = false;
  //       this.showEditCategoryDropdown = false;
  //     }
  //   });

  //   const role = sessionStorage.getItem('role');
  //   if (role !== 'admin') {
  //     this.navCtrl.navigateRoot('/login');
  //     return;
  //   }
  //   this.adminName = sessionStorage.getItem('name') || 'Admin';
  //   this.adminAvatar = this.adminName.charAt(0).toUpperCase();
    
  //   await this.loadAllCategories();
    
  //   // ✅ Overview ke liye required initial data load karo
  //   await this.loadStudents();
  //   await this.loadQuestions();
  //   await this.loadSubmissions();
  //   this.loadedViews.students = true;
  //   this.loadedViews.questions = true;
  //   this.loadedViews.submissions = true;

  //   await this.loadBatches();
    
  //   // this.startLiveStudentPolling();
  //   this.startSmartLivePolling();
  //   this.setMinDateTime();
  // }

  async ngOnInit() {
    // Global click listener for dropdown
    document.addEventListener('click', (event: any) => {
      const dropdown = document.querySelector('.custom-dropdown');
      if (dropdown && event.target && !dropdown.contains(event.target)) {
        this.showCategoryDropdown = false;
        this.showEditCategoryDropdown = false;
      }
    });

    const role = sessionStorage.getItem('role');
    if (role !== 'admin') {
      this.navCtrl.navigateRoot('/login');
      return;
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

  async setView(view: 'overview' | 'submissions' | 'students' | 'questions' | 'examvids' | 'screenvids' | 'sessionlogs' | 'bulkimport' | 'live' | 'settings') {
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

  // async setTimetableStrict12Hour() {
  //   if (!this.selectedStudentForTimetable) return;
  //   if (!this.startDateOnly || !this.startTimeOnly || !this.endDateOnly || !this.endTimeOnly) {
  //     this.showToast('Please select valid date and time', 'warning');
  //     return;
  //   }

  //   // Convert Date, Time, and AM/PM into 24-hour ISO string for backend
  //   const convertToISO = (dateStr: string, timeStr: string, ampm: string) => {
  //     let [hours, minutes] = timeStr.split(':').map(Number);
      
  //     if (ampm === 'PM' && hours < 12) hours += 12;
  //     if (ampm === 'AM' && hours === 12) hours = 0;
      
  //     const d = new Date(dateStr);
  //     d.setHours(hours, minutes, 0, 0);
  //     return d.toISOString();
  //   };

  //   try {
  //     this.timetableStart = convertToISO(this.startDateOnly, this.startTimeOnly, this.startAmPm);
  //     this.timetableEnd = convertToISO(this.endDateOnly, this.endTimeOnly, this.endAmPm);

  //     // Call existing setTimetable logic
  //     await this.setTimetable();
  //   } catch (e) {
  //     this.showToast('Invalid date/time selection', 'danger');
  //   }
  // }

  // =========================================================================
  // 2. INDIVIDUAL STUDENT SCHEDULE FIX (Taaki single student me bhi error na aaye)
  // =========================================================================
  async setTimetableStrict12Hour() {
    if (!this.selectedStudentForTimetable) return;
    
    if (!this.startDateOnly || !this.startTimeOnly || !this.endDateOnly || !this.endTimeOnly) {
      this.showToast('Please select valid date and time', 'warning');
      return;
    }

    // 🛠️ YAHAN HAI FIX: Create Naive Local ISO String (bina 'Z' ke)
    const convertToNaiveISO = (dateStr: string, timeStr: string, ampm: string) => {
      let [hours, minutes] = timeStr.split(':').map(Number);
      if (ampm === 'PM' && hours < 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      
      const pad = (num: number) => String(num).padStart(2, '0');
      return `${dateStr}T${pad(hours)}:${pad(minutes)}:00`;
    };

    try {
      this.timetableStart = convertToNaiveISO(this.startDateOnly, this.startTimeOnly, this.startAmPm);
      this.timetableEnd = convertToNaiveISO(this.endDateOnly, this.endTimeOnly, this.endAmPm);

      await this.setTimetable(); // Calls existing setTimetable logic
    } catch (e) {
      this.showToast('Invalid date/time selection', 'danger');
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

  // setView(view: 'overview' | 'submissions' | 'students' | 'questions' | 'examvids' | 'screenvids' | 'sessionlogs' | 'bulkimport' | 'live' | 'settings') {
  //   this.activeView = view;
  //   if (view === 'live') {
  //     this.loadLiveExams();
  //   }
  //   if (view === 'settings') {
  //     this.loadSettings();
  //   }
  //   if (window.innerWidth <= 768) {
  //     this.sidebarOpen = false;
  //   }
  //   this.cdr.markForCheck(); // Use markForCheck, not detectChanges
  // }

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
    this.editQuestionText = question.text;
    this.editQuestionCategory = question.category || 'General';
    this.editQuestionDifficulty = question.difficulty || 'Medium';
    this.showEditModal = true;
  }

  closeEditModal() {
    this.showEditModal = false;
    this.editQuestionId = null;
    this.editQuestionText = '';
    this.editQuestionCategory = '';
    this.editQuestionDifficulty = 'Medium';
  }

  loadUniqueCategories() {
    const cats = new Set<string>();
    this.questions.forEach(q => {
      if (q.category) cats.add(q.category);
    });
    this.allCategories.forEach(cat => cats.add(cat));
    this.uniqueCategories = Array.from(cats).sort();
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
    try {
      await this.adminService.updateQuestion(
        this.editQuestionId,
        this.editQuestionText,
        this.editQuestionCategory,
        this.editQuestionDifficulty
      );
      this.showToast('Question updated successfully!', 'success');
      this.closeEditModal();
      await this.loadQuestions();
      this.applyQuestionsFilters();
    } catch (err) {
      this.showToast('Failed to update question', 'danger');
    }
  }

  // get totalSubmissions() { return this.submissions.length; }
  // get activeStudentsCount() { return new Set(this.submissions.map(s => s.username)).size; }
  // get videosCount() { return this.recordings.length; }
  // get questionsCount() { return this.questions.length; }
  // get recentSubmissions() { return this.submissions.slice(0, 5); }
  // get latestRecordings() { return this.recordings.slice(0, 10); }

  // get studentActivity() {
  //   const map = new Map<string, { username: string; name: string; count: number }>();
  //   for (const s of this.submissions) {
  //     if (!map.has(s.username)) {
  //       map.set(s.username, { username: s.username, name: s.student_name, count: 0 });
  //     }
  //     map.get(s.username)!.count++;
  //   }
  //   return Array.from(map.values()).sort((a, b) => b.count - a.count);
  // }

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
    try {
      await this.adminService.addQuestion(
        this.newQuestionText.trim(),
        this.newQuestionCategory.trim() || 'General',
        this.newQuestionDifficulty
      );
      this.showFeedback('Question added successfully!', 'success');
      this.newQuestionText = '';
      this.newQuestionCategory = '';
      this.newQuestionDifficulty = 'Medium';
      await this.loadQuestions();
      await this.loadAllCategories();
      this.loadUniqueCategories();
      this.applyQuestionsFilters();
    } catch (err) {
      this.showFeedback('Failed to add question', 'error');
    }
  }

  async deleteQuestion(id: number) {
    if (!confirm(`Delete question #${id}? This cannot be undone.`)) return;
    try {
      await this.adminService.deleteQuestion(id);
      await this.loadQuestions();
      this.applyQuestionsFilters();
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

// ─── 1. Load Timetable (Updated for 12-Hour Format) ───
  // async loadTimetable(username: string) {
  //   try {
  //     const res = await this.adminService.getTimetable(username);
  //     this.currentTimetable = res;
      
  //     if (res && res.schedule) {
  //       // Agar pehle se schedule hai, toh usko parse karke fields mein daalo
  //       const startDate = new Date(res.schedule.start_time);
  //       const endDate = new Date(res.schedule.end_time);
  //       this.populate12HourFields(startDate, endDate);
        
  //       this.timetableTopics = res.schedule.topics?.join(', ') || '';
  //     } else {
  //       // Naya schedule hai toh current time set karo
  //       this.setInitialDates();
  //     }
  //   } catch (err) {
  //     this.currentTimetable = null;
  //     this.setInitialDates();
  //   }
  // }

  // ─── 1. Load Timetable (Smart Fallback ke sath) ───
  async loadTimetable(username: string) {
    try {
      const res = await this.adminService.getTimetable(username);
      this.currentTimetable = res;
      
      if (res && res.schedule) {
        // Agar pehle se schedule hai, toh usko parse karke fields mein daalo
        const startDate = new Date(res.schedule.start_time);
        const endDate = new Date(res.schedule.end_time);
        this.populate12HourFields(startDate, endDate);
        
        this.timetableTopics = res.schedule.topics?.join(', ') || '';
      } else {
        // Naya schedule hai toh current time set karo
        this.setInitialDates();
        // 🟢 FIX: Agar schedule nahi hai, toh bachhe ki profile se assigned topics utha kar auto-fill karo!
        await this.fetchStudentCategoriesForFallback(username);
      }
    } catch (err) {
      this.currentTimetable = null;
      this.setInitialDates();
      // 🟢 FIX: Error aane par bhi profile se topics uthao
      await this.fetchStudentCategoriesForFallback(username);
    }
  }

  // ─── NEW HELPER: Profile se topics uthane ke liye ───
  async fetchStudentCategoriesForFallback(username: string) {
    try {
      const status = await this.adminService.getAttemptStatus(username);
      if (status && status.preferred_categories && status.preferred_categories.length > 0) {
        // Backend mein jo auto-assign hue the, wo yahan text box mein bhar jayenge
        this.timetableTopics = status.preferred_categories.join(', ');
      } else {
        this.timetableTopics = '';
      }
    } catch (e) {
      this.timetableTopics = '';
    }
  }

  // ─── 2. Initial Dates Helper ───
  setInitialDates() {
    const now = new Date();
    // End time ko 1 ghanta aage set karte hain
    const end = new Date(now.getTime() + 60 * 60 * 1000); 
    this.populate12HourFields(now, end);
    this.timetableTopics = '';
  }

  // ─── 3. NEW HELPER: Date object ko 12-Hour UI Variables mein split karne ke liye ───
  // populate12HourFields(start: Date, end: Date) {
  //   const formatDate = (d: Date) => {
  //     const y = d.getFullYear();
  //     const m = String(d.getMonth() + 1).padStart(2, '0');
  //     const day = String(d.getDate()).padStart(2, '0');
  //     return `${y}-${m}-${day}`;
  //   };

  //   const formatTime12 = (d: Date) => {
  //     let h = d.getHours();
  //     const m = String(d.getMinutes()).padStart(2, '0');
  //     const ampm = h >= 12 ? 'PM' : 'AM';
  //     h = h % 12;
  //     if (h === 0) h = 12; // 12 AM / 12 PM handle karne ke liye
  //     const hStr = String(h).padStart(2, '0');
  //     return { time: `${hStr}:${m}`, ampm };
  //   };

  //   // Set Start Fields
  //   this.startDateOnly = formatDate(start);
  //   const startT = formatTime12(start);
  //   this.startTimeOnly = startT.time;
  //   this.startAmPm = startT.ampm;

  //   // Set End Fields
  //   this.endDateOnly = formatDate(end);
  //   const endT = formatTime12(end);
  //   this.endTimeOnly = endT.time;
  //   this.endAmPm = endT.ampm;
  // }

  populate12HourFields(start: Date, end: Date) {
    const formatDate = (d: Date) => {
      // Strictly YYYY-MM-DD format for HTML5 <input type="date">
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const formatTime12 = (d: Date) => {
      let h = d.getHours();
      const m = String(d.getMinutes()).padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12;
      if (h === 0) h = 12; 
      const hStr = String(h).padStart(2, '0');
      return { time: `${hStr}:${m}`, ampm };
    };

    // Set Start Fields
    this.startDateOnly = formatDate(start);
    const startT = formatTime12(start);
    this.startTimeOnly = startT.time;
    this.startAmPm = startT.ampm;

    // Set End Fields
    this.endDateOnly = formatDate(end);
    const endT = formatTime12(end);
    this.endTimeOnly = endT.time;
    this.endAmPm = endT.ampm;
  }

async setTimetable() {
    if (!this.selectedStudentForTimetable) return;
    
    if (!this.timetableStart || !this.timetableEnd) {
      this.showToast('Please select both start and end time', 'warning');
      return;
    }
    
    const now = new Date();
    const startDate = new Date(this.timetableStart);
    const endDate = new Date(this.timetableEnd);
    
    if (startDate < now) {
      this.showToast('Start time cannot be in the past!', 'warning');
      return;
    }
    
    if (endDate <= startDate) {
      this.showToast('End time must be after start time', 'warning');
      return;
    }
    
    // 👇 LOADING START
    this.timetableSaving = true; 
    
    // Ab topics ki jagah plain message/instructions bhej rahe hain
    const message = this.timetableTopics ? this.timetableTopics.trim() : '';
    
    try {
      await this.adminService.setTimetable(
        this.selectedStudentForTimetable,
        this.timetableStart,
        this.timetableEnd,
        [message] // ✅ Yahan string ki jagah array pass kar diya hai
      );
      this.showToast('Timetable saved successfully', 'success');
      await this.loadTimetable(this.selectedStudentForTimetable);
      
      this.showTimetableModal = false; 

    } catch (err) {
      this.showToast('Failed to save timetable', 'danger');
    } finally {
      // 👇 LOADING STOP
      this.timetableSaving = false; 
    }
  }

  // Helper method to convert datetime-local string to ISO (if needed)
  private timestampToISO(datetimeLocal: string): string {
    // datetime-local returns "YYYY-MM-DDThh:mm"
    return new Date(datetimeLocal).toISOString();
  }

  async deleteTimetable() {
    if (!this.selectedStudentForTimetable) return;
    try {
      await this.adminService.deleteTimetable(this.selectedStudentForTimetable);
      this.currentTimetable = null;
      this.timetableStart = '';
      this.timetableEnd = '';
      this.timetableTopics = '';
      this.showToast('Timetable deleted successfully', 'success');
    } catch (err) {
      this.showToast('Failed to delete timetable', 'danger');
    }
  }

  // group ke schedule ko fetch karega
  async fetchGroupTimetable() {
    this.selectedGroupTimetable = null;
    if (this.selectedGroup && this.selectedGroup.students && this.selectedGroup.students.length > 0) {
      try {
        // Group ke pehle student ka timetable fetch karte hain
        const res = await this.adminService.getTimetable(this.selectedGroup.students[0]);
        if (res && res.schedule) {
          this.selectedGroupTimetable = res.schedule;
        }
      } catch (err) {
        console.warn('Failed to fetch group timetable', err);
      }
    }
  }

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

  async showToast(message: string, color: string = 'danger') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      position: 'bottom',
      color,
      buttons: [{ text: 'OK', role: 'cancel' }]
    });
    await toast.present();
  }

  showFeedback(msg: string, type: 'success' | 'error') {
    this.addFeedback = msg;
    this.addFeedbackType = type;
    setTimeout(() => this.addFeedback = '', 5000);
  }

  async openSubmission(submission: Submission) {
    const modal = await this.modalCtrl.create({
      component: SubmissionModalComponent,
      componentProps: { submission }
    });
    await modal.present();
  }

  async filterByStudent(username: string, studentName: string) {
    try {
      const modal = await this.modalCtrl.create({
        component: StudentDetailModalComponent,
        componentProps: { username, studentName }
      });
      await modal.present();
      const { data } = await modal.onDidDismiss();
      if (data === true) {
        await this.loadStudents();
        await this.loadSubmissions();
        await this.loadRecordings();
        await this.loadScreenRecordings();
        this.applyFilters();
      }
    } catch (err) {
      console.error('[ERROR] Failed to open modal:', err);
    }
  }

  async playVideo(filename: string, studentName: string) {
    const videoUrl = `${environment.apiUrl}/uploads/${filename}`;
    const modal = await this.modalCtrl.create({
      component: VideoModalComponent,
      componentProps: { videoUrl, videoTitle: `${studentName}'s Exam Recording` }
    });
    await modal.present();
  }

  async playScreenVideo(filename: string, studentName: string) {
    const videoUrl = `${environment.apiUrl}/uploads/${filename}`;
    const modal = await this.modalCtrl.create({
      component: VideoModalComponent,
      componentProps: { videoUrl, videoTitle: `${studentName}'s Screen Recording` }
    });
    await modal.present();
  }

  getCategoryOptions() {
    const cats = new Set(this.submissions.map(s => s.question_category));
    return Array.from(cats).map(c => ({ value: c, label: c }));
  }

  // ============================================
  // BATCH MANAGEMENT METHODS
  // ============================================

  async loadBatches() {
    try {
      const res = await this.adminService.getBatches();
      this.batches = (res || []).map((b: any) => ({
        ...b,
        students: Array.isArray(b?.students) ? b.students : []
      }));
      this.groups = this.batches;
    } catch (err) {
      this.batches = [];
      this.groups = [];
    }
  }

  openCreateBatchModal() {
    if (this.selectedStudentsForEmail.length < 1) {
      this.showToast('Please select at least 1 student', 'warning');
      return;
    }
    this.batchName = '';
    this.batchTopics = '';
    this.showCreateBatchModal = true;
  }

  async createBatch() {
    if (!this.batchName.trim()) {
      this.showToast('Batch name is required', 'warning');
      return;
    }
    const topics = this.batchTopics.split(',').map(t => t.trim()).filter(t => t);
    try {
      await this.adminService.createBatch(
        this.batchName.trim(),
        this.selectedStudentsForEmail,
        topics
      );
      this.showToast(`Batch "${this.batchName}" created with ${this.selectedStudentsForEmail.length} students!`, 'success');
      this.showCreateBatchModal = false;
      this.clearEmailSelection();
      this.studentSubView = 'groups';   // Automatically batches tab pe le jao
      await this.loadBatches();
    } catch (err) {
      this.showToast('Failed to create batch', 'danger');
    }
  }

  openBatchScheduleModal(batch: any) {
    this.selectedBatch = batch;
    this.batchScheduleStart = '';
    this.batchScheduleEnd = '';
    // Batch ke default topics pre-fill kar do
    this.batchScheduleTopics = (batch.topics || []).join(', ');
    this.showBatchScheduleModal = true;
  }

  async applyBatchSchedule() {
    if (!this.selectedBatch) return;
    if (!this.batchScheduleStart || !this.batchScheduleEnd) {
      this.showToast('Start and End time are required!', 'warning');
      return;
    }

    const now = new Date();
    const startDate = new Date(this.batchScheduleStart);
    const endDate = new Date(this.batchScheduleEnd);

    if (startDate < now) {
      this.showToast('Start time cannot be in the past!', 'warning');
      return;
    }
    if (endDate <= startDate) {
      this.showToast('End time must be after start time', 'warning');
      return;
    }

    this.batchScheduleLoading = true;
    const topics = this.batchScheduleTopics.split(',').map(t => t.trim()).filter(t => t);

    try {
      const result = await this.adminService.batchBulkSchedule(
        this.selectedBatch.id,
        this.batchScheduleStart,
        this.batchScheduleEnd,
        topics
      );
      this.showToast(
        `Schedule applied to ${result.success_count} / ${result.total} students in "${this.selectedBatch.name}"!`,
        'success'
      );
      this.showBatchScheduleModal = false;
      await this.loadBatches();  // last_scheduled_at update karo
    } catch (err) {
      this.showToast('Failed to apply batch schedule', 'danger');
    } finally {
      this.batchScheduleLoading = false;
    }
  }

  async deleteBatch(batchId: string) {
    if (!confirm('Delete this batch? Students will NOT be removed, only the batch grouping.')) return;
    try {
      await this.adminService.deleteBatch(batchId);
      this.showToast('Batch deleted', 'success');
      await this.loadBatches();
    } catch (err) {
      this.showToast('Failed to delete batch', 'danger');
    }
  }

  // logout() {
  //   if (this.refreshTimer) clearTimeout(this.refreshTimer);
  //   this.stopSmartLivePolling();
  //   // this.stopLiveStudentPolling();
  //   // this.stopLiveTracking();
  //   sessionStorage.clear();
  //   this.navCtrl.navigateRoot('/login');
  // }


    logout() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    
    if (this.liveExamsWs) {
      this.liveExamsWs.close();
      this.liveExamsWs = null;
    }
    
    sessionStorage.clear();
    this.navCtrl.navigateRoot('/login');
  }

  // ============================================
  // BULK IMPORT METHODS
  // ============================================

  onStudentFileSelected(event: any) {
    this.studentFile = event.target.files[0];
  }

  onQuestionFileSelected(event: any) {
    this.questionFile = event.target.files[0];
  }

  async uploadStudents() {
    if (!this.studentFile) return;
    this.studentsUploading = true;
    this.showImportResult = false; // Purana result hide karein

    try {
      // 1. API hit karo, backend job start karega aur job_id dega
      const response = await this.adminService.bulkImportStudents(this.studentFile, this.sendEmailToStudents);

      if (response.job_id) {
        // 2. Job start ho gayi, ab polling shuru karo
        this.pollImportStatus(response.job_id);
      } else {
        // Safe fallback (agar backend update na hua ho)
        this.handleImportCompletion(response);
      }
    } catch (err: any) {
      this.showToast(err.error?.error || 'Failed to start import', 'danger');
      this.studentsUploading = false;
    }
  }

  // Naya method polling ke liye
  pollImportStatus(jobId: string) {
    this.importPollingInterval = setInterval(async () => {
      try {
        const statusRes = await this.adminService.getBulkImportStatus(jobId);

        if (statusRes.status === 'completed') {
          // Job complete ho gayi!
          clearInterval(this.importPollingInterval);
          this.handleImportCompletion(statusRes.result);
        } else if (statusRes.status === 'failed') {
          // Backend par koi fat gaya
          clearInterval(this.importPollingInterval);
          this.showToast(statusRes.error || 'Import failed during processing', 'danger');
          this.studentsUploading = false;
          this.studentFile = null;
        }
        // Agar status 'processing' hai, toh kuch mat karo, agli baar phir check hoga
      } catch (err) {
        console.error('Error polling status', err);
        clearInterval(this.importPollingInterval);
        this.showToast('Lost connection to server while checking status', 'danger');
        this.studentsUploading = false;
      }
    }, 3000); // Har 3 second (3000ms) mein status check karega
  }

  // Naya method success handle karne ke liye (Taki Refresh ka error import ko blame na kare)
  async handleImportCompletion(result: any) {
    this.studentsUploading = false;
    this.importResult = result;
    this.showImportResult = true;
    this.studentFile = null;

    if (result && result.created > 0) {
      try {
        // Alag try-catch me rakha hai, taaki list refresh ka fail hona import success ko overwrite na kare
        await this.loadStudents();
        await this.refreshAll(false);
      } catch (err) {
        console.warn('Import succeeded, but data refresh failed:', err);
        this.showToast('Import successful, but failed to auto-refresh list. Please click refresh.', 'warning');
      }
    }
  }

  async uploadQuestions() {
    if (!this.questionFile) return;
    this.questionsUploading = true;
    try {
      const result = await this.adminService.bulkImportQuestions(this.questionFile);
      this.importResult = result;
      this.showImportResult = true;
      this.questionFile = null;
      if (result.created > 0) {
        await this.loadQuestions();
        await this.loadAllCategories();
        this.loadUniqueCategories();
        this.refreshCategoryOptions(); 
      }
    } catch (err: any) {
      this.showToast(err.error?.error || 'Failed to import questions', 'danger');
    } finally {
      this.questionsUploading = false;
    }
  }

  async downloadStudentTemplate() {
      try {
        await this.adminService.downloadStudentTemplate();
      } catch (error) {
        console.error('Failed to download student template:', error);
        this.showToast('Failed to download template', 'danger');
      }
    }

    async downloadQuestionTemplate() {
      try {
        await this.adminService.downloadQuestionTemplate();
      } catch (error) {
        console.error('Failed to download question template:', error);
        this.showToast('Failed to download template', 'danger');
      }
    }

  closeImportResult() {
    this.showImportResult = false;
    this.importResult = null;
  }

  // ============================================
  // CATEGORY METHODS
  // ============================================

  async loadAllCategories() {
    try {
      this.allCategories = await this.adminService.getAllCategoriesStandalone(); 
      this.filteredCategories = [...this.allCategories];
      this.filteredEditCategories = [...this.allCategories];
    } catch (err) {
      console.error('Failed to load categories', err);
      this.allCategories = [];
      this.filteredCategories = [];
      this.filteredEditCategories = [];
    }
  }

  async loadAllClasses() {
    try {
      this.allClasses = await this.adminService.getAllClassesStandalone();
    } catch (err) {
      console.error('Failed to load classes', err);
      this.allClasses = ['All'];
    }
  }

  filterCategories() {
    this.showCategoryDropdown = true; 
    if (!this.categorySearchText || this.categorySearchText.trim() === '') {
      this.filteredCategories = [...this.allCategories];
    } else {
      const search = this.categorySearchText.toLowerCase().trim();
      this.filteredCategories = this.allCategories.filter(cat => 
        cat.toLowerCase().startsWith(search)
      ).sort();
    }
  }

  selectCategory(category: string) {
    this.newQuestionCategory = category;
    this.categorySearchText = category;
    this.showCategoryDropdown = false;
  }

  async addNewCategory() {
    if (!this.categorySearchText || this.categorySearchText.trim() === '') return;
    const newCat = this.categorySearchText.trim();
    const exists = this.allCategories.some(cat => cat.toLowerCase() === newCat.toLowerCase());
    if (exists) {
      const existingCat = this.allCategories.find(cat => cat.toLowerCase() === newCat.toLowerCase());
      if (existingCat) this.selectCategory(existingCat);
      this.showToast(`Category "${existingCat}" already exists`, 'warning');
      return;
    }
    try {
      await this.adminService.addCategoryStandalone(newCat);
      this.newQuestionCategory = newCat;
      this.categorySearchText = '';
      this.showCategoryDropdown = false;
      await this.loadAllCategories();
      this.loadUniqueCategories();
      this.showToast(`New category "${newCat}" added permanently`, 'success');
    } catch (err) {
      this.showToast('Failed to add category', 'danger');
    }
  }

  toggleCategoryDropdown() {
    this.filteredCategories = [...this.allCategories];
    this.showCategoryDropdown = !this.showCategoryDropdown;
  }

  filterEditCategories() {
    this.showEditCategoryDropdown = true;
    if (!this.editQuestionCategory || this.editQuestionCategory.trim() === '') {
      this.filteredEditCategories = [...this.allCategories];
    } else {
      const search = this.editQuestionCategory.toLowerCase().trim();
      this.filteredEditCategories = this.allCategories.filter(cat => 
        cat.toLowerCase().startsWith(search)
      ).sort();
    }
  }

  selectEditCategory(category: string) {
    this.editQuestionCategory = category;
    this.showEditCategoryDropdown = false;
  }

  async addNewEditCategory() {
    if (!this.editQuestionCategory || this.editQuestionCategory.trim() === '') return;
    const newCat = this.editQuestionCategory.trim();
    const exists = this.allCategories.some(cat => cat.toLowerCase() === newCat.toLowerCase());
    if (exists) {
      const existingCat = this.allCategories.find(cat => cat.toLowerCase() === newCat.toLowerCase());
      if (existingCat) this.selectEditCategory(existingCat);
      this.showToast(`Category "${existingCat}" already exists`, 'warning');
      return;
    }
    try {
      await this.adminService.addCategoryStandalone(newCat);
      await this.loadAllCategories();
      this.loadUniqueCategories();
      this.selectEditCategory(newCat);
      this.showToast(`New category "${newCat}" added`, 'success');
    } catch (err) {
      this.showToast('Failed to add category', 'danger');
    }
  }

  // ============================================
  // LIVE STUDENT POLLING (Optimized)
  // ============================================

  // private startLiveStudentPolling() {
  //   this.ngZone.runOutsideAngular(() => {
  //     this.livePollingTimer = setInterval(async () => {
  //       if (this.activeView === 'students' || this.activeView === 'live') {
  //         await this.fetchLiveStudentsStatus();
  //         this.ngZone.run(() => {
  //           this.syncLiveStatusToStudents();
  //         });
  //       }
  //     }, 3000);
  //   });
  // }

  private syncLiveStatusToStudents() {
    if (this.isUpdatingLiveStatus) return;
    this.isUpdatingLiveStatus = true;

    let changed = false;
    // Update main students array
    for (let student of this.students) {
      const newLive = this.liveStudentMap.has(student.username);
      if (student.isLive !== newLive) {
        student.isLive = newLive;
        changed = true;
      }
    }
    // Update filteredStudents similarly
    for (let student of this.filteredStudents) {
      const newLive = this.liveStudentMap.has(student.username);
      if (student.isLive !== newLive) {
        student.isLive = newLive;
        changed = true;
      }
    }

    if (changed) {
      this.cdr.markForCheck();
    }
    this.isUpdatingLiveStatus = false;
  }

  // private stopLiveStudentPolling() {
  //   if (this.livePollingTimer) {
  //     clearInterval(this.livePollingTimer);
  //     this.livePollingTimer = null;
  //   }
  // }

  // ============================================
  // 🚀 REAL-TIME WEBSOCKET (Live Exams & Activity)
  // ============================================

  private stopSmartLivePolling() {
    if (this.livePollingTimer) {
      clearInterval(this.livePollingTimer);
      this.livePollingTimer = null;
    }
  }

  private stopLiveExamsWebSocket() {
    if (this.liveReconnectTimer) {
      clearTimeout(this.liveReconnectTimer);
      this.liveReconnectTimer = null;
    }
    if (this.liveExamsWs) {
      this.liveExamsWs.onopen = null;
      this.liveExamsWs.onmessage = null;
      this.liveExamsWs.onerror = null;
      this.liveExamsWs.onclose = null;
      try {
        this.liveExamsWs.close();
      } catch {}
      this.liveExamsWs = null;
    }
    this.stopSmartLivePolling();
  }

  private startLiveExamsWebSocket() {
    if (this.isDestroyed) return;
    // Sirf tabhi connect rakho jab Students ya Live tab active ho
    if (this.activeView !== 'students' && this.activeView !== 'live') {
      this.stopLiveExamsWebSocket();
      return;
    }

    if (this.liveExamsWs && (this.liveExamsWs.readyState === WebSocket.OPEN || this.liveExamsWs.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // Stop any periodic polling to avoid redundant server load
    this.stopSmartLivePolling();

    this.ngZone.runOutsideAngular(() => {
      let wsBase = '';
      if (environment.wsUrl) {
        wsBase = environment.wsUrl.replace(/\/+$/, '');
      } else if (environment.apiUrl && environment.apiUrl.startsWith('http')) {
        wsBase = environment.apiUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://').replace(/\/+$/, '');
      } else {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsBase = `${protocol}//${window.location.host}`;
      }
      
      const token = localStorage.getItem('admin_token') || 'admin';

      try {
        this.stopLiveExamsWebSocket();
        const socket = new WebSocket(`${wsBase}/ws/admin/live-exams?token=${encodeURIComponent(token)}`);
        this.liveExamsWs = socket;

        socket.onopen = () => {
          console.log('[LIVE WS] Connected to live-exams WebSocket. Real-time active.');
          this.stopSmartLivePolling();
        };

        socket.onmessage = (event) => {
          try {
            const result = JSON.parse(event.data);
            this.ngZone.run(() => {
              this.liveExams = result?.exams || [];
              this.liveExamsCount = result?.count || 0;
              this.totalQuestionsAnswered = this.liveExams.reduce((sum: number, exam: any) => sum + (exam.answered_count || 0), 0);

              const newMap = new Map<string, boolean>();
              if (result?.exams && result.exams.length) {
                for (const exam of result.exams) {
                  if (exam.username) newMap.set(exam.username, true);
                }
              }
              this.liveStudentMap = newMap;
              this.syncLiveStatusToStudents();
              this.cdr.markForCheck();
            });
          } catch (err) {
            console.warn('[LIVE WS] Error parsing message:', err);
          }
        };

        socket.onerror = () => {
          // Graceful one-time fallback without continuous polling spam
          this.ngZone.run(() => {
            if (this.activeView === 'live') {
              this.loadLiveExams();
            }
          });
        };

        socket.onclose = () => {
          this.liveExamsWs = null;
          // Reconnect with relaxed 15-second interval only if still on Live or Students tab
          if (!this.isDestroyed && (this.activeView === 'students' || this.activeView === 'live')) {
            if (this.liveReconnectTimer) clearTimeout(this.liveReconnectTimer);
            this.liveReconnectTimer = setTimeout(() => {
              this.startLiveExamsWebSocket();
            }, 15000);
          }
        };
      } catch (err) {
        console.warn('[LIVE WS] Failed to create WebSocket:', err);
      }
    });
  }

  private async fetchLiveStudentsStatus() {
    try {
      const result = await this.adminService.getLiveExams();
      const newMap = new Map<string, boolean>();
      if (result.exams && result.exams.length) {
        for (const exam of result.exams) {
          if (exam.username) newMap.set(exam.username, true);
        }
      }
      this.liveStudentMap = newMap;
    } catch (err) {
      console.error('Failed to fetch live exams', err);
    }
  }

  // ============================================
  // LIVE TRACKING (Tab)
  // ============================================

  async loadLiveExams() {
    try {
      const result = await this.adminService.getLiveExams();
      this.liveExams = result.exams || [];
      this.liveExamsCount = result.count || 0;
      this.totalQuestionsAnswered = this.liveExams.reduce((sum, exam) => sum + (exam.answered_count || 0), 0);
    } catch (err) {
      console.error('Failed to load live exams', err);
    }
  }

  // startLiveTracking() {
  //   if (this.liveTrackingInterval) clearInterval(this.liveTrackingInterval);
  //   this.liveTrackingInterval = setInterval(() => {
  //     if (this.activeView === 'live') this.loadLiveExams();
  //   }, 3000);
  // }

  // stopLiveTracking() {
  //   if (this.liveTrackingInterval) {
  //     clearInterval(this.liveTrackingInterval);
  //     this.liveTrackingInterval = null;
  //   }
  // }

  viewLiveExam(username: string) {
    console.log('View live exam:', username);
  }

  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // ============================================
  // BULK EMAIL & SELECTION
  // ============================================

  toggleEmailSelection(username: string) {
    const index = this.selectedStudentsForEmail.indexOf(username);
    if (index > -1) {
      this.selectedStudentsForEmail.splice(index, 1);
    } else {
      this.selectedStudentsForEmail.push(username);
    }
  }

  selectAllForEmail() {
    if (this.selectedStudentsForEmail.length === this.students.length) {
      this.selectedStudentsForEmail = [];
    } else {
      this.selectedStudentsForEmail = this.students.map(s => s.username);
    }
  }

  filterStudents() {
    if (!this.studentSearch) {
      this.filteredStudents = [...this.students];
    } else {
      const term = this.studentSearch.toLowerCase();
      this.filteredStudents = this.students.filter(s =>
        s.name.toLowerCase().includes(term) ||
        s.username.toLowerCase().includes(term) ||
        (s.email && s.email.toLowerCase().includes(term))
      );
    }
    this.filteredStudents = this.filteredStudents.map(s => ({
      ...s,
      isLive: this.liveStudentMap.has(s.username)
    }));
  }

  clearEmailSelection() {
    this.selectedStudentsForEmail = [];
  }

  openBulkEmailModal() {
    if (this.selectedStudentsForEmail.length === 0) return;
    this.showBulkEmailModal = true;
  }

  closeBulkEmailModal() {
    this.showBulkEmailModal = false;
    this.emailSubject = '';
    this.emailMessage = '';
  }

  async sendBulkEmail() {
    if (this.selectedStudentsForEmail.length === 0) {
      this.showToast('No students selected', 'warning');
      return;
    }
    if (this.emailType === 'custom' && !this.emailMessage) {
      this.showToast('Please enter a message', 'warning');
      return;
    }
    try {
      const result = await this.adminService.scheduleBulkEmail(
        this.selectedStudentsForEmail,
        this.emailSubject || 'Message from AI Interview Platform',
        this.emailMessage,
        this.emailType
      );
      this.showToast(`Email sent to ${result.success.length} students`, 'success');
      this.closeBulkEmailModal();
      this.clearEmailSelection();
      if (result.failed.length > 0) {
        console.log('Failed emails:', result.failed_list);
      }
    } catch (err) {
      this.showToast('Failed to send emails', 'danger');
    }
  }

  async applyBulkSchedule() {
    if (!this.bulkScheduleStart || !this.bulkScheduleEnd) {
      this.showToast('Start and End time are required!', 'warning');
      return;
    }
    
    const now = new Date();
    const startDate = new Date(this.bulkScheduleStart);
    const endDate = new Date(this.bulkScheduleEnd);
    
    // ✅ Past date validation
    if (startDate < now) {
      this.showToast('Start time cannot be in the past!', 'warning');
      return;
    }
    
    if (endDate <= startDate) {
      this.showToast('End time must be after start time', 'warning');
      return;
    }
    
    const allUsernames = this.students.map(s => s.username);
    if (allUsernames.length === 0) {
      this.showToast('No students available to schedule', 'warning');
      return;
    }
    
    const topicsArray = this.bulkScheduleTopics.split(',').map(t => t.trim()).filter(t => t);
    try {
      await this.adminService.bulkSetTimetable(
        allUsernames,
        this.bulkScheduleStart,
        this.bulkScheduleEnd,
        topicsArray
      );
      this.showToast(`Schedule successfully applied to ${allUsernames.length} students!`, 'success');
      this.bulkScheduleStart = '';
      this.bulkScheduleEnd = '';
      this.bulkScheduleTopics = '';
    } catch (err) {
      this.showToast('Failed to apply bulk schedule', 'danger');
    }
  }

  async viewLiveScreen(username: string) {
    const student = this.students.find(s => s.username === username);
    const studentName = student?.name || username;
    const modal = await this.modalCtrl.create({
      component: LiveViewModalComponent,
      componentProps: { username: username, studentName: studentName }
    });
    await modal.present();
  }

  openBulkScheduleModal() {
    if (this.selectedStudentsForEmail.length === 0) {
      this.showToast('Please select at least one student', 'warning');
      return;
    }
    this.showBulkScheduleModal = true;
  }

  closeBulkScheduleModal() {
    this.showBulkScheduleModal = false;
  }

  async applyBulkScheduleToSelected() {
    if (!this.bulkScheduleStart || !this.bulkScheduleEnd) {
      this.showToast('Start and End time are required!', 'warning');
      return;
    }
    
    const now = new Date();
    const startDate = new Date(this.bulkScheduleStart);
    const endDate = new Date(this.bulkScheduleEnd);
    
    // ✅ Past date validation
    if (startDate < now) {
      this.showToast('Start time cannot be in the past!', 'warning');
      return;
    }
    
    if (endDate <= startDate) {
      this.showToast('End time must be after start time', 'warning');
      return;
    }
    
    const topicsArray = this.bulkScheduleTopics.split(',').map(t => t.trim()).filter(t => t);
    try {
      await this.adminService.bulkSetTimetable(
        this.selectedStudentsForEmail,
        this.bulkScheduleStart,
        this.bulkScheduleEnd,
        topicsArray
      );
      this.showToast(`Schedule successfully applied to ${this.selectedStudentsForEmail.length} students!`, 'success');
      this.closeBulkScheduleModal();
      this.clearEmailSelection();
      this.bulkScheduleStart = '';
      this.bulkScheduleEnd = '';
      this.bulkScheduleTopics = '';
    } catch (err) {
      this.showToast('Failed to apply schedule', 'danger');
    }
  }

  get displayedRangeEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalQuestions);
  }

  refreshCategoryOptions() {
    const cats = new Set(this.submissions.map(s => s.question_category));
    this.categoryOptions = Array.from(cats).map(c => ({ value: c, label: c }));
  }

  async viewProctoringLogs(username: string, studentName: string) {
    const modal = await this.modalCtrl.create({
      component: ProctoringLogsModalComponent,
      componentProps: { username, studentName }
    });
    await modal.present();
  }
  
  // For individual timetable
  onStartTimeChange(event: any) {
    // Optional: add any additional logic
    console.log('Start time changed:', this.timetableStart);
  }

  onEndTimeChange(event: any) {
    console.log('End time changed:', this.timetableEnd);
  }

  // For bulk schedule
  onBulkStartChange(event: any) {
    console.log('Bulk start changed:', this.bulkScheduleStart);
  }

  // You may also add a computed property for minimum date (optional)
  // get minDateTime(): string {
  //   const now = new Date();
  //   return now.toISOString();
  // }

  // ─── 1. Min Date Format (MM-DD-YYYY) ───
  // private setMinDateTime() {
  //   const now = new Date();
  //   this.minDateTime = now.toISOString();
    
  //   // Strictly MM-DD-YYYY format
  //   const m = String(now.getMonth() + 1).padStart(2, '0');
  //   const day = String(now.getDate()).padStart(2, '0');
  //   const y = now.getFullYear();
    
  //   this.minDateOnly = `${m}-${day}-${y}`;
    
  //   this.cdr.detectChanges();
  // }

  private setMinDateTime() {
    const now = new Date();
    this.minDateTime = now.toISOString();
    
    // 🟢 FIXED: Yahan bhi strictly YYYY-MM-DD hona chahiye
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    this.minDateOnly = `${y}-${m}-${day}`; 
    
    this.cdr.detectChanges();
  }

  // ─── Batch Detail Methods ───────────────────

  openCreateEmptyBatchModal() {
    this.batchName = '';
    this.batchTopics = '';
    this.showCreateEmptyBatchModal = true;
  }

  async createEmptyBatch() {
    if (!this.batchName?.trim()) return;
    const topics = this.batchTopics
      ? this.batchTopics.split(',').map(t => t.trim()).filter(t => t)
      : [];
    try {
      await this.adminService.createBatch(this.batchName.trim(), [], topics);
      this.showToast(`Batch "${this.batchName}" created!`, 'success');
      this.showCreateEmptyBatchModal = false;
      this.studentSubView = 'groups';
      await this.loadBatches();
    } catch (err) {
      this.showToast('Failed to create batch', 'danger');
    }
  }

  openBatchDetail(batch: any) {
    this.selectedBatch = { ...batch };   // copy taaki live edit na ho
    this.batchAddStudentUsername = '';
    this.batchImportFile = null;
    this.showBatchDetailModal = true;
  }

  async addStudentToBatch() {
    if (!this.batchAddStudentUsername || !this.selectedBatch) return;
    try {
      const result = await this.adminService.addStudentsToBatch(
        this.selectedBatch.id,
        [this.batchAddStudentUsername]
      );
      this.showToast('Student added to batch!', 'success');
      this.batchAddStudentUsername = '';
      await this.loadBatches();
      // Modal ka data bhi refresh karo
      this.selectedBatch = this.batches.find(b => b.id === this.selectedBatch.id);
    } catch (err) {
      this.showToast('Failed to add student', 'danger');
    }
  }

  async removeStudentFromBatch(username: string) {
    if (!this.selectedBatch) return;
    try {
      await this.adminService.removeStudentFromBatch(this.selectedBatch.id, username);
      this.showToast('Student removed from batch', 'success');
      await this.loadBatches();
      this.selectedBatch = this.batches.find(b => b.id === this.selectedBatch.id);
    } catch (err) {
      this.showToast('Failed to remove student', 'danger');
    }
  }

  onBatchImportFileSelected(event: any) {
    this.batchImportFile = event.target.files[0] || null;
  }

  async importStudentsToBatch() {
    if (!this.batchImportFile || !this.selectedBatch) return;
    this.batchImporting = true;
    try {
      const result = await this.adminService.importStudentsToBatch(
        this.selectedBatch.id,
        this.batchImportFile
      );
      this.showToast(
        `${result.added_count} students imported into batch!`, 'success'
      );
      this.batchImportFile = null;
      await this.loadBatches();
      this.selectedBatch = this.batches.find(b => b.id === this.selectedBatch.id);
      // Agar naye students create hue hain to global list bhi refresh karo
      if (result.created > 0) await this.loadStudents();
    } catch (err) {
      this.showToast('Import failed', 'danger');
    } finally {
      this.batchImporting = false;
    }
  }

  getStudentName(username: string): string {
    return this.students.find(s => s.username === username)?.name || username;
  }

  formatScheduleTime(val: any): string {
    if (!val) return 'Not set';
    const str = String(val).trim();
    const timeMatch = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2];
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      return `${hours}:${minutes} ${ampm}`;
    }
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    }
    return str;
  }

  /**
   * Open StudentDetailModal from inside the Group Detail modal.
   * Does NOT close the group modal — StudentDetailModal stacks on top.
   * After dismiss, refreshes group data so remove/changes reflect.
   */
  async openStudentProfileFromGroup(username: string, studentName: string) {
    try {
      const modal = await this.modalCtrl.create({
        component: StudentDetailModalComponent,
        componentProps: { username, studentName },
        // Stacks on top of the group detail modal
        presentingElement: undefined,
      });
      await modal.present();
      const { data } = await modal.onDidDismiss();
      // Refresh data after profile modal closes
      await this.loadStudents();
      await this.loadSubmissions();
      await this.loadRecordings();
      await this.loadScreenRecordings();
      this.applyFilters();
      // Also refresh selected group student objects
      if (this.selectedGroup) {
        await this.loadBatches();
        this.selectedGroup = this.groups.find(g => g.id === this.selectedGroup.id) || this.selectedGroup;
      }
    } catch (err) {
      console.error('[ERROR] Failed to open student profile from group:', err);
    }
  }

  /** Return full student object by username (for group detail cards) */
  getStudentByUsername(username: string): any {
    return this.students.find(s => s.username === username) || {
      username,
      name: username,
      email: '',
      is_terminated: false,
      isLive: this.liveStudentMap.has(username),
      attempts_taken: 0,
      max_attempts: 1
    };
  }

  /** Count how many students in the selected group are currently live */
  getGroupLiveCount(): number {
    if (!this.selectedGroup?.students?.length) return 0;
    return this.selectedGroup.students.filter((u: string) => this.liveStudentMap.has(u)).length;
  }

  /** Returns human-readable duration between two datetime-local strings */
  getScheduleDuration(start: string, end: string): string {
    if (!start || !end) return '';
    const diffMs = new Date(end).getTime() - new Date(start).getTime();
    if (diffMs <= 0) return 'Invalid';
    const totalMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMins / 60);
    const mins  = totalMins % 60;
    if (hours === 0) return `${mins} min`;
    if (mins  === 0) return `${hours} hr`;
    return `${hours} hr ${mins} min`;
  }

  // ============================================
  // GROUP MANAGEMENT METHODS (new — wrap batch API)
  // ============================================

  /** Open "Create Group" modal from toolbar (empty group) */
  openCreateGroupModal() {
    this.groupName = '';
    this.showCreateGroupModal = true;
  }

  /** Create empty group, then switch to Groups tab */
  async createGroup() {
    if (!this.groupName?.trim()) {
      this.showToast('Group name is required', 'warning');
      return;
    }
    try {
      await this.adminService.createBatch(this.groupName.trim(), [], []);
      this.showToast(`Group "${this.groupName}" created!`, 'success');
      this.showCreateGroupModal = false;
      this.studentSubView = 'groups';
      await this.loadBatches();
    } catch (err) {
      this.showToast('Failed to create group', 'danger');
    }
  }

  /** Create group from selected students (floating bar) */
  openCreateGroupFromSelectionModal() {
    if (this.selectedStudentsForEmail.length < 1) {
      this.showToast('Please select at least 1 student', 'warning');
      return;
    }
    this.groupName = '';
    this.showCreateBatchModal = true; // reuse existing modal, just renamed in template
  }

  async createGroupFromSelection() {
    if (!this.groupName.trim()) {
      this.showToast('Group name is required', 'warning');
      return;
    }
    try {
      await this.adminService.createBatch(
        this.groupName.trim(),
        this.selectedStudentsForEmail,
        []
      );
      this.showToast(`Group "${this.groupName}" created with ${this.selectedStudentsForEmail.length} students!`, 'success');
      this.showCreateBatchModal = false;
      this.clearEmailSelection();
      this.studentSubView = 'groups';
      await this.loadBatches();
    } catch (err) {
      this.showToast('Failed to create group', 'danger');
    }
  }

  /** Delete group (batch) with confirmation */
  async deleteGroup(groupId: string, groupNameLabel: string) {
    if (!confirm(`Delete group "${groupNameLabel}"?\n\nStudents will NOT be removed — only the group will be deleted.`)) return;
    try {
      await this.adminService.deleteBatch(groupId);
      this.showToast(`Group "${groupNameLabel}" deleted`, 'success');
      await this.loadBatches();
    } catch (err) {
      this.showToast('Failed to delete group', 'danger');
    }
  }

  /** Open group detail modal */

  // 🟢 UPDATED FUNCTION: Ab ye tab ka naam bhi receive karega
  // openGroupDetail(group: any, tab: 'students' | 'settings' = 'students') {
  //   this.selectedGroup = { ...group };
  //   this.groupAddStudentUsername = '';
  //   this.groupImportFile = null;
  //   this.activeGroupTab = tab; // Tab set kiya
  //   this.showGroupDetailModal = true;
  //   this.groupBulkSelectedTopics = Array.isArray(group.topics) ? [...group.topics] : [];
  //   this.fetchGroupTimetable();
  // }

  // 🟢 UPDATED FUNCTION: Modal khulte hi saara data (Schedule, Topics, Settings) ek sath ready ho jayega
  // openGroupDetail(group: any, tab: 'students' | 'settings' = 'students') {
  //   this.selectedGroup = { ...group };
  //   this.groupAddStudentUsername = '';
  //   this.groupImportFile = null;
  //   this.activeGroupTab = tab; 
  //   this.showGroupDetailModal = true;
    
  //   // 🟢 YAHAN NAYI LINE ADD KAREIN: Modal khulte hi latest classes fetch hongi
  //   this.loadAllClasses();
    
  //   // 1. Topics Load karein
  //   this.groupBulkSelectedTopics = Array.isArray(group.topics) ? [...group.topics] : [];
    
  //   // 2. Schedule Load karein
  //   this.fetchGroupTimetable();

  //   // 3. Settings Load karein
  //   if (this.selectedGroup && this.selectedGroup.settings) {
  //     const savedSettings = this.selectedGroup.settings;
  //     this.groupSettings.allowTyping = savedSettings.allowTyping !== undefined ? savedSettings.allowTyping : true;
  //     this.groupSettings.topicDistribution = [];

  //     if (savedSettings.topicDistribution && Array.isArray(savedSettings.topicDistribution)) {
  //       const activeGroupTopics = this.selectedGroup.topics || [];
  //       savedSettings.topicDistribution.forEach((row: any) => {
  //         if (activeGroupTopics.includes(row.topic)) {
  //           this.groupSettings.topicDistribution.push({
  //             topic: row.topic,
  //             className: row.className || 'All',
  //             count: row.count
  //           });
  //         }
  //       });
  //     }
  //   } else {
  //     this.groupSettings.allowTyping = true;
  //     this.groupSettings.topicDistribution = [];
  //     const assignedTopics = this.selectedGroup?.topics || [];
  //     if (assignedTopics.length > 0) {
  //       this.groupSettings.topicDistribution.push({ topic: assignedTopics[0], className: 'All', count: 3 });
  //     }
  //   }
  // }

  // 🟢 UPDATED FUNCTION: Added strict fallback logic
  // openGroupDetail(group: any, tab: 'students' | 'settings' = 'students') {
  //   this.selectedGroup = { ...group };
  //   this.groupAddStudentUsername = '';
  //   this.groupImportFile = null;
  //   this.activeGroupTab = tab; 
  //   this.showGroupDetailModal = true;
    
  //   this.loadAllClasses();
    
  //   // 1. Topics Load karein
  //   this.groupBulkSelectedTopics = Array.isArray(group.topics) ? [...group.topics] : [];
    
  //   // 2. Schedule Load karein
  //   this.fetchGroupTimetable();

  //   // 3. Settings Load karein
  //   if (this.selectedGroup && this.selectedGroup.settings) {
  //     const savedSettings = this.selectedGroup.settings;
  //     this.groupSettings.allowTyping = savedSettings.allowTyping !== undefined ? savedSettings.allowTyping : true;
  //     this.groupSettings.topicDistribution = [];

  //     const activeGroupTopics = this.selectedGroup.topics || [];

  //     // Naya format check
  //     if (savedSettings.topicDistribution && Array.isArray(savedSettings.topicDistribution)) {
  //       savedSettings.topicDistribution.forEach((row: any) => {
  //         if (activeGroupTopics.includes(row.topic)) {
  //           this.groupSettings.topicDistribution.push({
  //             topic: row.topic,
  //             className: row.className || 'All',
  //             count: row.count
  //           });
  //         }
  //       });
  //     } 
  //     // 🟢 FIX: Agar backend naya format drop kar de, toh purane format se data bacha lo
  //     else if (savedSettings.topicCounts) {
  //       for (const [topic, count] of Object.entries(savedSettings.topicCounts)) {
  //         if (activeGroupTopics.includes(topic)) {
  //           this.groupSettings.topicDistribution.push({
  //             topic: topic,
  //             className: 'All', // Default assign
  //             count: count as number
  //           });
  //         }
  //       }
  //     }
  //   } else {
  //     // Default empty state
  //     this.groupSettings.allowTyping = true;
  //     this.groupSettings.topicDistribution = [];
  //     const assignedTopics = this.selectedGroup?.topics || [];
  //     if (assignedTopics.length > 0) {
  //       this.groupSettings.topicDistribution.push({ topic: assignedTopics[0], className: 'All', count: 3 });
  //     }
  //   }
  // }

  async openGroupDetail(group: any, tab: 'students' | 'settings' = 'students') {
    this.selectedGroup = { ...group };
    this.groupAddStudentUsername = '';
    this.groupImportFile = null;
    this.activeGroupTab = tab; 
    this.showGroupDetailModal = true;
    
    this.loadAllClasses();
    this.fetchGroupTimetable();

    // 1. ENSURE QUESTIONS ARE LOADED FIRST
    if (!this.questions || this.questions.length === 0) {
      if (typeof this.loadQuestions === 'function') {
        await this.loadQuestions();
      }
    }

    // 2. INITIALIZE SETTINGS
    if (this.selectedGroup && this.selectedGroup.settings) {
      const savedSettings = this.selectedGroup.settings;
      this.groupSettings.allowTyping = savedSettings.allowTyping !== undefined ? savedSettings.allowTyping : true;
      
      this.groupSettings.selectedClasses = savedSettings.selectedClasses || [];
      this.groupSettings.selectedCategories = savedSettings.selectedCategories || [];
      this.groupSettings.topicDistribution = [];

      // Restore Rows (L1, L2, L3)
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

      // 🟢 THE FIX: SMART FRONTEND AUTO-RECOVERY 🟢
      // Agar backend ne selectedClasses ko save nahi kiya (Schema rule ki wajah se drop kar diya)
      // Toh hum saved topics (L1, L2 rules) ko read karenge aur database (this.questions) se unki Class khud nikal lenge!
      if (this.groupSettings.selectedClasses.length === 0 && this.groupSettings.topicDistribution.length > 0) {
        console.warn("Backend dropped selectedClasses. Auto-recovering from topics...");
        const recoveredClasses = new Set<string>();
        const recoveredCategories = new Set<string>();

        this.groupSettings.topicDistribution.forEach(row => {
          recoveredCategories.add(row.topic);
          // Find which class this topic belongs to
          const matchedQuestions = this.questions.filter((q: any) => q.category === row.topic);
          matchedQuestions.forEach((q: any) => {
            const qClass = q.class_name || q.className;
            if (qClass && qClass !== 'All') {
              recoveredClasses.add(qClass);
            }
          });
        });

        this.groupSettings.selectedClasses = Array.from(recoveredClasses);
        this.groupSettings.selectedCategories = Array.from(recoveredCategories);
      }

    } else {
      // Default blank state
      this.groupSettings.allowTyping = true;
      this.groupSettings.selectedClasses = [];
      this.groupSettings.selectedCategories = [];
      this.groupSettings.topicDistribution = [];
    }
    
    this.pendingClassSelection = '';
    await this.fetchCategoriesForClasses();
  }

  /** Add single student to group */
  async addStudentToGroup() {
    if (!this.groupAddStudentUsername || !this.selectedGroup) return;
    try {
      await this.adminService.addStudentsToBatch(
        this.selectedGroup.id,
        [this.groupAddStudentUsername]
      );
      this.showToast('Student added to group!', 'success');
      this.groupAddStudentUsername = '';
      await this.loadBatches();
      this.selectedGroup = this.groups.find(g => g.id === this.selectedGroup.id);
    } catch (err) {
      this.showToast('Failed to add student', 'danger');
    }
  }

  /** Remove student from group */
  async removeStudentFromGroup(username: string) {
    if (!this.selectedGroup) return;
    try {
      await this.adminService.removeStudentFromBatch(this.selectedGroup.id, username);
      this.showToast('Student removed from group', 'success');
      await this.loadBatches();
      this.selectedGroup = this.groups.find(g => g.id === this.selectedGroup.id);
    } catch (err) {
      this.showToast('Failed to remove student', 'danger');
    }
  }

  onGroupImportFileSelected(event: any) {
    this.groupImportFile = event.target.files[0] || null;
  }

  /** Bulk import students into group via Excel */
  async importStudentsToGroup() {
    if (!this.groupImportFile || !this.selectedGroup) return;
    this.groupImporting = true;
    try {
      const result = await this.adminService.importStudentsToBatch(
        this.selectedGroup.id,
        this.groupImportFile
      );
      this.showToast(`${result.added_count} students imported into group!`, 'success');
      this.groupImportFile = null;
      await this.loadBatches();
      this.selectedGroup = this.groups.find(g => g.id === this.selectedGroup.id);
      if (result.created > 0) await this.loadStudents();
    } catch (err) {
      this.showToast('Import failed', 'danger');
    } finally {
      this.groupImporting = false;
    }
  }

  /** Open schedule interview modal for a group */
  openGroupScheduleModal(group: any) {
    this.selectedGroup = group;
    this.groupScheduleStart = '';
    this.groupScheduleEnd = '';
    // Pre-select categories from group's saved topics
    this.groupSelectedCategories = Array.isArray(group.topics) ? [...group.topics] : [];
    this.showGroupScheduleModal = true;
  }

  /** Toggle a category chip in the group schedule modal */
  toggleGroupCategory(cat: string) {
    const idx = this.groupSelectedCategories.indexOf(cat);
    if (idx > -1) {
      this.groupSelectedCategories.splice(idx, 1);
    } else {
      this.groupSelectedCategories.push(cat);
    }
  }

  /** Apply schedule + preferred_categories to all students in the group */
  async applyGroupSchedule() {
    if (!this.selectedGroup) return;
    if (!this.groupScheduleStart || !this.groupScheduleEnd) {
      this.showToast('Start and End time are required!', 'warning');
      return;
    }
    const now = new Date();
    const startDate = new Date(this.groupScheduleStart);
    const endDate = new Date(this.groupScheduleEnd);
    if (startDate < now) {
      this.showToast('Start time cannot be in the past!', 'warning');
      return;
    }
    if (endDate <= startDate) {
      this.showToast('End time must be after start time!', 'warning');
      return;
    }

    this.groupScheduleLoading = true;
    const selectedCats = [...this.groupSelectedCategories];

    try {
      // ── 1. Set timetable for all students in group ───────────────────────
      const result = await this.adminService.batchBulkSchedule(
        this.selectedGroup.id,
        this.groupScheduleStart,
        this.groupScheduleEnd,
        selectedCats   // topics = selected categories
      );

      // ── 2. Set preferred_categories for each student in parallel ─────────
      if (selectedCats.length > 0 && this.selectedGroup.students?.length > 0) {
        const catPromises = this.selectedGroup.students.map((username: string) =>
          this.adminService.setStudentCategories(username, selectedCats).catch(() => null)
        );
        await Promise.all(catPromises);
      }

      const catMsg = selectedCats.length > 0
        ? ` Categories set: ${selectedCats.join(', ')}.`
        : '';
      this.showToast(
        `✅ Schedule applied to ${result.success_count}/${result.total} students!${catMsg}`,
        'success'
      );
      this.showGroupScheduleModal = false;
      await this.loadBatches();
    } catch (err) {
      this.showToast('Failed to apply schedule', 'danger');
    } finally {
      this.groupScheduleLoading = false;
    }
  }

  // ─── Toggles selection of a topic inside the Popover ───
  toggleGroupBulkTopic(topic: string) {
    const idx = this.groupBulkSelectedTopics.indexOf(topic);
    if (idx > -1) {
      this.groupBulkSelectedTopics.splice(idx, 1);
    } else {
      this.groupBulkSelectedTopics.push(topic);
    }
  }

  // ─── Applies selected topics to all students in the group simultaneously ───
  // async applyTopicsToGroup() {
  //   if (!this.selectedGroup || !this.selectedGroup.students || this.selectedGroup.students.length === 0) {
  //     this.showToast('No students in this group to update.', 'warning');
  //     return;
  //   }
  //   if (this.groupBulkSelectedTopics.length === 0) {
  //     this.showToast('Please select at least one topic.', 'warning');
  //     return;
  //   }

  //   try {
  //     // Create an array of API calls for each student in the group
  //     const updatePromises = this.selectedGroup.students.map((username: string) =>
  //       this.adminService.setStudentCategories(username, this.groupBulkSelectedTopics).catch(() => null)
  //     );

  //     // Execute all API calls in parallel
  //     await Promise.all(updatePromises);

  //     this.showToast(`✅ Topics successfully applied to ${this.selectedGroup.students.length} students!`, 'success');
      
  //     // Optionally close the popover by programmatically clicking body or handling ion-popover controller
  //     document.body.click(); 

  //     // Clear the selection for next time
  //     this.groupBulkSelectedTopics = [];
      
  //   } catch (err) {
  //     this.showToast('Failed to apply topics to the group.', 'danger');
  //   }
  // }

// ─── Applies selected topics to all students in the group simultaneously ───
  // async applyTopicsToGroup(popoverReference: any) {
  //   if (!this.selectedGroup || !this.selectedGroup.students || this.selectedGroup.students.length === 0) {
  //     this.showToast('No students in this group to update.', 'warning');
  //     return;
  //   }

  //   try {
  //     const updatePromises = this.selectedGroup.students.map((username: string) =>
  //       this.adminService.setStudentCategories(username, this.groupBulkSelectedTopics).catch(() => null)
  //     );

  //     await Promise.all(updatePromises);

  //     // Local UI ko turant update karein
  //     this.selectedGroup.topics = [...this.groupBulkSelectedTopics];
      
  //     const groupIndex = this.groups.findIndex(g => g.id === this.selectedGroup.id);
  //     if (groupIndex > -1) {
  //       this.groups[groupIndex].topics = [...this.groupBulkSelectedTopics];
  //     }

  //     this.showToast(`✅ Topics successfully applied to ${this.selectedGroup.students.length} students!`, 'success');
      
  //     // ✅ FIX: Reliably close the popover
  //     if (popoverReference) {
  //       popoverReference.dismiss();
  //     }
      
  //   } catch (err) {
  //     this.showToast('Failed to apply topics to the group.', 'danger');
  //   }
  // }

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

  // async applyGroupScheduleStrict12Hour() {
  //   if (!this.selectedGroup) return;
  //   if (!this.groupStartDateOnly || !this.groupStartTimeOnly || !this.groupEndDateOnly || !this.groupEndTimeOnly) {
  //     this.showToast('Please select valid date and time', 'warning');
  //     return;
  //   }

  //   // Convert UI layout values to 24-hour ISO string for backend
  //   const convertToISO = (dateStr: string, timeStr: string, ampm: string) => {
  //     let [hours, minutes] = timeStr.split(':').map(Number);
  //     if (ampm === 'PM' && hours < 12) hours += 12;
  //     if (ampm === 'AM' && hours === 12) hours = 0;
  //     const d = new Date(dateStr);
  //     d.setHours(hours, minutes, 0, 0);
  //     return d.toISOString();
  //   };

  //   try {
  //     this.groupScheduleStart = convertToISO(this.groupStartDateOnly, this.groupStartTimeOnly, this.groupStartAmPm);
  //     this.groupScheduleEnd = convertToISO(this.groupEndDateOnly, this.groupEndTimeOnly, this.groupEndAmPm);

  //     this.groupScheduleLoading = true;
  //     const message = this.groupScheduleTopics ? this.groupScheduleTopics.trim() : '';

  //     // Call batch scheduler
  //     const result = await this.adminService.batchBulkSchedule(
  //       this.selectedGroup.id,
  //       this.groupScheduleStart,
  //       this.groupScheduleEnd,
  //       [message]
  //     );

  //     this.showToast(`✅ Schedule applied to ${result.success_count}/${result.total} students!`, 'success');
  //     this.showGroupScheduleModal = false;
      
  //     // Refresh Data so the header UI updates immediately
  //     await this.loadBatches();
  //     this.selectedGroup = this.groups.find(g => g.id === this.selectedGroup.id) || this.selectedGroup;

  //   } catch (err) {
  //     this.showToast('Failed to apply group schedule', 'danger');
  //   } finally {
  //     this.groupScheduleLoading = false;
  //   }
  // }

  // =========================================================================
  // 1. GROUP BATCH SCHEDULE FIX (For Batch Timetable)
  // =========================================================================
  async applyGroupScheduleStrict12Hour() {
    if (!this.selectedGroup) return;
    if (!this.groupStartDateOnly || !this.groupStartTimeOnly || !this.groupEndDateOnly || !this.groupEndTimeOnly) {
      this.showToast('Please select valid date and time', 'warning');
      return;
    }

    // 🛠️ Local ISO String converter (bina 'Z' ke)
    const convertToNaiveISO = (dateStr: string, timeStr: string, ampm: string) => {
      let [hours, minutes] = timeStr.split(':').map(Number);
      if (ampm === 'PM' && hours < 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      
      const pad = (num: number) => String(num).padStart(2, '0');
      return `${dateStr}T${pad(hours)}:${pad(minutes)}:00`;
    };

    try {
      this.groupScheduleStart = convertToNaiveISO(this.groupStartDateOnly, this.groupStartTimeOnly, this.groupStartAmPm);
      this.groupScheduleEnd = convertToNaiveISO(this.groupEndDateOnly, this.groupEndTimeOnly, this.groupEndAmPm);

      this.groupScheduleLoading = true;
      
      // 🟢 FIX 1: Message ko alag se rakha, aur topics mein sirf real group topics bheje
      const message = this.groupScheduleMessage ? this.groupScheduleMessage.trim() : '';
      const realTopics = this.selectedGroup.topics || [];

      // Backend service mein topics ke sath message bhi pass kar sakte hain (agar service support kare)
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

    } catch (err) {
      this.showToast('Failed to apply group schedule', 'danger');
    } finally {
      this.groupScheduleLoading = false;
    }
  }

  // ─── Open Settings & Initialize Defaults ───
// ─── Open Settings & Initialize Defaults or Load Saved ───
  // openGroupSettings() {
  //   // Check karte hain ki kya is group mein pehle se koi settings save ki gayi hain
  //   if (this.selectedGroup && this.selectedGroup.settings) {
      
  //     const savedSettings = this.selectedGroup.settings;
  //     this.groupSettings.allowTyping = savedSettings.allowTyping;
  //     this.groupSettings.topicDistribution = [];

  //     // Saved topicCounts object ko wapas dynamic rows array mein convert karte hain
  //     if (savedSettings.topicCounts) {
  //       for (const [topic, count] of Object.entries(savedSettings.topicCounts)) {
  //         // Verify karte hain ki ye topic abhi bhi group ko assign hai (kahi admin ne Set Topics se hata toh nahi diya)
  //         if (this.selectedGroup.topics?.includes(topic)) {
  //           this.groupSettings.topicDistribution.push({ 
  //             topic: topic, 
  //             count: count as number 
  //           });
  //         }
  //       }
  //     }

  //   } else {
  //     // Agar pehli baar khol raha hai, toh default setting load karein
  //     this.groupSettings.allowTyping = true;
  //     this.groupSettings.topicDistribution = [];
      
  //     const assignedTopics = this.selectedGroup?.topics || [];
  //     if (assignedTopics.length > 0) {
  //       this.groupSettings.topicDistribution.push({
  //         topic: assignedTopics[0], 
  //         count: 3 
  //       });
  //     }
  //   }
    
  //   this.showGroupSettingsModal = true;
  // }



  // openGroupSettings() {
  //   if (this.selectedGroup && this.selectedGroup.settings) {
      
  //     const savedSettings = this.selectedGroup.settings;
  //     this.groupSettings.allowTyping = savedSettings.allowTyping !== undefined ? savedSettings.allowTyping : true;
  //     this.groupSettings.topicDistribution = [];

  //     // Saved topicCounts object ko directly dynamic rows mein convert karein
  //     if (savedSettings.topicCounts) {
  //       for (const [topic, count] of Object.entries(savedSettings.topicCounts)) {
  //         // Yahan se restrictive check hata diya gaya hai, saari saved settings clearly dikhengi
  //         this.groupSettings.topicDistribution.push({ 
  //           topic: topic, 
  //           count: count as number 
  //         });
  //       }
  //     }

  //   } else {
  //     // Default setting load karein agar naya khola hai
  //     this.groupSettings.allowTyping = true;
  //     this.groupSettings.topicDistribution = [];
      
  //     const assignedTopics = this.selectedGroup?.topics || [];
  //     if (assignedTopics.length > 0) {
  //       this.groupSettings.topicDistribution.push({
  //         topic: assignedTopics[0], 
  //         count: 3 
  //       });
  //     }
  //   }
    
  //   this.showGroupSettingsModal = true;
  // }

  // openGroupSettings() {
  //   if (this.selectedGroup && this.selectedGroup.settings) {
      
  //     const savedSettings = this.selectedGroup.settings;
  //     this.groupSettings.allowTyping = savedSettings.allowTyping !== undefined ? savedSettings.allowTyping : true;
  //     this.groupSettings.topicDistribution = [];

  //     // 🟢 1. Agar naya format (topicDistribution with className) saved hai
  //     if (savedSettings.topicDistribution && Array.isArray(savedSettings.topicDistribution)) {
  //       const activeGroupTopics = this.selectedGroup.topics || [];
  //       savedSettings.topicDistribution.forEach((row: any) => {
  //         if (activeGroupTopics.includes(row.topic)) {
  //           this.groupSettings.topicDistribution.push({
  //             topic: row.topic,
  //             className: row.className || 'All', // ✅ Class/Level load hoga
  //             count: row.count
  //           });
  //         }
  //       });
  //     } 
  //     // 🟢 2. Fallback: Agar sirf purana topicCounts object hai
  //     else if (savedSettings.topicCounts) {
  //       const activeGroupTopics = this.selectedGroup.topics || [];
  //       for (const [topic, count] of Object.entries(savedSettings.topicCounts)) {
  //         if (activeGroupTopics.includes(topic)) {
  //           this.groupSettings.topicDistribution.push({ 
  //             topic: topic, 
  //             className: 'All', // ✅ Default class assign kar denge
  //             count: count as number 
  //           });
  //         }
  //       }
  //     }

  //   } else {
  //     // Agar pehli baar settings khul rahi hain
  //     this.groupSettings.allowTyping = true;
  //     this.groupSettings.topicDistribution = [];
      
  //     const assignedTopics = this.selectedGroup?.topics || [];
  //     if (assignedTopics.length > 0) {
  //       this.groupSettings.topicDistribution.push({
  //         topic: assignedTopics[0], 
  //         className: 'All', // ✅ Default class
  //         count: 3 
  //       });
  //     }
  //   }
    
  //   this.showGroupSettingsModal = true;

  //   this.groupSettings.topicDistribution.forEach(async (row) => {
  //     if (row.topic) {
  //       await this.fetchClassesForSpecificTopic(row.topic);
  //     }
  //   });
  // }

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


  // ─── Filter Dropdown Options (Exclude already selected topics) ───
  // getAvailableTopicsForDropdown(currentIndex: number): string[] {
  //   const allAssignedTopics = this.selectedGroup?.topics || [];
    
  //   // Un topics ki list nikalo jo dusri rows mein select ho chuke hain
  //   const currentlySelectedInOtherRows = this.groupSettings.topicDistribution
  //     .filter((_, idx) => idx !== currentIndex)
  //     .map(row => row.topic);
      
  //   // ✅ FIX: Added condition to remove any blank/empty strings (t && t.trim() !== '')
  //   return allAssignedTopics.filter((t: string) => 
  //     t && t.trim() !== '' && !currentlySelectedInOtherRows.includes(t)
  //   );
  // }



  // ─── Filter Dropdown Options (Show ALL categories) ───
  // getAvailableTopicsForDropdown(currentIndex: number): string[] {
  //   // ✅ FIX: Ab ye group topics ki jagah poore system ke saare unique categories (topics) dikhayega
  //   const allSystemTopics = (this.uniqueCategories && this.uniqueCategories.length > 0) 
  //     ? this.uniqueCategories 
  //     : this.allCategories; 
    
  //   // Jo topics dusri rows mein select ho chuke hain, unko list se nikal do
  //   const currentlySelectedInOtherRows = this.groupSettings.topicDistribution
  //     .filter((_, idx) => idx !== currentIndex)
  //     .map(row => row.topic);
      
  //   return allSystemTopics.filter((t: string) => 
  //     t && t.trim() !== '' && !currentlySelectedInOtherRows.includes(t)
  //   );
  // }

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

  // ─── Add a new topic row ───
  // addTopicRow() {
  //   const unselectedTopics = this.getAvailableTopicsForDropdown(-1);
  //   if (unselectedTopics.length > 0) {
  //     this.groupSettings.topicDistribution.push({
  //       topic: unselectedTopics[0], // Automatically agla available topic select kar do
  //       className: 'All',
  //       count: 3 // Default 3 questions
  //     });
  //   }
  // }
  
  // 🟢 UPDATED FUNCTION
  // addTopicRow() {
  //   const unselectedTopics = this.getAvailableTopicsForDropdown(-1);
  //   if (unselectedTopics.length > 0) {
  //     const newTopic = unselectedTopics[0];
  //     const newRow = {
  //       topic: newTopic, 
  //       className: 'All', 
  //       count: 3 
  //     };
  //     this.groupSettings.topicDistribution.push(newRow);
      
  //     // Nayi row add hote hi uski classes fetch karo
  //     this.onTopicSelectionChange(newRow);
  //   }
  // }

  // 🟢 UPDATED FUNCTION
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

  // ─── Calculate sum of topic-wise questions for UI feedback ───
  // getTopicQuestionsSum(): number {
  //   return this.groupSettings.topicDistribution.reduce((sum, row) => sum + (row.count || 0), 0);
  // }

  // ─── Calculate sum of topic-wise questions for UI feedback ───
  // getTopicQuestionsSum(): number {
  //   return this.groupSettings.topicDistribution.reduce((sum, row) => 
  //     sum + (row.l1 || 0) + (row.l2 || 0) + (row.l3 || 0), 0);
  // }

  getTopicQuestionsSum(): number {
    return this.groupSettings.topicDistribution.reduce((sum, row) => 
      sum + (row.l1 || 0) + (row.l2 || 0) + (row.l3 || 0), 0);
  }

  // ─── Save Logic (UI Phase) ───
  // saveGroupSettings() {
  //   const total = this.getTopicQuestionsSum();
    
  //   if (total === 0) {
  //     this.showToast('Warning: Total questions cannot be 0. Please assign questions to topics.', 'warning');
  //     return;
  //   }

  //   // Array ko wapas object format { "Python": 5, "VLSI": 3 } mein convert karte hain
  //   const topicCountsObj: { [key: string]: number } = {};
  //   this.groupSettings.topicDistribution.forEach(row => {
  //     if (row.topic) {
  //       topicCountsObj[row.topic] = row.count;
  //     }
  //   });

  //   const finalSettingsToSave = {
  //     allowTyping: this.groupSettings.allowTyping,
  //     totalQuestions: total,
  //     topicCounts: topicCountsObj
  //   };

  //   // ✅ FIX: Yahan hum locally selected group aur main groups list me data save kar rahe hain
  //   this.selectedGroup.settings = finalSettingsToSave;
    
  //   const groupIndex = this.groups.findIndex(g => g.id === this.selectedGroup.id);
  //   if (groupIndex > -1) {
  //     this.groups[groupIndex].settings = finalSettingsToSave;
  //   }

  //   console.log('Saved Group Settings JSON:', finalSettingsToSave);
    
  //   this.showGroupSettingsModal = false;
  //   this.showToast(`✅ Settings saved! Total ${total} questions set for this group.`, 'success');
  // }

  // ─── Save Logic (UI Phase) ───
  // async saveGroupSettings() {
  //   const total = this.getTopicQuestionsSum();
    
  //   if (total === 0) {
  //     this.showToast('Warning: Total questions cannot be 0. Please assign questions to topics.', 'warning');
  //     return;
  //   }

  //   // Convert array to object format { "Python": 5, "SQL": 5 }
  //   const topicCountsObj: { [key: string]: number } = {};
  //   this.groupSettings.topicDistribution.forEach(row => {
  //     if (row.topic) {
  //       topicCountsObj[row.topic] = row.count;
  //     }
  //   });

  //   const finalSettingsToSave = {
  //     allowTyping: this.groupSettings.allowTyping,
  //     totalQuestions: total,
  //     topicCounts: topicCountsObj
  //   };

  //   try {
  //     // ✅ YAHAN HAI FIX: Ab ye actually API call karega aur database mein save karega!
  //     await this.adminService.saveGroupSettings(this.selectedGroup.id, finalSettingsToSave);

  //     // Local UI update taaki page refresh hone tak bhi sahi dikhe
  //     this.selectedGroup.settings = finalSettingsToSave;
  //     const groupIndex = this.groups.findIndex(g => g.id === this.selectedGroup.id);
  //     if (groupIndex > -1) {
  //       this.groups[groupIndex].settings = finalSettingsToSave;
  //     }

  //     console.log('Saved Group Settings to Backend:', finalSettingsToSave);
      
  //     this.showGroupSettingsModal = false;
  //     this.showToast(`✅ Settings saved! Total ${total} questions set for this group.`, 'success');
  //   } catch (err) {
  //     console.error('Failed to save settings:', err);
  //     this.showToast('❌ Failed to save group settings to server.', 'danger');
  //   }
  // }



  // async saveGroupSettings() {

  //   if (this.groupSettings && this.groupSettings.topicDistribution) {
  //     this.groupSettings.topicDistribution = this.groupSettings.topicDistribution.filter((row: any) => 
  //       row.topic && row.topic.trim() !== ''
  //     );
  //   }
    
  //   const total = this.getTopicQuestionsSum();
    
  //   if (total === 0) {
  //     this.showToast('Warning: Total questions cannot be 0. Please assign questions to topics.', 'warning');
  //     return;
  //   }

  //   // Purana format support ke liye object mapping
  //   const topicCountsObj: { [key: string]: number } = {};
  //   this.groupSettings.topicDistribution.forEach(row => {
  //     if (row.topic) {
  //       topicCountsObj[row.topic] = row.count;
  //     }
  //   });

  //   const finalSettingsToSave = {
  //     allowTyping: this.groupSettings.allowTyping,
  //     totalQuestions: total, // ✅ Total count yahan saved hai
  //     topicDistribution: this.groupSettings.topicDistribution, // ✅ Naya topic + class mapping
  //     topicCounts: topicCountsObj // ✅ Purana format safe rakha hai
  //   };

  //   try {
  //     await this.adminService.saveGroupSettings(this.selectedGroup.id, finalSettingsToSave);

  //     this.selectedGroup.settings = finalSettingsToSave;
  //     const groupIndex = this.groups.findIndex(g => g.id === this.selectedGroup.id);
  //     if (groupIndex > -1) {
  //       this.groups[groupIndex].settings = finalSettingsToSave;
  //     }
      
  //     this.showGroupSettingsModal = false;
  //     this.showToast(`✅ Settings saved! Total ${total} questions configured.`, 'success');
  //   } catch (err) {
  //     console.error('Failed to save settings:', err);
  //     this.showToast('❌ Failed to save group settings to server.', 'danger');
  //   }
  // }


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

}