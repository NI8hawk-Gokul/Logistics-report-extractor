import os
import io
import json
from datetime import datetime, timezone
from typing import Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, Query
from bson import ObjectId
from auth import get_current_user
from activity_logger import create_activity_log
from database import (
    users_collection, reports_collection, report_versions_collection,
    report_access_collection, report_templates_collection, scheduled_reports_collection,
    activity_logs_collection, branches_collection, departments_collection,
    clients_collection, agents_collection, jobs_collection, payments_collection,
    documents_collection, approval_requests_collection, backups_collection,
    system_settings_collection, notifications_collection, data_validation_logs_collection,
    search_history_collection, api_integrations_collection
)

def serialize_doc(doc: dict) -> dict:
    if not doc:
        return doc
    doc = dict(doc)
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    return doc

def serialize_list(docs) -> List[Dict[str, Any]]:
    return [serialize_doc(doc) for doc in docs]

router = APIRouter(prefix="/backups", tags=["backups"])

BACKUP_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "backups")
os.makedirs(BACKUP_DIR, exist_ok=True)

collections_map = {
    "users": users_collection,
    "reports": reports_collection,
    "report_versions": report_versions_collection,
    "report_access": report_access_collection,
    "report_templates": report_templates_collection,
    "scheduled_reports": scheduled_reports_collection,
    "activity_logs": activity_logs_collection,
    "branches": branches_collection,
    "departments": departments_collection,
    "clients": clients_collection,
    "agents": agents_collection,
    "jobs": jobs_collection,
    "payments": payments_collection,
    "documents": documents_collection,
    "approval_requests": approval_requests_collection,
    "backups": backups_collection,
    "system_settings": system_settings_collection,
    "notifications": notifications_collection,
    "data_validation_logs": data_validation_logs_collection,
    "search_history": search_history_collection,
    "api_integrations": api_integrations_collection
}

def serialize_bson(val):
    if isinstance(val, list):
        return [serialize_bson(x) for x in val]
    if isinstance(val, dict):
        return {k: serialize_bson(v) for k, v in val.items()}
    if isinstance(val, ObjectId):
        return str(val)
    if isinstance(val, datetime):
        return val.isoformat()
    return val

def deserialize_bson(val):
    if isinstance(val, list):
        return [deserialize_bson(x) for x in val]
    if isinstance(val, dict):
        new_dict = {}
        for k, v in val.items():
            if k == "_id" and isinstance(v, str) and len(v) == 24:
                try:
                    new_dict[k] = ObjectId(v)
                except Exception:
                    new_dict[k] = v
            else:
                new_dict[k] = deserialize_bson(v)
        return new_dict
    return val

@router.get("")
async def get_backups_list(user: dict = Depends(get_current_user)):
    backups = await backups_collection.find({}).sort("createdAt", -1).to_list(100)
    return serialize_list(backups)

@router.post("/create")
async def create_backup(user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can create backups")
    
    backup_id = "BAK-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    filename = f"backup_{backup_id}.json"
    filepath = os.path.join(BACKUP_DIR, filename)
    
    # Extract data from all collections
    backup_data = {}
    for col_name, col_obj in collections_map.items():
        # Do not include the backups collection itself in the data dump to avoid self-replication issues
        if col_name == "backups":
            continue
        docs = await col_obj.find({}).to_list(200000)
        backup_data[col_name] = serialize_bson(docs)
        
    backup_doc = {
        "backupId": backup_id,
        "backupName": f"Backup {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
        "filename": filename,
        "status": "success",
        "createdBy": user["email"],
        "createdAt": datetime.now(timezone.utc).isoformat()
    }
    
    # Save file
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump({
                "backupId": backup_id,
                "createdAt": backup_doc["createdAt"],
                "createdBy": backup_doc["createdBy"],
                "data": backup_data
            }, f, indent=2)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write backup file: {str(e)}")
        
    await backups_collection.insert_one(backup_doc)
    await create_activity_log(user, "BACKUP_CREATED", f"Created database backup file: {filename}")
    
    # Log this backup doc itself
    log_doc = serialize_bson(backup_doc)
    if "_id" in log_doc:
        log_doc["id"] = str(log_doc["_id"])
        del log_doc["_id"]
    return log_doc

@router.post("/execute")
async def execute_backup(user: dict = Depends(get_current_user)):
    return await create_backup(user)

@router.post("/{backup_id}/restore")
async def restore_backup(backup_id: str, user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can restore database backups")
        
    backup = await backups_collection.find_one({"backupId": backup_id})
    filename = backup.get("filename") if backup else f"backup_{backup_id}.json"
    filepath = os.path.join(BACKUP_DIR, filename)
    
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail=f"Backup file {filename} not found on server disk")
        
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            backup_payload = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read backup file: {str(e)}")
        
    backup_data = backup_payload.get("data", {})
    
    # Restore collections
    for col_name, col_obj in collections_map.items():
        if col_name == "backups":
            continue
            
        # Clear collection
        await col_obj.delete_many({})
        
        # Load from backup
        docs = backup_data.get(col_name, [])
        if docs:
            deserialized = [deserialize_bson(d) for d in docs]
            # Batch inserts of 1000
            batch_size = 1000
            for i in range(0, len(deserialized), batch_size):
                batch = deserialized[i : i + batch_size]
                await col_obj.insert_many(batch)
                
    await create_activity_log(user, "BACKUP_RESTORED", f"Restored database from backup recovery point: {backup_id}")
    return {"message": f"Database successfully restored from recovery point {backup_id}"}
