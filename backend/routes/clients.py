"""Client analytics, lifetime value, clustering, and export endpoints."""

import io
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
import pandas as pd
import numpy as np
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, letter
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

from database import get_database
from auth import get_current_user
from activity_logger import create_activity_log

db = get_database()
router = APIRouter(prefix="/clients")

# Helper function to serialize ObjectId
def serialize_doc(doc) -> Dict[str, Any]:
    if not doc:
        return {}
    res = dict(doc)
    res["id"] = str(res.get("_id"))
    res.pop("_id", None)
    return res

def serialize_list(docs) -> List[Dict[str, Any]]:
    return [serialize_doc(doc) for doc in docs]

async def accessible_report_ids(user: dict) -> list[str]:
    if user["role"] == "Admin":
        versions = await db["report_versions"].find({"isArchived": False}).to_list(500)
        return [version["reportId"] for version in versions]
    access = await db["report_access"].find({
        "$or": [
            {"assignedTo": user["email"], "assignedToType": "user", "isActive": True},
            {"assignedTo": user["role"], "assignedToType": "role", "isActive": True},
        ]
    }).to_list(500)
    return [item["reportId"] for item in access]

async def apply_user_data_scope(query: dict, user: dict) -> dict:
    scoped_query = dict(query)
    if user["role"] == "Admin":
        return scoped_query

    user_agent = await db["agents"].find_one({"email": user["email"]})
    if not user_agent:
        return scoped_query

    if user_agent.get("branch"):
        scoped_query["branch"] = user_agent["branch"]
    if user_agent.get("department"):
        scoped_query["department"] = user_agent["department"]
    return scoped_query

async def check_allow_financials() -> bool:
    settings_doc = await db["system_settings"].find_one({"key": "global"})
    if settings_doc:
        settings = settings_doc.get("settings", {})
        return settings.get("reports", {}).get("allowStaffFinancials", False)
    return False

def classify_client_segment(client_data: dict, max_date_str: str) -> str:
    billing = client_data["totalBilling"]
    pending = client_data["pendingPayment"]
    profit = client_data["totalProfit"]
    score = client_data["clientScore"]
    
    # 1. Payment Risk Client
    if pending > 0 and (billing == 0 or pending / billing >= 0.3):
        return "Payment Risk Client"
        
    # 2. Inactive Client
    if client_data["lastJobDate"] and max_date_str:
        try:
            last_dt = datetime.strptime(client_data["lastJobDate"], "%Y-%m-%d")
            max_dt = datetime.strptime(max_date_str, "%Y-%m-%d")
            if (max_dt - last_dt).days > 45:
                return "Inactive Client"
        except Exception:
            pass
            
    # 3. High Value Client
    if score >= 70:
        return "High Value Client"
        
    # 4. Low Profit Client
    if billing > 0 and (profit / billing < 0.10 or profit < 0):
        return "Low Profit Client"
        
    # 5. Regular Client
    return "Regular Client"

def get_suggested_action(segment: str) -> str:
    if segment == "High Value Client":
        return "Assign priority manager"
    elif segment == "Payment Risk Client":
        return "Follow up payment"
    elif segment == "Low Profit Client":
        return "Review low-profit jobs"
    elif segment == "Inactive Client":
        return "Offer discount"
    else:
        return "Continue regular service"

