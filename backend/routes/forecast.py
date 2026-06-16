"""Forecast endpoint – returns a 30‑day billing forecast using Prophet.

GET /forecast?reportId=<id>
Returns JSON: { "forecast": [{"ds": "YYYY‑MM‑DD", "yhat": float, ...}], "message": "OK" }
"""

from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any, List
import pandas as pd
import os

from ml_stack import MLStack
from database import get_database
from auth import get_current_user

def serialize_doc(doc) -> Dict[str, Any]:
    if not doc:
        return {}
    res = dict(doc)
    res["id"] = str(res.get("_id"))
    res.pop("_id", None)
    return res

def serialize_list(docs) -> List[Dict[str, Any]]:
    return [serialize_doc(doc) for doc in docs]

router = APIRouter(prefix="/forecast")
ml_stack = MLStack()

@router.get("")
async def get_forecast(reportId: str, user: dict = Depends(get_current_user)):
    # Basic permission guard – same logic as other endpoints
    if user["role"] == "Staff":
        raise HTTPException(status_code=403, detail="Staff cannot request forecasts")
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database not initialized")
    # Ensure report is accessible
    # Re‑use logic from main – you could import helper but keep simple here
    reports = await db["report_versions"].find({"reportId": reportId, "isArchived": False}).to_list(1)
    if not reports:
        raise HTTPException(status_code=404, detail="Report not found or archived")
    # Pull report data
    records = await db["reports"].find({"reportId": reportId}).to_list(5000)
    if not records:
        raise HTTPException(status_code=404, detail="No data to forecast")
    df = pd.DataFrame(serialize_list(records))
    # Train (or reuse) forecast model
    result = ml_stack.train_forecast_model(df)
    return {"forecast": result["forecast"], "message": "OK"}
