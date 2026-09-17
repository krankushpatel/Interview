import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { of, delay } from 'rxjs';

const MOCK_QUESTIONS = [
  {
    id: 1,
    text: "Please introduce yourself, describing your background, key technical strengths, and recent software projects.",
    category: "General",
    difficulty: "Easy"
  },
  {
    id: 2,
    text: "Explain the differences between let, const, and var in JavaScript, and what hoisting means.",
    category: "Frontend",
    difficulty: "Easy"
  },
  {
    id: 3,
    text: "What is the difference between synchronous and asynchronous execution in Node.js? How does the event loop function?",
    category: "Backend",
    difficulty: "Easy"
  },
  {
    id: 4,
    text: "What are primary keys, foreign keys, and unique constraints in relational databases?",
    category: "Database",
    difficulty: "Easy"
  },
  {
    id: 5,
    text: "How do virtual DOM and change detection work in modern frontend frameworks like React and Angular?",
    category: "Frontend",
    difficulty: "Medium"
  },
  {
    id: 6,
    text: "Describe the architecture and security best practices when implementing JSON Web Token (JWT) authentication.",
    category: "Backend",
    difficulty: "Medium"
  },
  {
    id: 7,
    text: "How do B-tree indexes speed up SQL queries, and what are the trade-offs on write operations?",
    category: "Database",
    difficulty: "Medium"
  },
  {
    id: 8,
    text: "How would you design a scalable rate-limiting system for a high-traffic public API gateway?",
    category: "System Design",
    difficulty: "Hard"
  },
  {
    id: 9,
    text: "Explain the CAP theorem and discuss trade-offs between consistency and availability in distributed storage.",
    category: "System Design",
    difficulty: "Hard"
  },
  {
    id: 10,
    text: "How do you detect and mitigate memory leaks and long task blocking on the browser main thread?",
    category: "Frontend",
    difficulty: "Hard"
  }
];

const MOCK_STUDENTS = [
  { username: "student1", name: "Aarav Sharma", email: "aarav@example.com", attempts_taken: 1, max_attempts: 3, is_terminated: false, isLive: false },
  { username: "student2", name: "Priya Patel", email: "priya@example.com", attempts_taken: 0, max_attempts: 3, is_terminated: false, isLive: true },
  { username: "student3", name: "Rohan Gupta", email: "rohan@example.com", attempts_taken: 2, max_attempts: 3, is_terminated: false, isLive: false },
  { username: "student4", name: "Ananya Rao", email: "ananya@example.com", attempts_taken: 1, max_attempts: 3, is_terminated: false, isLive: false }
];

