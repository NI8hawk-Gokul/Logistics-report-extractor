from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from pathlib import Path
import os
import io
import pandas as pd
from bson import ObjectId
import json
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders

# Import project modules
from database import (
    ACTIVE_DATABASE_MODE, get_database, users_collection, reports_collection, report_versions_collection,
    report_access_collection, report_templates_collection, scheduled_reports_collection,
    activity_logs_collection, branches_collection, departments_collection,
    clients_collection, agents_collection, jobs_collection, payments_collection,
    login_history_collection, login_otps_collection, documents_collection,
    approval_requests_collection, backups_collection, system_settings_collection,
    notifications_collection, data_validation_logs_collection
)
from models import (
    LoginRequest, FilterRequest, ColumnMappingRequest, SaveTemplateRequest,
    ScheduledReportRequest, ReportAccessRequest, ReportVersionRequest,
    BranchRequest, DepartmentRequest, ClientRequest, AgentRequest, JobRequest,
    AIChatRequest, ShareReportEmailRequest
)
from auth import verify_password, get_password_hash, create_access_token, get_current_user
from activity_logger import create_activity_log
from ai_engine import generate_ai_insights, answer_ai_query
from ml_stack import MLStack
from extended_routes import router as extended_router

# ReportLab flowables
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

app = FastAPI(title="Smart Logistics Portal API")
app.include_router(extended_router)
from routes.forecast import router as forecast_router
app.include_router(forecast_router)
from routes.models import router as models_router
app.include_router(models_router)

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db = get_database()


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "database": ACTIVE_DATABASE_MODE,
        "persistent": ACTIVE_DATABASE_MODE == "mongodb",
    }


# Helper: Convert BSON to JSON-serializable dict
def serialize_doc(doc) -> Dict[str, Any]:
    if not doc:
        return {}
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    return doc

def serialize_list(docs) -> List[Dict[str, Any]]:
    return [serialize_doc(doc) for doc in docs]

# JWT Token Response
def auth_response(user: dict) -> dict:
    access_token = create_access_token(data={"email": user["email"], "role": user["role"]})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "email": user["email"],
            "role": user["role"],
            "name": user["name"]
        }
    }

# ----------------- AUTH ENDPOINTS -----------------
@app.post("/login")
async def login(req: LoginRequest):
    user = await users_collection.find_one({"email": req.email})
    if not user:
        # Check standard default accounts
        if req.email == "admin@logistics.com" and req.password == "admin123":
            # Auto-seed
            user = {
                "email": "admin@logistics.com",
                "password_hash": get_password_hash("admin123"),
                "role": "Admin",
                "name": "System Administrator",
                "isActive": True
            }
            await users_collection.insert_one(user)
        elif req.email == "manager@logistics.com" and req.password == "manager123":
            user = {
                "email": "manager@logistics.com",
                "password_hash": get_password_hash("manager123"),
                "role": "Manager",
                "name": "Logistics Manager",
                "isActive": True
            }
            await users_collection.insert_one(user)
        elif req.email == "staff@logistics.com" and req.password == "staff123":
            user = {
                "email": "staff@logistics.com",
                "password_hash": get_password_hash("staff123"),
                "role": "Staff",
                "name": "Operations Staff",
                "isActive": True
            }
            await users_collection.insert_one(user)
        else:
            raise HTTPException(status_code=400, detail="Invalid email or password")
            
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Invalid email or password")
    if user.get("isActive") is False:
        raise HTTPException(status_code=403, detail="This account has been deactivated")
        
    await create_activity_log(user, "USER_LOGIN", f"User logged in successfully")
    return auth_response(user)

@app.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return {
        "email": user["email"],
        "role": user["role"],
        "name": user["name"]
    }

