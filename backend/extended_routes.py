import io
from datetime import datetime, timezone
from typing import Any, Optional

import pandas as pd
from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, letter
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle

from activity_logger import create_activity_log
from auth import get_current_user, get_password_hash, verify_password
from database import (
    agents_collection,
    api_integrations_collection,
    approval_requests_collection,
    branches_collection,
    clients_collection,
    data_validation_logs_collection,
    departments_collection,
    documents_collection,
    jobs_collection,
    notifications_collection,
    payments_collection,
    report_access_collection,
    report_templates_collection,
    report_versions_collection,
    reports_collection,
    scheduled_reports_collection,
    search_history_collection,
    system_settings_collection,
    users_collection,
)
from models import (
    ApprovalCreateRequest,
    IntegrationRequest,
    PasswordChangeRequest,
    SettingsUpdateRequest,
    UserCreateRequest,
)

router = APIRouter()


def serialize_document(document: Optional[dict]) -> dict:
    if not document:
        return {}
    result = dict(document)
    if "_id" in result:
        result["id"] = str(result.pop("_id"))
    result.pop("password_hash", None)
    result.pop("fileBytes", None)
    result.pop("apiKey", None)
    return result


def serialize_documents(documents: list[dict]) -> list[dict]:
    return [serialize_document(document) for document in documents]


def require_admin(user: dict):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Administrator access is required")


