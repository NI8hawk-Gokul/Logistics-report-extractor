import io
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import os

import pandas as pd
import numpy as np
from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sklearn.linear_model import LinearRegression
from pydantic import BaseModel

from auth import get_current_user
from database import get_database
from activity_logger import create_activity_log

# ReportLab imports for PDF generation
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

router = APIRouter(prefix="/prediction")
db = get_database()
prediction_runs_collection = db["prediction_runs"]

def parse_object_id(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid record identifier") from exc

def serialize_doc(doc) -> Dict[str, Any]:
    if not doc:
        return {}
    res = dict(doc)
    res["id"] = str(res.get("_id"))
    res.pop("_id", None)
    return res

def serialize_list(docs) -> List[Dict[str, Any]]:
    return [serialize_doc(doc) for doc in docs]

# Clean numeric string to float
def clean_numeric(val):
    if pd.isna(val):
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    # Convert string
    s = str(val).strip()
    # Remove currency symbols (₹, $, € etc), commas, spaces
    s = re.sub(r'[^\d.-]', '', s)
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0

@router.post("/upload")
async def upload_prediction_report(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user)
):
    """
    Upload a report, parse columns dynamically, run local trend and forecasting models,
    generate local text insights, and store it in prediction_runs database.
    """
    if not file.filename.endswith((".xlsx", ".csv")):
        raise HTTPException(status_code=400, detail="Only Excel (.xlsx) or CSV (.csv) files are allowed")

    contents = await file.read()
    try:
        if file.filename.endswith(".xlsx"):
            df = pd.read_excel(io.BytesIO(contents))
        else:
            df = pd.read_csv(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {str(e)}")

    if df.empty:
        raise HTTPException(status_code=400, detail="The uploaded spreadsheet is empty.")

    # Memory limit check
    from database import ACTIVE_DATABASE_MODE
    if ACTIVE_DATABASE_MODE == "memory" and len(df) > 500:
        raise HTTPException(
            status_code=400,
            detail="Large uploads (>500 rows) are disabled in Memory Demo Mode. Please connect MongoDB to run in production mode."
        )

    # 1. Column Classification
    original_cols = list(df.columns)
    total_rows = len(df)
    
    # Identify date column
    date_col = None
    for col in original_cols:
        col_lower = col.lower()
        # Look for date keywords
        if any(kw in col_lower for kw in ["date", "time", "month", "year", "day", "timestamp", "period", "ds"]):
            # Try to convert to datetime to see if it is valid
            try:
                pd.to_datetime(df[col].head(10), errors="raise")
                date_col = col
                break
            except Exception:
                continue
                
    # If no date col found by name, check if any col has convertable date strings
    if not date_col:
        for col in original_cols:
            if df[col].dtype == object:
                try:
                    non_null = df[col].dropna().head(5)
                    if not non_null.empty:
                        pd.to_datetime(non_null, errors="raise")
                        date_col = col
                        break
                except Exception:
                    continue

    # Identify Numeric Target Columns
    numeric_targets = []
    # Identify Categorical Columns
    categorical_cols = []

    for col in original_cols:
        if col == date_col:
            continue
            
        # Check if column values can be clean-converted to numeric
        sample_vals = df[col].dropna().head(20)
        cleaned_samples = sample_vals.apply(clean_numeric)
        
        # If it converts to numeric and is not an ID (e.g. unique job number strings or incrementing IDs)
        is_numeric = False
        if pd.api.types.is_numeric_dtype(df[col]):
            is_numeric = True
        elif not cleaned_samples.empty and (cleaned_samples != 0).any():
            # If at least half of values are non-zero after conversion, treat as numeric candidate
            is_numeric = True

        # Check for ID-like columns (high uniqueness, integer steps or string formats)
        num_unique = df[col].nunique()
        if is_numeric:
            col_lower = col.lower()
            # Exclude explicit ID columns
            if any(id_kw in col_lower for id_kw in ["id", "no", "number", "code", "phone", "zip", "pin", "mobile"]):
                categorical_cols.append(col)
            elif num_unique == total_rows and total_rows > 10:
                categorical_cols.append(col)
            else:
                numeric_targets.append(col)
        else:
            # Categorical if cardinality is reasonable
            if num_unique < max(50, total_rows * 0.4):
                categorical_cols.append(col)

    # If no numerical column detected, fail or fallback
    if not numeric_targets:
        # Fallback: check if we can force any numeric
        numeric_cols = [c for c in original_cols if pd.api.types.is_numeric_dtype(df[c]) and c != date_col]
        if numeric_cols:
            numeric_targets = numeric_cols
        else:
            raise HTTPException(
                status_code=400, 
                detail="Could not detect any numerical metrics to analyze/forecast. Ensure your report contains columns with numeric values."
            )

    # Limit categorical columns to top 5 by cardinality for sanity
    categorical_cols = categorical_cols[:5]
    # Limit numeric targets to top 5
    numeric_targets = numeric_targets[:5]

    # Pre-clean numeric columns in DataFrame
    clean_df = df.copy()
    for col in numeric_targets:
        clean_df[col] = clean_df[col].apply(clean_numeric)

    # 2. Local Forecasting Engine (using Linear Regression + statistics)
    prediction_results = {}
    forecast_steps = 15  # predict 15 future steps
    
    # Sort or index by date
    if date_col:
        clean_df["_parsed_date"] = pd.to_datetime(clean_df[date_col], errors="coerce")
        # Drop rows where date is invalid
        clean_df = clean_df.dropna(subset=["_parsed_date"])
        clean_df = clean_df.sort_values("_parsed_date")
        
        # Aggregate duplicates by date
        date_grouped = clean_df.groupby("_parsed_date")[numeric_targets].sum().reset_index()
        history_len = len(date_grouped)
    else:
        history_len = len(clean_df)

    for target in numeric_targets:
        if date_col and history_len > 1:
            y = date_grouped[target].values
            x = np.arange(history_len).reshape(-1, 1)
            dates = date_grouped["_parsed_date"].dt.strftime("%Y-%m-%d").tolist()
            
            # Predict future dates
            last_date = date_grouped["_parsed_date"].max()
            # Check date frequency (crude estimation)
            if history_len > 1:
                date_diffs = date_grouped["_parsed_date"].diff().dropna()
                median_diff = date_diffs.median()
            else:
                median_diff = pd.Timedelta(days=1)
                
            future_dates = [
                (last_date + median_diff * i).strftime("%Y-%m-%d") 
                for i in range(1, forecast_steps + 1)
            ]
        else:
            # Fallback to row index index
            y = clean_df[target].values
            x = np.arange(history_len).reshape(-1, 1)
            dates = [f"Step {i+1}" for i in range(history_len)]
            future_dates = [f"Forecast +{i+1}" for i in range(forecast_steps)]

        # Run linear regression
        if len(x) > 1:
            model = LinearRegression()
            model.fit(x, y)
            
            # Predict historical + future
            hist_preds = model.predict(x)
            x_future = np.arange(history_len, history_len + forecast_steps).reshape(-1, 1)
            future_preds = model.predict(x_future)
            
            # Calculate standard error for confidence intervals
            residuals = y - hist_preds
            std_error = np.std(residuals) if len(residuals) > 0 else 1.0
            
            # Calculate Accuracy Metrics
            ss_res = np.sum(residuals ** 2)
            ss_tot = np.sum((y - np.mean(y)) ** 2)
            r2_score = 1.0 - (ss_res / ss_tot) if ss_tot != 0 else 1.0
            
            # MAPE
            non_zero_mask = y != 0
            if np.any(non_zero_mask):
                mape = np.mean(np.abs((y[non_zero_mask] - hist_preds[non_zero_mask]) / y[non_zero_mask])) * 100
            else:
                mape = 0.0
            
            slope = float(model.coef_[0])
            intercept = float(model.intercept_)
        else:
            slope = 0.0
            intercept = float(y[0]) if len(y) > 0 else 0.0
            hist_preds = y
            future_preds = np.array([intercept] * forecast_steps)
            std_error = 0.0
            r2_score = 1.0
            mape = 0.0

        # Bound forecast values to be >= 0 if all historical values were positive
        all_positive = (y >= 0).all()
        if all_positive:
            future_preds = np.clip(future_preds, 0, None)

        # Growth Rate calculation
        avg_hist = float(np.mean(y)) if len(y) > 0 else 1.0
        growth_rate = (slope * history_len) / (avg_hist if avg_hist != 0 else 1.0) * 100

        # Determine trend direction
        std_y = np.std(y) if len(y) > 1 else 1.0
        norm_slope = slope / std_y if std_y != 0 else 0.0
        if norm_slope > 0.03:
            trend = "Upward Growth"
        elif norm_slope < -0.03:
            trend = "Declining"
        else:
            trend = "Stable"

        # Outliers detection (Z-score > 2.2)
        outliers = []
        if len(y) > 2:
            mean_y = np.mean(y)
            std_y = np.std(y)
            if std_y > 0:
                for idx, val in enumerate(y):
                    z = (val - mean_y) / std_y
                    if abs(z) > 2.2:
                        direction = "high" if z > 0 else "low"
                        outliers.append({
                            "index": idx,
                            "label": dates[idx],
                            "value": float(val),
                            "deviation": float(z),
                            "reason": f"Outlier because {target} is unusually {direction} (Value: {float(val):.2f}, Z-Score: {float(z):+.2f})"
                        })

        prediction_results[target] = {
            "linear_regression": {
                "historical": [{"label": dates[i], "actual": float(y[i]), "fit": float(hist_preds[i])} for i in range(history_len)],
                "forecast": [{"label": future_dates[i], "predicted": float(future_preds[i]), "upper": float(future_preds[i] + 1.96 * std_error), "lower": float(np.clip(future_preds[i] - 1.96 * std_error, 0, None) if all_positive else future_preds[i] - 1.96 * std_error)} for i in range(forecast_steps)],
                "accuracy": {
                    "r2": float(r2_score),
                    "mape": float(mape)
                },
                "growthRatePercent": float(growth_rate),
                "trend": trend,
                "slope": slope,
                "mean": float(avg_hist),
                "max": float(np.max(y)) if len(y) > 0 else 0.0,
                "min": float(np.min(y)) if len(y) > 0 else 0.0,
                "totalHistorical": float(np.sum(y)),
                "totalForecasted": float(np.sum(future_preds)),
                "outliers": outliers
            }
        }
        
        # Add Prophet Forecasting
        try:
            if date_col and history_len > 2:
                from prophet import Prophet
                prophet_df = pd.DataFrame({"ds": date_grouped["_parsed_date"], "y": date_grouped[target]})
                p_model = Prophet(yearly_seasonality=False, weekly_seasonality=False, daily_seasonality=False)
                p_model.fit(prophet_df)
                p_future = p_model.make_future_dataframe(periods=forecast_steps, freq=median_diff)
                p_forecast = p_model.predict(p_future)
                
                p_hist_preds = p_forecast['yhat'][:history_len].values
                p_future_preds = p_forecast['yhat'][history_len:].values
                p_future_lower = p_forecast['yhat_lower'][history_len:].values
                p_future_upper = p_forecast['yhat_upper'][history_len:].values
                
                p_residuals = y - p_hist_preds
                p_ss_res = np.sum(p_residuals ** 2)
                p_r2 = 1.0 - (p_ss_res / ss_tot) if ss_tot != 0 else 1.0
                if np.any(non_zero_mask):
                    p_mape = np.mean(np.abs((y[non_zero_mask] - p_hist_preds[non_zero_mask]) / y[non_zero_mask])) * 100
                else:
                    p_mape = 0.0
                    
                prediction_results[target]["prophet"] = {
                    "historical": [{"label": dates[i], "actual": float(y[i]), "fit": float(p_hist_preds[i])} for i in range(history_len)],
                    "forecast": [{"label": future_dates[i], "predicted": float(p_future_preds[i]), "upper": float(p_future_upper[i]), "lower": float(p_future_lower[i])} for i in range(forecast_steps)],
                    "accuracy": {"r2": float(p_r2), "mape": float(p_mape)},
                    "growthRatePercent": float(growth_rate),
                    "trend": trend,
                    "outliers": outliers
                }
        except Exception as e:
            print(f"Prophet forecast failed for {target}: {e}")
            pass

        # Add Random Forest
        try:
            from sklearn.ensemble import RandomForestRegressor
            from sklearn.preprocessing import LabelEncoder
            
            rf_features = []
            rf_df = clean_df.copy().fillna(0)
            
            for col in numeric_targets:
                if col != target:
                    rf_features.append(col)
                    
            for col in categorical_cols:
                le = LabelEncoder()
                rf_df[col] = le.fit_transform(rf_df[col].astype(str))
                rf_features.append(col)
                
            if len(rf_features) > 0 and len(rf_df) > 5:
                X_rf = rf_df[rf_features].values
                y_rf = rf_df[target].values
                
                rf_model = RandomForestRegressor(n_estimators=50, random_state=42)
                rf_model.fit(X_rf, y_rf)
                rf_preds = rf_model.predict(X_rf)
                
                rf_ss_res = np.sum((y_rf - rf_preds) ** 2)
                rf_ss_tot = np.sum((y_rf - np.mean(y_rf)) ** 2)
                rf_r2 = 1.0 - (rf_ss_res / rf_ss_tot) if rf_ss_tot != 0 else 1.0
                
                rf_non_zero = y_rf != 0
                if np.any(rf_non_zero):
                    rf_mape = np.mean(np.abs((y_rf[rf_non_zero] - rf_preds[rf_non_zero]) / y_rf[rf_non_zero])) * 100
                else:
                    rf_mape = 0.0
                    
                importances = rf_model.feature_importances_
                feature_importances = [{"feature": rf_features[i], "importance": float(importances[i])} for i in range(len(rf_features))]
                feature_importances.sort(key=lambda x: x["importance"], reverse=True)
                
                rf_labels = rf_df[date_col].astype(str).tolist() if date_col else [f"Row {i+1}" for i in range(len(rf_df))]
                
                prediction_results[target]["random_forest"] = {
                    "historical": [{"label": rf_labels[i], "actual": float(y_rf[i]), "fit": float(rf_preds[i])} for i in range(min(len(rf_labels), 100))],
                    "forecast": [],
                    "accuracy": {"r2": float(rf_r2), "mape": float(rf_mape)},
                    "featureImportances": feature_importances,
                    "growthRatePercent": float(growth_rate),
                    "trend": trend,
                    "outliers": outliers
                }
        except Exception as e:
            print(f"Random Forest failed for {target}: {e}")
            pass

    # 3. Categorical Cross Analysis
    categorical_analysis = {}
    for cat in categorical_cols:
        categorical_analysis[cat] = {}
        for target in numeric_targets:
            # Group clean_df by cat and calculate average/sum of target
            grouped = clean_df.groupby(cat)[target].agg(["mean", "sum", "count"]).reset_index()
            # Sort by sum descending
            grouped = grouped.sort_values(by="sum", ascending=False).head(10)
            
            categorical_analysis[cat][target] = [
                {
                    "category": str(row[cat]),
                    "average": float(row["mean"]),
                    "sum": float(row["sum"]),
                    "count": int(row["count"])
                }
                for _, row in grouped.iterrows()
            ]

    # 4. Generate local rules-based AI text insights and suggestions
    insights = []
    suggestions = []

    # General summary insight
    insights.append(
        f"**Dataset Summary:** Analyzed logistics report containing **{total_rows}** total rows across "
        f"**{len(original_cols)}** columns. Auto-detected **{len(numeric_targets)}** key metrics "
        f"and **{len(categorical_cols)}** categories."
    )

    # Metrics-specific insights
    for target in numeric_targets:
        res = prediction_results[target]
        lr_res = res.get("linear_regression", res)
        trend_label = lr_res.get("trend", "Stable")
        growth_pct = lr_res.get("growthRatePercent", 0.0)
        
        # Trend insight
        if trend_label == "Upward Growth":
            insights.append(
                f"**{target} Trend:** Demonstrating a clear **upward trend** with an estimated project growth "
                f"of **+{growth_pct:.1f}%** over the next {forecast_steps} periods. Future cumulative value "
                f"is forecasted to reach **{lr_res.get('totalForecasted', 0.0):,.2f}**."
            )
            suggestions.append(
                f"Leverage the upward trend in **{target}** by optimizing capacity allocation and scaling "
                f"resources to match this growing demand."
            )
        elif trend_label == "Declining":
            insights.append(
                f"**{target} Alert:** Showing a **declining trend** of **{growth_pct:.1f}%**. "
                f"Current period metrics may decrease. Historical total was {lr_res.get('totalHistorical', 0.0):,.2f}, "
                f"while the next {forecast_steps} periods are projected to contract to **{lr_res.get('totalForecasted', 0.0):,.2f}**."
            )
            suggestions.append(
                f"Investigate operations impacting **{target}** immediately. Consider cost audits, reviewing "
                f"margin structures, or re-negotiating contracts to arrest this decline."
            )
        else:
            insights.append(
                f"**{target} Trend:** Metrics remain **stable and consistent** with a nominal change of "
                f"**{growth_pct:+.1f}%**. Historical average is **{lr_res.get('mean', 0.0):,.2f}** per period."
            )
            suggestions.append(
                f"Maintain standard operations for **{target}** while monitoring key cost drivers for incremental efficiencies."
            )

        # Outlier alert
        outliers_list = lr_res.get("outliers", [])
        if outliers_list:
            outlier_labels = [o["label"] for o in outliers_list[:3]]
            outlier_reasons = " ".join([o["reason"] for o in outliers_list[:2]])
            insights.append(
                f"**Anomaly Detected in {target}:** Identified **{len(outliers_list)}** anomaly events "
                f"during period(s): {', '.join(outlier_labels)}. {outlier_reasons}"
            )
            suggestions.append(
                f"Audit anomaly periods in **{target}** ({', '.join(outlier_labels)}) to check for billing errors, "
                f"seasonal spikes, or one-off operational issues."
            )

    # Categorical analysis insights
    for cat in categorical_cols:
        for target in numeric_targets:
            analysis_list = categorical_analysis[cat].get(target, [])
            if len(analysis_list) >= 2:
                top = analysis_list[0]
                bottom = analysis_list[-1]
                ratio = (top["sum"] / bottom["sum"]) if bottom["sum"] > 0 else 1.0
                
                insights.append(
                    f"**Performance Concentration ({cat} / {target}):** Top performer is **'{top['category']}'** "
                    f"generating a total of **{top['sum']:,.2f}** (avg: {top['average']:,.2f}), which is "
                    f"**{ratio:.1f}x** higher than the lowest performer **'{bottom['category']}'** ({bottom['sum']:,.2f})."
                )
                
                if ratio > 3.0:
                    suggestions.append(
                        f"Operational reliance on **'{top['category']}'** for **{target}** is high. Establish "
                        f"contingency plans or transfer best practices from '{top['category']}' to improve performance in other categories."
                    )

    if not suggestions:
        suggestions.append("Continue tracking automated predictions weekly to capture operational seasonality.")

    # 5. Save the prediction run with rawData limits
    # Limit to 10,000 rows to prevent DB bloat
    raw_data_records = clean_df.head(10000).to_dict(orient="records")
    
    run_doc = {
        "fileName": file.filename,
        "uploadedBy": user["email"],
        "uploadedAt": datetime.now(timezone.utc).isoformat(),
        "totalRows": total_rows,
        "dateColumn": date_col,
        "targets": numeric_targets,
        "categories": categorical_cols,
        "predictions": prediction_results,
        "categoricalAnalysis": categorical_analysis,
        "insights": insights,
        "suggestions": suggestions,
        "rawData": raw_data_records,
        "createdAt": datetime.now(timezone.utc).isoformat()
    }
    
    result = await prediction_runs_collection.insert_one(run_doc)
    run_id = str(result.inserted_id)

    await create_activity_log(
        user, 
        "AI_PREDICTION_RUN_COMPLETED", 
        f"Completed local prediction analysis for file {file.filename} (ID: {run_id})"
    )

    return {
        "message": "Prediction report generated successfully",
        "runId": run_id,
        "fileName": file.filename,
        "totalRows": total_rows,
        "targets": numeric_targets,
        "categories": categorical_cols,
        "predictions": prediction_results,
        "categoricalAnalysis": categorical_analysis,
        "insights": insights,
        "suggestions": suggestions
    }

@router.get("/runs")
async def list_prediction_runs(user: dict = Depends(get_current_user)):
    """List all previous prediction analysis runs in descending chronological order."""
    cursor = prediction_runs_collection.find({}).sort("createdAt", -1)
    runs = await cursor.to_list(100)
    # Serialize for frontend
    serialized = []
    for r in runs:
        # Avoid sending massive raw data in list endpoint to save bandwidth
        serialized.append({
            "id": str(r["_id"]),
            "fileName": r["fileName"],
            "uploadedBy": r["uploadedBy"],
            "uploadedAt": r["uploadedAt"],
            "totalRows": r["totalRows"],
            "targets": r["targets"],
            "categories": r["categories"]
        })
    return serialized

@router.get("/runs/{run_id}")
async def get_prediction_run(run_id: str, user: dict = Depends(get_current_user)):
    """Fetch details of a specific prediction run."""
    doc = await prediction_runs_collection.find_one({"_id": parse_object_id(run_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Prediction analysis record not found.")
    return serialize_doc(doc)

@router.delete("/runs/{run_id}")
async def delete_prediction_run(run_id: str, user: dict = Depends(get_current_user)):
    """Delete a prediction run record."""
    result = await prediction_runs_collection.find_one({"_id": parse_object_id(run_id)})
    if not result:
        raise HTTPException(status_code=404, detail="Prediction analysis record not found.")
    
    await prediction_runs_collection.delete_one({"_id": parse_object_id(run_id)})
    await create_activity_log(
        user, 
        "AI_PREDICTION_RUN_DELETED", 
        f"Deleted prediction run record (ID: {run_id}, File: {result.get('fileName')})"
    )
    return {"message": "Prediction record deleted successfully."}

@router.get("/runs/{run_id}/pdf")
async def download_prediction_pdf(run_id: str, user: dict = Depends(get_current_user)):
    """Generate a high-quality ReportLab PDF report for the prediction run."""
    run = await prediction_runs_collection.find_one({"_id": parse_object_id(run_id)})
    if not run:
        raise HTTPException(status_code=404, detail="Prediction analysis record not found.")

    buffer = io.BytesIO()
    # Design PDF
    doc = SimpleDocTemplate(
        buffer, 
        pagesize=letter, 
        rightMargin=40, 
        leftMargin=40, 
        topMargin=40, 
        bottomMargin=40
    )
    story = []

    # Design Styles
    styles = getSampleStyleSheet()
    
    # Custom colors matching the workspace
    primary_color = colors.HexColor('#4f46e5')  # Indigo
    dark_neutral = colors.HexColor('#0f172a')   # Slate 900
    light_neutral = colors.HexColor('#f8fafc')  # Slate 50
    border_color = colors.HexColor('#e2e8f0')   # Slate 200

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=22,
        leading=26,
        textColor=primary_color,
        spaceAfter=6
    )
    
    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=colors.HexColor('#64748b'),
        spaceAfter=20
    )

    section_style = ParagraphStyle(
        'SectionHeader',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=dark_neutral,
        spaceBefore=16,
        spaceAfter=10,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'BodyText',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=colors.HexColor('#334155'),
        spaceAfter=6
    )

    bold_body_style = ParagraphStyle(
        'BoldBodyText',
        parent=body_style,
        fontName='Helvetica-Bold'
    )

    recommendation_style = ParagraphStyle(
        'Recommendation',
        parent=body_style,
        textColor=colors.HexColor('#92400e'),
        spaceAfter=8
    )

    # --- Header ---
    story.append(Paragraph("Local AI Business Prediction Report", title_style))
    story.append(Paragraph(
        f"Confidential Internal Logistics Report &bull; Generated on: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        subtitle_style
    ))
    story.append(Spacer(1, 10))

    # --- Meta Info Table ---
    meta_data = [
        [Paragraph("<b>File Name:</b>", body_style), Paragraph(run["fileName"], body_style),
         Paragraph("<b>Analyst:</b>", body_style), Paragraph(run["uploadedBy"], body_style)],
        [Paragraph("<b>Total Data Rows:</b>", body_style), Paragraph(str(run["totalRows"]), body_style),
         Paragraph("<b>Analyzed At:</b>", body_style), Paragraph(run["uploadedAt"][:16].replace("T", " "), body_style)],
        [Paragraph("<b>Date Field:</b>", body_style), Paragraph(run["dateColumn"] or "None (Row Order)", body_style),
         Paragraph("<b>Metrics Found:</b>", body_style), Paragraph(", ".join(run["targets"]), body_style)]
    ]
    meta_table = Table(meta_data, colWidths=[110, 160, 90, 170])
    meta_table.setStyle(TableStyle([
        ('GRID', (0,0), (-1,-1), 0.5, border_color),
        ('PADDING', (0,0), (-1,-1), 6),
        ('BACKGROUND', (0,0), (0,-1), light_neutral),
        ('BACKGROUND', (2,0), (2,-1), light_neutral)
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 15))

    # --- Executive Summary & Insights ---
    story.append(Paragraph("Executive Summary & Predictive Insights", section_style))
    insights_bullets = []
    for ins in run["insights"]:
        # Simple markdown bold replacement for ReportLab
        formatted_ins = ins.replace("**", "<b>", 1).replace("**", "</b>", 1)
        insights_bullets.append([Paragraph("&bull;", body_style), Paragraph(formatted_ins, body_style)])
        
    insights_table = Table(insights_bullets, colWidths=[15, 515])
    insights_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('TOPPADDING', (0,0), (-1,-1), 2)
    ]))
    story.append(insights_table)
    story.append(Spacer(1, 15))

    # --- Recommendations ---
    story.append(Paragraph("Strategic Actions & Recommendations", section_style))
    sug_bullets = []
    for sug in run["suggestions"]:
        formatted_sug = sug.replace("**", "<b>", 1).replace("**", "</b>", 1)
        sug_bullets.append([Paragraph("&bull;", recommendation_style), Paragraph(formatted_sug, recommendation_style)])
        
    sug_table = Table(sug_bullets, colWidths=[15, 515])
    sug_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 2),
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#fffbeb'))  # Amber bg tint
    ]))
    story.append(sug_table)
    story.append(Spacer(1, 15))

    # --- Metrics & Forecast Breakdown ---
    story.append(Paragraph("Future Metric Forecasts (Next 15 Periods)", section_style))
    
    # Render forecast table for each numerical target
    for target in run["targets"]:
        story.append(Paragraph(f"<b>Metric: {target}</b> (Historical vs Forecasted Trend)", body_style))
        pred_data = run["predictions"][target]
        model_data = pred_data.get("linear_regression", pred_data)
        forecast_list = model_data.get("forecast", [])
        
        forecast_headers = ["Future Period", "Predicted Value", "Confidence Lower Bound", "Confidence Upper Bound"]
        forecast_rows = [forecast_headers]
        for f in forecast_list[:10]:  # Show next 10 periods in PDF table
            forecast_rows.append([
                f["label"],
                f"{f['predicted']:,.2f}",
                f"{f['lower']:,.2f}",
                f"{f['upper']:,.2f}"
            ])
            
        f_table = Table(forecast_rows, colWidths=[130, 130, 135, 135])
        f_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), primary_color),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('ALIGN', (1,0), (-1,-1), 'RIGHT'),
            ('GRID', (0,0), (-1,-1), 0.5, border_color),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTSIZE', (0,0), (-1,0), 9),
            ('FONTSIZE', (0,1), (-1,-1), 8),
            ('PADDING', (0,0), (-1,-1), 5),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, light_neutral])
        ]))
        story.append(f_table)
        story.append(Spacer(1, 12))

    doc.build(story)
    buffer.seek(0)
    
    await create_activity_log(
        user, 
        "AI_PREDICTION_PDF_DOWNLOADED", 
        f"Downloaded prediction analysis PDF (ID: {run_id})"
    )

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=local_ai_prediction_report_{run_id}.pdf"}
    )

