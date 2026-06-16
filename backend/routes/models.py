"""Model management endpoints for training and retrieving ML models."""

from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any, List
import pandas as pd
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

router = APIRouter(prefix="/models")

# Instantiate a singleton MLStack (could be moved to dependency injection)
ml_stack = MLStack()

@router.post("/retrain")
async def retrain_models(user: dict = Depends(get_current_user)):
    """Retrain forecasting and anomaly models on the active report version.
    Only Admins can trigger retraining.
    """
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can retrain models")
    # Find active report
    db = get_database()
    if db is None:
        raise HTTPException(status_code=500, detail="Database not initialized")
    active_version = await db["report_versions"].find_one({"isActive": True, "isArchived": False})
    if not active_version:
        raise HTTPException(status_code=404, detail="No active report version found")
    report_id = active_version["reportId"]
    # Fetch all records for this report
    records = await db["reports"].find({"reportId": report_id}).to_list(5000)
    if not records:
        raise HTTPException(status_code=404, detail="No records to train on")
    df = pd.DataFrame(serialize_list(records))
    # Train forecast
    forecast_result = ml_stack.train_forecast_model(df)
    # Train anomaly detection
    anomaly_result = ml_stack.detect_anomalies(df)
    # Persist model artifacts (optional – could be saved to disk or DB)
    # For now, we just return the results
    return {
        "forecast": forecast_result["forecast"],
        "anomalies": anomaly_result,
        "message": "Models retrained successfully"
    }

@router.get("/status")
async def model_status(user: dict = Depends(get_current_user)):
    """Return a simple status indicating models are loaded (in‑memory)."""
    status = {
        "forecastModelLoaded": ml_stack._forecast_model is not None,
        "anomalyModelLoaded": ml_stack._anomaly_model is not None,
    }
    return status