def parse_object_id(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid record identifier") from exc


async def accessible_report_ids(user: dict) -> list[str]:
    if user["role"] == "Admin":
        versions = await report_versions_collection.find({"isArchived": False}).to_list(500)
        return [version["reportId"] for version in versions]
    access = await report_access_collection.find({
        "$or": [
            {"assignedTo": user["email"], "assignedToType": "user", "isActive": True},
            {"assignedTo": user["role"], "assignedToType": "role", "isActive": True},
        ]
    }).to_list(500)
    return [item["reportId"] for item in access]


@router.get("/api/status")
async def root():
    return {"name": "Smart Logistics API", "status": "ready"}


@router.get("/reports")
async def get_reports(
    reportId: Optional[str] = None,
    page: int = 1,
    pageSize: int = 25,
    sortBy: str = "date",
    sortOrder: str = "desc",
    search: str = "",
    user: dict = Depends(get_current_user),
):
    allowed_ids = await accessible_report_ids(user)
    query: dict[str, Any] = {"reportId": {"$in": allowed_ids}}
    if reportId:
        if reportId not in allowed_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this report")
        query["reportId"] = reportId
    if search:
        regex = {"$regex": search, "$options": "i"}
        query["$or"] = [
            {"jobNo": regex},
            {"agentName": regex},
            {"clientName": regex},
            {"jobType": regex},
            {"status": regex},
        ]
    page = max(page, 1)
    page_size = min(max(pageSize, 10), 100)
    total = await reports_collection.count_documents(query)
    cursor = (
        reports_collection.find(query)
        .sort(sortBy, -1 if sortOrder == "desc" else 1)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    records = await cursor.to_list(page_size)
    if user["role"] == "Staff":
        for record in records:
            record.pop("billingAmount", None)
            record.pop("expense", None)
            record.pop("profit", None)
    return {
        "data": serialize_documents(records),
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "totalRecords": total,
            "totalPages": max((total + page_size - 1) // page_size, 1),
        },
    }


@router.delete("/clear-reports")
async def clear_reports(user: dict = Depends(get_current_user)):
    require_admin(user)
    await reports_collection.delete_many({})
    await report_versions_collection.delete_many({})
    await create_activity_log(user, "REPORT_DATA_CLEARED", "Cleared all report data")
    return {"message": "All report data was cleared"}


@router.patch("/templates/{template_id}")
async def update_template(
    template_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    template = await report_templates_collection.find_one({"_id": parse_object_id(template_id)})
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if user["role"] != "Admin" and template.get("createdBy") != user["email"]:
        raise HTTPException(status_code=403, detail="You cannot edit this template")
    update = {
        "templateName": payload.get("templateName", template.get("templateName")),
        "filters": payload.get("filters", template.get("filters", {})),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    await report_templates_collection.update_one({"_id": template["_id"]}, {"$set": update})
    await create_activity_log(user, "TEMPLATE_UPDATED", f"Updated template {template_id}")
    return {"message": "Template updated"}


@router.get("/scheduled-reports/{schedule_id}")
async def get_schedule(schedule_id: str, user: dict = Depends(get_current_user)):
    schedule = await scheduled_reports_collection.find_one({"_id": parse_object_id(schedule_id)})
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return serialize_document(schedule)


@router.get("/report-versions/{report_id}")
async def get_report_version(report_id: str, user: dict = Depends(get_current_user)):
    if report_id not in await accessible_report_ids(user):
        raise HTTPException(status_code=403, detail="You do not have access to this report")
    version = await report_versions_collection.find_one({"reportId": report_id})
    if not version:
        raise HTTPException(status_code=404, detail="Report version not found")
    return serialize_document(version)


@router.get("/report-access/{report_id}")
async def get_report_access_for_version(
    report_id: str,
    user: dict = Depends(get_current_user),
):
    require_admin(user)
    rules = await report_access_collection.find({"reportId": report_id}).to_list(500)
    return serialize_documents(rules)


def register_detail_routes():
    resources = [
        ("branches", branches_collection),
        ("departments", departments_collection),
        ("clients", clients_collection),
        ("agents", agents_collection),
        ("jobs", jobs_collection),
    ]

    def create_handlers(resource_name, collection):
        async def get_item(item_id: str, user: dict = Depends(get_current_user)):
            item = await collection.find_one({"_id": parse_object_id(item_id)})
            if not item:
                raise HTTPException(status_code=404, detail="Record not found")
            return serialize_document(item)

        async def delete_item(item_id: str, user: dict = Depends(get_current_user)):
            require_admin(user)
            await collection.delete_one({"_id": parse_object_id(item_id)})
            await create_activity_log(user, "RECORD_DELETED", f"Deleted {resource_name} record {item_id}")
            return {"message": "Record deleted"}

        return get_item, delete_item

    for resource_name, collection in resources:
        get_item, delete_item = create_handlers(resource_name, collection)
        router.add_api_route(f"/{resource_name}/{{item_id}}", get_item, methods=["GET"])
        router.add_api_route(f"/{resource_name}/{{item_id}}", delete_item, methods=["DELETE"])


register_detail_routes()


@router.post("/payments")
async def create_payment(payload: dict, user: dict = Depends(get_current_user)):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff cannot create payments")
    document = {
        **payload,
        "status": payload.get("status", "Unpaid"),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    await payments_collection.insert_one(document)
    await create_activity_log(user, "PAYMENT_CREATED", "Created a payment record")
    return serialize_document(document)


@router.delete("/payments/{payment_id}")
async def delete_payment(payment_id: str, user: dict = Depends(get_current_user)):
    require_admin(user)
    await payments_collection.delete_one({"_id": parse_object_id(payment_id)})
    return {"message": "Payment deleted"}


@router.patch("/payments/{payment_id}/mark-partial")
async def mark_payment_partial(
    payment_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff cannot update payments")
    await payments_collection.update_one(
        {"_id": parse_object_id(payment_id)},
        {"$set": {
            "status": "Partial",
            "paidAmount": float(payload.get("paidAmount", 0)),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"message": "Payment marked as partially paid"}


@router.post("/approvals")
async def create_approval(
    request: ApprovalCreateRequest,
    user: dict = Depends(get_current_user),
):
    document = {
        "approvalId": f"APR-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}",
        **request.model_dump(),
        "requestedBy": user["email"],
        "status": "Pending",
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    await approval_requests_collection.insert_one(document)
    await create_activity_log(user, "APPROVAL_REQUESTED", request.description)
    return serialize_document(document)


@router.get("/approvals/{approval_id}")
async def get_approval(approval_id: str, user: dict = Depends(get_current_user)):
    approval = await approval_requests_collection.find_one({"approvalId": approval_id})
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    return serialize_document(approval)


@router.patch("/approvals/{approval_id}/reject")
async def reject_approval(
    approval_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    require_admin(user)
    await approval_requests_collection.update_one(
        {"approvalId": approval_id},
        {"$set": {
            "status": "Rejected",
            "rejectionReason": payload.get("reason", ""),
            "reviewedBy": user["email"],
        }},
    )
    return {"message": "Approval rejected"}


@router.patch("/approvals/{approval_id}/cancel")
async def cancel_approval(approval_id: str, user: dict = Depends(get_current_user)):
    approval = await approval_requests_collection.find_one({"approvalId": approval_id})
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    if user["role"] != "Admin" and approval.get("requestedBy") != user["email"]:
        raise HTTPException(status_code=403, detail="You cannot cancel this approval")
    await approval_requests_collection.update_one(
        {"approvalId": approval_id},
        {"$set": {"status": "Cancelled"}},
    )
    return {"message": "Approval cancelled"}


@router.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    documentType: str = Form("Other"),
    linkedEntityType: str = Form("report"),
    linkedEntityId: str = Form(""),
    user: dict = Depends(get_current_user),
):
    contents = await file.read()
    document = {
        "documentName": file.filename,
        "documentType": documentType,
        "linkedEntityType": linkedEntityType,
        "linkedEntityId": linkedEntityId,
        "contentType": file.content_type or "application/octet-stream",
        "fileBytes": contents,
        "fileSize": len(contents),
        "uploadedBy": user["email"],
        "uploadedAt": datetime.now(timezone.utc).isoformat(),
    }
    await documents_collection.insert_one(document)
    await create_activity_log(user, "DOCUMENT_UPLOADED", f"Uploaded {file.filename}")
    return serialize_document(document)


@router.get("/documents")
async def get_documents(user: dict = Depends(get_current_user)):
    documents = await documents_collection.find({"documentName": {"$ne": None}}).to_list(500)
    return serialize_documents(documents)


@router.get("/documents/{document_id}")
async def get_document(document_id: str, user: dict = Depends(get_current_user)):
    document = await documents_collection.find_one({"_id": parse_object_id(document_id)})
    if not document or "documentName" not in document:
        raise HTTPException(status_code=404, detail="Document not found")
    return serialize_document(document)


@router.get("/documents/{document_id}/download")
async def download_document(document_id: str, user: dict = Depends(get_current_user)):
    document = await documents_collection.find_one({"_id": parse_object_id(document_id)})
    if not document or "documentName" not in document:
        raise HTTPException(status_code=404, detail="Document not found")
    return StreamingResponse(
        io.BytesIO(document["fileBytes"]),
        media_type=document.get("contentType", "application/octet-stream"),
        headers={"Content-Disposition": f'attachment; filename="{document["documentName"]}"'},
    )


@router.delete("/documents/{document_id}")
async def delete_document(document_id: str, user: dict = Depends(get_current_user)):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff cannot delete documents")
    await documents_collection.delete_one({"_id": parse_object_id(document_id)})
    return {"message": "Document deleted"}


@router.get("/notifications")
async def get_notifications(user: dict = Depends(get_current_user)):
    notifications = await notifications_collection.find({
        "$or": [{"userEmail": user["email"]}, {"userEmail": "*"}]
    }).sort("createdAt", -1).to_list(200)
    return serialize_documents(notifications)


@router.get("/notifications/unread-count")
async def notification_unread_count(user: dict = Depends(get_current_user)):
    count = await notifications_collection.count_documents({
        "$or": [{"userEmail": user["email"]}, {"userEmail": "*"}],
        "isRead": False,
    })
    return {"count": count}


@router.patch("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, user: dict = Depends(get_current_user)):
    await notifications_collection.update_one(
        {"_id": parse_object_id(notification_id)},
        {"$set": {"isRead": True}},
    )
    return {"message": "Notification marked as read"}


@router.patch("/notifications/mark-all-read")
async def mark_all_notifications_read(user: dict = Depends(get_current_user)):
    await notifications_collection.update_many(
        {"$or": [{"userEmail": user["email"]}, {"userEmail": "*"}]},
        {"$set": {"isRead": True}},
    )
    return {"message": "All notifications marked as read"}


@router.delete("/notifications/{notification_id}")
async def delete_notification(notification_id: str, user: dict = Depends(get_current_user)):
    await notifications_collection.delete_one({"_id": parse_object_id(notification_id)})
    return {"message": "Notification deleted"}


@router.get("/users")
async def get_users(user: dict = Depends(get_current_user)):
    require_admin(user)
    users = await users_collection.find({}).sort("name", 1).to_list(500)
    return serialize_documents(users)


@router.post("/users")
async def create_user(
    request: UserCreateRequest,
    user: dict = Depends(get_current_user),
):
    require_admin(user)
    if await users_collection.find_one({"email": request.email}):
        raise HTTPException(status_code=400, detail="A user with this email already exists")
    document = {
        "name": request.name,
        "email": request.email,
        "password_hash": get_password_hash(request.password),
        "role": request.role,
        "branch": request.branch,
        "department": request.department,
        "isActive": True,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    await users_collection.insert_one(document)
    return serialize_document(document)


@router.patch("/users/{user_id}/deactivate")
async def deactivate_user(user_id: str, user: dict = Depends(get_current_user)):
    require_admin(user)
    await users_collection.update_one(
        {"_id": parse_object_id(user_id)},
        {"$set": {"isActive": False}},
    )
    return {"message": "User deactivated"}


@router.patch("/users/{user_id}/reactivate")
async def reactivate_user(user_id: str, user: dict = Depends(get_current_user)):
    require_admin(user)
    await users_collection.update_one(
        {"_id": parse_object_id(user_id)},
        {"$set": {"isActive": True}},
    )
    return {"message": "User reactivated"}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(get_current_user)):
    require_admin(user)
    await users_collection.delete_one({"_id": parse_object_id(user_id)})
    return {"message": "User deleted"}


@router.get("/profile")
async def get_profile(user: dict = Depends(get_current_user)):
    return serialize_document(user)


@router.post("/change-password")
async def change_password(
    request: PasswordChangeRequest,
    user: dict = Depends(get_current_user),
):
    if not verify_password(request.currentPassword, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    await users_collection.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": get_password_hash(request.newPassword)}},
    )
    return {"message": "Password changed"}


DEFAULT_SETTINGS = {
    "company": {
        "name": "Smart Logistics",
        "currency": "INR",
        "timezone": "Asia/Kolkata",
    },
    "reports": {"defaultPageSize": 25, "allowStaffFinancials": False},
    "notifications": {"emailEnabled": False, "inAppEnabled": True},
}


@router.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    settings = await system_settings_collection.find_one({"key": "global"})
    return settings.get("settings", DEFAULT_SETTINGS) if settings else DEFAULT_SETTINGS


@router.patch("/settings")
async def update_settings(
    request: SettingsUpdateRequest,
    user: dict = Depends(get_current_user),
):
    require_admin(user)
    existing = await system_settings_collection.find_one({"key": "global"})
    if existing:
        await system_settings_collection.update_one(
            {"key": "global"},
            {"$set": {"settings": request.settings}},
        )
    else:
        await system_settings_collection.insert_one({
            "key": "global",
            "settings": request.settings,
        })
    return {"message": "Settings updated"}


@router.post("/settings/reset-defaults")
async def reset_settings(user: dict = Depends(get_current_user)):
    require_admin(user)
    existing = await system_settings_collection.find_one({"key": "global"})
    if existing:
        await system_settings_collection.update_one(
            {"key": "global"},
            {"$set": {"settings": DEFAULT_SETTINGS}},
        )
    else:
        await system_settings_collection.insert_one({
            "key": "global",
            "settings": DEFAULT_SETTINGS,
        })
    return DEFAULT_SETTINGS


SEARCH_MODULES = [
    ("reports", report_versions_collection, ["reportId", "reportName", "period"]),
    ("jobs", jobs_collection, ["jobNo", "jobType", "status", "clientName", "agentName"]),
    ("clients", clients_collection, ["name", "email", "phone"]),
    ("agents", agents_collection, ["name", "email", "phone", "branch"]),
    ("payments", payments_collection, ["invoiceNo", "clientName", "status"]),
    ("documents", documents_collection, ["documentName", "documentType"]),
    ("approvals", approval_requests_collection, ["approvalId", "targetType", "status"]),
    ("branches", branches_collection, ["name", "code"]),
    ("departments", departments_collection, ["name", "code"]),
]


@router.get("/global-search")
async def global_search(query: str, user: dict = Depends(get_current_user)):
    text = query.strip()
    if len(text) < 2:
        return {"query": text, "totalResults": 0, "results": {}}
    results = {}
    total = 0
    regex = {"$regex": text, "$options": "i"}
    for module, collection, fields in SEARCH_MODULES:
        module_query = {"$or": [{field: regex} for field in fields]}
        documents = await collection.find(module_query).to_list(5)
        serialized = serialize_documents(documents)
        if user["role"] == "Staff" and module in {"payments", "approvals"}:
            serialized = []
        results[module] = serialized
        total += len(serialized)
    history = {
        "searchId": f"SRC-{ObjectId()}",
        "userEmail": user["email"],
        "searchText": text,
        "resultCount": total,
        "searchedAt": datetime.now(timezone.utc).isoformat(),
    }
    await search_history_collection.insert_one(history)
    return {"query": text, "totalResults": total, "results": results}


@router.get("/search-history")
async def get_search_history(user: dict = Depends(get_current_user)):
    history = await search_history_collection.find({
        "userEmail": user["email"]
    }).sort("searchedAt", -1).to_list(10)
    return serialize_documents(history)


@router.delete("/search-history/clear")
async def clear_search_history(user: dict = Depends(get_current_user)):
    await search_history_collection.delete_many({"userEmail": user["email"]})
    return {"message": "Search history cleared"}


@router.delete("/search-history/{search_id}")
async def delete_search_history(search_id: str, user: dict = Depends(get_current_user)):
    await search_history_collection.delete_one({
        "searchId": search_id,
        "userEmail": user["email"],
    })
    return {"message": "Search history item deleted"}


@router.delete("/ai-chat/history/clear")
async def clear_ai_history(user: dict = Depends(get_current_user)):
    from database import db
    await db["ai_chat_history"].delete_many({"userEmail": user["email"]})
    return {"message": "AI chat history cleared"}


@router.delete("/ai-chat/history/{chat_id}")
async def delete_ai_history(chat_id: str, user: dict = Depends(get_current_user)):
    from database import db
    await db["ai_chat_history"].delete_one({
        "_id": parse_object_id(chat_id),
        "userEmail": user["email"],
    })
    return {"message": "AI chat item deleted"}


@router.get("/api-integrations")
async def get_integrations(user: dict = Depends(get_current_user)):
    require_admin(user)
    integrations = await api_integrations_collection.find({}).to_list(200)
    return serialize_documents(integrations)


@router.post("/api-integrations")
async def create_integration(
    request: IntegrationRequest,
    user: dict = Depends(get_current_user),
):
    require_admin(user)
    document = {
        **request.model_dump(),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "createdBy": user["email"],
    }
    await api_integrations_collection.insert_one(document)
    return serialize_document(document)


@router.delete("/api-integrations/{integration_id}")
async def delete_integration(integration_id: str, user: dict = Depends(get_current_user)):
    require_admin(user)
    await api_integrations_collection.delete_one({"_id": parse_object_id(integration_id)})
    return {"message": "Integration deleted"}


@router.post("/api-integrations/{integration_id}/test")
async def test_integration(integration_id: str, user: dict = Depends(get_current_user)):
    require_admin(user)
    integration = await api_integrations_collection.find_one({
        "_id": parse_object_id(integration_id)
    })
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    return {
        "success": True,
        "message": "Configuration is saved. External network testing is disabled in local mode.",
    }


@router.post("/validate-report-data")
async def validate_report_data(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can validate uploads")
    contents = await file.read()
    if file.filename.endswith(".xlsx"):
        frame = pd.read_excel(io.BytesIO(contents))
    elif file.filename.endswith(".csv"):
        frame = pd.read_csv(io.BytesIO(contents))
    else:
        raise HTTPException(status_code=400, detail="Only Excel and CSV files are supported")
    required = {
        "Agent Name", "Client Name", "Job Type", "Status", "Job No",
        "Billing Amount", "Expense", "Profit", "Date",
    }
    missing = sorted(required.difference(frame.columns))
    duplicate_jobs = int(frame["Job No"].duplicated().sum()) if "Job No" in frame else 0
    validation = {
        "validationId": f"VAL-{ObjectId()}",
        "filename": file.filename,
        "totalRows": len(frame),
        "missingColumns": missing,
        "duplicateJobNumbers": duplicate_jobs,
        "valid": not missing and duplicate_jobs == 0,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "createdBy": user["email"],
    }
    await data_validation_logs_collection.insert_one(validation)
    return serialize_document(validation)


@router.get("/validation-logs")
async def get_validation_logs(user: dict = Depends(get_current_user)):
    logs = await data_validation_logs_collection.find({}).sort("createdAt", -1).to_list(200)
    return serialize_documents(logs)


async def selected_report_rows(payload: dict, user: dict) -> list[dict]:
    selected_ids = payload.get("selectedIds", [])
    if not selected_ids:
        raise HTTPException(status_code=400, detail="Select at least one report row")
    object_ids = [parse_object_id(item) for item in selected_ids]
    rows = await reports_collection.find({"_id": {"$in": object_ids}}).to_list(5000)
    allowed = set(await accessible_report_ids(user))
    return [row for row in rows if row.get("reportId") in allowed]


@router.post("/reports/bulk-export-excel")
async def bulk_export_excel(payload: dict, user: dict = Depends(get_current_user)):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff cannot export reports")
    rows = await selected_report_rows(payload, user)
    frame = pd.DataFrame(serialize_documents(rows))
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        frame.to_excel(writer, index=False, sheet_name="Selected Reports")
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=selected_reports.xlsx"},
    )


@router.post("/reports/bulk-export-pdf")
async def bulk_export_pdf(payload: dict, user: dict = Depends(get_current_user)):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff cannot export reports")
    rows = await selected_report_rows(payload, user)
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=landscape(letter))
    headers = ["Job No", "Agent", "Client", "Type", "Status", "Billing", "Expense", "Profit", "Date"]
    data = [headers] + [[
        row.get("jobNo", ""),
        row.get("agentName", ""),
        row.get("clientName", ""),
        row.get("jobType", ""),
        row.get("status", ""),
        row.get("billingAmount", 0),
        row.get("expense", 0),
        row.get("profit", 0),
        row.get("date", ""),
    ] for row in rows]
    table = Table(data, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#312e81")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
    ]))
    document.build([table])
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=selected_reports.pdf"},
    )
