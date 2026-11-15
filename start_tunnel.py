import subprocess
import re
import os
import sys

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    cloudflared_path = os.path.join(base_dir, "cloudflared.exe")
    env_path = os.path.join(base_dir, "backend", ".env")

    if not os.path.exists(cloudflared_path):
        print(f"❌ Error: {cloudflared_path} not found!")
        return

    print("🚀 Starting Cloudflare Tunnel on http://localhost:8001 ...")
    proc = subprocess.Popen(
        [cloudflared_path, "tunnel", "--url", "http://localhost:8001"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="ignore"
    )

    url_found = False
    for line in iter(proc.stdout.readline, ""):
        print(line, end="")
        match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
        if match and not url_found:
            new_url = match.group(0)
            url_found = True
            print("\n" + "="*70)
            print(f"🎉 TUNNEL READY: {new_url}")
            print("="*70)

            # Auto-update backend/.env
            if os.path.exists(env_path):
                with open(env_path, "r", encoding="utf-8") as f:
                    content = f.read()

                updated_content = re.sub(
                    r'PUBLIC_BASE_URL="https://[^\"]+"',
                    f'PUBLIC_BASE_URL="{new_url}"',
                    content
                )
                with open(env_path, "w", encoding="utf-8") as f:
                    f.write(updated_content)

                print("✅ backend/.env (Line 76: PUBLIC_BASE_URL) updated automatically!")
                print("👉 Copy this into Meeting BaaS Dashboard Webhook URL:")
                print(f"   {new_url}/zoom-bot/webhook/meeting-baas")
                print("="*70 + "\n")

    proc.stdout.close()
    proc.wait()

if __name__ == "__main__":
    main()
