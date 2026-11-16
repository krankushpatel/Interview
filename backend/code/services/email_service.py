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

def send_zoom_schedule_email(
    to_email: str,
    name: str,
    username: str,
    start_time: str,
    end_time: str,
    zoom_join_url: str,
    zoom_app_url: str,
    meeting_id: str,
    passcode: str,
    zoom_host_url: str = "",
    topics: list = None,
    custom_message: str = ""
) -> bool:
    """Send formal Zoom interview appointment with credentials and 1-click launcher."""
    if not SMTP_USER or not SMTP_PASSWORD:
        print("[EMAIL] SMTP not configured, skipping Zoom invite email")
        return False

    formatted_start = format_schedule_datetime(start_time)
    formatted_end = format_schedule_datetime(end_time)
    topics_str = ', '.join(topics) if topics else 'Comprehensive Technical Assessment'

    subject = f"📅 Zoom Interview Scheduled: {name} ({formatted_start})"

    msg_section = ""
    if custom_message and custom_message.strip():
        msg_section = f"""
        <div style="background: #f1f5f9; border-left: 4px solid #2563eb; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
            <strong style="color: #1e293b; font-size: 13px;">📝 SPECIAL INSTRUCTIONS:</strong>
            <p style="margin: 4px 0 0 0; color: #475569; font-size: 14px;">{custom_message.strip()}</p>
        </div>
        """

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #1e293b; }}
            .container {{ max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }}
            .header {{ background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); color: #ffffff; padding: 24px; text-align: center; }}
            .header h1 {{ margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }}
            .header p {{ margin: 6px 0 0 0; opacity: 0.9; font-size: 14px; }}
            .content {{ padding: 24px; }}
            .schedule-box {{ background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 16px 0; }}
            .schedule-row {{ display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }}
            .schedule-label {{ color: #64748b; font-weight: 600; }}
            .schedule-value {{ color: #1e293b; font-weight: 700; }}
            .creds-box {{ background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; }}
            .btn-group {{ margin: 24px 0; text-align: center; }}
            .btn-zoom {{ display: inline-block; background: #2563eb; color: #ffffff !important; padding: 12px 28px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 15px; box-shadow: 0 4px 10px rgba(37, 99, 235, 0.3); }}
            .btn-web {{ display: inline-block; background: #f1f5f9; color: #475569 !important; padding: 10px 20px; border-radius: 8px; font-weight: 600; text-decoration: none; font-size: 13px; margin-top: 10px; }}
            .footer {{ background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>📹 Video Interview Scheduled via Zoom</h1>
                <p>Eklakhya AI Interview Platform</p>
            </div>
            <div class="content">
                <p style="font-size: 15px;">Dear <strong>{name}</strong>,</p>
                <p style="font-size: 14px; line-height: 1.5; color: #475569;">
                    Your upcoming technical interview has been scheduled on the <strong>Zoom Application</strong>. Please review your appointment details and credentials below:
                </p>

                <div class="schedule-box">
                    <div style="font-size: 13px; font-weight: 700; color: #2563eb; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px;">📅 APPOINTMENT WINDOW</div>
                    <div style="margin-bottom: 6px;"><span class="schedule-label">Start Time:</span> <span class="schedule-value">{formatted_start}</span></div>
                    <div style="margin-bottom: 6px;"><span class="schedule-label">End Time:</span> <span class="schedule-value">{formatted_end}</span></div>
                    <div><span class="schedule-label">Topics:</span> <span class="schedule-value">{topics_str}</span></div>
                </div>

                {msg_section}

                <div class="creds-box">
                    <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 10px;">🔑 YOUR ZOOM INTERVIEW CREDENTIALS</div>
                    <div style="font-family: monospace; font-size: 14px; margin-bottom: 6px;"><strong>Candidate Username:</strong> <span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">{username}</span></div>
                    <div style="font-family: monospace; font-size: 14px; margin-bottom: 6px;"><strong>Zoom Meeting ID:</strong> <span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">{meeting_id}</span></div>
                    <div style="font-family: monospace; font-size: 14px;"><strong>Zoom Passcode:</strong> <span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">{passcode or 'None'}</span></div>
                </div>

                <div class="btn-group">
                    <a href="{zoom_app_url or zoom_join_url}" class="btn-zoom" style="background: #2563eb; color: #ffffff !important; padding: 14px 28px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 15px; display: inline-block;">
                        🚀 1-Click Launch Zoom Meeting
                    </a>
                    <div style="margin-top: 14px;">
                        <a href="https://dipstickdev.eklakshya.com/zoom-app?username={username}&launch_zoom=true" class="btn-web" style="display: inline-block; background: #0f172a; color: #38bdf8 !important; padding: 10px 18px; border-radius: 6px; font-weight: 700; text-decoration: none; font-size: 13px; margin-right: 8px;">
                            📝 Open In-Client Question Window
                        </a>
                        <a href="{zoom_join_url}" class="btn-web" style="display: inline-block; background: #f1f5f9; color: #334155 !important; padding: 10px 18px; border-radius: 6px; font-weight: 600; text-decoration: none; font-size: 13px;">
                            🌐 Web Browser Join
                        </a>
                    </div>
                </div>

                <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #991b1b;">
                    <strong>⚠️ Important Security Instructions:</strong>
                    <ul style="margin: 6px 0 0 0; padding-left: 20px;">
                        <li>You can only access the interview within your scheduled time window.</li>
                        <li>Ensure your Zoom desktop/mobile app is updated and your camera & microphone are working.</li>
                        <li>Have a quiet, well-lit environment ready before launching the meeting.</li>
                    </ul>
                </div>
            </div>
            <div class="footer">
                © Eklakhya Interview Platform • Automated Appointment Dispatcher
            </div>
        </div>
    </body>
    </html>
    """

    plain_body = f"""
Dear {name},

Your technical interview has been scheduled on the Zoom Application.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 APPOINTMENT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Start Time: {formatted_start}
End Time: {formatted_end}
Topics: {topics_str}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔑 ZOOM CREDENTIALS & LAUNCHER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Candidate Username: {username}
Zoom Meeting ID: {meeting_id}
Zoom Passcode: {passcode or 'None'}

🚀 Join via Native Zoom App: {zoom_app_url}
🌐 Join via Web Browser: {zoom_join_url}

⚠️ Important: Access is strictly restricted to your scheduled time slot.

Best regards,
Eklakhya AI Interview Platform
"""

    try:
        msg = MIMEMultipart('alternative')
        msg['From'] = FROM_EMAIL
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(plain_body, 'plain'))
        msg.attach(MIMEText(html_content, 'html'))

        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(msg)
        server.quit()

        print(f"[EMAIL] Zoom schedule invite successfully emailed to {to_email} for {username}")
        return True
    except Exception as e:
        print(f"[EMAIL] Failed to send Zoom schedule invite to {to_email}: {e}")
        return False


def send_google_meet_schedule_email(
    to_email: str,
    name: str,
    username: str,
    start_time: str,
    end_time: str,
    meet_url: str,
    topics: list = None,
    custom_message: str = ""
) -> bool:
    """Send formal Google Meet interview appointment with 1-click launcher."""
    if not SMTP_USER or not SMTP_PASSWORD:
        print("[EMAIL] SMTP not configured, skipping Google Meet invite email")
        return False

    formatted_start = format_schedule_datetime(start_time)
    formatted_end = format_schedule_datetime(end_time)
    topics_str = ', '.join(topics) if topics else 'Comprehensive Technical Assessment'

    subject = f"📅 Google Meet Interview Scheduled: {name} ({formatted_start})"

    msg_section = ""
    if custom_message and custom_message.strip():
        msg_section = f"""
        <div style="background: #f1f5f9; border-left: 4px solid #059669; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
            <strong style="color: #065f46; font-size: 13px;">📝 SPECIAL INSTRUCTIONS:</strong>
            <p style="margin: 4px 0 0 0; color: #475569; font-size: 14px;">{custom_message.strip()}</p>
        </div>
        """

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #1e293b; }}
            .container {{ max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }}
            .header {{ background: linear-gradient(135deg, #065f46 0%, #059669 100%); color: #ffffff; padding: 24px; text-align: center; }}
            .header h1 {{ margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }}
            .header p {{ margin: 6px 0 0 0; opacity: 0.9; font-size: 14px; }}
            .content {{ padding: 24px; }}
            .schedule-box {{ background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 16px; margin: 16px 0; }}
            .schedule-label {{ color: #047857; font-weight: 600; }}
            .schedule-value {{ color: #064e3b; font-weight: 700; }}
            .btn-group {{ margin: 24px 0; text-align: center; }}
            .btn-meet {{ display: inline-block; background: #059669; color: #ffffff !important; padding: 14px 32px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 16px; box-shadow: 0 4px 12px rgba(5, 150, 105, 0.35); }}
            .footer {{ background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🌐 Video Interview Scheduled via Google Meet</h1>
                <p>Eklakhya AI Interview Platform</p>
            </div>
            <div class="content">
                <p style="font-size: 15px;">Dear <strong>{name}</strong>,</p>
                <p style="font-size: 14px; line-height: 1.5; color: #475569;">
                    Your upcoming technical interview has been scheduled on <strong>Google Meet</strong>. You can join directly from any web browser (Chrome, Edge, Brave, or mobile browser) with 1 click:
                </p>

                <div class="schedule-box">
                    <div style="font-size: 13px; font-weight: 700; color: #059669; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px;">📅 APPOINTMENT WINDOW</div>
                    <div style="margin-bottom: 6px;"><span class="schedule-label">Start Time:</span> <span class="schedule-value">{formatted_start}</span></div>
                    <div style="margin-bottom: 6px;"><span class="schedule-label">End Time:</span> <span class="schedule-value">{formatted_end}</span></div>
                    <div><span class="schedule-label">Topics:</span> <span class="schedule-value">{topics_str}</span></div>
                </div>

                {msg_section}

                <div class="btn-group">
                    <a href="{meet_url}" class="btn-meet">
                        🌐 Join Google Meet Interview
                    </a>
                    <div style="margin-top: 10px; font-size: 13px; color: #64748b;">
                        Direct Link: <a href="{meet_url}" style="color: #059669;">{meet_url}</a>
                    </div>
                </div>

                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 16px; font-size: 13px; color: #166534;">
                    <strong>ℹ️ How the Interview Works in Google Meet:</strong>
                    <ul style="margin: 6px 0 0 0; padding-left: 20px; line-height: 1.5;">
                        <li>Join the Google Meet call at your scheduled time.</li>
                        <li>An AI bot named <strong>Interviewer</strong> will join the call and post questions in the <strong>In-Meeting Chat</strong>.</li>
                        <li>Speak your answers clearly into your microphone.</li>
                        <li>Type <code>/submit</code> in chat when finished with a question, or <code>/skip</code> to skip to the next.</li>
                        <li>Ensure a stable internet connection and quiet environment.</li>
                    </ul>
                </div>
            </div>
            <div class="footer">
                © Eklakhya Interview Platform • Automated Appointment Dispatcher
            </div>
        </div>
    </body>
    </html>
    """

    plain_body = f"""
Dear {name},

Your technical interview has been scheduled on Google Meet.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 APPOINTMENT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Start Time: {formatted_start}
End Time: {formatted_end}
Topics: {topics_str}

🌐 Google Meet Link: {meet_url}

ℹ️ Instructions:
- Join at your scheduled time.
- The AI Interviewer bot will post questions one by one in the in-meeting chat.
- Speak your answers clearly into your mic.
- Type '/submit' in chat when done with each question.

Best regards,
Eklakhya AI Interview Platform
"""

    try:
        msg = MIMEMultipart('alternative')
        msg['From'] = FROM_EMAIL
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(plain_body, 'plain'))
        msg.attach(MIMEText(html_content, 'html'))

        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(msg)
        server.quit()

        print(f"[EMAIL] Google Meet schedule invite successfully emailed to {to_email} for {username}")
        return True
    except Exception as e:
        print(f"[EMAIL] Failed to send Google Meet schedule invite to {to_email}: {e}")
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