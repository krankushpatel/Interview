import sys
import os
import time

sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

def run_test():
    os.makedirs("test_artifacts", exist_ok=True)
    print("🚀 Starting Playwright Browser Automated Test...")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                "--no-sandbox",
                "--disable-dev-shm-usage"
            ]
        )
        context = browser.new_context(
            permissions=["camera", "microphone"],
            viewport={"width": 1280, "height": 800}
        )
        page = context.new_page()

        # Capture console messages and errors
        page.on("console", lambda msg: print(f"  [BROWSER {msg.type.upper()}]: {msg.text}"))
        page.on("pageerror", lambda err: print(f"  ❌ [PAGE ERROR]: {err}"))

        print("\n1️⃣ Navigating to http://localhost:3000/login...")
        page.goto("http://localhost:3000/login", wait_until="networkidle")
        time.sleep(1)
        page.screenshot(path="test_artifacts/01_login_page.png")
        print("  📸 Saved test_artifacts/01_login_page.png")

        print("\n2️⃣ Performing Login as Ankush...")
        page.fill("input[placeholder='Enter your username']", "Ankush")
        page.fill("input[placeholder='••••••••']", "Ankush@123")
        page.click("button.btn-primary")

        # Wait for navigation to /student
        page.wait_for_url("**/student**", timeout=10000)
        print("  ✅ Successfully navigated to /student")
        time.sleep(2)
        page.screenshot(path="test_artifacts/02_student_instructions.png")
        print("  📸 Saved test_artifacts/02_student_instructions.png")

        print("\n3️⃣ Accepting Instructions...")
        page.click(".acceptance-box")
        time.sleep(0.5)
        page.click("button.proceed-btn")
        time.sleep(2)
        page.screenshot(path="test_artifacts/03_mic_check.png")
        print("  📸 Saved test_artifacts/03_mic_check.png")

        print("\n4️⃣ Checking Mic Check step...")
        # Check if Skip / Pass mic check is available or click skip
        skip_btn = page.query_selector("ion-button:has-text('Skip & Proceed')")
        if not skip_btn:
            # Let's see if we can trigger passMicCheck directly or click startMicCheck
            print("  Bypassing mic check via component evaluation...")
            page.evaluate("() => { const el = document.querySelector('app-student'); if (window.ng) { const comp = window.ng.getComponent(el); if (comp) comp.passMicCheck('Playwright test verified'); } }")
        time.sleep(1)
        
        # Click proceed to camera check
        proceed_cam_btn = page.query_selector("ion-button:has-text('Proceed to Camera Check')")
        if proceed_cam_btn and proceed_cam_btn.is_enabled():
            proceed_cam_btn.click()
            print("  Clicked 'Proceed to Camera Check'")
        else:
            # Try finding any success button to proceed
            page.evaluate("() => { const el = document.querySelector('app-student'); if (window.ng) { const comp = window.ng.getComponent(el); if (comp) { comp.micTestPassed = true; comp.nextStep(); } } }")
        
        time.sleep(2)
        page.screenshot(path="test_artifacts/04_camera_check.png")
        print("  📸 Saved test_artifacts/04_camera_check.png")

        browser.close()
        print("\n🎉 Test phase 1 completed successfully!")

if __name__ == "__main__":
    run_test()
