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
