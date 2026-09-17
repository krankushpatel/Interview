import os
import sys

# Project directory ko path mein add karna taaki imports chal sakein
sys.path.append(os.getcwd())

# Aapke existing data_manager se import
from code.core.data_manager import save_questions

def clear_all_questions():
    print("🚨 WARNING: You are about to DELETE ALL questions from the JSON Database.")
    confirm = input("Type 'YES' to confirm and delete: ")
    
    if confirm == 'YES':
        try:
            # Khali array save karke poora data uda dena
            save_questions([]) 
            print("✅ SUCCESS: All questions have been permanently deleted from JSON!")
        except Exception as e:
            print(f"❌ ERROR: Failed to clear questions. {e}")
    else:
        print("🛑 Operation Cancelled. Your questions are safe.")

if __name__ == "__main__":
    clear_all_questions()