# ----------------- UPLOAD & MAP ENDPOINTS -----------------
@app.post("/upload-preview")
async def upload_preview(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can upload files")
        
    if not file.filename.endswith((".xlsx", ".csv")):
        raise HTTPException(status_code=400, detail="Only Excel (.xlsx) or CSV (.csv) files are allowed")
        
    contents = await file.read()
    if file.filename.endswith(".xlsx"):
        df = pd.read_excel(io.BytesIO(contents))
    else:
        df = pd.read_csv(io.BytesIO(contents))
        
    df = df.fillna("")
    preview_rows = df.head(10).to_dict(orient="records")
    
    # Temporarily cache file in memory/disk or return data
    # For preview, we return columns and preview rows
    await create_activity_log(user, "REPORT_PREVIEW_GENERATED", f"Generated preview for {file.filename}")
    
    # Store binary temp file contents in a temp vault to access it in confirm mapping
    temp_id = str(ObjectId())
    await documents_collection.insert_one({
        "tempId": temp_id,
        "filename": file.filename,
        "fileBytes": contents,
        "createdAt": datetime.now(timezone.utc).isoformat()
    })
    
    return {
        "tempId": temp_id,
        "filename": file.filename,
        "uploadedColumns": list(df.columns),
        "previewRows": preview_rows
    }

@app.post("/confirm-column-mapping")
async def confirm_column_mapping(req: Dict[str, Any], user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can confirm mapping")
        
    temp_id = req.get("tempId")
    mapping = req.get("mapping")  # Dict of RawHeader -> SystemField
    report_name = req.get("reportName", "New Logistics Report")
    period = req.get("period", "Current")
    description = req.get("description", "")
    
    if not temp_id or not mapping:
        raise HTTPException(status_code=400, detail="Missing mapping parameters")
        
    temp_file = await documents_collection.find_one({"tempId": temp_id})
    if not temp_file:
        raise HTTPException(status_code=404, detail="Temporary file session expired")
        
    # Read file
    if temp_file["filename"].endswith(".xlsx"):
        df = pd.read_excel(io.BytesIO(temp_file["fileBytes"]))
    else:
        df = pd.read_csv(io.BytesIO(temp_file["fileBytes"]))
        
    df = df.fillna("")
    
    # Rename columns based on mapping
    rename_dict = {}
    for raw, sys_field in mapping.items():
        if sys_field:
            rename_dict[raw] = sys_field
            
    df = df.rename(columns=rename_dict)
    
    # Ensure system columns exist, otherwise fill with defaults
    required_fields = ["Agent Name", "Client Name", "Job Type", "Status", "Job No", "Billing Amount", "Expense", "Profit", "Date"]
    for field in required_fields:
        if field not in df.columns:
            if field in ["Billing Amount", "Expense", "Profit"]:
                df[field] = 0.0
            elif field == "Date":
                df[field] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            else:
                df[field] = "N/A"
                
    # Normalize Branch & Department columns if they exist
    # If not mapped, map to default or parse if present
    branch_col = next((c for c in df.columns if c.lower() == "branch"), None)
    if not branch_col:
        df["Branch"] = "Chennai"  # Default
    else:
        df["Branch"] = df[branch_col].astype(str).str.strip()
        
    dept_col = next((c for c in df.columns if c.lower() in ["department", "dept"]), None)
    if not dept_col:
        df["Department"] = "Operations"  # Default
    else:
        df["Department"] = df[dept_col].astype(str).str.strip()

    # Convert numeric fields
    df["Billing Amount"] = pd.to_numeric(df["Billing Amount"], errors='coerce').fillna(0.0)
    df["Expense"] = pd.to_numeric(df["Expense"], errors='coerce').fillna(0.0)
    df["Profit"] = pd.to_numeric(df["Profit"], errors='coerce').fillna(0.0)
    
    # Standardize Date column format
    def format_date(d_val):
        try:
            return pd.to_datetime(d_val).strftime("%Y-%m-%d")
        except Exception:
            return str(d_val)
            
    df["Date"] = df["Date"].apply(format_date)
    
    report_id = "RPT-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    
    # Store records in MongoDB
    records = df.to_dict(orient="records")
    for r in records:
        r["reportId"] = report_id
        r["uploadedBy"] = user["email"]
        r["uploadedAt"] = datetime.now(timezone.utc).isoformat()
        # Ensure database fields are camelCase or match standard schema
        r["agentName"] = r.pop("Agent Name", "N/A")
        r["clientName"] = r.pop("Client Name", "N/A")
        r["jobType"] = r.pop("Job Type", "N/A")
        r["status"] = r.pop("Status", "N/A")
        r["jobNo"] = r.pop("Job No", "N/A")
        r["billingAmount"] = float(r.pop("Billing Amount", 0.0))
        r["expense"] = float(r.pop("Expense", 0.0))
        r["profit"] = float(r.pop("Profit", 0.0))
        r["date"] = r.pop("Date", "")
        r["branch"] = r.pop("Branch", "Chennai")
        r["department"] = r.pop("Department", "Operations")
        
    await reports_collection.insert_many(records)
    
    # Register Version
    version_doc = {
        "reportId": report_id,
        "reportName": report_name,
        "reportType": req.get("reportType", "Monthly"),
        "period": period,
        "description": description,
        "uploadedBy": user["email"],
        "uploadedAt": datetime.now(timezone.utc).isoformat(),
        "totalRecords": len(records),
        "isActive": True,
        "isArchived": False,
        "createdAt": datetime.now(timezone.utc).isoformat()
    }
    await report_versions_collection.insert_one(version_doc)
    
    # Deactivate other report versions if requested
    await report_versions_collection.update_many({"reportId": {"$ne": report_id}}, {"$set": {"isActive": False}})
    
    await create_activity_log(user, "REPORT_VERSION_CREATED", f"Uploaded version {report_id} with {len(records)} records")
    return {"message": "Column mapping saved and records inserted successfully", "reportId": report_id, "totalRecords": len(records)}

# ----------------- REPORT & FILTERS ENDPOINTS -----------------
# Access control helper
async def get_user_accessible_report_ids(user: dict) -> List[str]:
    if user["role"] == "Admin":
        versions = await report_versions_collection.find({"isArchived": False}).to_list(100)
        return [v["reportId"] for v in versions]
        
    # Check permissions in report_access collection
    accessible = await report_access_collection.find({
        "$or": [
            {"assignedTo": user["email"], "assignedToType": "user", "permissions.view": True, "isActive": True},
            {"assignedTo": user["role"], "assignedToType": "role", "permissions.view": True, "isActive": True}
        ]
    }).to_list(100)
    
    return [a["reportId"] for a in accessible]

@app.get("/report-versions")
async def get_report_versions(user: dict = Depends(get_current_user)):
    accessible_ids = await get_user_accessible_report_ids(user)
    # Return versions matching accessible report IDs
    versions = await report_versions_collection.find({"reportId": {"$in": accessible_ids}}).to_list(100)
    return serialize_list(versions)

@app.post("/report-versions")
async def create_report_version(req: ReportVersionRequest, user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can manage report versions")
    report_id = "RPT-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    version_doc = {
        "reportId": report_id,
        "reportName": req.reportName,
        "reportType": req.reportType,
        "period": req.period,
        "description": req.description,
        "uploadedBy": user["email"],
        "uploadedAt": datetime.now(timezone.utc).isoformat(),
        "totalRecords": 0,
        "isActive": False,
        "isArchived": False,
        "createdAt": datetime.now(timezone.utc).isoformat()
    }
    await report_versions_collection.insert_one(version_doc)
    await create_activity_log(user, "REPORT_VERSION_CREATED", f"Created manual empty version {report_id}")
    return serialize_doc(version_doc)

@app.patch("/report-versions/{report_id}/archive")
async def archive_report_version(report_id: str, user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can archive report versions")
    await report_versions_collection.update_one({"reportId": report_id}, {"$set": {"isArchived": True, "isActive": False}})
    await create_activity_log(user, "REPORT_VERSION_ARCHIVED", f"Archived report version {report_id}")
    return {"message": "Report version archived successfully"}

@app.patch("/report-versions/{report_id}/restore")
async def restore_report_version(report_id: str, user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can restore report versions")
    await report_versions_collection.update_one({"reportId": report_id}, {"$set": {"isArchived": False}})
    await create_activity_log(user, "REPORT_VERSION_RESTORED", f"Restored report version {report_id}")
    return {"message": "Report version restored successfully"}

@app.delete("/report-versions/{report_id}")
async def delete_report_version(report_id: str, user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can delete report versions")
    await report_versions_collection.delete_one({"reportId": report_id})
    await reports_collection.delete_many({"reportId": report_id})
    await create_activity_log(user, "REPORT_VERSION_DELETED", f"Deleted report version {report_id} and its associated records")
    return {"message": "Report version and associated records deleted permanently"}

@app.get("/filters")
async def get_filters(reportId: Optional[str] = None, user: dict = Depends(get_current_user)):
    # Verify access
    if not reportId:
        active_ver = await report_versions_collection.find_one({"isActive": True, "isArchived": False})
        if active_ver:
            reportId = active_ver["reportId"]
            
    if not reportId:
        return {"agents": [], "clients": [], "jobTypes": [], "statuses": [], "branches": [], "departments": []}
        
    accessible_ids = await get_user_accessible_report_ids(user)
    if reportId not in accessible_ids:
        raise HTTPException(status_code=403, detail="You do not have access to this report version")
        
    # Query database to get unique filter values
    # Admin gets all, managers/staff may be restricted to their branches/departments
    query = await apply_user_data_scope({"reportId": reportId}, user)
            
    pipeline = [
        {"$match": query},
        {"$facet": {
            "agents": [{"$group": {"_id": "$agentName"}}, {"$sort": {"_id": 1}}],
            "clients": [{"$group": {"_id": "$clientName"}}, {"$sort": {"_id": 1}}],
            "jobTypes": [{"$group": {"_id": "$jobType"}}, {"$sort": {"_id": 1}}],
            "statuses": [{"$group": {"_id": "$status"}}, {"$sort": {"_id": 1}}],
            "branches": [{"$group": {"_id": "$branch"}}, {"$sort": {"_id": 1}}],
            "departments": [{"$group": {"_id": "$department"}}, {"$sort": {"_id": 1}}]
        }}
    ]
    cursor = reports_collection.aggregate(pipeline)
    result = await cursor.to_list(1)
    
    facet = result[0] if result else {}
    return {
        "agents": [x["_id"] for x in facet.get("agents", []) if x["_id"]],
        "clients": [x["_id"] for x in facet.get("clients", []) if x["_id"]],
        "jobTypes": [x["_id"] for x in facet.get("jobTypes", []) if x["_id"]],
        "statuses": [x["_id"] for x in facet.get("statuses", []) if x["_id"]],
        "branches": [x["_id"] for x in facet.get("branches", []) if x["_id"]],
        "departments": [x["_id"] for x in facet.get("departments", []) if x["_id"]]
    }

def build_filter_query(filters: dict, user: dict) -> dict:
    query = {}
    
    report_id = filters.get("reportId")
    if report_id:
        query["reportId"] = report_id
        
    # Check checkbox selections
    if filters.get("agentName"):
        query["agentName"] = {"$in": filters["agentName"]}
    if filters.get("clientName"):
        query["clientName"] = {"$in": filters["clientName"]}
    if filters.get("jobType"):
        query["jobType"] = {"$in": filters["jobType"]}
    if filters.get("status"):
        query["status"] = {"$in": filters["status"]}
    if filters.get("branch"):
        query["branch"] = {"$in": filters["branch"]}
    if filters.get("department"):
        query["department"] = {"$in": filters["department"]}
        
    # Date Range
    date_range = filters.get("dateRange", {})
    from_date = date_range.get("fromDate")
    to_date = date_range.get("toDate")
    if from_date and to_date:
        query["date"] = {"$gte": from_date, "$lte": to_date}
    elif from_date:
        query["date"] = {"$gte": from_date}
    elif to_date:
        query["date"] = {"$lte": to_date}
        
    if user["role"] != "Staff":
        # Financial filters are not available to Staff users.
        profit_range = filters.get("profitRange", {})
        min_profit = profit_range.get("minProfit")
        max_profit = profit_range.get("maxProfit")
        if min_profit or max_profit:
            query["profit"] = {}
            if min_profit:
                query["profit"]["$gte"] = float(min_profit)
            if max_profit:
                query["profit"]["$lte"] = float(max_profit)

        billing_range = filters.get("billingRange", {})
        min_billing = billing_range.get("minBilling")
        max_billing = billing_range.get("maxBilling")
        if min_billing or max_billing:
            query["billingAmount"] = {}
            if min_billing:
                query["billingAmount"]["$gte"] = float(min_billing)
            if max_billing:
                query["billingAmount"]["$lte"] = float(max_billing)
            
    # Text Search
    search_text = filters.get("searchText")
    if search_text:
        search_regex = {"$regex": search_text, "$options": "i"}
        query["$or"] = [
            {"jobNo": search_regex},
            {"agentName": search_regex},
            {"clientName": search_regex},
            {"jobType": search_regex},
            {"status": search_regex}
        ]
        
    return query


async def apply_user_data_scope(query: dict, user: dict) -> dict:
    scoped_query = dict(query)
    if user["role"] == "Admin":
        return scoped_query

    user_agent = await agents_collection.find_one({"email": user["email"]})
    if not user_agent:
        return scoped_query

    if user_agent.get("branch"):
        scoped_query["branch"] = user_agent["branch"]
    if user_agent.get("department"):
        scoped_query["department"] = user_agent["department"]
    return scoped_query


@app.post("/filter-report")
async def filter_report(req: FilterRequest, user: dict = Depends(get_current_user)):
    accessible_ids = await get_user_accessible_report_ids(user)
    report_id = req.reportId
    if not report_id:
        active_ver = await report_versions_collection.find_one({"isActive": True, "isArchived": False})
        if active_ver:
            report_id = active_ver["reportId"]
            
    if not report_id:
        return {"total_records": 0, "data": []}
        
    if report_id not in accessible_ids:
        raise HTTPException(status_code=403, detail="You do not have access to this report version")
        
    filters_dict = req.dict()
    filters_dict["reportId"] = report_id
    query = build_filter_query(filters_dict, user)
    query = await apply_user_data_scope(query, user)
    
    cursor = reports_collection.find(query)
    results = await cursor.to_list(1000)
    
    serialized_results = serialize_list(results)

    if user["role"] == "Staff":
        for result in serialized_results:
            result.pop("billingAmount", None)
            result.pop("expense", None)
            result.pop("profit", None)
    
    await create_activity_log(user, "FILTERS_APPLIED", f"Queried filtered data for report version {report_id}")
    return {
        "total_records": len(serialized_results),
        "data": serialized_results
    }

# ----------------- EXPORTS & DOWNLOADS ENDPOINTS -----------------
@app.post("/download-excel")
async def download_excel(filters: Dict[str, Any], user: dict = Depends(get_current_user)):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff are not permitted to export data")
        
    report_id = filters.get("reportId")
    accessible_ids = await get_user_accessible_report_ids(user)
    if report_id not in accessible_ids:
        raise HTTPException(status_code=403, detail="You do not have access to this report data")
        
    query = build_filter_query(filters, user)
    query = await apply_user_data_scope(query, user)
    cursor = reports_collection.find(query)
    results = await cursor.to_list(5000)
    
    df = pd.DataFrame(serialize_list(results))
    if not df.empty:
        # Standardize order and headers
        column_mapping = {
            "agentName": "Agent Name",
            "clientName": "Client Name",
            "jobType": "Job Type",
            "status": "Status",
            "jobNo": "Job No",
            "billingAmount": "Billing Amount",
            "expense": "Expense",
            "profit": "Profit",
            "date": "Date",
            "branch": "Branch",
            "department": "Department"
        }
        df = df.rename(columns=column_mapping)
        # Select standard columns
        cols = ["Agent Name", "Client Name", "Job Type", "Status", "Job No", "Billing Amount", "Expense", "Profit", "Date", "Branch", "Department"]
        df = df[[c for c in cols if c in df.columns]]
        
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Sub Report")
        
    output.seek(0)
    
    await create_activity_log(user, "EXCEL_REPORT_DOWNLOADED", f"Downloaded Excel sub-report for {report_id}")
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=sub_report.xlsx"}
    )

@app.post("/download-pdf")
async def download_pdf(filters: Dict[str, Any], user: dict = Depends(get_current_user)):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff are not permitted to export data")
        
    report_id = filters.get("reportId")
    accessible_ids = await get_user_accessible_report_ids(user)
    if report_id not in accessible_ids:
        raise HTTPException(status_code=403, detail="You do not have access to this report data")
        
    query = build_filter_query(filters, user)
    query = await apply_user_data_scope(query, user)
    cursor = reports_collection.find(query)
    results = await cursor.to_list(5000)
    
    # Calculate summary stats for the PDF header
    total_jobs = len(results)
    total_billing = sum(x["billingAmount"] for x in results)
    total_expense = sum(x["expense"] for x in results)
    total_profit = sum(x["profit"] for x in results)
    completed_jobs = len([x for x in results if x["status"].lower() == "completed"])
    pending_jobs = len([x for x in results if x["status"].lower() == "pending"])
    
    # PDF generation buffer
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(letter), rightMargin=30, leftMargin=30, topMargin=30, bottomMargin=30)
    story = []
    
    # Styles
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=colors.HexColor('#1e3a8a'),
        spaceAfter=15
    )
    section_style = ParagraphStyle(
        'SectionHeader',
        parent=styles['Heading3'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=colors.HexColor('#1e3a8a'),
        spaceBefore=10,
        spaceAfter=6
    )
    body_style = styles['Normal']
    
    story.append(Paragraph("Smart Logistics Report Extraction and Sub-Report Generator", title_style))
    story.append(Spacer(1, 10))
    
    # Summary Grid
    summary_data = [
        [Paragraph("<b>Total Jobs</b>", body_style), Paragraph(str(total_jobs), body_style),
         Paragraph("<b>Completed Jobs</b>", body_style), Paragraph(str(completed_jobs), body_style)],
        [Paragraph("<b>Total Billing</b>", body_style), Paragraph(f"INR {total_billing:,.2f}", body_style),
         Paragraph("<b>Pending Jobs</b>", body_style), Paragraph(str(pending_jobs), body_style)],
        [Paragraph("<b>Total Expense</b>", body_style), Paragraph(f"INR {total_expense:,.2f}", body_style),
         Paragraph("<b>Total Profit</b>", body_style), Paragraph(f"INR {total_profit:,.2f}", body_style)]
    ]
    summary_table = Table(summary_data, colWidths=[120, 150, 120, 150])
    summary_table.setStyle(TableStyle([
        ('GRID', (0,0), (-1,-1), 0.5, colors.grey),
        ('PADDING', (0,0), (-1,-1), 6),
        ('BACKGROUND', (0,0), (0,-1), colors.HexColor('#f3f4f6')),
        ('BACKGROUND', (2,0), (2,-1), colors.HexColor('#f3f4f6'))
    ]))
    
    story.append(Paragraph("Report Summary", section_style))
    story.append(summary_table)
    story.append(Spacer(1, 15))
    
    # Data Table
    table_headers = ["Job No", "Agent Name", "Client Name", "Job Type", "Status", "Billing", "Expense", "Profit", "Date", "Branch"]
    data_rows = [table_headers]
    
    for row in results:
        data_rows.append([
            row["jobNo"],
            row["agentName"],
            row["clientName"],
            row["jobType"],
            row["status"],
            f"{row['billingAmount']:.0f}",
            f"{row['expense']:.0f}",
            f"{row['profit']:.0f}",
            row["date"],
            row["branch"]
        ])
        
    report_table = Table(data_rows, colWidths=[65, 80, 80, 85, 65, 50, 50, 50, 65, 60], repeatRows=1)
    report_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1e3a8a')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,0), 9),
        ('BOTTOMPADDING', (0,0), (-1,0), 8),
        ('ALIGN', (5,0), (7,-1), 'RIGHT'),
        ('FONTSIZE', (0,1), (-1,-1), 8),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e5e7eb')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f9fafb')])
    ]))
    
    story.append(Paragraph("Filtered Sub-Report Data", section_style))
    story.append(report_table)
    
    doc.build(story)
    buffer.seek(0)
    
    await create_activity_log(user, "PDF_REPORT_DOWNLOADED", f"Downloaded PDF sub-report for {report_id}")
    
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=sub_report.pdf"}
    )