async def compute_clv_data(report_id: str, user: dict) -> List[Dict[str, Any]]:
    query = {"reportId": report_id}
    query = await apply_user_data_scope(query, user)
    records = await db["reports"].find(query).to_list(5000)
    
    if not records:
        return []

    # Find maximum date in report to compare active status
    dates = [r.get("date") for r in records if r.get("date")]
    max_date_str = max(dates) if dates else ""

    # Group by client
    from collections import defaultdict
    client_groups = defaultdict(list)
    for r in records:
        c_name = r.get("clientName")
        if c_name:
            client_groups[c_name].append(r)

    if not client_groups:
        return []

    client_names = list(client_groups.keys())
    
    # Query payments for pending payments
    payments = await db["payments"].find({"clientName": {"$in": client_names}}).to_list(5000)
    pending_payments = defaultdict(float)
    for p in payments:
        c_name = p.get("clientName")
        if c_name:
            status = p.get("status", "Unpaid")
            amount = float(p.get("amount", 0))
            paid_amount = float(p.get("paidAmount", 0))
            if status == "Unpaid":
                pending_payments[c_name] += amount
            elif status == "Partial":
                pending_payments[c_name] += max(0.0, amount - paid_amount)

    # Calculate ranges for score normalization
    max_billing = max((sum(float(r.get("billingAmount", 0)) for r in group) for group in client_groups.values()), default=0.0)
    max_profit = max((sum(float(r.get("profit", 0)) for r in group) for group in client_groups.values()), default=0.0)
    max_jobs = max((len(group) for group in client_groups.values()), default=0)

    clv_list = []
    for client_name, c_records in client_groups.items():
        billing = sum(float(r.get("billingAmount", 0)) for r in c_records)
        profit = sum(float(r.get("profit", 0)) for r in c_records)
        jobs = len(c_records)
        avg_profit = profit / jobs if jobs > 0 else 0.0
        last_date = max((r.get("date", "") for r in c_records if r.get("date")), default="")
        pending = pending_payments[client_name]

        # Scoring normalization
        billing_score = (billing / max_billing * 100) if max_billing > 0 else 0
        profit_score = (profit / max_profit * 100) if max_profit > 0 else 0
        freq_score = (jobs / max_jobs * 100) if max_jobs > 0 else 0

        if pending <= 0:
            reliability_score = 100
        elif billing <= 0:
            reliability_score = 0
        else:
            reliability_score = max(0.0, 100.0 - (pending / billing * 100.0))

        score = int(0.4 * billing_score + 0.3 * profit_score + 0.2 * freq_score + 0.1 * reliability_score)
        score = max(0, min(100, score))

        client_item = {
            "clientName": client_name,
            "totalBilling": billing,
            "totalProfit": profit,
            "totalJobs": jobs,
            "averageProfitPerJob": int(avg_profit),
            "lastJobDate": last_date,
            "pendingPayment": pending,
            "clientScore": score,
        }

        segment = classify_client_segment(client_item, max_date_str)
        client_item["segment"] = segment
        client_item["suggestedAction"] = get_suggested_action(segment)

        clv_list.append(client_item)

    # Staff visibility masking
    is_staff = user["role"] == "Staff"
    allow_financials = await check_allow_financials()
    if is_staff and not allow_financials:
        for item in clv_list:
            item["totalBilling"] = 0
            item["totalProfit"] = 0
            item["averageProfitPerJob"] = 0
            item["pendingPayment"] = 0
            item["clientScore"] = 0
            item["segment"] = "Hidden"
            item["suggestedAction"] = "Continue regular service"

    # Save to MongoDB Cache
    cache_docs = []
    now_iso = datetime.now(timezone.utc).isoformat()
    for item in clv_list:
        cache_docs.append({
            "reportId": report_id,
            "clientName": item["clientName"],
            "totalBilling": item["totalBilling"],
            "totalProfit": item["totalProfit"],
            "totalJobs": item["totalJobs"],
            "averageProfitPerJob": item["averageProfitPerJob"],
            "pendingPayment": item["pendingPayment"],
            "clientScore": item["clientScore"],
            "segment": item["segment"],
            "generatedAt": now_iso
        })
    if cache_docs:
        await db["client_analytics_cache"].delete_many({"reportId": report_id})
        await db["client_analytics_cache"].insert_many(cache_docs)

    return clv_list

# API: GET /clients/clv-analysis
@router.get("/clv-analysis")
async def get_clv_analysis(reportId: Optional[str] = None, user: dict = Depends(get_current_user)):
    if not reportId:
        active_ver = await db["report_versions"].find_one({"isActive": True, "isArchived": False})
        if active_ver:
            reportId = active_ver["reportId"]

    if not reportId:
        return {"data": []}

    allowed_reports = await accessible_report_ids(user)
    if reportId not in allowed_reports:
        await create_activity_log(user, "UNAUTHORIZED_ACCESS_ATTEMPT", f"Unauthorized attempt to access CLV analysis for report version {reportId}")
        raise HTTPException(status_code=403, detail="You do not have access to this report version")

    clv_data = await compute_clv_data(reportId, user)
    await create_activity_log(user, "CLIENT_CLV_VIEWED", f"Viewed client CLV analysis for report version {reportId}")
    return {"data": clv_data}

