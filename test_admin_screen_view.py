import sys
import os
import time
import subprocess

sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

def test_screen_live():
    print("==================================================")
    print("🔍 TESTING STUDENT SCREEN STREAMING TO ADMIN")
    print("==================================================")

    # 1. Reset user in MongoDB
    reset_script = os.path.abspath("reset_test_user.py")
    venv_py = os.path.abspath(os.path.join("backend", ".venv", "Scripts", "python.exe"))
    subprocess.run([venv_py, reset_script], capture_output=True, text=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                "--enable-usermedia-screen-capturing",
                "--auto-select-desktop-capture-source=Entire screen",
                "--no-sandbox",
                "--disable-dev-shm-usage"
            ]
        )

        # Context for Student
        student_ctx = browser.new_context(
            permissions=["camera", "microphone"],
            viewport={"width": 1280, "height": 800}
        )
        student_ctx.route('**/*.woff*', lambda r: r.abort())
        student_ctx.route('**/*.ttf*', lambda r: r.abort())
        student_ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        student_ctx.route('https://fonts.gstatic.com/**', lambda r: r.abort())

        student_page = student_ctx.new_page()
        student_logs = []
        student_page.on("console", lambda msg: student_logs.append(f"[STUDENT {msg.type.upper()}]: {msg.text}"))

        # Context for Admin
        admin_ctx = browser.new_context(
            permissions=["camera", "microphone"],
            viewport={"width": 1280, "height": 800}
        )
        admin_ctx.route('**/*.woff*', lambda r: r.abort())
        admin_ctx.route('**/*.ttf*', lambda r: r.abort())
        admin_ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        admin_ctx.route('https://fonts.gstatic.com/**', lambda r: r.abort())

        admin_page = admin_ctx.new_page()
        admin_logs = []
        admin_page.on("console", lambda msg: admin_logs.append(f"[ADMIN {msg.type.upper()}]: {msg.text}"))

        # ---------------------------------------------
        # STEP 1: Student starts exam
        # ---------------------------------------------
        print("\n[1] Student Logging in...")
        student_page.goto("http://localhost:3000/login", wait_until="networkidle")
        student_page.fill("input[placeholder='Enter your username']", "Ankush")
        student_page.fill("input[placeholder='••••••••']", "Ankush@123")
        student_page.click("button.btn-primary")
        student_page.wait_for_url("**/student**", timeout=10000)

        # Accept instructions
        student_page.click(".acceptance-box")
        student_page.click("button.proceed-btn")
        time.sleep(1)

        # Mic check pass
        student_page.evaluate("""() => {
            const el = document.querySelector('app-student');
            if (window.ng) {
                const comp = window.ng.getComponent(el);
                if (comp) {
                    comp.micTestPassed = true;
                    comp.nextStep();
                }
            }
        }""")
        time.sleep(1)

        # Camera check pass & start exam with screen recording
        print("[2] Student Starting Exam...")
        student_page.evaluate("""() => {
            const canvas = document.createElement('canvas');
            canvas.width = 1280;
            canvas.height = 720;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#10b981';
            ctx.fillRect(0, 0, 1280, 720);
            ctx.font = '48px sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.fillText('STUDENT ACTIVE DESKTOP SCREEN', 200, 360);
            const stream = canvas.captureStream(30);
            navigator.mediaDevices.getDisplayMedia = async () => stream;

            const el = document.querySelector('app-student');
            if (window.ng) {
                const comp = window.ng.getComponent(el);
                if (comp) {
                    comp.faceDetected = true;
                    comp.referenceFaceDescriptor = new Float32Array(128).fill(0.08);
                    comp.maxViolations = 999;
                    comp.nextStep();
                }
            }
        }""")
        time.sleep(4)

        # Verify Student Screen Stream State
        student_state = student_page.evaluate("""() => {
            const el = document.querySelector('app-student');
            if (window.ng) {
                const comp = window.ng.getComponent(el);
                return {
                    screenStreamDefined: !!comp.screenStream,
                    screenTracks: comp.screenStream ? comp.screenStream.getVideoTracks().length : 0,
                    screenTrackActive: comp.screenStream && comp.screenStream.getVideoTracks()[0] ? comp.screenStream.getVideoTracks()[0].readyState : null,
                    isStreaming: comp.isStreaming,
                    webrtcStreaming: comp.webrtcService ? comp.webrtcService.isWebRtcStreaming$.value : null,
                    savedScreenStream: comp.webrtcService ? !!comp.webrtcService.savedScreenStream : null
                };
            }
            return null;
        }""")
        print(f"  Student Screen Stream Status: {student_state}")

        # ---------------------------------------------
        # STEP 2: Admin Logs in & Opens Live View Modal
        # ---------------------------------------------
        print("\n[3] Admin Logging in...")
        admin_page.goto("http://localhost:3000/login", wait_until="networkidle")
        admin_page.fill("input[placeholder='Enter your username']", "admin")
        admin_page.fill("input[placeholder='••••••••']", "admin@123")
        admin_page.click("button.btn-primary")
        admin_page.wait_for_url("**/admin**", timeout=10000)
        time.sleep(2)

        # Open Live View Modal for Ankush directly
        print("[4] Admin Opening Live View Modal for Ankush...")
        admin_page.evaluate("""() => {
            const el = document.querySelector('app-admin');
            if (window.ng) {
                const comp = window.ng.getComponent(el);
                if (comp) comp.viewLiveExam('Ankush');
            }
        }""")
        time.sleep(5)

        # Check Admin Modal DOM & State
        os.makedirs("test_artifacts", exist_ok=True)
        admin_page.screenshot(path="test_artifacts/admin_live_modal.png", timeout=5000)
        print("  📸 Captured test_artifacts/admin_live_modal.png")

        admin_modal_state = admin_page.evaluate("""() => {
            const modal = document.querySelector('app-live-view-modal');
            const vids = document.querySelectorAll('app-live-view-modal video');
            const camVideo = vids[0];
            const screenVideo = vids[1];
            const images = document.querySelectorAll('app-live-view-modal img.live-image');
            
            let compState = null;
            if (window.ng && modal) {
                const comp = window.ng.getComponent(modal);
                if (comp) {
                    compState = {
                        hasWebRtcCamera: comp.hasWebRtcCamera,
                        hasWebRtcScreen: comp.hasWebRtcScreen,
                        cameraFrameDefined: !!comp.cameraFrame,
                        screenFrameDefined: !!comp.screenFrame,
                        connectionStatus: comp.connectionStatus,
                        expectedCameraStreamId: comp.webrtcService ? comp.webrtcService.expectedCameraStreamId : null,
                        expectedScreenStreamId: comp.webrtcService ? comp.webrtcService.expectedScreenStreamId : null
                    };
                }
            }

            return {
                modalFound: !!modal,
                compState: compState,
                camVideo: camVideo ? { 
                    display: camVideo.style.display,
                    readyState: camVideo.readyState, 
                    srcObject: !!camVideo.srcObject, 
                    tracks: camVideo.srcObject ? camVideo.srcObject.getTracks().map(t => ({ kind: t.kind, label: t.label, readyState: t.readyState, muted: t.muted })) : [],
                    dimensions: camVideo.videoWidth + 'x' + camVideo.videoHeight,
                    paused: camVideo.paused
                } : null,
                screenVideo: screenVideo ? { 
                    display: screenVideo.style.display,
                    readyState: screenVideo.readyState, 
                    srcObject: !!screenVideo.srcObject, 
                    tracks: screenVideo.srcObject ? screenVideo.srcObject.getTracks().map(t => ({ kind: t.kind, label: t.label, readyState: t.readyState, muted: t.muted })) : [],
                    dimensions: screenVideo.videoWidth + 'x' + screenVideo.videoHeight,
                    paused: screenVideo.paused
                } : null,
                imageCount: images.length
            };
        }""")
        print(f"\n📊 Admin Live Modal Inspection:\n{admin_modal_state}")

        print("\n📋 Recent Admin Console Logs:")
        for log in admin_logs[-20:]:
            print(" ", log)

        print("\n📋 Recent Student WebRTC Console Logs:")
        for log in [l for l in student_logs if 'WebRTC' in l or 'LIVE' in l or 'Screen' in l][-20:]:
            print(" ", log)

        browser.close()
        subprocess.run([venv_py, reset_script], capture_output=True, text=True)

if __name__ == "__main__":
    test_screen_live()