# ----------------- ANALYTICS & AI ENDPOINTS -----------------
@app.get("/analytics")
async def get_analytics(reportId: Optional[str] = None, user: dict = Depends(get_current_user)):
    accessible_ids = await get_user_accessible_report_ids(user)
    if not reportId:
        active_ver = await report_versions_collection.find_one({"isActive": True, "isArchived": False})
        if active_ver:
            reportId = active_ver["reportId"]
            
    if not reportId:
        return {
            "profitByAgent": [], "billingByClient": [], "jobStatus": [],
            "monthlyProfit": [], "expenseVsProfit": []
        }
        
    if reportId not in accessible_ids:
        raise HTTPException(status_code=403, detail="You do not have access to this report data")
        
    query = await apply_user_data_scope({"reportId": reportId}, user)
    
    # Enforce Staff masking
    is_staff = user["role"] == "Staff"
    
    cursor = reports_collection.find(query)
    results = await cursor.to_list(5000)
    
    df = pd.DataFrame(serialize_list(results))
    if df.empty:
        return {
            "profitByAgent": [], "billingByClient": [], "jobStatus": [],
            "monthlyProfit": [], "expenseVsProfit": []
        }
        
    # Convert types
    df["billingAmount"] = pd.to_numeric(df["billingAmount"], errors='coerce').fillna(0)
    df["expense"] = pd.to_numeric(df["expense"], errors='coerce').fillna(0)
    df["profit"] = pd.to_numeric(df["profit"], errors='coerce').fillna(0)
    
    # Pie chart for job status (Staff CAN view this)
    status_counts = df["status"].value_counts().to_dict()
    job_status = [{"status": k, "count": int(v)} for k, v in status_counts.items()]
    
    if is_staff:
        # Mask profit, billing, expense charts for Staff
        return {
            "profitByAgent": [],
            "billingByClient": [],
            "jobStatus": job_status,
            "monthlyProfit": [],
            "expenseVsProfit": []
        }
        
    # 1. Profit by Agent
    agent_profits = df.groupby("agentName")["profit"].sum().reset_index()
    profit_by_agent = [{"agentName": r["agentName"], "totalProfit": float(r["profit"])} for _, r in agent_profits.iterrows()]
    
    # 2. Billing by Client
    client_billings = df.groupby("clientName")["billingAmount"].sum().reset_index()
    billing_by_client = [{"clientName": r["clientName"], "totalBilling": float(r["billingAmount"])} for _, r in client_billings.iterrows()]
    
    # 3. Monthly Profit
    df["date_dt"] = pd.to_datetime(df["date"], errors='coerce')
    df["month"] = df["date_dt"].dt.strftime("%Y-%m")
    monthly_data = df.groupby("month")["profit"].sum().reset_index().sort_values("month")
    monthly_profit = [{"month": r["month"], "profit": float(r["profit"])} for _, r in monthly_data.iterrows()]
    
    # 4. Expense vs Profit
    total_expense = float(df["expense"].sum())
    total_profit = float(df["profit"].sum())
    expense_vs_profit = [
        {"name": "Expense", "value": total_expense},
        {"name": "Profit", "value": total_profit}
    ]
    
    return {
        "profitByAgent": profit_by_agent,
        "billingByClient": billing_by_client,
        "jobStatus": job_status,
        "monthlyProfit": monthly_profit,
        "expenseVsProfit": expense_vs_profit
    }

