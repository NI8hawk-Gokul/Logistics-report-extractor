import React, { useState, useEffect, useMemo } from "react";
import api from "../services/api";
import { PageHeading, StatusBadge } from "./CorePages";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
  BarChart,
  Bar
} from "recharts";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

export default function PredictionAnalysis({ user }) {
  const [runs, setRuns] = useState([]);
  const [activeRun, setActiveRun] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedModel, setSelectedModel] = useState("linear_regression");

  // What-If Simulator state variables
  const [whatIfFeature, setWhatIfFeature] = useState("");
  const [whatIfDelta, setWhatIfDelta] = useState(10);
  const [whatIfLoading, setWhatIfLoading] = useState(false);
  const [whatIfResult, setWhatIfResult] = useState(null);
  const [whatIfError, setWhatIfError] = useState("");

  // Fetch past prediction runs list
  const fetchRuns = async (selectLatestId = null) => {
    try {
      setLoading(true);
      const { data } = await api.get("/prediction/runs");
      setRuns(data);
      
      // Auto-load a run if requested, or the latest available one
      if (selectLatestId) {
        loadRun(selectLatestId);
      } else if (data.length > 0 && !activeRun) {
        loadRun(data[0].id);
      }
    } catch (err) {
      console.error(err);
      setError("Failed to load historical prediction runs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  // Set default target and category when a run is loaded
  useEffect(() => {
    if (activeRun) {
      if (activeRun.targets && activeRun.targets.length > 0) {
        setSelectedTarget(activeRun.targets[0]);
      }
      if (activeRun.categories && activeRun.categories.length > 0) {
        setSelectedCategory(activeRun.categories[0]);
      }
      setSelectedModel("linear_regression");
    } else {
      setSelectedTarget("");
      setSelectedCategory("");
      setSelectedModel("linear_regression");
    }
  }, [activeRun]);

  // Reset What-If State when target or run changes
  useEffect(() => {
    setWhatIfResult(null);
    setWhatIfError("");
    if (activeRun && activeRun.targets) {
      const eligible = activeRun.targets.filter(t => t !== selectedTarget);
      if (eligible.length > 0) {
        setWhatIfFeature(eligible[0]);
      } else {
        setWhatIfFeature("");
      }
    } else {
      setWhatIfFeature("");
    }
  }, [activeRun, selectedTarget]);

  useEffect(() => {
    setWhatIfResult(null);
    setWhatIfError("");
  }, [selectedModel]);

  const handleWhatIfSimulate = async () => {
    if (!activeRun || !selectedTarget || !whatIfFeature) return;
    try {
      setWhatIfLoading(true);
      setWhatIfError("");
      const runId = activeRun.id || activeRun.runId;
      const { data } = await api.post(`/prediction/runs/${runId}/what-if`, {
        target: selectedTarget,
        feature: whatIfFeature,
        delta_percent: parseFloat(whatIfDelta)
      });
      setWhatIfResult(data);
    } catch (err) {
      console.error(err);
      setWhatIfError(err.response?.data?.detail || "Simulation failed. Please try again.");
    } finally {
      setWhatIfLoading(false);
    }
  };

  const loadRun = async (runId) => {
    try {
      setLoading(true);
      setError("");
      const { data } = await api.get(`/prediction/runs/${runId}`);
      setActiveRun(data);
    } catch (err) {
      console.error(err);
      setError("Failed to load the selected prediction run details.");
    } finally {
      setLoading(false);
    }
  };

  const deleteRun = async (runId, event) => {
    event.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this prediction analysis history item?")) {
      return;
    }
    try {
      setLoading(true);
      await api.delete(`/prediction/runs/${runId}`);
      if (activeRun && activeRun.id === runId) {
        setActiveRun(null);
      }
      fetchRuns();
    } catch (err) {
      console.error(err);
      setError("Failed to delete the prediction run.");
      setLoading(false);
    }
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    setLoading(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const { data } = await api.post("/prediction/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setActiveRun(data);
      fetchRuns(data.runId);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || "An error occurred during file upload and analysis.");
      setLoading(false);
    }
  };

  const onDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const onDragLeave = () => {
    setDragOver(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFileUpload(droppedFile);
    }
  };

  const handleDownloadPdf = async (runId) => {
    try {
      const response = await api.get(`/prediction/runs/${runId}/pdf`, { responseType: "blob" });
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `Confidential_Prediction_Report_${runId}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Failed to download PDF report.");
    }
  };

  // Active prediction metrics
  const activeMetrics = useMemo(() => {
    if (!activeRun || !selectedTarget || !activeRun.predictions?.[selectedTarget]) return null;
    const pred = activeRun.predictions[selectedTarget];
    
    // Support nested model structure
    if (pred[selectedModel]) {
        return pred[selectedModel];
    }
    // Backward compatibility for old single-model runs or fallback
    return pred;
  }, [activeRun, selectedTarget, selectedModel]);

  // Combine historical and forecasted data for rendering
  const chartData = useMemo(() => {
    if (!activeMetrics) return [];
    
    // Format historical
    const hist = (activeMetrics.historical || []).map(item => ({
      name: item.label,
      actual: Math.round(item.actual),
      trendFit: Math.round(item.fit),
      type: "Historical"
    }));

    // Format forecast
    const forecast = (activeMetrics.forecast || []).map((item, idx) => ({
      name: item.label,
      predicted: Math.round(item.predicted),
      lower: Math.round(item.lower),
      upper: Math.round(item.upper),
      type: "Forecast"
    }));

    // To connect the historical and forecast lines on the chart,
    // we make sure the first forecasted item or the last historical item matches.
    if (hist.length > 0 && forecast.length > 0) {
      const lastHist = hist[hist.length - 1];
      // Create a bridging point
      forecast.unshift({
        name: lastHist.name,
        predicted: lastHist.actual,
        lower: lastHist.actual,
        upper: lastHist.actual,
        type: "Forecast"
      });
    }

    return [...hist, ...forecast];
  }, [activeMetrics]);

  // Format category chart data
  const categoryChartData = useMemo(() => {
    if (!activeRun || !selectedCategory || !selectedTarget || !activeRun.categoricalAnalysis?.[selectedCategory]?.[selectedTarget]) {
      return [];
    }
    return activeRun.categoricalAnalysis[selectedCategory][selectedTarget].map(item => ({
      name: item.category,
      average: Math.round(item.average),
      sum: Math.round(item.sum),
      count: item.count
    }));
  }, [activeRun, selectedCategory, selectedTarget]);

  // Available models for the selected target
  const availableModels = useMemo(() => {
    if (!activeRun || !selectedTarget || !activeRun.predictions?.[selectedTarget]) return ["linear_regression"];
    const pred = activeRun.predictions[selectedTarget];
    if (pred.linear_regression) {
      return Object.keys(pred);
    }
    return ["linear_regression"];
  }, [activeRun, selectedTarget]);

  return (
    <>
      <PageHeading
        eyebrow="Local Intelligence Engine"
        title="AI Prediction Analysis"
        description="Predict future business metrics, analyze performance drivers, and receive local executive suggestions with 100% data confidentiality."
      />

      {error && <div className="inline-alert error mb-4">{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", gap: "24px", alignItems: "start" }}>
        
        {/* Sidebar: Runs History */}
        <aside className="card panel" style={{ padding: "16px", minHeight: "60vh" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", borderBottom: "1px solid var(--border-color)", paddingBottom: "10px" }}>
            <h3 style={{ margin: 0, fontSize: "15px" }}>Prediction Runs</h3>
            <button 
              className="btn-secondary" 
              onClick={() => setActiveRun(null)}
              style={{ fontSize: "11px", padding: "4px 8px", margin: 0 }}
            >
              + New Run
            </button>
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", maxHeight: "550px" }}>
            {runs.map((run) => (
              <div 
                key={run.id}
                onClick={() => loadRun(run.id)}
                className={`card hover-effect`}
                style={{
                  padding: "10px 12px",
                  cursor: "pointer",
                  border: activeRun?.id === run.id ? "1.5px solid var(--primary)" : "1px solid var(--border-color)",
                  background: activeRun?.id === run.id ? "var(--primary-light)" : "var(--bg-card)",
                  position: "relative"
                }}
              >
                <div style={{ paddingRight: "20px" }}>
                  <strong style={{ display: "block", fontSize: "13px", color: "var(--text-heading)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }} title={run.fileName}>
                    {run.fileName}
                  </strong>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginTop: "4px" }}>
                    {run.totalRows} rows &bull; {new Date(run.uploadedAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  onClick={(e) => deleteRun(run.id, e)}
                  style={{
                    position: "absolute",
                    right: "8px",
                    top: "8px",
                    background: "none",
                    border: "none",
                    color: "var(--danger)",
                    fontSize: "16px",
                    padding: "2px",
                    cursor: "pointer",
                    margin: 0
                  }}
                  title="Delete analysis"
                >
                  &times;
                </button>
              </div>
            ))}
            {runs.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: "13px", textAlign: "center", marginTop: "20px" }}>
                No past prediction runs.
              </p>
            )}
          </div>
        </aside>

        {/* Main Content Area */}
        <section>
          {loading ? (
            <div className="card loading-panel" style={{ height: "450px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
              <span className="upload-icon" style={{ animation: "spin 2s linear infinite" }}>🔄</span>
              <p style={{ marginTop: "12px", fontSize: "15px" }}>Processing dataset and calculating forecasting projections locally...</p>
            </div>
          ) : !activeRun ? (
            /* Upload Zone Screen */
            <div 
              className="card upload-card"
              style={{
                border: dragOver ? "2px dashed var(--primary)" : "2px dashed var(--border-color)",
                background: dragOver ? "var(--primary-light)" : "var(--bg-card)",
                transition: "all 0.2s ease",
                padding: "40px"
              }}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <label className="upload-dropzone" style={{ cursor: "pointer" }}>
                <input 
                  type="file" 
                  accept=".xlsx,.csv" 
                  onChange={(event) => handleFileUpload(event.target.files?.[0])}
                  style={{ display: "none" }}
                />
                <span className="upload-icon" style={{ fontSize: "48px", color: "var(--primary)" }}>📈</span>
                <h2 style={{ marginTop: "16px", fontSize: "20px" }}>Upload a report for local AI prediction</h2>
                <p style={{ color: "var(--text-muted)", margin: "8px 0 16px" }}>
                  Drag & drop an Excel (.xlsx) or CSV (.csv) file here, or click to browse.
                </p>
                <b style={{
                  background: "var(--primary)",
                  color: "white",
                  padding: "10px 20px",
                  borderRadius: "6px",
                  fontSize: "14px"
                }}>
                  Choose File
                </b>
              </label>

              <div style={{
                marginTop: "30px",
                borderTop: "1px solid var(--border-color)",
                paddingTop: "24px",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "20px",
                textAlign: "left"
              }}>
                <div>
                  <h4 style={{ color: "var(--primary)", fontSize: "14px", marginBottom: "6px" }}>🔒 Complete Confidentiality</h4>
                  <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    All algorithms run 100% locally. Your records and business details are never sent to third-party servers or external APIs.
                  </p>
                </div>
                <div>
                  <h4 style={{ color: "var(--primary)", fontSize: "14px", marginBottom: "6px" }}>📊 Any Spreadsheet Format</h4>
                  <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    Upload sales reports, transport logs, employee scores, or profit/loss statements. The engine automatically maps and groups your variables.
                  </p>
                </div>
                <div>
                  <h4 style={{ color: "var(--primary)", fontSize: "14px", marginBottom: "6px" }}>🔮 Future Time-Series Projections</h4>
                  <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    Computes historical growth factors, models linear trends, identifies numerical outliers, and predicts future steps.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Dashboard View */
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              
              {/* Dashboard Header */}
              <div className="card" style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span className="status-badge status-completed" style={{ fontSize: "10px", textTransform: "uppercase" }}>Local Prediction Run</span>
                  <h2 style={{ margin: "4px 0 2px", fontSize: "18px" }}>{activeRun.fileName}</h2>
                  <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    Analyzed {activeRun.totalRows} rows &bull; Generated by {activeRun.uploadedBy} on {new Date(activeRun.uploadedAt).toLocaleString()}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button 
                    className="btn-secondary"
                    onClick={() => setActiveRun(null)}
                    style={{ margin: 0 }}
                  >
                    Analyze Another
                  </button>
                  <button 
                    onClick={() => handleDownloadPdf(activeRun.id || activeRun.runId)}
                    style={{ margin: 0 }}
                  >
                    Download PDF Report
                  </button>
                </div>
              </div>

              {/* KPI Cards Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                <div className="card" style={{ padding: "16px", display: "flex", alignItems: "center", gap: "14px" }}>
                  <span style={{ fontSize: "24px", padding: "10px", background: "var(--primary-light)", borderRadius: "8px", color: "var(--primary)" }}>📋</span>
                  <div>
                    <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>Data Rows</p>
                    <strong style={{ fontSize: "18px", color: "var(--text-heading)" }}>{activeRun.totalRows.toLocaleString()}</strong>
                  </div>
                </div>
                
                <div className="card" style={{ padding: "16px", display: "flex", alignItems: "center", gap: "14px" }}>
                  <span style={{ fontSize: "24px", padding: "10px", background: "rgba(16, 185, 129, 0.08)", borderRadius: "8px", color: "var(--success-text)" }}>🎯</span>
                  <div>
                    <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>Prediction Accuracy</p>
                    <strong style={{ fontSize: "18px", color: "var(--text-heading)" }}>
                      {activeMetrics?.accuracy?.r2 !== undefined ? `${(activeMetrics.accuracy.r2 * 100).toFixed(1)}%` : "N/A"}
                    </strong>
                  </div>
                </div>

                <div className="card" style={{ padding: "16px", display: "flex", alignItems: "center", gap: "14px" }}>
                  <span style={{ fontSize: "24px", padding: "10px", background: "rgba(239, 68, 68, 0.08)", borderRadius: "8px", color: "var(--danger-text)" }}>📉</span>
                  <div>
                    <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>Error Rate (MAPE)</p>
                    <strong style={{ fontSize: "18px", color: "var(--text-heading)" }}>
                      {activeMetrics?.accuracy?.mape !== undefined ? `${activeMetrics.accuracy.mape.toFixed(1)}%` : "N/A"}
                    </strong>
                  </div>
                </div>

                <div className="card" style={{ padding: "16px", display: "flex", alignItems: "center", gap: "14px" }}>
                  <span style={{ fontSize: "24px", padding: "10px", background: activeMetrics?.growthRatePercent >= 0 ? "rgba(16, 185, 129, 0.08)" : "rgba(239, 68, 68, 0.08)", borderRadius: "8px", color: activeMetrics?.growthRatePercent >= 0 ? "var(--success-text)" : "var(--danger-text)" }}>
                    {activeMetrics?.growthRatePercent >= 0 ? "↗" : "↘"}
                  </span>
                  <div>
                    <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>Projected Growth</p>
                    <strong style={{ fontSize: "18px", color: activeMetrics?.growthRatePercent >= 0 ? "var(--success-text)" : "var(--danger-text)" }}>
                      {activeMetrics ? `${activeMetrics.growthRatePercent >= 0 ? "+" : ""}${activeMetrics.growthRatePercent.toFixed(1)}%` : "N/A"}
                    </strong>
                  </div>
                </div>

                <div className="card" style={{ padding: "16px", display: "flex", alignItems: "center", gap: "14px" }}>
                  <span style={{ fontSize: "24px", padding: "10px", background: activeMetrics?.outliers?.length > 0 ? "rgba(245, 158, 11, 0.08)" : "var(--primary-light)", borderRadius: "8px", color: activeMetrics?.outliers?.length > 0 ? "var(--warning-text)" : "var(--primary)" }}>⚠️</span>
                  <div>
                    <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>Anomalies</p>
                    <strong style={{ fontSize: "18px", color: "var(--text-heading)" }}>
                      {activeMetrics?.outliers?.length || 0} events
                    </strong>
                  </div>
                </div>
              </div>

              {/* Local Executive Summary & Insights */}
              <div className="card" style={{ padding: "20px" }}>
                <h3 style={{ marginBottom: "16px", borderBottom: "1px solid var(--border-color)", paddingBottom: "8px" }}>Local AI Business Recommendations</h3>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
                  
                  {/* Left: Key Findings */}
                  <div style={{ background: "var(--primary-light)", padding: "16px", borderRadius: "8px", border: "1px solid var(--primary-border)" }}>
                    <h4 style={{ color: "var(--primary)", fontSize: "14px", marginBottom: "10px" }}>Key Findings</h4>
                    <ul style={{ paddingLeft: "16px", margin: 0, fontSize: "13px", color: "var(--text-main)", display: "flex", flexDirection: "column", gap: "8px" }}>
                      {activeRun.insights?.map((ins, idx) => (
                        <li key={idx} dangerouslySetInnerHTML={{ __html: ins.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") }}></li>
                      ))}
                    </ul>
                  </div>

                  {/* Right: Actions / Suggestions */}
                  <div style={{ background: "rgba(245, 158, 11, 0.04)", padding: "16px", borderRadius: "8px", border: "1px solid rgba(245, 158, 11, 0.1)" }}>
                    <h4 style={{ color: "var(--warning-text)", fontSize: "14px", marginBottom: "10px" }}>Recommended Company Actions</h4>
                    <ul style={{ paddingLeft: "16px", margin: 0, fontSize: "13px", color: "var(--warning-text)", display: "flex", flexDirection: "column", gap: "8px" }}>
                      {activeRun.suggestions?.map((sug, idx) => (
                        <li key={idx} dangerouslySetInnerHTML={{ __html: sug.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") }}></li>
                      ))}
                    </ul>
                  </div>

                </div>
              </div>

              {/* Dynamic Time Series Chart */}
              <div className="card" style={{ padding: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <div>
                    <h3 style={{ margin: 0 }}>Business Metric Forecasting</h3>
                    <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
                      Historical trend (solid line) mapped with future projections and confidence intervals (shaded/dashed).
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "16px" }}>
                    <label style={{ fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
                      <span>Model Used:</span>
                      <select 
                        value={selectedModel} 
                        onChange={(e) => setSelectedModel(e.target.value)}
                        style={{ padding: "4px 8px", borderRadius: "4px", border: "1px solid var(--border-color)", background: "var(--bg-card)", fontSize: "13px", fontWeight: "bold" }}
                      >
                        {availableModels.includes("linear_regression") && <option value="linear_regression">Linear Regression</option>}
                        {availableModels.includes("prophet") && <option value="prophet">Prophet (Seasonal)</option>}
                        {availableModels.includes("random_forest") && <option value="random_forest">Random Forest (Drivers)</option>}
                      </select>
                    </label>
                    <label style={{ fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
                      <span>Metric target:</span>
                      <select 
                        value={selectedTarget} 
                        onChange={(e) => setSelectedTarget(e.target.value)}
                        style={{ padding: "4px 8px", borderRadius: "4px", border: "1px solid var(--border-color)", background: "var(--bg-card)", fontSize: "13px" }}
                      >
                        {activeRun.targets?.map(target => (
                          <option key={target} value={target}>{target}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                <div style={{ width: "100%", height: 350 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    {selectedModel === "random_forest" && activeMetrics?.featureImportances ? (
                      <BarChart data={activeMetrics.featureImportances} layout="vertical" margin={{ top: 20, right: 30, left: 40, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={true} vertical={false} />
                        <XAxis type="number" hide />
                        <YAxis dataKey="feature" type="category" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} width={100} />
                        <Tooltip 
                          contentStyle={{ background: "var(--bg-card)", borderRadius: "8px", border: "1px solid var(--border-color)", boxShadow: "var(--shadow-md)" }}
                          formatter={(value) => [`${(value * 100).toFixed(1)}%`, "Importance"]}
                        />
                        <Bar name="Feature Importance" dataKey="importance" fill="var(--primary)" radius={[0, 4, 4, 0]}>
                        </Bar>
                      </BarChart>
                    ) : (
                      <LineChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} tickLine={false} />
                        <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} />
                        <Tooltip 
                          contentStyle={{ background: "var(--bg-card)", borderRadius: "8px", border: "1px solid var(--border-color)", boxShadow: "var(--shadow-md)" }}
                          labelStyle={{ fontWeight: "bold", color: "var(--text-heading)" }}
                        />
                        <Legend verticalAlign="top" height={36} iconType="circle" />
                        
                        {/* Actual historical values */}
                        <Line 
                          name="Actual Data" 
                          type="monotone" 
                          dataKey="actual" 
                          stroke="var(--primary)" 
                          strokeWidth={2.5} 
                          dot={{ r: 3, fill: "var(--primary)" }} 
                          activeDot={{ r: 6 }} 
                          connectNulls
                        />

                        {/* Best fit trend line */}
                        <Line 
                          name="Predicted (Trend)" 
                          type="monotone" 
                          dataKey="trendFit" 
                          stroke="rgba(79, 70, 229, 0.3)" 
                          strokeWidth={1.5} 
                          strokeDasharray="4 4" 
                          dot={false}
                          activeDot={false}
                          connectNulls
                        />
                        
                        {/* Future Predicted Path */}
                        <Line 
                          name="Forecast Projection" 
                          type="monotone" 
                          dataKey="predicted" 
                          stroke="var(--warning)" 
                          strokeWidth={2.5} 
                          strokeDasharray="5 5"
                          dot={{ r: 3, fill: "var(--warning)" }}
                          activeDot={{ r: 5 }}
                          connectNulls
                        />
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Lower Section: Predictions Table & Categorical Performance */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "24px" }}>
                
                {/* Predictions Data Table or What-If Simulator */}
                {selectedModel !== "random_forest" ? (
                  <div className="card" style={{ padding: "20px" }}>
                    <h3 style={{ marginBottom: "12px" }}>Forecasted Values Table</h3>
                    <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>
                      Tabular future steps projection values with confidence intervals.
                    </p>
                    
                    <div className="table-wrap" style={{ maxHeight: "300px", overflowY: "auto" }}>
                      <table style={{ width: "100%", fontSize: "13px" }}>
                        <thead>
                          <tr style={{ background: "var(--bg-main)" }}>
                            <th style={{ padding: "8px", textAlign: "left" }}>Period</th>
                            <th style={{ padding: "8px", textAlign: "right" }}>Forecast Value</th>
                            <th style={{ padding: "8px", textAlign: "right" }}>Min Range</th>
                            <th style={{ padding: "8px", textAlign: "right" }}>Max Range</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeMetrics?.forecast?.map((row, idx) => (
                            <tr key={idx} style={{ borderBottom: "1px solid var(--border-color)" }}>
                              <td style={{ padding: "8px", fontWeight: "500" }}>{row.label}</td>
                              <td style={{ padding: "8px", textAlign: "right", color: "var(--warning-text)", fontWeight: "bold" }}>
                                {row.predicted.toLocaleString()}
                              </td>
                              <td style={{ padding: "8px", textAlign: "right", color: "var(--text-muted)" }}>
                                {Math.round(row.lower).toLocaleString()}
                              </td>
                              <td style={{ padding: "8px", textAlign: "right", color: "var(--text-muted)" }}>
                                {Math.round(row.upper).toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="card" style={{ padding: "20px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                      <h3 style={{ margin: 0 }}>What-If Business Simulator</h3>
                      <span className="status-badge status-completed" style={{ fontSize: "10px", background: "var(--primary-light)", color: "var(--primary)" }}>RF Model</span>
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>
                      Project the operational impact on <strong>{selectedTarget}</strong> by adjusting feature variables.
                    </p>
                    
                    {activeRun.targets && activeRun.targets.filter(t => t !== selectedTarget).length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                        <div>
                          <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "6px", color: "var(--text-heading)" }}>
                            Select Feature to Adjust
                          </label>
                          <select
                            value={whatIfFeature}
                            onChange={(e) => setWhatIfFeature(e.target.value)}
                            style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-card)", fontSize: "13px" }}
                          >
                            {activeRun.targets
                              .filter(t => t !== selectedTarget)
                              .map(feature => (
                                <option key={feature} value={feature}>{feature}</option>
                              ))}
                          </select>
                        </div>
                        
                        <div>
                          <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "6px", color: "var(--text-heading)" }}>
                            Change Percentage: <span style={{ color: "var(--primary)", fontWeight: "bold" }}>{whatIfDelta > 0 ? `+${whatIfDelta}` : whatIfDelta}%</span>
                          </label>
                          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                            <input 
                              type="range" 
                              min="-100" 
                              max="100" 
                              step="5"
                              value={whatIfDelta}
                              onChange={(e) => setWhatIfDelta(parseInt(e.target.value))}
                              style={{ flex: 1, height: "6px", background: "var(--border-color)", borderRadius: "3px", outline: "none" }}
                            />
                            <input 
                              type="number"
                              value={whatIfDelta}
                              onChange={(e) => {
                                const val = parseInt(e.target.value);
                                if (!isNaN(val)) {
                                  setWhatIfDelta(val);
                                }
                              }}
                              style={{ width: "80px", padding: "6px 8px", fontSize: "13px", borderRadius: "6px", textAlign: "right" }}
                            />
                          </div>
                          
                          {/* Presets */}
                          <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                            {[-25, -10, 10, 25].map(val => (
                              <button
                                key={val}
                                type="button"
                                className="btn-secondary"
                                onClick={() => setWhatIfDelta(val)}
                                style={{ fontSize: "11px", padding: "4px 8px", margin: 0, flex: 1 }}
                              >
                                {val > 0 ? `+${val}` : val}%
                              </button>
                            ))}
                          </div>
                        </div>

                        {whatIfError && <div className="inline-alert error" style={{ fontSize: "12px", padding: "8px" }}>{whatIfError}</div>}

                        <button 
                          className="btn-primary" 
                          onClick={handleWhatIfSimulate} 
                          disabled={whatIfLoading || !whatIfFeature}
                          style={{ margin: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: "8px" }}
                        >
                          {whatIfLoading ? (
                            <>
                              <span className="upload-icon" style={{ animation: "spin 1.5s linear infinite", width: "14px", height: "14px", fontSize: "12px", background: "none", color: "inherit" }}>🔄</span>
                              Running Simulation...
                            </>
                          ) : "Run Simulation"}
                        </button>

                        {whatIfResult && (
                          <div 
                            style={{ 
                              marginTop: "12px", 
                              padding: "14px", 
                              borderRadius: "8px", 
                              background: "var(--bg-main)", 
                              border: "1px solid var(--border-color)",
                              display: "flex",
                              flexDirection: "column",
                              gap: "10px"
                            }}
                          >
                            <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-heading)" }}>
                              Simulation Result:
                            </div>
                            <div style={{ fontSize: "13px", color: "var(--text-main)", lineHeight: "1.4" }}>
                              {whatIfResult.message}
                            </div>
                            
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "4px", borderTop: "1px solid var(--border-color)", paddingTop: "10px" }}>
                              <div>
                                <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>Original Sum</span>
                                <strong style={{ fontSize: "14px", color: "var(--text-heading)" }}>{Math.round(whatIfResult.originalSum).toLocaleString()}</strong>
                              </div>
                              <div>
                                <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>Simulated Sum</span>
                                <strong style={{ fontSize: "14px", color: whatIfResult.deltaValue >= 0 ? "var(--success)" : "var(--danger)" }}>
                                  {Math.round(whatIfResult.newSum).toLocaleString()}
                                </strong>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ padding: "20px 10px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                        What-If simulation requires multiple numeric columns in the report (e.g. KM, Fuel Used, and Profit) to analyze feature driver dependencies.
                      </div>
                    )}
                  </div>
                )}

                {/* Categorical Driver Performance */}
                <div className="card" style={{ padding: "20px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                    <div>
                      <h3 style={{ margin: 0 }}>Performance Drivers</h3>
                      <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
                        Cross-analysis showing metrics aggregate by categories.
                      </p>
                    </div>
                    {activeRun.categories?.length > 0 && (
                      <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        style={{ padding: "4px 8px", borderRadius: "4px", border: "1px solid var(--border-color)", background: "var(--bg-card)", fontSize: "12px" }}
                      >
                        {activeRun.categories.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  {categoryChartData.length > 0 ? (
                    <div style={{ width: "100%", height: 260 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={categoryChartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} angle={-15} textAnchor="end" interval={0} />
                          <YAxis stroke="var(--text-muted)" fontSize={11} />
                          <Tooltip 
                            contentStyle={{ background: "var(--bg-card)", borderRadius: "8px", border: "1px solid var(--border-color)" }}
                          />
                          <Bar name={`Average ${selectedTarget}`} dataKey="average" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div style={{ height: "260px", display: "flex", justifyContent: "center", alignItems: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                      No category metrics available for this view.
                    </div>
                  )}
                </div>

              </div>

            </div>
          )}
        </section>

      </div>
    </>
  );
}
