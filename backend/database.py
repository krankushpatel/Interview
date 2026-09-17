import os
import asyncpg
import json
from pathlib import Path
from datetime import datetime

# Database configuration
DB_CONFIG = {
    "host": os.getenv("PG_HOST", "").strip(),
    "port": int(os.getenv("PG_PORT", 5432)),
    "database": os.getenv("PG_DATABASE", "").strip(),
    "user": os.getenv("PG_USER", "").strip(),
    "password": os.getenv("PG_PASSWORD", "").strip()
}

class Database:
    def __init__(self):
        self.pool = None
    
    async def connect(self):
        self.pool = await asyncpg.create_pool(**DB_CONFIG)
        await self.init_tables()
    
    async def init_tables(self):
        async with self.pool.acquire() as conn:
            # Users table
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    username TEXT PRIMARY KEY,
                    password TEXT NOT NULL,
                    role TEXT DEFAULT 'student',
                    name TEXT NOT NULL,
                    email TEXT,
                    attempts_taken INTEGER DEFAULT 0,
                    max_attempts INTEGER DEFAULT 1,
                    is_terminated BOOLEAN DEFAULT FALSE,
                    termination_reason TEXT,
                    preferred_categories TEXT[],
                    created_at TIMESTAMP DEFAULT NOW()
                )
            ''')
            
            # Questions table
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS questions (
                    id SERIAL PRIMARY KEY,
                    text TEXT NOT NULL,
                    category TEXT,
                    difficulty TEXT DEFAULT 'Medium'
                )
            ''')
            
            # Submissions table
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS submissions (
                    id TEXT PRIMARY KEY,
                    username TEXT REFERENCES users(username),
                    question_id INTEGER REFERENCES questions(id),
                    question_text TEXT,
                    question_category TEXT,
                    answer TEXT,
                    video_file TEXT,
                    score REAL,
                    submitted_at TIMESTAMP DEFAULT NOW()
                )
            ''')
            
            # Exam recordings table
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS exam_recordings (
                    id TEXT PRIMARY KEY,
                    username TEXT REFERENCES users(username),
                    video_file TEXT,
                    duration_sec INTEGER,
                    size_mb REAL,
                    submitted_at TIMESTAMP DEFAULT NOW()
                )
            ''')
            
            # Screen recordings table
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS screen_recordings (
                    id TEXT PRIMARY KEY,
                    username TEXT REFERENCES users(username),
                    video_file TEXT,
                    size_mb REAL,
                    submitted_at TIMESTAMP DEFAULT NOW()
                )
            ''')
            
            # Proctoring events table
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS proctoring_events (
                    id SERIAL PRIMARY KEY,
                    username TEXT REFERENCES users(username),
                    event_type TEXT,
                    detail TEXT,
                    event_time TIMESTAMP DEFAULT NOW()
                )
            ''')
            
            # Sessions table
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS exam_sessions (
                    id TEXT PRIMARY KEY,
                    username TEXT REFERENCES users(username),
                    start_time TIMESTAMP,
                    end_time TIMESTAMP,
                    status TEXT
                )
            ''')
            
            print("✅ Database tables created")

db = Database()