# API: GET /clients/segmentation
@router.get("/segmentation")
async def get_segmentation(reportId: Optional[str] = None, user: dict = Depends(get_current_user)):
    if not reportId:
        active_ver = await db["report_versions"].find_one({"isActive": True, "isArchived": False})
        if active_ver:
            reportId = active_ver["reportId"]

    if not reportId:
        return {"clusters": [], "summary": {}}

    allowed_reports = await accessible_report_ids(user)
    if reportId not in allowed_reports:
        await create_activity_log(user, "UNAUTHORIZED_ACCESS_ATTEMPT", f"Unauthorized attempt to access client segmentation for report version {reportId}")
        raise HTTPException(status_code=403, detail="You do not have access to this report version")

    # Get CLV data
    clv_data = await compute_clv_data(reportId, user)
    
    is_staff = user["role"] == "Staff"
    allow_financials = await check_allow_financials()
    if is_staff and not allow_financials:
        # Staff is not allowed to view cluster mappings which expose relative profit/billing shapes
        return {"clusters": [], "summary": {"highValueClients": 0, "regularClients": 0, "lowProfitClients": 0, "paymentRiskClients": 0, "inactiveClients": 0}}

    if not clv_data:
        return {"clusters": [], "summary": {}}

    # Perform KMeans Clustering
    features = []
    for c in clv_data:
        margin = c["totalProfit"] / c["totalBilling"] if c["totalBilling"] > 0 else 0.0
        features.append([
            c["totalBilling"],
            c["totalProfit"],
            c["totalJobs"],
            margin,
            c["pendingPayment"]
        ])

    features_arr = np.array(features)
    scaler = StandardScaler()
    scaled_features = scaler.fit_transform(features_arr)

    # Dynamically select cluster count up to 4 depending on data size
    n_clusters = min(4, len(clv_data))
    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init='auto')
    labels = kmeans.fit_predict(scaled_features)

    clusters = []
    summary = {
        "highValueClients": 0,
        "regularClients": 0,
        "lowProfitClients": 0,
        "paymentRiskClients": 0,
        "inactiveClients": 0
    }

    for i, c in enumerate(clv_data):
        clusters.append({
            "clientName": c["clientName"],
            "x": c["totalBilling"],
            "y": c["totalProfit"],
            "cluster": int(labels[i]),
            "segment": c["segment"]
        })
        
        # Increment summary counts
        seg = c["segment"]
        if seg == "High Value Client":
            summary["highValueClients"] += 1
        elif seg == "Regular Client":
            summary["regularClients"] += 1
        elif seg == "Low Profit Client":
            summary["lowProfitClients"] += 1
        elif seg == "Payment Risk Client":
            summary["paymentRiskClients"] += 1
        elif seg == "Inactive Client":
            summary["inactiveClients"] += 1

    await create_activity_log(user, "CLIENT_SEGMENTATION_GENERATED", f"Generated KMeans client segmentation for report version {reportId}")
    return {
        "clusters": clusters,
        "summary": summary
    }

# API: POST /clients/analytics/export-excel
@router.post("/analytics/export-excel")
async def export_excel(payload: dict, user: dict = Depends(get_current_user)):
    if user["role"] not in {"Admin", "Manager"}:
        await create_activity_log(user, "UNAUTHORIZED_ACCESS_ATTEMPT", "Unauthorized attempt to export client Excel report")
        raise HTTPException(status_code=403, detail="Only Admins and Managers can export client analytics")

    report_id = payload.get("reportId")
    if not report_id:
        active_ver = await db["report_versions"].find_one({"isActive": True, "isArchived": False})
        if active_ver:
            report_id = active_ver["reportId"]

    if not report_id:
        raise HTTPException(status_code=404, detail="No report version found to export")

    allowed_reports = await accessible_report_ids(user)
    if report_id not in allowed_reports:
        raise HTTPException(status_code=403, detail="You do not have access to this report data")

    clv_data = await compute_clv_data(report_id, user)
    
    # Rank clients
    clv_data = sorted(clv_data, key=lambda x: x["clientScore"], reverse=True)
    for idx, item in enumerate(clv_data):
        item["Rank"] = idx + 1

    df = pd.DataFrame(clv_data)
    if not df.empty:
        # Reorder and rename columns
        column_mapping = {
            "Rank": "Rank",
            "clientName": "Client Name",
            "totalBilling": "Total Billing (INR)",
            "totalProfit": "Total Profit (INR)",
            "totalJobs": "Total Jobs",
            "averageProfitPerJob": "Avg Profit Per Job (INR)",
            "lastJobDate": "Last Job Date",
            "pendingPayment": "Pending Payment (INR)",
            "clientScore": "Client Score",
            "segment": "Segment",
            "suggestedAction": "Suggested Action"
        }
        df = df.rename(columns=column_mapping)
        cols_ordered = ["Rank", "Client Name", "Total Billing (INR)", "Total Profit (INR)", "Total Jobs", "Avg Profit Per Job (INR)", "Last Job Date", "Pending Payment (INR)", "Client Score", "Segment", "Suggested Action"]
        df = df[[c for c in cols_ordered if c in df.columns]]

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Client Analytics")
    output.seek(0)

    await create_activity_log(user, "CLIENT_ANALYTICS_EXPORTED", f"Exported client analytics Excel for report {report_id}")
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=client_analytics_{report_id}.xlsx"}
    )

