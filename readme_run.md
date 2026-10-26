# 🚀 Quick Setup & Run Guide (`readme_run.md`)

A simple, beginner-friendly guide to setup, configure, and run the **AI Interview & Proctoring Platform**.  
Even if you are not a developer, you can follow these exact steps to get the app running on your machine!

---

## 📌 What is this app?

This platform consists of 3 main parts that work together:
1. **Frontend (User Interface)**: Built with Angular & Ionic (Runs in your browser at `http://localhost:3000` or `http://localhost:8100`).
2. **Backend (Server & AI Logic)**: Built with Python FastAPI (Runs at `http://localhost:8001`).
3. **Database**: MongoDB (Stores questions, students, batches, and exam records).

---

## 🛠️ Step 0: Prerequisites (Only install once on your PC)

Before starting, make sure these software tools are installed on your computer:

| Software | Download Link | Notes |
|---|---|---|
| **Node.js (v18 or v20+)** | [nodejs.org](https://nodejs.org/) | Recommended LTS version. |
| **Python (3.10 or 3.11+)** | [python.org](https://www.python.org/) | ⚠️ **Important:** Check the box **"Add Python to PATH"** during installation. |
| **MongoDB Community Server** | [mongodb.com](https://www.mongodb.com/try/download/community) | Install as a Service with **MongoDB Compass**. |
| **Git** | [git-scm.com](https://git-scm.com/) | To clone or pull project files. |

---

## 🌟 PART 1: First-Time Setup (New User - Do Only Once)

If you just cloned or received this project on a new computer, follow these steps once:

### 1. Ensure MongoDB is Running
* Open **MongoDB Compass** and click **Connect** (default connection string: `mongodb://localhost:27017` or `mongodb://127.0.0.1:27017`).
* As long as MongoDB is running in the background, you are good to go!

---

### 2. Setup the Frontend

Open your terminal (Command Prompt, PowerShell, or VS Code Terminal) in the main project folder (`Interview`):

```bash
# 1. Make sure you are in the project root folder
npm install
```
*Wait few minutes for dependencies to finish installing.*

---

### 3. Setup the Backend (Python)

In your terminal, navigate to the `backend` folder:

```bash
# 1. Go into the backend folder
cd backend

# 2. Create a virtual environment (keeps dependencies clean)
python -m venv .venv
```

Now **activate** the virtual environment:
* **On Windows (PowerShell / Command Prompt):**
  ```powershell
  .venv\Scripts\activate
  ```
  *(You will see `(.venv)` appear at the start of your terminal line).*

* **On Mac / Linux:**
  ```bash
  source .venv/bin/activate
  ```

Now **install Python packages**:
```bash
pip install -r requirements.txt
```

---

### 4. Create Initial Admin Account (`add_admin.py`) 👤

On a fresh database, there are **no users or admins** yet. You must create the initial Admin account so you can log into the Admin Dashboard:

Make sure you are in the `backend/` folder with virtual environment active:
```bash
python add_admin.py
```

👉 **Output:**
```text
✅ Admin created successfully.
Username : admin
Password : admin@123
```
*(You can use these credentials to log in at `http://localhost:3000/login`).*

---

### 5. Configure Environment Variables (`backend/.env`) ⚙️

Check that a `.env` file exists in the `backend/` folder (`backend/.env`). Open it in any text editor (like Notepad or VS Code) and verify the following key sections:

#### A. Database Connection (Required)
```env
MONGO_URL=mongodb://127.0.0.1:27017/
MONGO_DB_NAME=interview_platform
```

#### B. Email Configuration (Required for sending credentials & exam schedules to students)
To allow the system to send automatic emails to students when importing them or setting up batches:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_16_digit_app_password
FROM_EMAIL=your_email@gmail.com
```

> 💡 **How to get a Gmail App Password (Very Important):**
> 1. Your regular Gmail login password will **not** work here (Google blocks it).
> 2. Go to your [Google Account](https://myaccount.google.com/) -> **Security**.
> 3. Ensure **2-Step Verification** is turned ON.
> 4. Search for **"App passwords"** in the top search bar.
> 5. Create a new App Password (name it "Interview App"). Google will give you a **16-letter code** (e.g., `abcd efgh ijkl mnop`).
> 6. Paste this 16-letter code into `SMTP_PASSWORD` (without spaces).

#### C. AI & Audio Keys (For AI Answer Evaluation & Proctoring)
```env
GEMINI_API_KEY=AIzaSy...               # Get free key from Google AI Studio (aistudio.google.com)
DEEPGRAM_API_KEY=your_deepgram_key    # Get free key from Deepgram (console.deepgram.com) for real-time speech
```

---

## 🌐 PART 2: Do I Need to Configure an IP Address?

### ❓ Is adding an IP address necessary?
* **Case 1: Running on your own PC (Most Common):**
  * 👉 **NO!** You do **NOT** need to configure any IP address.
  * `http://localhost:3000` (frontend) and `http://localhost:8001` (backend) work automatically out-of-the-box.

* **Case 2: Testing from a Mobile Phone or another Laptop on the same Wi-Fi (LAN):**
  * 👉 **YES!** A phone cannot understand `localhost` (it thinks localhost is itself).
  * **Steps to connect from mobile:**
    1. Find your computer's local IP address:
       * On Windows, open Command Prompt and type: `ipconfig`
       * Look for **IPv4 Address** (e.g., `192.168.1.15`).
    2. Open file `src/environments/environment.ts`:
       * Change:
         ```typescript
         return (window as any).__ENV__?.API_URL || 'http://localhost:8001';
         ```
       * To your PC's IP:
         ```typescript
         return (window as any).__ENV__?.API_URL || 'http://192.168.1.15:8001';
         ```
    3. Start the frontend allowing external connections:
       ```bash
       npm start
       ```
       *(or `ionic serve --external`)*
    4. On your mobile phone browser, open:
       `http://192.168.1.15:3000`

---

## ⚡ PART 3: Daily Run Guide (How to run the app everyday)

Whenever you want to use the application, follow these simple steps:

### 🔹 Step 1: Start the Backend Server (Terminal 1)

1. Open a terminal in the project folder.
2. Run these commands:

```bash
cd backend
.venv\Scripts\activate
uvicorn main:app --reload --host 0.0.0.0 --port 8001
```
*(On Mac/Linux, use `source .venv/bin/activate` instead).*

👉 **Success Message:** You will see:
```text
INFO:     Uvicorn running on http://0.0.0.0:8001 (Press CTRL+C to quit)
```
*Keep this terminal open.*

---

### 🔹 Step 2: Start the Frontend Application (Terminal 2)

1. Open a **second terminal** window in the main project folder (`Interview`).
2. Run:

```bash
npm start
```
*(Recommended: `npm start` works directly without needing Ionic CLI installed globally. If you have Ionic CLI installed, you can also use `ionic serve`).*

👉 **Success Message:** You will see the local server URL:
```text
✔ Compiled successfully.
Application running on: http://localhost:3000
```
*Keep this terminal open.*

---

### 🔹 Step 3: Open in Browser & Log in

Open Google Chrome or any modern browser and visit:
* **App URL:** [http://localhost:3000](http://localhost:3000)
* **Backend API Docs (Swagger):** [http://localhost:8001/docs](http://localhost:8001/docs)

---

## 🔍 PART 4: First-Time Data Check & Verification

Before using the app with students, verify everything is working:

1. **Verify Backend Health:**
   * Open [http://localhost:8001/](http://localhost:8001/) in your browser.
   * You should see:
     ```json
     {"status": "ok", "questions_loaded": ..., "users_loaded": ..., ...}
     ```

2. **Verify Admin Login:**
   * Go to [http://localhost:3000/login](http://localhost:3000/login).
   * Enter:
     * **Username:** `admin`
     * **Password:** `admin@123`
   * Click **Sign In**. It should open the **Admin Dashboard** smoothly.

3. **Verify Question Bank:**
   * On the Admin Dashboard, go to the **Questions** tab.
   * If questions are present, you are ready!
   * If empty: Click **Download Template** -> fill in your questions -> use **Bulk Import Questions** to upload your Excel file.
   * *(Note: When importing Excel, column headers can be `question`, `category`, `difficulty`, `class_name`).*

4. **Verify Email Sending (Optional):**
   * In Admin Dashboard -> Batches or Students, try sending a schedule or test invite.
   * Check your terminal to see email confirmation logs.

---

## 🛑 How to Stop the App

When you are done working:
* Click on **Terminal 1** and press `Ctrl + C` (then type `Y` if prompted).
* Click on **Terminal 2** and press `Ctrl + C` (then type `Y` if prompted).
* Both servers will shut down safely.

---

## ❓ Common Issues & Easy Troubleshooting

| Problem | Cause | How to Fix |
|---|---|---|
| **"MongoDB connection failed"** | MongoDB service is stopped | Open **MongoDB Compass** and click Connect, or start MongoDB from Windows Services. |
| **"Cannot GET /api" or Network Error** | Backend is not running or wrong port | Make sure Terminal 1 is running and showing port `8001`. |
| **"Invalid credentials" on Admin Login** | Admin not created yet | Run `python add_admin.py` in the `backend/` folder. |
| **"Emails are failing to send"** | Incorrect Gmail password or SMTP blocked | Create a 16-digit **Google App Password** and put it in `backend/.env`. |
| **"Python is not recognized"** | Python not added to PATH | Reinstall Python and check the box **"Add Python to PATH"**. |
| **"Script execution disabled on Windows"** | PowerShell policy restriction | Run PowerShell as Admin and type: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| **"Microphone / Camera not working"** | Browser permissions blocked | Click the lock icon 🔒 next to the browser URL and allow **Camera** & **Microphone**. |
| **"Port already in use"** | Previous instance is still running | Close other open terminals or restart your computer. |

---

## 📋 Quick Cheat Sheet (Daily Run Summary)

```text
Terminal 1 (Backend):
cd backend
.venv\Scripts\activate
uvicorn main:app --reload --host 0.0.0.0 --port 8001

Terminal 2 (Frontend):
npm start
```
Browser: Open **http://localhost:3000**
