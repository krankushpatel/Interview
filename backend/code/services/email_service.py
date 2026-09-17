import smtplib
import re
import os
import pytz
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from dotenv import load_dotenv


# India timezone
IST = pytz.timezone('Asia/Kolkata')


load_dotenv()

# Email configuration
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", SMTP_USER)


def validate_email(email: str) -> bool:
    """Validate email format"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None


def send_credentials_email(to_email: str, name: str, username: str, password: str) -> bool:
    """Send login credentials to student"""
    if not SMTP_USER or not SMTP_PASSWORD:
        print("[EMAIL] SMTP not configured, skipping email send")
        return False
    
    login_link = os.getenv("APP_LOGIN_URL", "").strip()
    if not login_link:
        base_url = os.getenv("FRONTEND_URL", "").strip().rstrip("/")
        login_link = f"{base_url}/login" if base_url else "/login"
    
    subject = f"Welcome to AI Interview Platform - Your Login Credentials"
    
    body = f"""
Dear {name},

Your account has been created on AI Interview Platform.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 LOGIN CREDENTIALS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔑 Username: {username}
🔒 Password: {password}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔗 Login Link: {login_link}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ IMPORTANT NOTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Your exam schedule will be assigned by your teacher
• You can only take the exam during scheduled time
• Please contact your teacher for exam schedule
• Do not share your credentials with anyone

Best regards,
AI Interview Platform Team
"""
    
    try:
        msg = MIMEMultipart()
        msg['From'] = FROM_EMAIL
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))
        
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(msg)
        server.quit()
        
        print(f"[EMAIL] Credentials sent to {to_email} for {username}")
        return True
    except Exception as e:
        print(f"[EMAIL] Failed to send to {to_email}: {e}")
        return False

# def format_datetime(dt_str: str) -> str:
#     """Format ISO or existing date string to human-friendly format"""
#     if not dt_str:
#         return "Not specified"
#     try:
#         # 1. Try ISO format (2026-08-22T17:42:00)
#         if 'T' in dt_str:
#             dt = datetime.fromisoformat(dt_str.replace('Z', '+00:00'))
#         # 2. Try the format previously used in timetable_service (22 Aug 2026, 05:42 PM)
#         elif ',' in dt_str and len(dt_str) > 15:
#             dt = datetime.strptime(dt_str, "%d %b %Y, %I:%M %p")
#         # 3. Fallback for standard SQL-like format
#         else:
#             dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
        
#         # Return requested format: Tuesday, 25 August 2026 at 04:35 PM
#         return dt.strftime("%A, %d %B %Y at %I:%M %p")
#     except Exception as e:
#         # If all parsing fails, return the original string so we don't lose data
#         return dt_str


def format_schedule_datetime(dt_str: str) -> str:
    """Helper to convert raw ISO string to readable IST format"""
    try:
        if "T" not in dt_str:
            return dt_str # Agar pehle se formatted hai toh wapas bhej do

        dt = datetime.fromisoformat(dt_str.replace('Z', '+00:00'))
        if dt.tzinfo is not None:
            dt = dt.astimezone(IST)
        else:
            dt = IST.localize(dt)
        return dt.strftime('%A, %d %B %Y at %I:%M %p')
    except Exception:
        return dt_str

def send_schedule_email(to_email: str, name: str, start_time: str, end_time: str, topics: list, custom_message: str = "") -> bool:
    """Send schedule notification to student"""
    if not SMTP_USER or not SMTP_PASSWORD:
        return False
    
    # Format the times for readability
    # 🟢 YAHAN NAYA FIX: Use format_schedule_datetime for IST-aware formatting
    formatted_start = format_schedule_datetime(start_time)
    formatted_end = format_schedule_datetime(end_time)

    subject = f"Your Exam Schedule - AI Interview Platform"
    
    # 🟢 YAHAN FIX HAI: Custom message ko email body me set kiya hai
    msg_section = ""
    if custom_message and custom_message.strip():
        msg_section = f"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📝 INSTRUCTIONS FROM TEACHER\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n{custom_message.strip()}\n"

    body = f"""
Dear {name},

Your exam schedule has been assigned.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 EXAM SCHEDULE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 Start Time: {formatted_start}
⏰ End Time: {formatted_end}
📚 Topics: {', '.join(topics) if topics else 'Not specified'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{msg_section}
⚠️ Please note:
• You can only take the exam during the scheduled time
• Login to your portal at the scheduled time
• Late entries will not be allowed

Best regards,
AI Interview Platform Team
"""
    
    try:
        msg = MIMEMultipart()
        msg['From'] = FROM_EMAIL
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))
        
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(msg)
        server.quit()
        
        print(f"[EMAIL] Schedule sent to {to_email}")
        return True
    except Exception as e:
        print(f"[EMAIL] Failed to send schedule to {to_email}: {e}")
        return False
    
def send_custom_email(to_email: str, name: str, subject: str, message: str) -> bool:
    """Send custom email to student"""
    if not SMTP_USER or not SMTP_PASSWORD:
        print("[EMAIL] SMTP not configured, skipping email send")
        return False
    
    body = f"""
Dear {name},

{message}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AI Interview Platform
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This is an automated message from the AI Interview Platform.
"""
    
    try:
        msg = MIMEMultipart()
        msg['From'] = FROM_EMAIL
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))
        
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(msg)
        server.quit()
        
        print(f"[EMAIL] Custom email sent to {to_email}")
        return True
    except Exception as e:
        print(f"[EMAIL] Failed to send to {to_email}: {e}")
        return False
    
def send_report_email(to_email: str, name: str, pdf_bytes: bytes, filename: str) -> bool:
    """Send interview PDF evaluation report to student as an attachment"""
    if not SMTP_USER or not SMTP_PASSWORD:
        print("[EMAIL] SMTP not configured, skipping report email send")
        return False

    subject = f"Your AI Interview Evaluation Report - {name}"
    
    body = f"""
Dear {name},

Congratulations on completing your interview! 

Attached to this email, you will find your detailed, AI-generated performance evaluation report, breakdown metrics, and proctoring log breakdown.

Best regards,
AI Interview Platform Team
"""

    try:
        # Create a multipart message container
        msg = MIMEMultipart()
        msg['From'] = FROM_EMAIL
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))
        
        # Create the PDF attachment entry
        attachment = MIMEApplication(pdf_bytes, _subtype="pdf")
        attachment.add_header('Content-Disposition', 'attachment', filename=filename)
        msg.attach(attachment)
        
        # Connect and send via TLS
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(msg)
        server.quit()
        
        print(f"[EMAIL] Report PDF successfully emailed to {to_email}")
        return True
    except Exception as e:
        print(f"[EMAIL] Failed to send report email to {to_email}: {e}")
        return False