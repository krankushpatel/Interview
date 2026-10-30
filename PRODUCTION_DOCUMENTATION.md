# 🎓 AI-Powered Interview & Proctoring Platform
## Production-Grade System Architecture & Technical Documentation

---

| **Document Attribute** | **Specification** |
|---|---|
| **Project Name** | AI Interview & Exam Proctoring Platform |
| **Document Version** | 1.0.0 (Production Candidate) |
| **Status** | Approved for Production Readiness |
| **Last Updated** | October 2026 |
| **Author** | Eklakshya |
| **Target Audience** | DevOps Engineers, System Architects, Developers, Technical Leads |

---

## 📑 Table of Contents

1. [Executive Summary & Scope](#1-executive-summary--scope)
2. [High-Level System Architecture](#2-high-level-system-architecture)
3. [Technology Stack & Specifications](#3-technology-stack--specifications)
4. [Production Infrastructure & Deployment Guide](#4-production-infrastructure--deployment-guide)
5. [Environment Variables & Secrets Management](#5-environment-variables--secrets-management)
6. [Database Schema & Data Persistence](#6-database-schema--data-persistence)
7. [Core Subsystems & Business Logic Workflows](#7-core-subsystems--business-logic-workflows)
8. [API & WebSocket Specifications](#8-api--websocket-specifications)
9. [Production Security & Hardening Checklist](#9-production-security--hardening-checklist)
10. [Maintenance, Monitoring & Disaster Recovery (Runbook)](#10-maintenance-monitoring--disaster-recovery-runbook)

---

## 1. Executive Summary & Scope

### 1.1 Purpose
The **AI-Powered Interview & Proctoring Platform** is an enterprise-grade automated assessment solution designed for conducting remote technical interviews, competitive examinations, and skills verification. The platform eliminates the need for human proctors by combining advanced client-side behavioral analysis with cloud-based AI evaluation.

### 1.2 Target Personas
* **Candidates / Students:** Seamless browser-based exam interface, automated system compatibility checks, real-time audio/screen recording, and instant or scheduled results.
* **Examiners / Administrators:** Complete control via the Admin Portal, question bank management, bulk student/question ingestion, batch scheduling, live WebSocket monitoring of ongoing exams, and detailed violation audits.

### 1.3 Key Architectural Pillars
* **High Availability & Low Latency:** FastAPI asynchronous ASGI core with multi-worker concurrency.
* **Proctoring Integrity:** Multi-layered anti-cheating engine (Tab switch detection, blur events, face presence via `face-api.js`, and voice diarization via Deepgram Nova-3).
* **AI Evaluation Engine:** Multi-model fallback scoring architecture (Google Gemini primary, Anthropic Claude / OpenRouter fallback).
* **Enterprise Persistence:** MongoDB thread-safe connection pooling for sub-millisecond response times.

---

## 2. High-Level System Architecture

### 2.1 Architectural Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             CLIENT TIER                                  │
│   Web Browser (Candidate UI / Admin Dashboard)                          │
│   - Angular 20 + Ionic 8 (PWA / Responsive Desktop)                      │
│   - face-api.js (Local Face Tracking)                                    │
│   - MediaRecorder API (Video, Audio & Screen Streams)                    │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ HTTPS / WSS
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          EDGE & GATEWAY TIER                             │
│   Nginx Reverse Proxy & Load Balancer                                    │
│   - SSL/TLS Termination (Let's Encrypt / Wildcard Cert)                  │
│   - Static Asset Serving (Angular Production Bundle)                     │
│   - WebSocket Upgrade Handlers & Gzip Compression                        │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ Internal Reverse Proxy (Port 8001)
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         APPLICATION TIER                                 │
│   FastAPI ASGI Application (Python 3.11+)                                │
│   - Process Manager: Gunicorn (4+ Uvicorn Workers)                       │
│   - JWT Auth & Role-Based Access Control (Admin / Student)               │
│   - WebSocket Hub (/ws/admin/live-exams, /ws/stt-stream)                 │
│   - Proctoring Analyzer & AI Scoring Pipeline                            │
└──────────────┬─────────────────────┬──────────────────────┬──────────────┘
               │                     │                      │
               ▼                     ▼                      ▼
┌──────────────────────┐ ┌──────────────────────┐ ┌────────────────────────┐
│    DATABASE TIER     │ │   THIRD-PARTY AI     │ │      COMMUNICATIONS    │
│ MongoDB 7.x          │ │ - Google Gemini Flash│ │ - Google SMTP / SendGrid│
│ - Connection Pool    │ │ - Deepgram Nova-3 STT│ │   (Credentials, Exam   │
│ - Collections: Users,│ │ - OpenRouter/Claude  │ │    Schedules, Alerts)  │
│   Questions, Batches │ │   (Fallback Scoring) │ │                        │
└──────────────────────┘ └──────────────────────┘ └────────────────────────┘
```

### 2.2 Network & Communication Protocol Topology
* **Public Port 443 (HTTPS):** Production traffic for frontend application, REST API requests, and secure WebSockets.
* **Internal Port 8001:** FastAPI backend application binding (`127.0.0.1:8001`).
* **Internal Port 27017:** MongoDB database service (`127.0.0.1:27017`).
* **Real-time Protocol (`wss://`):** Full-duplex WebSocket connections for audio speech-to-text diarization and live proctoring telemetry.

---

## 3. Technology Stack & Specifications

### 3.1 Frontend Stack (Client Tier)
| Component | Technology | Version | Purpose |
|---|---|---|---|
| **Framework** | Angular | 20.3.x | Single Page Application (SPA) architecture |
| **UI Components** | Ionic Framework | 8.0.x | Mobile-first, responsive dashboard components |
| **Language** | TypeScript | 5.x | Strictly typed client-side application logic |
| **Facial Tracking** | face-api.js | 0.22.x | Client-side real-time multi-face detection |
| **State & Async** | RxJS | 7.8.x | Reactive event-driven state streams |
| **Excel Parser** | xlsx (SheetJS) | 0.18.x | Client-side spreadsheet template processing |
| **Reporting** | jsPDF | 4.2.x | Downloadable PDF exam report generation |

### 3.2 Backend Stack (Application Tier)
| Component | Technology | Version | Purpose |
|---|---|---|---|
| **Core Framework** | FastAPI | 0.104+ | High-performance asynchronous REST & WebSocket API |
| **Language** | Python | 3.11+ | Execution runtime |
| **ASGI Server** | Uvicorn / Gunicorn | Latest | Production ASGI web server with worker management |
| **Data Validation** | Pydantic | 2.5+ | Schema enforcement and runtime data validation |
| **Database Driver** | PyMongo | 4.x | MongoDB client with pooled socket connections |
| **Auth & Crypto** | PyJWT & Bcrypt | Latest | JWT generation, verification, and bcrypt hashing |
| **Excel Ingestion** | Pandas & OpenPyXL | Latest | Bulk student and question ingestion engine |

### 3.3 Third-Party Cloud Services
* **Speech-to-Text & Diarization:** Deepgram Nova-3 API (Multi-speaker separation in under 300ms latency).
* **Primary AI Evaluation:** Google Gemini API (`gemini-3.5-flash` / `gemini-3.5-flash-lite`).
* **Fallback AI Evaluation:** OpenRouter API (`moonshotai/kimi-k2.6` / `nvidia/nemotron-3-ultra`).
* **Email Delivery:** SMTP Server (TLS Port 587) for transactional candidate onboarding.

---

## 4. Production Infrastructure & Deployment Guide

### 4.1 Production Server Sizing Guidelines
* **Minimum Configuration (Up to 100 concurrent examinees):**
  * 4 vCPU, 8 GB RAM, 80 GB SSD (NVMe preferred), Ubuntu 22.04 LTS.
* **Recommended Enterprise Configuration (100–500 concurrent examinees):**
  * 8 vCPU, 16 GB RAM, 250 GB SSD (or dedicated AWS S3/Cloudflare R2 for recording storage).

---

### 4.2 Step-by-Step Linux Production Deployment

#### Step 1: System Package Preparation
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3.11 python3.11-venv python3-pip nodejs npm nginx git curl mongodb
```

#### Step 2: Clone and Setup Backend
```bash
# Clone to production directory
cd /var/www/
sudo git clone <REPOSITORY_URL> interview_platform
sudo chown -R $USER:$USER /var/www/interview_platform
cd /var/www/interview_platform/backend

# Create virtual environment
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
pip install gunicorn

# Initialize Admin and verify DB
python add_admin.py
```

#### Step 3: Configure Systemd Service for FastAPI
Create `/etc/systemd/system/interview-backend.service`:
```ini
[Unit]
Description=Interview Platform FastAPI Backend
After=network.target mongod.service

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/interview_platform/backend
Environment="PATH=/var/www/interview_platform/backend/.venv/bin"
ExecStart=/var/www/interview_platform/backend/.venv/bin/gunicorn \
    -w 4 \
    -k uvicorn.workers.UvicornWorker \
    main:app \
    --bind 127.0.0.1:8001 \
    --access-logfile /var/log/interview/backend_access.log \
    --error-logfile /var/log/interview/backend_error.log

Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo mkdir -p /var/log/interview
sudo chown -R www-data:www-data /var/log/interview
sudo systemctl daemon-reload
sudo systemctl enable interview-backend
sudo systemctl start interview-backend
```

#### Step 4: Build and Deploy Frontend
```bash
cd /var/www/interview_platform
npm install
npm run build -- --configuration production
```
*The optimized production files will be output to `/var/www/interview_platform/dist/` (or `www/`).*

#### Step 5: Configure Nginx Reverse Proxy & SSL
Create `/etc/nginx/sites-available/interview.conf`:
```nginx
server {
    listen 80;
    server_name exam.yourcompany.com api.yourcompany.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name exam.yourcompany.com;

    # SSL Certificates (managed via Certbot)
    ssl_certificate /etc/letsencrypt/live/exam.yourcompany.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/exam.yourcompany.com/privkey.pem;

    root /var/www/interview_platform/dist;
    index index.html;

    # Frontend Single Page App Routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Reverse Proxy for Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket Proxy for Real-time Streaming
    location /ws/ {
        proxy_pass http://127.0.0.1:8001/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

Enable Nginx site and reload:
```bash
sudo ln -s /etc/nginx/sites-available/interview.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 5. Environment Variables & Secrets Management

The application loads configuration via `backend/.env`. All production variables must be configured with secure secrets:

| Variable Name | Required | Default / Format | Description |
|---|---|---|---|
| `MONGO_URL` | **Yes** | `mongodb://127.0.0.1:27017/` | Connection URI for the MongoDB instance |
| `MONGO_DB_NAME` | **Yes** | `interview_platform` | Primary application database name |
| `JWT_SECRET_KEY` | **Yes** | 64+ char random string | Secret key for signing candidate & admin JWT tokens |
| `GEMINI_API_KEY` | **Yes** | `AIzaSy...` | Google AI Studio API key for answer evaluation |
| `GEMINI_MODEL` | No | `gemini-3.5-flash-lite` | Primary LLM model identifier |
| `GEMINI_MODEL_FALLBACK`| No | `gemini-3.5-flash` | Secondary LLM model fallback |
| `DEEPGRAM_API_KEY` | **Yes** | 40-character hex key | Deepgram API key for speech diarization |
| `OPENROUTER_API_KEY` | No | `sk-or-v1-...` | Fallback LLM provider key |
| `SMTP_HOST` | **Yes** | `smtp.gmail.com` | Outgoing email server hostname |
| `SMTP_PORT` | **Yes** | `587` | Outgoing email server port (STARTTLS) |
| `SMTP_USER` | **Yes** | `admin@company.com` | Email account username |
| `SMTP_PASSWORD` | **Yes** | 16-character App code | Email account App Password (no spaces) |
| `FROM_EMAIL` | **Yes** | `no-reply@company.com` | Outgoing sender display email |

---

## 6. Database Schema & Data Persistence

The MongoDB database (`interview_platform`) utilizes optimized schema collections:

```
interview_platform (Database)
├── users                  → Candidates and Admin accounts
├── questions              → Question repository (categorized, difficulty levels)
├── batches                → Group groupings, schedules, and custom rules
├── exam_sessions          → Active exam session metadata and timestamps
├── submissions            → Candidate responses and evaluations
├── session_proctoring     → Real-time event log of detected violations
├── exam_recordings        → Candidate webcam/audio recording metadata
└── screen_recordings      → Candidate screen capture stream metadata
```

### 6.1 Essential Production Indexes
To ensure sub-50ms query execution during bulk exam sessions, the following indexes are maintained:
```javascript
// Execute in MongoDB Shell (mongosh):
use interview_platform;

// 1. Users collection: Fast login and uniqueness enforcement
db.users.createIndex({ "username": 1 }, { unique: true });
db.users.createIndex({ "role": 1 });

// 2. Questions collection: Category and Class lookup
db.questions.createIndex({ "id": 1 }, { unique: true });
db.questions.createIndex({ "category": 1 });
db.questions.createIndex({ "class_name": 1 });

// 3. Proctoring collection: Session telemetry aggregation
db.session_proctoring.createIndex({ "session_id": 1, "timestamp": -1 });
db.session_proctoring.createIndex({ "username": 1 });

// 4. Submissions collection: Candidate result lookups
db.submissions.createIndex({ "username": 1, "created_at": -1 });
```

---

## 7. Core Subsystems & Business Logic Workflows

### 7.1 Candidate Exam Lifecycle Workflow

```
[Candidate Login]
       │
       ▼
[System Compatibility Check] ──> (Verify Camera, Microphone, Screen Share Access)
       │
       ▼
[Exam Room Initialization]  ──> (Generate Session ID, Initialize WebSocket Stream)
       │
       ▼
[Question Delivery & Proctoring Loop]
   ├── Client Event Listeners:
   │     • Window Blur / Tab Switch Detection
   │     • Fullscreen Enforcement
   │     • Local Face Tracking (0, 1, or multiple faces)
   ├── Real-Time Audio Streaming (Deepgram Nova-3 Diarization)
   └── Background Screen & Camera Recording Chunking
       │
       ▼
[Exam Finalization / Auto-Submission]
       │
       ▼
[AI Evaluation Pipeline Triggered]
       │
       ▼
[Results & Feedback Generation]
```

### 7.2 Proctoring & Cheating Detection Rules
Violations are classified by severity and deducted from candidate integrity ratings:
* **Critical Violations (Penalty: Immediate Flagging after 5 instances):**
  * Window blur or tab switching (attempting to Google answers).
  * Fullscreen exit attempt.
  * Secondary speaker detected (voice diarization identifies multiple distinct vocal prints).
  * Multiple faces detected within camera frame.
  * Developer tools / Inspect element shortcuts opened.
* **Minor Violations:**
  * Face temporarily missing from frame (< 5 seconds).
  * Audio volume drop / background noise.

### 7.3 Multi-Model AI Evaluation Pipeline
When an answer is submitted, the backend routes the response through an automated evaluation engine:
1. **Model Hierarchy:**
   * Primary: Google Gemini (`gemini-3.5-flash-lite` / `gemini-3.5-flash`).
   * Fallback: OpenRouter (`nvidia/nemotron-3-ultra` / `moonshotai/kimi-k2.6`).
   * Final Fallback: Keyword-based semantic rule scoring engine.
2. **Scoring Rubric (Scale 0–10):**
   * **Technical Correctness (40%):** Accuracy of technical facts, algorithms, and concepts.
   * **Completeness (30%):** Coverage of core requirements stated in question.
   * **Clarity & Articulation (30%):** Structure, terminology, and explanation clarity.

---

## 8. API & WebSocket Specifications

### 8.1 Primary REST Endpoints
| HTTP Method | Endpoint | Authorization | Description |
|---|---|---|---|
| `POST` | `/auth/login` | Public | Authenticates candidate or admin; returns JWT token |
| `GET` | `/questions/all` | Bearer Token | Retrieves active question bank (filtered by category/class) |
| `POST` | `/admin/bulk-import/questions` | Admin Only | Ingests Excel question sheets with column normalization |
| `POST` | `/admin/students/bulk-import` | Admin Only | Ingests candidate rosters and triggers automated email invites |
| `GET` | `/classes/all` | Admin Only | Retrieves all unique classes from questions collection |
| `POST` | `/batches/create` | Admin Only | Creates a batch group and configures topic distributions |
| `POST` | `/submissions/submit` | Student Token | Submits candidate answer and triggers async evaluation |
| `GET` | `/results/student/{username}` | Bearer Token | Retrieves completed score reports and violation tallies |

### 8.2 Real-Time WebSocket Protocols
* **Admin Live Monitoring (`/ws/admin/live-exams?token=<JWT>`):**
  * Broadcasts active exam sessions, current question index, elapsed time, and real-time violation alerts to the Admin dashboard.
* **Audio Diarization Stream (`/ws/stt-stream`):**
  * Ingests real-time raw PCM/WAV audio chunks from candidate's browser and correlates speaker count with Deepgram's live diarization engine.

---

## 9. Production Security & Hardening Checklist

Prior to launching the platform for public examinations, ensure the following hardening steps are verified:

- [x] **CORS Origins Restricted:** In `backend/main.py`, replace wildcard `allow_origins=["*"]` with explicit production domains (e.g. `["https://exam.yourcompany.com"]`).
- [x] **Secure JWT Configuration:** Verify `JWT_SECRET_KEY` in `backend/.env` is a cryptographically strong, non-default random hash.
- [x] **Database Authentication:** Ensure MongoDB is secured with user authentication enabled (`auth = true` in `/etc/mongod.conf`) and not exposed to the public internet.
- [x] **SSL / HTTPS Enforcement:** Confirm all HTTP requests are redirected to HTTPS with HSTS headers enabled in Nginx.
- [x] **Media Directory Permissions:** Ensure `backend/uploads/` is writable by `www-data` but execution permissions are disabled (`chmod 750`).
- [x] **API Rate Limiting:** Implement rate limiting on `/auth/login` to prevent credential brute-forcing.

---

## 10. Maintenance, Monitoring & Disaster Recovery (Runbook)

### 10.1 Service Management Commands
```bash
# Check service health
sudo systemctl status interview-backend
sudo systemctl status nginx
sudo systemctl status mongod

# Restart backend service
sudo systemctl restart interview-backend

# View real-time application logs
sudo journalctl -u interview-backend -f --no-tail
```

### 10.2 Automated Database Backup Script (Crontab)
Create `/usr/local/bin/backup-interview-db.sh`:
```bash
#!/bin/bash
BACKUP_DIR="/var/backups/mongodb"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
mkdir -p "$BACKUP_DIR"

# Perform mongodump
mongodump --db interview_platform --out "$BACKUP_DIR/backup_$TIMESTAMP"

# Retain only last 7 days of backups
find "$BACKUP_DIR" -type d -mtime +7 -exec rm -rf {} +
```
*Schedule in root crontab (`crontab -e`):*
```cron
0 2 * * * /usr/local/bin/backup-interview-db.sh > /dev/null 2>&1
```

### 10.3 Disaster Recovery: Mid-Exam Disconnection SOP
If a candidate experiences an unexpected power outage, browser crash, or network drop:
1. Administrator navigates to **Admin Dashboard -> Students**.
2. Locate candidate username and click **"Reset Termination"** or **"Increase Attempts (+1)"**.
3. Candidate can log back in. The system preserves previously submitted questions and assigns fresh or remaining questions as per the batch configuration.

---

## 🏁 Sign-Off & Approval

| Role | Name | Signature / Status | Date |
|---|---|---|---|
| **Lead Developer** | Ankush Kumar | Approved | 2026-10-26 |
| **System Architect** | Kumar Kudari | Pending(review) | 2026-10-26 |
| **DevOps / QA** | Production Operations | Pending Deployment | 2026-10-26 |