class WhatIfRequest(BaseModel):
    target: str
    feature: str
    delta_percent: float

@router.post("/runs/{run_id}/what-if")
async def simulate_what_if(run_id: str, payload: WhatIfRequest, user: dict = Depends(get_current_user)):
    """Simulate a what-if scenario using the stored raw data and a dynamically trained Random Forest model."""
    doc = await prediction_runs_collection.find_one({"_id": parse_object_id(run_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Prediction analysis record not found.")
        
    raw_data = doc.get("rawData", [])
    if not raw_data:
        raise HTTPException(status_code=400, detail="Raw data not available for this run to perform What-If analysis.")
        
    df = pd.DataFrame(raw_data)
    
    if payload.target not in doc.get("targets", []):
        raise HTTPException(status_code=400, detail=f"Target {payload.target} is not a valid numeric target for this run.")
        
    if payload.feature not in df.columns:
        raise HTTPException(status_code=400, detail=f"Feature {payload.feature} not found in the dataset.")
        
    # Check if feature is numeric
    if not pd.api.types.is_numeric_dtype(df[payload.feature]):
        raise HTTPException(status_code=400, detail="What-If simulations are currently only supported for numeric features.")

    # Prepare features for Random Forest
    rf_features = []
    numeric_targets = doc.get("targets", [])
    categorical_cols = doc.get("categories", [])
    
    df = df.fillna(0)
    
    for col in numeric_targets:
        if col != payload.target:
            rf_features.append(col)
            
    from sklearn.preprocessing import LabelEncoder
    from sklearn.ensemble import RandomForestRegressor
    
    for col in categorical_cols:
        le = LabelEncoder()
        df[col] = le.fit_transform(df[col].astype(str))
        rf_features.append(col)
        
    if not rf_features or len(df) < 5:
        raise HTTPException(status_code=400, detail="Not enough features or rows to run a simulation.")
        
    X_base = df[rf_features].values
    y = df[payload.target].values
    
    model = RandomForestRegressor(n_estimators=50, random_state=42)
    model.fit(X_base, y)
    
    base_preds = model.predict(X_base)
    original_sum = float(np.sum(base_preds))
    
    # Apply What-If delta
    df_sim = df.copy()
    multiplier = 1.0 + (payload.delta_percent / 100.0)
    df_sim[payload.feature] = df_sim[payload.feature] * multiplier
    
    X_sim = df_sim[rf_features].values
    sim_preds = model.predict(X_sim)
    new_sum = float(np.sum(sim_preds))
    
    delta_value = new_sum - original_sum
    
    return {
        "originalSum": original_sum,
        "newSum": new_sum,
        "deltaValue": delta_value,
        "deltaPercent": (delta_value / original_sum * 100) if original_sum != 0 else 0.0,
        "message": f"If {payload.feature} changes by {payload.delta_percent:+.1f}%, {payload.target} is projected to change by {delta_value:+,.2f}."
    }