export const mockApiInterceptor: HttpInterceptorFn = (req, next) => {
  const url = req.url;

  // 1. Auth Login
  if (url.includes('/auth/login')) {
    const body = (req.body as any) || {};
    const username = (body.username || 'student').trim();
    const isAdmin = username.toLowerCase() === 'admin';

    const loginResponse = {
      success: true,
      username: username,
      name: isAdmin ? 'Platform Administrator' : (username.charAt(0).toUpperCase() + username.slice(1)),
      role: isAdmin ? 'admin' : 'student',
      email: `${username.toLowerCase()}@interview.app`,
      access_token: isAdmin ? 'mock-admin-jwt-token-ai-studio' : undefined,
      token_type: 'bearer'
    };

    return of(new HttpResponse({ status: 200, body: loginResponse })).pipe(delay(250));
  }

  // 2. Questions
  if (url.includes('/questions/all')) {
    return of(new HttpResponse({
      status: 200,
      body: { count: MOCK_QUESTIONS.length, questions: MOCK_QUESTIONS }
    })).pipe(delay(100));
  }

  if (url.includes('/questions/categories')) {
    return of(new HttpResponse({
      status: 200,
      body: ["General", "Frontend", "Backend", "Database", "System Design"]
    })).pipe(delay(100));
  }

  if (url.includes('/categories/all')) {
    return of(new HttpResponse({
      status: 200,
      body: { categories: ["General", "Frontend", "Backend", "Database", "System Design"] }
    })).pipe(delay(100));
  }

  // 3. Classes
  if (url.includes('/classes/all')) {
    return of(new HttpResponse({
      status: 200,
      body: [
        { id: 1, name: "Class 10-A", batch: "Batch-2026" },
        { id: 2, name: "Class 10-B", batch: "Batch-2026" }
      ]
    })).pipe(delay(100));
  }

  // Submissions
  if (url.includes('/admin/submissions')) {
    return of(new HttpResponse({
      status: 200,
      body: {
        submissions: [
          {
            id: "sub-1",
            username: "student1",
            student_name: "Aarav Sharma",
            timestamp: new Date().toISOString(),
            total_score: 8.4,
            category: "General",
            evaluation: { clarity: 8.5, technical_accuracy: 8.3, feedback: "Strong answers with accurate concepts." }
          }
        ]
      }
    })).pipe(delay(100));
  }

  // Recordings
  if (url.includes('/admin/exam-recordings') || url.includes('/admin/screen-recordings')) {
    return of(new HttpResponse({
      status: 200,
      body: { recordings: [] }
    })).pipe(delay(100));
  }

  // Timetable
  if (url.includes('/admin/timetable')) {
    const today = new Date().toISOString().split('T')[0];
    return of(new HttpResponse({
      status: 200,
      body: {
        schedule: {
          start_time: `${today}T09:00:00`,
          end_time: `${today}T18:00:00`,
          topics: ["Frontend", "Backend"],
          is_active: true
        }
      }
    })).pipe(delay(100));
  }

  // Proctoring events
  if (url.includes('/admin/proctoring')) {
    return of(new HttpResponse({
      status: 200,
      body: { events: [] }
    })).pipe(delay(100));
  }

  // Results
  if (url.includes('/results/')) {
    return of(new HttpResponse({
      status: 200,
      body: {
        username: "student1",
        score: 8.5,
        total_questions: 10,
        feedback: "Solid foundation across data structures, REST architectures, and frontend design.",
        categories: { "Frontend": 8.5, "Backend": 8.0, "Database": 9.0 }
      }
    })).pipe(delay(100));
  }

  // 4. Student Attempt / Exam Status
  if (url.includes('/student/attempt-status') || url.includes('/student/exam-status')) {
    return of(new HttpResponse({
      status: 200,
      body: {
        allowed: true,
        attempts_taken: 0,
        max_attempts: 3,
        is_terminated: false,
        settings: { topicCounts: {} }
      }
    })).pipe(delay(100));
  }

  // 5. Admin Dashboard Stats
  if (url.includes('/admin/dashboard-stats')) {
    return of(new HttpResponse({
      status: 200,
      body: {
        total_students: 24,
        total_questions: 10,
        total_submissions: 15,
        total_groups: 2,
        total_batches: 2,
        active_students_count: 2,
        student_activity: [
          { username: "student1", name: "Aarav Sharma", score: 8.4, timestamp: "2 hours ago", count: 2 },
          { username: "student2", name: "Priya Patel", score: 9.1, timestamp: "4 hours ago", count: 1 }
        ],
        active_exams: 1,
        completed_exams: 19,
        flagged_sessions: 1,
        average_score: 8.1
      }
    })).pipe(delay(100));
  }

  // 6. Student Full Profile
  if (url.includes('/admin/student-full-profile/')) {
    const parts = url.split('/admin/student-full-profile/');
    const rawUsername = (parts[1] || 'student1').split('?')[0].trim();
    const student = MOCK_STUDENTS.find(s => s.username === rawUsername) || {
      username: rawUsername,
      name: rawUsername.charAt(0).toUpperCase() + rawUsername.slice(1),
      email: `${rawUsername}@example.com`,
      attempts_taken: 1,
      max_attempts: 3,
      is_terminated: false,
      isLive: false
    };

    const mockProfile = {
      success: true,
      profile: {
        username: student.username,
        name: student.name,
        email: student.email,
        status: student.is_terminated ? "Terminated" : "Active",
        attempts_taken: student.attempts_taken ?? 1,
        max_attempts: student.max_attempts ?? 3
      },
      timetable: {
        schedule: {
          start_time: new Date(Date.now() - 3600000).toISOString(),
          end_time: new Date(Date.now() + 86400000).toISOString(),
          topics: ["Frontend", "Backend", "General"],
          is_active: true
        }
      },
      history: [
        {
          session_id: `sess_${student.username}_1`,
          attempt_number: 1,
          started_at: new Date(Date.now() - 7200000).toISOString(),
          ended_at: new Date(Date.now() - 5400000).toISOString(),
          status: "completed",
          result: {
            score: 8.5,
            clarity: 8.8,
            technical_accuracy: 8.3,
            feedback: "Demonstrated strong conceptual grasp of software engineering fundamentals and clear communication.",
            categories: {
              "General": 8.5,
              "Frontend": 8.7,
              "Backend": 8.2
            }
          },
          submissions: [
            {
              id: "sub-1",
              session_id: `sess_${student.username}_1`,
              question_id: 1,
              question_text: "Please introduce yourself, describing your background, key technical strengths, and recent software projects.",
              category: "General",
              answer: "I am a full-stack developer with experience in Angular, Node.js, and cloud deployments.",
              score: 8.5,
              clarity: 8.8,
              technical_accuracy: 8.3,
              feedback: "Well-structured response highlighting relevant experience.",
              submitted_at: new Date(Date.now() - 6900000).toISOString(),
              video_file: "sample_stream.mp4",
              has_video: true
            },
            {
              id: "sub-2",
              session_id: `sess_${student.username}_1`,
              question_id: 2,
              question_text: "Explain the differences between let, const, and var in JavaScript, and what hoisting means.",
              category: "Frontend",
              answer: "let and const are block scoped, while var is function scoped. const prevents reassignment. Hoisting moves declarations to top of scope.",
              score: 8.7,
              clarity: 9.0,
              technical_accuracy: 8.5,
              feedback: "Accurate distinction between scoping and variable reassignments.",
              submitted_at: new Date(Date.now() - 6300000).toISOString(),
              video_file: "sample_stream.mp4",
              has_video: true
            }
          ],
          recordings: [
            {
              id: "rec-1",
              session_id: `sess_${student.username}_1`,
              username: student.username,
              video_file: "sample_stream.mp4",
              duration_sec: 120,
              size_mb: 8.5,
              submitted_at: new Date(Date.now() - 5400000).toISOString()
            }
          ],
          screen_recordings: [],
          proctoring: [
            {
              type: "tab_switch",
              event: "tab_switch",
              message: "Student switched tab briefly",
              detail: "Student switched tab briefly",
              timestamp: new Date(Date.now() - 6500000).toISOString()
            }
          ],
          session_logs: [
            {
              action: "exam_started",
              timestamp: new Date(Date.now() - 7200000).toISOString()
            },
            {
              action: "exam_completed",
              timestamp: new Date(Date.now() - 5400000).toISOString()
            }
          ],
          evidence: []
        }
      ]
    };

    return of(new HttpResponse({ status: 200, body: mockProfile })).pipe(delay(100));
  }

  // 6b. Proctoring Evidence
  if (url.includes('/recording/proctoring/evidence/')) {
    return of(new HttpResponse({
      status: 200,
      body: {
        success: true,
        evidence: []
      }
    })).pipe(delay(50));
  }

  // 6c. Classes by Topic
  if (url.includes('/classes/by-topic')) {
    return of(new HttpResponse({
      status: 200,
      body: {
        classes: [
          { id: 1, name: "Class 10-A", batch: "Batch-2026" },
          { id: 2, name: "Class 10-B", batch: "Batch-2026" }
        ]
      }
    })).pipe(delay(50));
  }

  // 6d. Single Live Exam status
  if (url.includes('/admin/live-exam/')) {
    return of(new HttpResponse({
      status: 200,
      body: {
        username: "student1",
        isLive: true,
        current_question: 1,
        total_questions: 10
      }
    })).pipe(delay(50));
  }

  // 6e. Bulk Import Status
  if (url.includes('/admin/bulk-import/status/')) {
    return of(new HttpResponse({
      status: 200,
      body: {
        status: "completed",
        processed: 10,
        total: 10,
        errors: []
      }
    })).pipe(delay(50));
  }

  // 7. Admin Students List
  if (url.includes('/admin/smart-students') || url.includes('/admin/students')) {
    return of(new HttpResponse({
      status: 200,
      body: {
        students: MOCK_STUDENTS,
        total: MOCK_STUDENTS.length,
        page: 1,
        limit: 10
      }
    })).pipe(delay(100));
  }

  // 8. Admin Batches
  if (url.includes('/admin/batches')) {
    return of(new HttpResponse({
      status: 200,
      body: {
        batches: [
          { id: "batch-1", name: "2026 Placement Batch", student_count: 24, students: ["student1", "student2"], topics: ["Frontend", "Backend"] },
          { id: "batch-2", name: "2026 Advanced Systems", student_count: 18, students: ["student3", "student4"], topics: ["Database", "System Design"] }
        ]
      }
    })).pipe(delay(100));
  }

  // 8. Live Exams & Session Logs
  if (url.includes('/admin/live-exams')) {
    return of(new HttpResponse({
      status: 200,
      body: {
        count: 1,
        exams: [
          { username: "student2", student_name: "Priya Patel", question_index: 2, total_questions: 10, warnings: 0, isLive: true }
        ]
      }
    })).pipe(delay(100));
  }

  if (url.includes('/admin/session-logs')) {
    return of(new HttpResponse({
      status: 200,
      body: []
    })).pipe(delay(100));
  }

  // 9. Single Answer Evaluation
  if (url.includes('/evaluation/evaluate-single')) {
    return of(new HttpResponse({
      status: 200,
      body: {
        score: 8.5,
        clarity: 8.8,
        technical_accuracy: 8.4,
        feedback: "Comprehensive and articulate answer demonstrating strong conceptual understanding.",
        is_gibberish: false,
        progressive_score: {
          overall: 8.5,
          breakdown: {
            clarity: 8.8,
            accuracy: 8.4,
            depth: 8.3
          }
        }
      }
    })).pipe(delay(300));
  }

  // 10. Exam Settings
  if (url.includes('/exam-settings')) {
    return of(new HttpResponse({
      status: 200,
      body: {
        settings: {
          duration: 300,
          questionTimer: 60,
          enableProctoring: true,
          maxWarnings: 5
        }
      }
    })).pipe(delay(100));
  }

  // 11. Generic Mutations (submissions, recordings, reports, logs)
  if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT') {
    return of(new HttpResponse({
      status: 200,
      body: { success: true, message: "Action completed successfully" }
    })).pipe(delay(150));
  }

  return next(req);
};