@app.get("/ai-summary")
async def get_ai_summary(reportId: Optional[str] = None, user: dict = Depends(get_current_user)):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff are not permitted to view AI insights summaries")
        
    accessible_ids = await get_user_accessible_report_ids(user)
    if not reportId:
        active_ver = await report_versions_collection.find_one({"isActive": True, "isArchived": False})
        if active_ver:
            reportId = active_ver["reportId"]
            
    if not reportId:
        raise HTTPException(status_code=404, detail="No active report version found")
        
    if reportId not in accessible_ids:
        raise HTTPException(status_code=403, detail="You do not have access to this report data")
        
    query = await apply_user_data_scope({"reportId": reportId}, user)
    cursor = reports_collection.find(query)
    results = await cursor.to_list(5000)
    
    df = pd.DataFrame(serialize_list(results))
    insights = generate_ai_insights(df)
    return insights

@app.post("/ai-chat")
async def ai_chat(req: AIChatRequest, user: dict = Depends(get_current_user)):
    # Staff cannot query sensitive profit metrics
    is_staff = user["role"] == "Staff"
    if is_staff and ("profit" in req.query.lower() or "billing" in req.query.lower() or "expense" in req.query.lower()):
        return {"reply": "Sorry, you do not have permission to query financial metrics (profit, billing, expense)."}
        
    accessible_ids = await get_user_accessible_report_ids(user)
    active_ver = None
    if req.reportId:
        if req.reportId not in accessible_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this report")
        active_ver = await report_versions_collection.find_one({
            "reportId": req.reportId,
            "isArchived": False,
        })
    if not active_ver:
        active_ver = await report_versions_collection.find_one({
            "isActive": True,
            "isArchived": False,
            "reportId": {"$in": accessible_ids}
        })
    if not active_ver:
        return {"reply": "No active reports are available in the database to answer queries."}
        
    query = await apply_user_data_scope({"reportId": active_ver["reportId"]}, user)
    cursor = reports_collection.find(query)
    results = await cursor.to_list(5000)
    df = pd.DataFrame(serialize_list(results))
    
    reply = answer_ai_query(df, req.query)
    
    # Log chat history
    chat_log = {
        "userEmail": user["email"],
        "reportId": active_ver["reportId"],
        "query": req.query,
        "reply": reply,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await db["ai_chat_history"].insert_one(chat_log)
    
    return {"reply": reply}

@app.get("/ai-chat/history")
async def get_ai_chat_history(user: dict = Depends(get_current_user)):
    history = await db["ai_chat_history"].find({"userEmail": user["email"]}).sort("timestamp", -1).to_list(100)
    return serialize_list(history)

# ----------------- EMAIL SHARE ENDPOINT -----------------
@app.post("/share-report-email")
async def share_report_email(req: ShareReportEmailRequest, user: dict = Depends(get_current_user)):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff are not permitted to share reports")
        
    # Verify SMTP configs in backend environment
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_email = os.getenv("SMTP_EMAIL")
    smtp_password = os.getenv("SMTP_PASSWORD")
    
    if not smtp_email or not smtp_password:
        # For demo purposes, if credentials are not configured, print to log and return mock success
        print("SMTP Credentials not configured in .env. Mocking email delivery to:", req.toEmail)
        await create_activity_log(user, "EMAIL_REPORT_SHARED", f"Shared report with {req.toEmail} (Mock mode: credentials missing)")
        return {"message": f"Demo Mode: Email dispatch request registered for {req.toEmail} successfully."}
        
    # Implement actual mail sending
    try:
        msg = MIMEMultipart()
        msg['From'] = smtp_email
        msg['To'] = req.toEmail
        msg['Subject'] = req.subject
        msg.attach(MIMEText(req.message, 'plain'))
        
        # Connect to SMTP
        server = smtplib.SMTP(smtp_host, smtp_port)
        server.starttls()
        server.login(smtp_email, smtp_password)
        server.send_message(msg)
        server.quit()
        
        await create_activity_log(user, "EMAIL_REPORT_SHARED", f"Shared report by email with {req.toEmail}")
        return {"message": "Email sent successfully!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Mail delivery failed: {str(e)}")

# ----------------- ACTIVITY LOGS ENDPOINT -----------------
@app.get("/activity-logs")
async def get_activity_logs(user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can view activity logs")
    logs = await activity_logs_collection.find({}).sort("timestamp", -1).to_list(100)
    return serialize_list(logs)

# ----------------- CONFIGURATION CRUDS -----------------
# 1. Branches & Departments
@app.get("/branches")
async def get_branches(user: dict = Depends(get_current_user)):
    branches = await branches_collection.find({}).to_list(100)
    # Seed default branches if empty
    if not branches:
        defaults = [
            {"name": "Chennai Branch", "code": "B-CHN", "address": "Chennai Terminal 1"},
            {"name": "Mumbai Branch", "code": "B-MUM", "address": "Mumbai Terminal 2"},
            {"name": "Bangalore Branch", "code": "B-BLR", "address": "Bangalore Hub"}
        ]
        await branches_collection.insert_many(defaults)
        branches = await branches_collection.find({}).to_list(100)
    return serialize_list(branches)

@app.post("/branches")
async def create_branch(req: BranchRequest, user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can manage branches")
    branch_doc = req.dict()
    await branches_collection.insert_one(branch_doc)
    await create_activity_log(user, "BRANCH_CREATED", f"Created branch {req.name}")
    return serialize_doc(branch_doc)

@app.get("/departments")
async def get_departments(user: dict = Depends(get_current_user)):
    depts = await departments_collection.find({}).to_list(100)
    # Seed defaults if empty
    if not depts:
        defaults = [
            {"name": "Air Cargo Department", "code": "D-AIR", "manager": "manager@logistics.com"},
            {"name": "Sea Freight Department", "code": "D-SEA", "manager": "manager@logistics.com"},
            {"name": "Operations Department", "code": "D-OPS", "manager": "manager@logistics.com"}
        ]
        await departments_collection.insert_many(defaults)
        depts = await departments_collection.find({}).to_list(100)
    return serialize_list(depts)

@app.post("/departments")
async def create_department(req: DepartmentRequest, user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can manage departments")
    dept_doc = req.dict()
    await departments_collection.insert_one(dept_doc)
    await create_activity_log(user, "DEPARTMENT_CREATED", f"Created department {req.name}")
    return serialize_doc(dept_doc)

# 2. Clients & Agents
@app.get("/clients")
async def get_clients(user: dict = Depends(get_current_user)):
    clients = await clients_collection.find({}).to_list(100)
    return serialize_list(clients)

@app.post("/clients")
async def create_client(req: ClientRequest, user: dict = Depends(get_current_user)):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff cannot create clients")
    client_doc = req.dict()
    await clients_collection.insert_one(client_doc)
    await create_activity_log(user, "CLIENT_CREATED", f"Created client {req.name}")
    return serialize_doc(client_doc)

@app.get("/agents")
async def get_agents(user: dict = Depends(get_current_user)):
    agents = await agents_collection.find({}).to_list(100)
    return serialize_list(agents)

@app.post("/agents")
async def create_agent(req: AgentRequest, user: dict = Depends(get_current_user)):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff cannot create agents")
    agent_doc = req.dict()
    await agents_collection.insert_one(agent_doc)
    await create_activity_log(user, "AGENT_CREATED", f"Created agent {req.name}")
    return serialize_doc(agent_doc)

# 3. Jobs & Invoicing
@app.get("/jobs")
async def get_jobs(user: dict = Depends(get_current_user)):
    jobs = await jobs_collection.find({}).to_list(100)
    return serialize_list(jobs)

@app.post("/jobs")
async def create_job(req: JobRequest, user: dict = Depends(get_current_user)):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff cannot record manual jobs")
    job_doc = req.dict()
    await jobs_collection.insert_one(job_doc)
    
    # Automatically trigger payment invoice entry
    invoice_doc = {
        "invoiceNo": "INV-" + req.jobNo,
        "clientName": req.clientName,
        "amount": req.billingAmount,
        "status": "Unpaid",
        "createdAt": datetime.now(timezone.utc).isoformat()
    }
    await payments_collection.insert_one(invoice_doc)
    
    await create_activity_log(user, "JOB_RECORDED", f"Created job {req.jobNo} and triggered invoice generation")
    return serialize_doc(job_doc)

# 4. Payments & Approvals
@app.get("/payments")
async def get_payments(user: dict = Depends(get_current_user)):
    payments = await payments_collection.find({}).to_list(100)
    return serialize_list(payments)

@app.get("/payments/{payment_id}")
async def get_payment(payment_id: str, user: dict = Depends(get_current_user)):
    p = await payments_collection.find_one({"_id": ObjectId(payment_id)})
    return serialize_doc(p)

@app.patch("/payments/{payment_id}/mark-paid")
async def mark_payment_paid(payment_id: str, user: dict = Depends(get_current_user)):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff cannot alter payment logs")
        
    payment = await payments_collection.find_one({"_id": ObjectId(payment_id)})
    if not payment:
        raise HTTPException(status_code=404, detail="Payment record not found")
        
    # High-value invoices (> ₹1,00,000) require Admin approval
    if payment["amount"] > 100000.0 and user["role"] == "Manager":
        approval_id = str(ObjectId())
        approval_doc = {
            "approvalId": approval_id,
            "paymentId": payment_id,
            "targetType": "PaymentMarkPaid",
            "requestedBy": user["email"],
            "amount": payment["amount"],
            "status": "Pending",
            "createdAt": datetime.now(timezone.utc).isoformat()
        }
        await approval_requests_collection.insert_one(approval_doc)
        await create_activity_log(user, "APPROVAL_REQUIRED", f"Payment mark-paid of Rs.{payment['amount']} registered for approval")
        return {"requires_approval": True, "approval_id": approval_id, "message": "High value payment note queued for Admin approval"}
        
    await payments_collection.update_one({"_id": ObjectId(payment_id)}, {"$set": {"status": "Paid"}})
    await create_activity_log(user, "PAYMENT_CLEARED", f"Marked invoice {payment['invoiceNo']} as paid")
    return {"requires_approval": False, "status": "Paid", "message": "Payment cleared successfully"}

@app.get("/approvals")
async def get_approvals(user: dict = Depends(get_current_user)):
    approvals = await approval_requests_collection.find({}).to_list(100)
    return serialize_list(approvals)

@app.patch("/approvals/{approval_id}/approve")
async def execute_approval(approval_id: str, user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can authorize pending items")
        
    approval = await approval_requests_collection.find_one({"approvalId": approval_id})
    if not approval:
        raise HTTPException(status_code=404, detail="Approval request not found")
        
    # Mark payment as paid
    payment_id = approval["paymentId"]
    await payments_collection.update_one({"_id": ObjectId(payment_id)}, {"$set": {"status": "Paid"}})
    await approval_requests_collection.update_one({"approvalId": approval_id}, {"$set": {"status": "Approved"}})
    
    await create_activity_log(user, "APPROVAL_EXECUTED", f"Approved payment note {payment_id} requested by {approval['requestedBy']}")
    return {"message": "Request approved and payment completed"}

# 5. Saved Templates
@app.get("/templates")
async def get_templates(user: dict = Depends(get_current_user)):
    templates = await report_templates_collection.find({}).to_list(100)
    return serialize_list(templates)

@app.post("/templates")
async def create_template(req: SaveTemplateRequest, user: dict = Depends(get_current_user)):
    template_doc = {
        "templateName": req.templateName,
        "createdBy": user["email"],
        "userRole": user["role"],
        "filters": req.filters,
        "createdAt": datetime.now(timezone.utc).isoformat()
    }
    await report_templates_collection.insert_one(template_doc)
    await create_activity_log(user, "TEMPLATE_SAVED", f"Saved filter template: {req.templateName}")
    return serialize_doc(template_doc)

@app.delete("/templates/{template_id}")
async def delete_template(template_id: str, user: dict = Depends(get_current_user)):
    await report_templates_collection.delete_one({"_id": ObjectId(template_id)})
    await create_activity_log(user, "TEMPLATE_DELETED", f"Deleted template {template_id}")
    return {"message": "Template deleted successfully"}

# 6. Scheduled Reports
@app.get("/scheduled-reports")
async def get_scheduled_reports(user: dict = Depends(get_current_user)):
    schedules = await scheduled_reports_collection.find({}).to_list(100)
    return serialize_list(schedules)

@app.post("/scheduled-reports")
async def create_schedule(req: ScheduledReportRequest, user: dict = Depends(get_current_user)):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff cannot schedule reports")
        
    sched_doc = req.dict()
    sched_doc["createdBy"] = user["email"]
    sched_doc["userRole"] = user["role"]
    sched_doc["isActive"] = True
    sched_doc["createdAt"] = datetime.now(timezone.utc).isoformat()
    
    await scheduled_reports_collection.insert_one(sched_doc)
    await create_activity_log(user, "SCHEDULE_CREATED", f"Created scheduled task: {req.scheduleName}")
    return serialize_doc(sched_doc)

@app.delete("/scheduled-reports/{schedule_id}")
async def delete_schedule(schedule_id: str, user: dict = Depends(get_current_user)):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff cannot manage schedules")
    await scheduled_reports_collection.delete_one({"_id": ObjectId(schedule_id)})
    await create_activity_log(user, "SCHEDULE_DELETED", f"Deleted schedule {schedule_id}")
    return {"message": "Schedule deleted successfully"}

@app.patch("/scheduled-reports/{schedule_id}/toggle")
async def toggle_schedule(schedule_id: str, user: dict = Depends(get_current_user)):
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff cannot toggle schedules")
    sched = await scheduled_reports_collection.find_one({"_id": ObjectId(schedule_id)})
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found")
    new_state = not sched.get("isActive", True)
    await scheduled_reports_collection.update_one({"_id": ObjectId(schedule_id)}, {"$set": {"isActive": new_state}})
    await create_activity_log(user, "SCHEDULE_TOGGLED", f"Toggled schedule {schedule_id} to {new_state}")
    return {"message": f"Schedule toggled to {'Active' if new_state else 'Inactive'}"}

# 7. Report Access Control
@app.get("/report-access")
async def get_report_access(user: dict = Depends(get_current_user)):
    access = await report_access_collection.find({}).to_list(100)
    return serialize_list(access)

@app.post("/report-access")
async def assign_report_access(req: ReportAccessRequest, user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can manage report access control")
    access_doc = req.dict()
    access_doc["assignedBy"] = user["email"]
    access_doc["assignedAt"] = datetime.now(timezone.utc).isoformat()
    access_doc["isActive"] = True
    await report_access_collection.insert_one(access_doc)
    await create_activity_log(user, "REPORT_ACCESS_ASSIGNED", f"Assigned access on {req.reportId} to {req.assignedTo}")
    return serialize_doc(access_doc)

@app.delete("/report-access/{access_id}")
async def revoke_report_access(access_id: str, user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can revoke report access control")
    await report_access_collection.delete_one({"_id": ObjectId(access_id)})
    await create_activity_log(user, "REPORT_ACCESS_REVOKED", f"Revoked report access rule {access_id}")
    return {"message": "Access revoked successfully"}

# 8. Backups & Restore
@app.get("/backups")
async def get_backups(user: dict = Depends(get_current_user)):
    backups = await backups_collection.find({}).to_list(100)
    return serialize_list(backups)

@app.post("/backups/create")
async def create_backup(user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can create backups")
    backup_id = "BAK-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    backup_doc = {
        "backupId": backup_id,
        "createdBy": user["email"],
        "createdAt": datetime.now(timezone.utc).isoformat()
    }
    await backups_collection.insert_one(backup_doc)
    await create_activity_log(user, "BACKUP_CREATED", f"Created database backup: {backup_id}")
    return serialize_doc(backup_doc)


FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8080)
