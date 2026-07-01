from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Dict, Any, List
from auth import get_current_user
from database import reports_collection, report_versions_collection

def serialize_doc(doc: dict) -> dict:
    if not doc:
        return doc
    doc = dict(doc)
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    return doc

def serialize_list(docs) -> List[Dict[str, Any]]:
    return [serialize_doc(doc) for doc in docs]

router = APIRouter(prefix="/reports", tags=["compare"])

@router.get("/compare")
async def compare_reports(
    versionA: str = Query(..., description="Base report version ID"),
    versionB: str = Query(..., description="Target report version ID"),
    user: dict = Depends(get_current_user)
):
    # Retrieve report version metadata to ensure they exist
    ver_a = await report_versions_collection.find_one({"reportId": versionA})
    ver_b = await report_versions_collection.find_one({"reportId": versionB})
    
    if not ver_a or not ver_b:
        raise HTTPException(status_code=404, detail="One or both report versions not found")
        
    # Query all records for both reports
    records_a = await reports_collection.find({"reportId": versionA}).to_list(100000)
    records_b = await reports_collection.find({"reportId": versionB}).to_list(100000)
    
    # Map to jobNo
    map_a = {str(r.get("jobNo", "")).strip(): r for r in records_a if r.get("jobNo")}
    map_b = {str(r.get("jobNo", "")).strip(): r for r in records_b if r.get("jobNo")}
    
    jobs_a = set(map_a.keys())
    jobs_b = set(map_b.keys())
    
    added_jobs = jobs_b - jobs_a
    removed_jobs = jobs_a - jobs_b
    common_jobs = jobs_a & jobs_b
    
    modified_billing = []
    modified_profit = []
    modified_status = []
    
    for j in common_jobs:
        rec_a = map_a[j]
        rec_b = map_b[j]
        
        bill_a = float(rec_a.get("billingAmount") or 0.0)
        bill_b = float(rec_b.get("billingAmount") or 0.0)
        if abs(bill_a - bill_b) > 0.01:
            modified_billing.append({
                "jobNo": j,
                "clientName": rec_b.get("clientName", "N/A"),
                "oldValue": bill_a,
                "newValue": bill_b,
                "delta": bill_b - bill_a
            })
            
        profit_a = float(rec_a.get("profit") or 0.0)
        profit_b = float(rec_b.get("profit") or 0.0)
        if abs(profit_a - profit_b) > 0.01:
            modified_profit.append({
                "jobNo": j,
                "clientName": rec_b.get("clientName", "N/A"),
                "oldValue": profit_a,
                "newValue": profit_b,
                "delta": profit_b - profit_a
            })
            
        status_a = str(rec_a.get("status") or "").strip().lower()
        status_b = str(rec_b.get("status") or "").strip().lower()
        if status_a != status_b:
            modified_status.append({
                "jobNo": j,
                "clientName": rec_b.get("clientName", "N/A"),
                "oldValue": rec_a.get("status", "N/A"),
                "newValue": rec_b.get("status", "N/A")
            })
            
    # Added records details
    added_details = []
    for j in added_jobs:
        rec = map_b[j]
        added_details.append({
            "jobNo": j,
            "clientName": rec.get("clientName", "N/A"),
            "agentName": rec.get("agentName", "N/A"),
            "billingAmount": float(rec.get("billingAmount") or 0.0),
            "profit": float(rec.get("profit") or 0.0),
            "status": rec.get("status", "N/A"),
            "date": rec.get("date", "")
        })
        
    # Removed records details
    removed_details = []
    for j in removed_jobs:
        rec = map_a[j]
        removed_details.append({
            "jobNo": j,
            "clientName": rec.get("clientName", "N/A"),
            "agentName": rec.get("agentName", "N/A"),
            "billingAmount": float(rec.get("billingAmount") or 0.0),
            "profit": float(rec.get("profit") or 0.0),
            "status": rec.get("status", "N/A"),
            "date": rec.get("date", "")
        })
        
    # Summaries
    sum_bill_a = sum(float(r.get("billingAmount") or 0.0) for r in records_a)
    sum_bill_b = sum(float(r.get("billingAmount") or 0.0) for r in records_b)
    sum_profit_a = sum(float(r.get("profit") or 0.0) for r in records_a)
    sum_profit_b = sum(float(r.get("profit") or 0.0) for r in records_b)
    
    return {
        "meta": {
            "versionA": {
                "reportId": versionA,
                "reportName": ver_a.get("reportName", "Base Report"),
                "totalRecords": len(records_a),
                "totalBilling": sum_bill_a,
                "totalProfit": sum_profit_a
            },
            "versionB": {
                "reportId": versionB,
                "reportName": ver_b.get("reportName", "Target Report"),
                "totalRecords": len(records_b),
                "totalBilling": sum_bill_b,
                "totalProfit": sum_profit_b
            }
        },
        "counts": {
            "added": len(added_jobs),
            "removed": len(removed_jobs),
            "modifiedBilling": len(modified_billing),
            "modifiedProfit": len(modified_profit),
            "modifiedStatus": len(modified_status)
        },
        "deltas": {
            "records": len(records_b) - len(records_a),
            "billing": sum_bill_b - sum_bill_a,
            "profit": sum_profit_b - sum_profit_a
        },
        "addedRecords": added_details,
        "removedRecords": removed_details,
        "modifiedBillingRecords": modified_billing,
        "modifiedProfitRecords": modified_profit,
        "modifiedStatusRecords": modified_status
    }
