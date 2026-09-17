# Interview App

AI-powered interview and exam proctoring platform built with Angular/Ionic frontend and FastAPI backend.

## What this project does

- Student login and exam taking
- Admin dashboard for managing students, questions, results, and schedules
- Real-time proctoring and activity tracking
- AI-assisted answer evaluation
- Screen and exam recording support

## Project structure

- `src/` - frontend app
- `backend/` - FastAPI backend
- `docs/` - architecture diagram and related files

## Requirements

- Node.js and npm
- Python 3.10+
- MongoDB
- Optional API keys for AI/proctoring features

## Quick setup

### 1) Clone the project

```bash
git clone <repo-url>
cd <project-folder>
```

### 2) Install frontend dependencies

```bash
npm install
```

> Note: the frontend expects an API URL in `src/environments/environment.ts` and `src/environments/environment.prod.ts`.

### 3) Install backend dependencies

```bash
cd backend
python -m venv .venv
```

Activate the virtual environment:

- Linux/macOS: `source .venv/bin/activate`
- Windows: `.venv\Scripts\activate`

Then install packages:

```bash
pip install -r requirements.txt
```

### 4) Add environment values

Create a `backend/.env` file and add the values you need.

```env
DIPSTICK_API_BASE=
DIPSTICK_API_TOKEN=
DIPSTICK_TEST_ID=

JWT_SECRET_KEY=

# Email Configuration
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
FROM_EMAIL=

USE_NNPACK=0
NNPACK_DISABLE=1

# API Keys
GEMINI_API_KEY=
OPENROUTER_API_KEY=
GROQ_API_KEY=
OPENAI_API_KEY=
DEEPGRAM_API_KEY=
FRONTEND_LOGIN_URL=

# Model Configurations
GEMINI_MODEL="gemini-3.6-flash"
GEMINI_MODEL_FALLBACK="gemini-3.5-flash"
OPENROUTER_MODEL="nvidia/nemotron-3-ultra-550b-a55b:free"
OPENROUTER_MODEL_FALLBACK="moonshotai/kimi-k2.6:free"
GROQ_MODEL="llama-3.3-70b-versatile"

# Pipeline Flags
USE_EVIDENCE_BASED_SCORING=true
ALLOW_OLD_LLM_FALLBACK=false

# Database URL
MONGO_URL=
MONGO_URI=
```

### 5) Run the backend

Run this command from inside the `backend/` folder:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 6) Run the frontend

Open a new terminal, go to the project directory, and run:

```bash
ionic serve --external
```

## Helpful notes for new users

- Start MongoDB before launching the backend.
- Keep the backend and frontend running together for the full app to work.
- If login or data loading fails, first check `.env`, MongoDB, and `environment.ts`.
- If AI or voice features are disabled, verify the related API keys.

## Useful commands

```bash
npm run build
npm run lint
npm test
```

## Troubleshooting

- **Frontend cannot reach backend**: confirm the API URL in the environment file.
- **Backend crashes on start**: confirm MongoDB is reachable and required `.env` values exist.
- **Proctoring features not working**: check browser permissions for camera, microphone, and screen capture.

## License

No license file is included yet.