# API: POST /clients/analytics/export-pdf
@router.post("/analytics/export-pdf")
async def export_pdf(payload: dict, user: dict = Depends(get_current_user)):
    if user["role"] not in {"Admin", "Manager"}:
        await create_activity_log(user, "UNAUTHORIZED_ACCESS_ATTEMPT", "Unauthorized attempt to export client PDF report")
        raise HTTPException(status_code=403, detail="Only Admins and Managers can export client analytics")

    report_id = payload.get("reportId")
    if not report_id:
        active_ver = await db["report_versions"].find_one({"isActive": True, "isArchived": False})
        if active_ver:
            report_id = active_ver["reportId"]

    if not report_id:
        raise HTTPException(status_code=404, detail="No report version found to export")

    allowed_reports = await accessible_report_ids(user)
    if report_id not in allowed_reports:
        raise HTTPException(status_code=403, detail="You do not have access to this report data")

    clv_data = await compute_clv_data(report_id, user)
    clv_data = sorted(clv_data, key=lambda x: x["clientScore"], reverse=True)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(letter), rightMargin=30, leftMargin=30, topMargin=30, bottomMargin=30)
    story = []

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

    story.append(Paragraph("Smart Logistics - Client Segmentation & CLV Report", title_style))
    story.append(Spacer(1, 10))

    # Summary Info
    total_clients = len(clv_data)
    high_value = len([x for x in clv_data if x["segment"] == "High Value Client"])
    regular = len([x for x in clv_data if x["segment"] == "Regular Client"])
    low_profit = len([x for x in clv_data if x["segment"] == "Low Profit Client"])
    payment_risk = len([x for x in clv_data if x["segment"] == "Payment Risk Client"])
    inactive = len([x for x in clv_data if x["segment"] == "Inactive Client"])

    summary_data = [
        [Paragraph("<b>Total Clients</b>", body_style), Paragraph(str(total_clients), body_style),
         Paragraph("<b>High Value Clients</b>", body_style), Paragraph(str(high_value), body_style)],
        [Paragraph("<b>Regular Clients</b>", body_style), Paragraph(str(regular), body_style),
         Paragraph("<b>Payment Risk Clients</b>", body_style), Paragraph(str(payment_risk), body_style)],
        [Paragraph("<b>Low Profit Clients</b>", body_style), Paragraph(str(low_profit), body_style),
         Paragraph("<b>Inactive Clients</b>", body_style), Paragraph(str(inactive), body_style)]
    ]
    summary_table = Table(summary_data, colWidths=[120, 150, 120, 150])
    summary_table.setStyle(TableStyle([
        ('GRID', (0,0), (-1,-1), 0.5, colors.grey),
        ('PADDING', (0,0), (-1,-1), 6),
        ('BACKGROUND', (0,0), (0,-1), colors.HexColor('#f3f4f6')),
        ('BACKGROUND', (2,0), (2,-1), colors.HexColor('#f3f4f6'))
    ]))
    story.append(Paragraph("Client Segmentation Summary", section_style))
    story.append(summary_table)
    story.append(Spacer(1, 15))

    # Client Rankings Table
    table_headers = ["Rank", "Client Name", "Billing (INR)", "Profit (INR)", "Jobs", "Avg Profit/Job", "Pending (INR)", "Score", "Segment"]
    data_rows = [table_headers]

    for idx, row in enumerate(clv_data):
        data_rows.append([
            str(idx + 1),
            row["clientName"],
            f"{row['totalBilling']:,.0f}",
            f"{row['totalProfit']:,.0f}",
            str(row["totalJobs"]),
            f"{row['averageProfitPerJob']:,.0f}",
            f"{row['pendingPayment']:,.0f}",
            str(row["clientScore"]),
            row["segment"]
        ])

    report_table = Table(data_rows, colWidths=[35, 120, 80, 80, 45, 80, 80, 45, 110], repeatRows=1)
    report_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1e3a8a')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,0), 9),
        ('BOTTOMPADDING', (0,0), (-1,0), 6),
        ('ALIGN', (2,0), (3,-1), 'RIGHT'),
        ('ALIGN', (5,0), (6,-1), 'RIGHT'),
        ('FONTSIZE', (0,1), (-1,-1), 8),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e5e7eb')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f9fafb')])
    ]))

    story.append(Paragraph("Detailed Client Value Rankings", section_style))
    story.append(report_table)

    doc.build(story)
    buffer.seek(0)

    await create_activity_log(user, "CLIENT_ANALYTICS_EXPORTED", f"Exported client analytics PDF for report {report_id}")
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=client_analytics_{report_id}.pdf"}
    )

# API: POST /clients/log-activity
@router.post("/log-activity")
async def log_client_activity(payload: dict, user: dict = Depends(get_current_user)):
    action = payload.get("action")
    description = payload.get("description", "")
    valid_actions = {
        "CLIENT_CLV_VIEWED",
        "CLIENT_SEGMENTATION_GENERATED",
        "CLIENT_ANALYTICS_EXPORTED",
        "CLIENT_DETAIL_VIEWED",
        "UNAUTHORIZED_ACCESS_ATTEMPT"
    }
    if action in valid_actions:
        await create_activity_log(user, action, description)
        return {"status": "success"}
    raise HTTPException(status_code=400, detail="Invalid action type")

