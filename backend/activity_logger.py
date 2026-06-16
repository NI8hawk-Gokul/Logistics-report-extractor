from datetime import datetime, timezone
from database import activity_logs_collection

async def create_activity_log(user: dict, action: str, description: str, status: str = "success"):
    try:
        log_doc = {
            "userEmail": user.get("email", "unknown@logistics.com"),
            "userRole": user.get("role", "Staff"),
            "action": action,
            "description": description,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": status
        }
        await activity_logs_collection.insert_one(log_doc)
    except Exception as e:
        print("Failed to write activity log:", e)
