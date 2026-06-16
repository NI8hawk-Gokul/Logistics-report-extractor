import React, { useEffect, useState } from "react";
import api from "../services/api";

export default function Settings({ user }) {
  const [settings, setSettings] = useState(null);
  const [modelStatus, setModelStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [retraining, setRetraining] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const fetchSettingsAndModels = async () => {
    setLoading(true);
    try {
      const [settingsRes, modelsRes] = await Promise.all([
        api.get("/settings"),
        api.get("/models/status")
      ]);
      setSettings(settingsRes.data);
      setModelStatus(modelsRes.data);
    } catch (e) {
      console.error("Failed to load settings", e);
      setError("Failed to load system configurations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettingsAndModels();
  }, []);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setMessage("");
    setError("");
    try {
      await api.patch("/settings", { settings });
      setMessage("Workspace settings updated successfully.");
    } catch (e) {
      setError("Failed to save settings. Make sure you have Administrator permissions.");
    }
  };

  const handleRetrain = async () => {
    setRetraining(true);
    setMessage("");
    setError("");
    try {
      const res = await api.post("/models/retrain");
      setMessage(res.data.message || "Models retrained successfully.");
      // Refresh status
      const statusRes = await api.get("/models/status");
      setModelStatus(statusRes.data);
    } catch (e) {
      setError(e.response?.data?.detail || "An error occurred during model retraining.");
    } finally {
      setRetraining(false);
    }
  };

  if (loading) return <div className="p-6 text-slate-500">Loading system configurations...</div>;

  const isAdmin = user?.role === "Admin";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">System Preferences</p>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Workspace & ML Settings</h1>
        </div>
      </div>

      {message && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 p-4 rounded-lg flex items-center justify-between">
          <span>{message}</span>
          <button className="text-lg font-bold" onClick={() => setMessage("")}>×</button>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 p-4 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button className="text-lg font-bold" onClick={() => setError("")}>×</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Workspace Configurations */}
        <section className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white border-b border-slate-100 dark:border-slate-700 pb-2">
            Company Preferences
          </h2>
          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">Company Name</label>
              <input
                disabled={!isAdmin}
                className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-slate-50 dark:bg-slate-700 disabled:opacity-60 text-slate-900 dark:text-white"
                value={settings?.company?.name || ""}
                onChange={(e) => setSettings({ ...settings, company: { ...settings.company, name: e.target.value } })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">Currency</label>
                <select
                  disabled={!isAdmin}
                  className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-slate-50 dark:bg-slate-700 disabled:opacity-60 text-slate-900 dark:text-white"
                  value={settings?.company?.currency || "INR"}
                  onChange={(e) => setSettings({ ...settings, company: { ...settings.company, currency: e.target.value } })}
                >
                  <option>INR</option>
                  <option>USD</option>
                  <option>EUR</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">Timezone</label>
                <input
                  disabled={!isAdmin}
                  className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-slate-50 dark:bg-slate-700 disabled:opacity-60 text-slate-900 dark:text-white"
                  value={settings?.company?.timezone || ""}
                  onChange={(e) => setSettings({ ...settings, company: { ...settings.company, timezone: e.target.value } })}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">Default Report Rows Page Size</label>
              <input
                disabled={!isAdmin}
                type="number"
                className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-slate-50 dark:bg-slate-700 disabled:opacity-60 text-slate-900 dark:text-white"
                value={settings?.reports?.defaultPageSize || 25}
                onChange={(e) => setSettings({ ...settings, reports: { ...settings.reports, defaultPageSize: Number(e.target.value) } })}
              />
            </div>

            {isAdmin && (
              <button className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm px-4 py-2 rounded shadow cursor-pointer transition-colors w-full">
                Save Workspace Configs
              </button>
            )}
          </form>
        </section>

        {/* Machine Learning Models */}
        <section className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white border-b border-slate-100 dark:border-slate-700 pb-2">
            Machine Learning Models
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Smart Logistics runs predictive algorithms in-memory for billing forecasting (Prophet) and shipping anomaly detection (Isolation Forest).
          </p>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-300">Prophet Billing Forecast Model</span>
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${modelStatus?.forecastModelLoaded ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-slate-100 text-slate-500"}`}>
                {modelStatus?.forecastModelLoaded ? "Loaded" : "Not Trained"}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-300">PyOD Anomaly Detection Model</span>
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${modelStatus?.anomalyModelLoaded ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-slate-100 text-slate-500"}`}>
                {modelStatus?.anomalyModelLoaded ? "Loaded" : "Not Trained"}
              </span>
            </div>
          </div>

          <hr className="border-slate-100 dark:border-slate-700" />

          {isAdmin ? (
            <div className="space-y-2">
              <button
                disabled={retraining}
                onClick={handleRetrain}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-sm px-4 py-2 rounded shadow cursor-pointer transition-colors w-full"
              >
                {retraining ? "Retraining Models (may take a moment)..." : "Retrain ML Models on Active Data"}
              </button>
              <p className="text-xs text-slate-400">
                Triggering retraining fits the forecasting and anomaly detection models to the currently active report data version.
              </p>
            </div>
          ) : (
            <p className="text-xs text-rose-500">
              Only workspace Administrators can trigger retraining of machine learning models.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
