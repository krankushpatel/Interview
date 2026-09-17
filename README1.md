# 🎓 AI-Powered Interview & Exam Proctoring Platform

> **A comprehensive remote interview/exam platform with real-time AI evaluation, advanced proctoring, and behavior-based scoring**

---

## 📋 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [API Documentation](#api-documentation)
- [Usage Guide](#usage-guide)
- [Data Models](#data-models)
- [Architecture](#architecture)
- [Contributing](#contributing)

---

## 🎯 Overview

This is a **full-stack AI-powered interview and exam proctoring platform** designed for conducting fair, remote assessments with real-time proctoring and intelligent evaluation. The platform combines:

- **AI-Powered Evaluation**: Scores answers using Claude AI and OpenRouter with detailed feedback
- **Real-Time Proctoring**: Detects cheating attempts including speaker diarization, facial recognition, tab switching, copy attempts, and more
- **Live Monitoring**: Administrators can monitor active exams in real-time
- **Secure Recording**: Records both exam and screen activity for review
- **Bulk Operations**: Import students and questions via Excel/CSV files

### Perfect For:
- Educational institutions conducting entrance exams
- Recruitment teams running technical interviews
- Certification programs requiring proctored assessments
- Training centers with remote evaluations

---

## ✨ Key Features

### 👨‍🎓 For Students

| Feature | Description |
|---------|-------------|
| **Secure Authentication** | JWT-based login system with role-based access |
| **Exam Interface** | Clean, intuitive interface for answering questions |
| **Real-Time Recording** | Automatic exam and screen recording for proctoring |
| **Audio Monitoring** | WebSocket-based real-time audio streaming with speaker detection |
| **Exam Schedule** | View assigned exams, topics, and time slots |
| **Results & Feedback** | Immediate AI-generated evaluation scores and detailed feedback |
| **Session Logging** | Complete activity tracking during the exam |

### 👨‍💼 For Administrators

| Feature | Description |
|---------|-------------|
| **Student Management** | Add, remove, and manage student accounts |
| **Bulk Import** | Upload student lists and question banks via Excel/CSV |
| **Question Bank** | Manage questions by category, difficulty, and topics |
| **Exam Scheduling** | Set exam dates, times, topics, and eligibility windows |
| **Live Monitoring** | Real-time dashboard showing all active exam sessions |
| **Violation Tracking** | Monitor proctoring violations and behavior analysis |
| **Results Analytics** | View all evaluation results with AI scores and feedback |
| **Recording Management** | Access and download exam and screen recordings |
| **Student Termination** | Block students exceeding violation thresholds |

### 🤖 AI & Proctoring

| Feature | Description |
|---------|-------------|
| **Multi-Model Evaluation** | Claude (primary) + OpenRouter Gemini (fallback) |
| **Detailed Scoring** | Correctness, completeness, clarity (0-10 scale) |
| **Speaker Diarization** | Real-time detection of multiple speakers using Deepgram AI |
| **Facial Recognition** | Detects multiple faces during exam using face-api.js |
| **Behavior Classification** | Fair / Suspicious / Cheating based on violation count |
| **Violation Penalties** | Automatic score deduction based on proctoring events |
| **Progressive Scoring** | Tracks performance across multiple attempts |

### 🚨 Proctoring Violations Detected

```
CRITICAL VIOLATIONS (Cheating if 5+ detected):
✗ Tab switching
✗ Window blur/unfocus
✗ Developer tools attempt
✗ Copy attempt
✗ Fullscreen exit
✗ Multiple faces detected
✗ Multiple speakers detected
✗ Split screen detected
✗ App switcher detected
✗ Screenshot attempt
```

---

## 🛠️ Technology Stack

### Frontend
```
┌─ Framework & Build ─────┐
│ • Angular 20.x          │
│ • Ionic 8.x             │
│ • TypeScript 5.x        │
│ • Capacitor 6.x         │
│ • Angular CLI            │
│ • RxJS                  │
│ • SCSS                  │
└─────────────────────────┘

┌─ Libraries & Tools ─────┐
│ • face-api.js          │ Face detection
│ • webrtcvad            │ Voice detection
│ • @capacitor/*         │ Native features
│ • xlsx                 │ Excel processing
│ • HttpClient           │ API communication
└─────────────────────────┘
```

### Backend
```
┌─ Core Framework ────────┐
│ • FastAPI 0.104+       │
│ • Python 3.11+         │
│ • Uvicorn              │
│ • Pydantic 2.5         │
│ • WebSockets           │
│ • JWT Authentication   │
└─────────────────────────┘

┌─ AI & Audio Processing ─┐
│ • Anthropic Claude API │ Answer evaluation
│ • OpenRouter API       │ Fallback AI
│ • Deepgram API         │ Speaker diarization
│ • OpenAI Whisper       │ Speech-to-text
│ • webrtcvad 2.0.10     │ Voice activity detection
│ • NumPy                │ Audio processing
└─────────────────────────┘

┌─ Data & Files ──────────┐
│ • JSON (in-memory)      │ Data persistence
│ • openpyxl              │ Excel parsing
│ • aiohttp               │ Async HTTP client
│ • email-validator       │ Email validation
└─────────────────────────┘
```

### Data Storage
- **Primary**: JSON files (in-memory with file sync)
- **Location**: `/backend/data/`
- **No external database required** (simplified deployment)

### External Services
| Service | Purpose | Config |
|---------|---------|--------|
| **Anthropic Claude** | AI answer evaluation | `ANTHROPIC_API_KEY` |
| **OpenRouter** | Fallback AI (Gemini 1.5 Pro) | `OPENROUTER_API_KEY` |
| **Deepgram** | Real-time speaker diarization | `DEEPGRAM_API_KEY` |
| **OpenAI Whisper** | Speech-to-text (optional) | Built-in model |

---

## 📁 Project Structure

```
interview_app/
│
├── 📱 Frontend (Angular/Ionic)
│   ├── src/
│   │   ├── app/
│   │   │   ├── pages/
│   │   │   │   ├── login/           → Login page
│   │   │   │   ├── student/         → Student exam interface
│   │   │   │   ├── admin/           → Admin dashboard
│   │   │   │   └── results/         → Results display
│   │   │   │
│   │   │   ├── components/
│   │   │   │   ├── add-student-modal/
│   │   │   │   ├── bulk-import-modal/
│   │   │   │   ├── live-view-modal/
│   │   │   │   ├── proctoring-logs-modal/
│   │   │   │   ├── student-detail-modal/
│   │   │   │   ├── submission-modal/
│   │   │   │   └── video-modal/
│   │   │   │
│   │   │   ├── services/
│   │   │   │   ├── auth.service.ts           → Auth & login
│   │   │   │   ├── question.service.ts       → Question retrieval
│   │   │   │   ├── recording.service.ts      → Video upload
│   │   │   │   ├── proctoring.service.ts     → Violation events
│   │   │   │   ├── admin.service.ts          → Admin operations
│   │   │   │   ├── progressive-evaluation.service.ts → Scoring
│   │   │   │   ├── speech.service.ts         → Speech recognition
│   │   │   │   ├── diarization.service.ts    → Speaker detection
│   │   │   │   └── ...
│   │   │   │
│   │   │   └── interceptors/
│   │   │       └── auth.interceptor.ts       → JWT injection
│   │   │
│   │   ├── assets/          → Images, icons, JS files
│   │   ├── environments/     → Environment configs
│   │   ├── theme/           → SCSS variables
│   │   └── main.ts          → App bootstrap
│   │
│   ├── package.json
│   ├── angular.json
│   └── tsconfig.json
│
├── 🐍 Backend (FastAPI)
│   ├── main.py                 → FastAPI app setup, CORS, routes
│   ├── requirements.txt         → Python dependencies
│   ├── config/
│   │   └── settings.py          → Configuration, thresholds
│   │
│   ├── code/
│   │   ├── auth/                → Authentication & JWT
│   │   │   ├── routes.py
│   │   │   ├── jwt_utils.py
│   │   │   └── password_utils.py
│   │   │
│   │   ├── questions/           → Question management (CRUD)
│   │   │   └── routes.py
│   │   │
│   │   ├── submissions/         → Answer tracking
│   │   │   └── routes.py
│   │   │
│   │   ├── evaluation/          → AI-powered scoring
│   │   │   ├── routes.py
│   │   │   ├── ai_evaluation.py (Claude, OpenRouter)
│   │   │   └── ollama_evaluation.py
│   │   │
│   │   ├── proctoring/          → Violation detection
│   │   │   ├── routes.py
│   │   │   └── manager.py       → Behavior analysis engine
│   │   │
│   │   ├── audio/               → Real-time audio processing
│   │   │   ├── routes.py        → WebSocket endpoint
│   │   │   ├── vad_processor.py → Voice activity detection
│   │   │   └── diarization.py   → Speaker detection
│   │   │
│   │   ├── recording/           → Video upload & streaming
│   │   │   ├── routes.py
│   │   │   ├── screen_manager.py
│   │   │   └── websocket_handlers.py
│   │   │
│   │   ├── results/             → Result retrieval
│   │   │   └── routes.py
│   │   │
│   │   ├── admin/               → Admin operations
│   │   │   ├── routes.py
│   │   │   ├── students.py
│   │   │   ├── bulk_operations.py
│   │   │   └── monitoring.py
│   │   │
│   │   ├── student/             → Student status tracking
│   │   ├── submissions/         → Submission handling
│   │   ├── timetable/           → Exam scheduling
│   │   ├── categories/          → Question categories
│   │   ├── batches/             → Batch management
│   │   ├── core/                → Shared utilities
│   │   │   ├── data_manager.py  → JSON persistence
│   │   │   ├── helpers.py
│   │   │   └── constants.py
│   │   ├── services/            → Business logic
│   │   │   ├── bulk_import_service.py
│   │   │   ├── email_service.py
│   │   │   ├── timetable_service.py
│   │   │   └── live_tracking.py
│   │   └── legacy/              → Deprecated services
│   │
│   ├── data/                    → JSON data files
│   │   ├── users.json
│   │   ├── questions.json
│   │   ├── submissions.json
│   │   ├── results_store.json
│   │   ├── exam_recordings.json
│   │   ├── session_proctoring.json
│   │   ├── timetables.json
│   │   └── ...
│   │
│   ├── uploads/                 → User uploaded files
│   │   ├── exam_recordings/
│   │   └── screen_recordings/
│   │
│   └── templates/               → Email templates (if needed)
│
└── Configuration Files
    ├── angular.json
    ├── capacitor.config.ts
    ├── ionic.config.json
    ├── package.json
    ├── tsconfig.json
    └── karma.conf.js
```

---

## 📋 Prerequisites

### Required
- **Node.js** 18+ & **npm** 9+
- **Python** 3.11+
- **pip** (Python package manager)
- **Git**

### Optional (for native builds)
- **Capacitor CLI** (for Android/iOS)
- **Java JDK 17+** (for Android builds)
- **Xcode** (for iOS builds)

### API Keys Required
1. **Anthropic Claude API** → [Get API Key](https://console.anthropic.com/)
2. **OpenRouter API** → [Get API Key](https://openrouter.ai/)
3. **Deepgram API** → [Get API Key](https://console.deepgram.com/)

---

## 🚀 Installation & Setup

### Step 1: Clone Repository
```bash
cd /home/softwared/Desktop/Ankush/interview_app
git clone <repository-url> .
```

### Step 2: Frontend Setup

```bash
# Install dependencies
npm install

# Build frontend
npm run build

# Or run in development mode
npm start
```

**Expected output:**
```
✔ Browser application bundle generation complete.
⠋ Generating optimized production build...
Application bundle generation complete. [12.89s]
```

### Step 3: Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Linux/macOS:
source venv/bin/activate
# On Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Verify installation
python -c "import fastapi; print(f'FastAPI {fastapi.__version__}')"

# run the code
uvicorn main:app --host 0.0.0.0 --port 7000 --reload 2>&1 | grep -v NNPAC

```

### Step 4: Configure Environment Variables

Create `.env` file in backend root:

```bash
cat > backend/.env << 'EOF'
# API Keys
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxxxxxx
DEEPGRAM_API_KEY=xxxxxxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx (optional)

# Server Config
HOST=0.0.0.0
PORT=8000
DEBUG=True

# JWT Config
JWT_SECRET_KEY=your-secret-key-here-change-in-production
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24

# Scoring Thresholds
PASS_THRESHOLD=65
EXCELLENT_THRESHOLD=80
CRITICAL_VIOLATION_LIMIT=5
SUSPICIOUS_VIOLATION_THRESHOLD=2
EOF
```

---

## ⚙️ Configuration

### Backend Settings
Edit `backend/code/config/settings.py`:

```python
# Scoring Configuration
PASS_THRESHOLD = 65          # Score to pass
EXCELLENT_THRESHOLD = 80     # Score for excellent
VIOLATION_PENALTY_HIGH = 25  # 5+ violations → -50%
VIOLATION_PENALTY_MID = 20   # 2-4 violations → -20%

# Proctoring
CRITICAL_VIOLATION_LIMIT = 5  # Violations to flag as cheating
SUSPICIOUS_THRESHOLD = 2      # Violations for suspicious

# AI Models
PRIMARY_AI_MODEL = "claude"    # claude or openrouter
FALLBACK_AI_MODEL = "openrouter"

# Deepgram
DEEPGRAM_MODEL = "nova-3"
DEEPGRAM_LANGUAGE = "en"
```

### Frontend Environment
Edit `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8000',
  wsUrl: 'ws://localhost:8000',
  recordingChunkSize: 4096,
};
```

---

## ▶️ Running the Application

### Option 1: Development Mode

**Terminal 1 - Backend:**
```bash
cd backend
source venv/bin/activate  # or venv\Scripts\activate on Windows
python main.py
```

Expected output:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Press CTRL+C to quit
```

**Terminal 2 - Frontend:**
```bash
npm start
```

Expected output:
```
✔ Compiled successfully.
⠋ Generating optimized production build...
Application running on: http://localhost:4200
```

### Option 2: Docker (Recommended for Deployment)

```bash
# Build Docker images
docker-compose up -d

# View logs
docker-compose logs -f
```

### Option 3: Production Build

**Backend:**
```bash
cd backend
gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app --bind 0.0.0.0:8000
```

**Frontend:**
```bash
npm run build
# Serve from dist/interview_app/browser
```

---

### Full API Reference
See `backend/main.py` for complete endpoint documentation.

---

## 📖 Usage Guide

### For Students

1. **Login**
   - Visit http://localhost:4200/login
   - Enter your credentials
   - Click "Login"

2. **View Exam Schedule**
   - Dashboard shows available exams
   - Check date, time, and topic
   - Confirm eligibility window

3. **Start Exam**
   - Click "Start Exam" button
   - Allow browser permissions for camera & microphone
   - Exam timer starts

4. **During Exam**
   - Read question carefully
   - Type your answer
   - Click "Next" for next question
   - **Important**: Keep microphone on for proctoring
   - **Important**: Don't switch tabs or minimize window

5. **Submit & Results**
   - Click "Submit Exam" when done
   - Review uploaded files
   - Wait for AI evaluation (2-5 minutes)
   - Check results on Results page

### For Administrators

1. **Login**
   - Login with admin account
   - Access admin dashboard

2. **Add Students**
   - **Option A**: Bulk Import
     - Click "Bulk Import Students"
     - Upload Excel file with columns: name, email
     - System generates username/password
     - Download credentials file
   
   - **Option B**: Manual Add
     - Click "Add Student"
     - Fill name, email, password
     - Click "Add"

3. **Set Questions**
   - Click "Question Bank"
   - **Option A**: Bulk Import
     - Upload Excel with: question, category, difficulty, answer_key
   - **Option B**: Manual Add
     - Fill question details
     - Click "Add"

4. **Schedule Exams**
   - Click "Timetable Management"
   - Select students
   - Set date, time, topic, attempts
   - Click "Schedule"

5. **Monitor Live Exams**
   - Click "Live Monitoring"
   - View all active exams
   - Monitor violations in real-time
   - Terminate student if needed

6. **Review Results**
   - Click "Results Analytics"
   - View scores, feedback, violations
   - Download recordings for audit

---

## 🏗️ Architecture

### System Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT LAYER                             │
│  (Browser/Capacitor - Angular/Ionic)                       │
│                                                             │
│  ┌─ Student Interface ─────┐  ┌─ Admin Dashboard ────┐     │
│  │ - Question Display       │  │ - Student Management │     │
│  │ - Answer Input           │  │ - Question Management│     │
│  │ - Recording              │  │ - Timetable Setup    │     │
│  │ - Real-time Audio Stream │  │ - Live Monitoring    │     │
│  │ - Result View            │  │ - Results Analytics  │     │
│  └──────────────────────────┘  └──────────────────────┘     │
└──────────────────┬──────────────────────────────────────────┘
                   │
            REST API + WebSocket
                   │
┌──────────────────▼──────────────────────────────────────────┐
│              API GATEWAY & MIDDLEWARE                        │
│  - JWT Authentication                                       │
│  - CORS                                                     │
│  - Error Handling                                           │
│  - Rate Limiting (optional)                                 │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│                  BACKEND LAYER                              │
│              (FastAPI - Python)                             │
│                                                             │
│  ┌─ Auth Module ─────────────────────────────────────┐    │
│  │ JWT generation, password hashing, role validation │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─ Student Module ──────────────────────────────────┐    │
│  │ Exam lifecycle, scheduling, session management   │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─ Question Module ─────────────────────────────────┐    │
│  │ CRUD operations, bulk import, categorization      │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─ Submission Module ───────────────────────────────┐    │
│  │ Answer collection, session tracking               │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─ Proctoring Module ───────────────────────────────┐    │
│  │ Violation detection, behavior analysis            │    │
│  │ - Tab switching                                   │    │
│  │ - Window blur                                     │    │
│  │ - DevTools                                        │    │
│  │ - Face detection                                  │    │
│  │ - Speaker diarization                             │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─ Audio Module (WebSocket) ────────────────────────┐    │
│  │ Real-time audio streaming                         │    │
│  │ - VAD processing                                  │    │
│  │ - Deepgram AI integration                         │    │
│  │ - Speaker detection                               │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─ Evaluation Module ───────────────────────────────┐    │
│  │ AI-powered scoring                                │    │
│  │ - Claude API calls                                │    │
│  │ - OpenRouter fallback                             │    │
│  │ - Behavior scoring                                │    │
│  │ - Progressive scoring                             │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─ Admin Module ────────────────────────────────────┐    │
│  │ Student management, bulk operations               │    │
│  │ - Bulk import (students, questions)               │    │
│  │ - Student termination                             │    │
│  │ - Live monitoring                                 │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─ Recording Module ────────────────────────────────┐    │
│  │ Video upload and streaming                        │    │
│  │ - Exam recording                                  │    │
│  │ - Screen recording                                │    │
│  └────────────────────────────────────────────────────┘    │
└──────────────────┬──────────────────────────────────────────┘
                   │
      ┌────────────┼────────────┬───────────────┐
      │            │            │               │
      ▼            ▼            ▼               ▼
┌──────────┐ ┌──────────┐ ┌─────────────┐ ┌──────────────┐
│  JSON    │ │External  │ │ File System │ │ AI Services  │
│  Storage │ │ Services │ │ (Uploads)   │ │              │
│          │ │          │ │             │ │ - Claude     │
│ users.   │ │Deepgram  │ │ exam_rec.   │ │ - OpenRouter │
│questions.│ │OpenAI    │ │ screen_rec. │ │ - Deepgram   │
│ results  │ │Anthropic │ │             │ │ - Whisper    │
│ etc.     │ │OpenRouter│ │             │ │              │
└──────────┘ └──────────┘ └─────────────┘ └──────────────┘
```

### Data Flow - Exam Taking
```
1. Student Login
   ↓ (JWT created)
2. Get Exam Schedule
   ↓ (Verify eligibility)
3. Start Exam
   ↓ (Create session, start recording)
4. Real-time Monitoring
   ├─ Submit answers (POST)
   ├─ Stream audio (WebSocket)
   │  └─ VAD + Deepgram → Speaker detection
   ├─ Monitor violations (POST)
   │  └─ Tab switch, blur, faces, etc.
   └─ Record video (multipart upload)
5. End Exam
   ↓ (Upload recordings)
6. Evaluation (Async)
   ├─ AI scoring (Claude/OpenRouter)
   ├─ Behavior analysis
   ├─ Penalty calculation
   └─ Save results
7. View Results
   ↓ (Display scores & feedback)
```

---

## 🔐 Security Considerations

### Authentication & Authorization
- ✅ JWT tokens with expiration
- ✅ Role-based access control (RBAC)
- ✅ Password hashing (bcrypt)
- ✅ Protected admin routes

### Proctoring Security
- ✅ Real-time violation detection
- ✅ Audio monitoring with speaker diarization
- ✅ Facial recognition for multiple faces
- ✅ Screen recording for auditing

### Data Protection
- ✅ CORS enabled for configured origins
- ✅ Input validation with Pydantic
- ✅ No sensitive data in logs
- ✅ File upload validation

### Production Recommendations
- [ ] Use HTTPS/SSL certificates
- [ ] Deploy behind reverse proxy (Nginx)
- [ ] Use production database (PostgreSQL recommended)
- [ ] Implement rate limiting
- [ ] Add request logging & monitoring
- [ ] Use environment-specific configs
- [ ] Regular security audits
- [ ] Enable API key rotation

---

## 🐛 Troubleshooting

### Common Issues

**WebSocket Connection Failed**
```
Error: Failed to connect to WebSocket
Solution: 
1. Check backend is running on port 8000
2. Verify CORS is enabled
3. Check firewall rules
4. Use ws:// for development, wss:// for production
```

**AI API Errors**
```
Error: ANTHROPIC_API_KEY not found
Solution:
1. Set ANTHROPIC_API_KEY in .env
2. Verify API key is valid
3. Check API account has credits
4. Test with curl: curl -H "Authorization: Bearer $ANTHROPIC_API_KEY" https://api.anthropic.com/v1/messages
```

**Audio Not Recording**
```
Error: Microphone permission denied
Solution:
1. Check browser microphone permissions
2. Verify HTTPS on production
3. Allow microphone access in browser settings
4. Test with: navigator.mediaDevices.getUserMedia({audio: true})
```

**High Memory Usage**
```
Issue: Application consuming too much memory
Solution:
1. Reduce concurrent WebSocket connections
2. Implement audio chunk buffering
3. Clean up temporary files
4. Profile with Python memory_profiler
```

---

## 📊 Performance Optimization

### Frontend
- Enable production build: `npm run build`
- Lazy load pages with Angular routing
- Optimize images and assets
- Use OnPush change detection strategy
- Implement virtual scrolling for large lists

### Backend
- Use async/await for I/O operations
- Implement connection pooling for APIs
- Cache frequently accessed data
- Monitor WebSocket connections
- Use pagination for large datasets

### Deployment
- Use CDN for static assets
- Compress responses with gzip
- Enable HTTP caching headers
- Load balance multiple backend instances
- Use reverse proxy (Nginx)

---

## 📝 Contributing

### Code Style
- Frontend: Follow Angular style guide
- Backend: Follow PEP 8 Python conventions
- Use meaningful variable and function names
- Add docstrings to all functions
- Comment complex logic

### Before Committing
```bash
# Frontend
npm run lint
npm run test

# Backend
flake8 code/
python -m pytest tests/
```

### Commit Message Format
```
type(scope): subject

body

fixes #issue_number
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

---

## 📞 Support & Contact

- **Documentation**: See `/docs/` folder
- **Issue Tracker**: GitHub Issues
- **Email**: krankushpatel@gmail.com

---

## 📄 License

This project is licensed under the MIT License - see LICENSE file for details.

---

## 🎉 Acknowledgments

- Built with [FastAPI](https://fastapi.tiangolo.com/)
- UI powered by [Ionic Framework](https://ionicframework.com/)
- AI evaluation via [Anthropic Claude](https://anthropic.com/)
- Speaker detection via [Deepgram](https://deepgram.com/)
- Face detection via [face-api.js](https://github.com/ml5js/face-api.js)

---

**Last Updated**: May 18, 2026  
**Version**: 1.0.0  
**Status**: Production Ready
