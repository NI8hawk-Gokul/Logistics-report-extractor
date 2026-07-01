"""Machine Learning utilities for forecasting, anomaly detection and sentiment analysis.

Provides:
- Prophet based time‑series forecasting (`train_forecast_model`)
- PyOD based anomaly detection (`detect_anomalies`)
- Placeholder for future sentiment model
"""

import pandas as pd
from prophet import Prophet
from pyod.models.iforest import IForest
from typing import Dict, Any

class MLStack:
    """Encapsulates ML models used by the API.
    Models are lazily instantiated and kept in memory for the app lifetime.
    """

    def __init__(self):
        self._forecast_model = None
        self._anomaly_model = None

    # ----------------------- Forecasting -----------------------------------
    def train_forecast_model(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Train a Prophet model on `billingAmount` over `date`.
        Expects `date` column (YYYY‑MM‑DD) and `billingAmount` numeric.
        Returns the forecast DataFrame (converted to list of dicts) and the model instance.
        """
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date", "billingAmount"])
        prophet_df = df[["date", "billingAmount"]].rename(columns={"date": "ds", "billingAmount": "y"})
        model = Prophet(yearly_seasonality=True, weekly_seasonality=True)
        model.add_country_holidays(country_name="IND")
        model.fit(prophet_df)
        future = model.make_future_dataframe(periods=30)  # next 30 days
        forecast = model.predict(future)
        self._forecast_model = model
        return {
            "forecast": forecast[["ds", "yhat", "yhat_lower", "yhat_upper"]]
                .tail(30)
                .to_dict(orient="records"),
            "model": model,
        }

    # ----------------------- Anomaly Detection ----------------------------
    def detect_anomalies(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Detect outliers in `billingAmount` and `profit` using IsolationForest.
        Returns indices of anomalous rows and a count.
        """
        df = df.copy()
        df["billingAmount"] = pd.to_numeric(df["billingAmount"], errors="coerce").fillna(0)
        df["profit"] = pd.to_numeric(df["profit"], errors="coerce").fillna(0)
        features = df[["billingAmount", "profit"]]
        model = IForest(contamination=0.05, random_state=42)
        model.fit(features)
        preds = model.labels_  # 0 = normal, 1 = outlier
        anomaly_indices = [int(i) for i, p in enumerate(preds) if p == 1]
        self._anomaly_model = model
        return {
            "anomaly_indices": anomaly_indices,
            "anomaly_count": len(anomaly_indices),
        }

    # ----------------------- Delay Risk Prediction ------------------------
    def predict_delay_risks(self, df: pd.DataFrame) -> dict:
        """Predict the likelihood of delay for pending shipments using scikit-learn.
        If historical training data is insufficient, falls back to a deterministic heuristic.
        """
        import numpy as np
        from sklearn.linear_model import LogisticRegression
        
        df = df.copy()
        
        # Standardize column names (mapping raw keys to standard variables)
        billing_col = "Billing Amount" if "Billing Amount" in df.columns else "billingAmount"
        expense_col = "Expense" if "Expense" in df.columns else "expense"
        profit_col = "Profit" if "Profit" in df.columns else "profit"
        status_col = "Status" if "Status" in df.columns else "status"
        agent_col = "Agent Name" if "Agent Name" in df.columns else "agentName"
        client_col = "Client Name" if "Client Name" in df.columns else "clientName"
        shipment_col = "Shipment Type" if "Shipment Type" in df.columns else ("jobType" if "jobType" in df.columns else "shipmentType")
        delay_reason_col = "Delay Reason" if "Delay Reason" in df.columns else "delayReason"
        
        # Clean columns
        for c in [billing_col, expense_col, profit_col]:
            if c in df.columns:
                df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
                
        # Fill missing categoricals
        for c in [status_col, agent_col, client_col, shipment_col, delay_reason_col]:
            if c in df.columns:
                df[c] = df[c].astype(str).fillna("").str.strip()
                
        # Label delay status
        def check_delayed(row):
            status_val = row.get(status_col, "").lower()
            delay_reason = row.get(delay_reason_col, "").lower()
            if status_val == "delayed" or (delay_reason and delay_reason != "none" and delay_reason != ""):
                return 1
            return 0
            
        df["_is_delayed"] = df.apply(check_delayed, axis=1)
        
        # Split into training data (Completed/Delayed) and predictions (Pending/In Transit)
        def check_pending(row):
            status_val = row.get(status_col, "").lower()
            return status_val in ["pending", "in transit", "in-transit"]
            
        pending_mask = df.apply(check_pending, axis=1)
        train_df = df[~pending_mask].copy()
        pred_df = df[pending_mask].copy()
        
        predictions = {}
        
        # If we have training data with both classes, train ML model
        use_ml = False
        if len(train_df) >= 4 and train_df["_is_delayed"].nunique() == 2:
            try:
                # Prepare features
                features_cols = []
                for c in [billing_col, expense_col, profit_col]:
                    if c in df.columns:
                        features_cols.append(c)
                        
                # Create dummy columns for categorical features
                cat_cols = [c for c in [agent_col, shipment_col] if c in df.columns]
                
                # Perform basic encoding
                X_train = train_df[features_cols].copy()
                X_pred = pred_df[features_cols].copy()
                
                for cat in cat_cols:
                    combined = pd.concat([train_df[cat], pred_df[cat]]).astype(str)
                    from sklearn.preprocessing import LabelEncoder
                    le = LabelEncoder()
                    le.fit(combined)
                    X_train[cat] = le.transform(train_df[cat].astype(str))
                    X_pred[cat] = le.transform(pred_df[cat].astype(str))
                    
                y_train = train_df["_is_delayed"].values
                
                model = LogisticRegression(random_state=42)
                model.fit(X_train, y_train)
                
                # Predict probabilities
                if not X_pred.empty:
                    probs = model.predict_proba(X_pred)[:, 1]
                    for idx, row in pred_df.iterrows():
                        prob = float(probs[len(predictions)])
                        predictions[str(row.get("id") or row.get("_id") or idx)] = prob
                        
                use_ml = True
            except Exception as e:
                print(f"ML training failed, falling back to heuristics: {str(e)}")
                
        # If ML is not used or was skipped, run heuristic predictive model
        if not use_ml:
            global_delay_rate = 0.15
            if not train_df.empty:
                global_delay_rate = train_df["_is_delayed"].mean()
                
            agent_delay_rates = {}
            if agent_col in train_df.columns:
                agent_delay_rates = train_df.groupby(agent_col)["_is_delayed"].mean().to_dict()
                
            for idx, row in pred_df.iterrows():
                score = global_delay_rate
                
                agent = row.get(agent_col)
                if agent and agent in agent_delay_rates:
                    score = 0.6 * score + 0.4 * agent_delay_rates[agent]
                    
                billing = row.get(billing_col, 0)
                profit = row.get(profit_col, 0)
                if profit < 0:
                    score += 0.2
                elif billing > 0 and profit / billing < 0.1:
                    score += 0.1
                    
                score = float(np.clip(score, 0.05, 0.95))
                predictions[str(row.get("id") or row.get("_id") or idx)] = score
                
        categorized_predictions = {}
        for key, prob in predictions.items():
            if prob >= 0.6:
                label = "High"
            elif prob >= 0.25:
                label = "Medium"
            else:
                label = "Low"
            categorized_predictions[key] = {
                "probability": round(prob * 100, 1),
                "risk": label
            }
            
        return categorized_predictions

