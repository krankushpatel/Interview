import os
from dotenv import load_dotenv
from google import genai

# .env file se keys load karein
load_dotenv()

def list_my_available_models():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("❌ GEMINI_API_KEY missing in .env file!")
        return

    client = genai.Client(api_key=api_key)

    print("🔍 Fetching available Gemini models for your region and key...\n")
    try:
        models = client.models.list()
        
        generate_models = []
        for model in models:
            # Sirf text generation wale models list karenge
            if "generateContent" in getattr(model, "supported_actions", []) or \
               "generateContent" in getattr(model, "supported_generation_methods", []):
                # Model name se 'models/' prefix hatana agar zaroorat ho
                clean_name = model.name.replace("models/", "")
                generate_models.append(clean_name)

        if generate_models:
            print("✅ Working / Available Models:")
            print("=" * 40)
            for m in generate_models:
                print(f" • {m}")
            print("=" * 40)
            print("\n👉 Inme se koi bhi ek model name apne .env file me GEMINI_MODEL me set kar lijiye.")
        else:
            print("❌ No text generation models found for this key/region.")

    except Exception as e:
        print(f"❌ Error fetching models: {e}")

if __name__ == "__main__":
    list_my_available_models()