import bcrypt
from pymongo import MongoClient
from dotenv import load_dotenv
import os

# Load .env
load_dotenv()

# MongoDB Connection
mongo_uri = os.getenv("MONGO_URI") or os.getenv("MONGO_URL", "")
if not mongo_uri:
    raise RuntimeError("MONGO_URI or MONGO_URL not set in environment")
client = MongoClient(mongo_uri)
db_name = os.getenv("MONGO_DB_NAME", "interview_platform")
db = client[db_name]
users_collection = db["users"]


def create_admin():
    username = "admin"

    # Check if admin already exists
    if users_collection.find_one({"username": username}):
        print(f"⚠️ Admin '{username}' already exists.")
        return

    password = "admin@123"

    hashed_password = bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt()
    ).decode("utf-8")

    admin = {
        "username": username,
        "password": hashed_password,
        "role": "admin",
        "name": "Ankush Kumar",
        "email": "krankushpatel@gmail.com"
    }

    users_collection.insert_one(admin)

    print("✅ Admin created successfully.")
    print(f"Username : {username}")
    print(f"Password : {password}")


if __name__ == "__main__":
    create_admin()