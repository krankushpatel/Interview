"""One-time Google Account Sign-In & Verification Setup for the Self-Hosted Bot.

This script launches Google Chrome with the persistent profile directory
(`backend/data/bot_chrome_profile`) using your REAL webcam (zero virtual canvas injection).

Use this to:
1. Sign into the Google/Gmail account used by the bot.
2. Complete any required 2FA / Face verification / Passkey checks with your physical webcam.
3. Once logged in, press ENTER in this terminal. The persistent session will be saved forever,
   allowing the bot to join Google Meet sessions instantly without verification prompts.
"""
import asyncio
import sys
from pathlib import Path

# Ensure backend directory is in sys.path
_BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND_DIR))

from playwright.async_api import async_playwright
from code.self_hosted_bot.config import load_bot_config


async def run_setup():
    config = load_bot_config()
    profile_dir = config.profile_dir
    profile_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 72)
    print("🤖 Google Meet / Gmail Bot Persistent Login Setup")
    print("=" * 72)
    print(f"Profile directory: {profile_dir}")
    print("Launching visible Chrome window with your REAL webcam enabled...")

    pw = await async_playwright().start()
    try:
        context = await pw.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=False,
            channel=config.browser_channel or "chrome",
            viewport={"width": 1280, "height": 720},
            permissions=["camera", "microphone"],
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
            ],
            ignore_default_args=["--mute-audio"],
        )

        page = context.pages[0] if context.pages else await context.new_page()
        print("Navigating to https://accounts.google.com ...")
        await page.goto("https://accounts.google.com", wait_until="domcontentloaded")

        print("\n" + "#" * 72)
        print("👉 INSTRUCTIONS:")
        print("1. Chrome window me apna Google account (Gmail / Workspace) login karein.")
        print("2. Agar face verification ya 2-step verification maangta hai to camera me dekhein.")
        print("   (Aapka REAL physical webcam active hai, face turant detect hoga!)")
        print("3. Login successfully complete hone ke baad yahan aakar ENTER dabayein.")
        print("#" * 72 + "\n")

        # Wait for user to complete login in the visible browser
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, input, "Login complete hone ke baad ENTER press karein: ")

        print("\nSaving session cookies and persistent profile...")
        await context.close()
        print("✅ Session saved successfully in:", profile_dir)
        print("Ab Google Meet me bot bina kisi verification ke smoothly join karega!")
    except Exception as exc:
        print("❌ Error during setup:", exc)
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(run_setup())
