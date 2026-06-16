import { useState } from "react";
import api from "../services/api";

function AISummary({ reportId }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  const fetchSummary = async () => {
    if (!reportId) return;
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await api.get(`/ai-summary`, { params: { reportId } });
      setData(response.data);
    } catch (error) {
      console.error(error);
      setErrorMessage(error.response?.data?.detail || "Failed to compute AI summary insights.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card padding" style={{ marginBottom: "32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h3 style={{ margin: 0 }}>AI Business Summary & Insights</h3>
        <button onClick={fetchSummary} disabled={loading || !reportId} style={{ margin: 0 }}>
          {loading ? "Generating Insights..." : "Generate AI Summary"}
        </button>
      </div>

      {errorMessage && <div className="inline-alert error">{errorMessage}</div>}

      {data && (
        <div style={{ marginTop: "20px", borderTop: "1px solid var(--border-color)", paddingTop: "20px" }}>
          <div style={{
            fontStyle: "italic",
            color: "var(--text-main)",
            lineHeight: "1.6",
            marginBottom: "24px",
            borderLeft: "4px solid var(--primary)",
            paddingLeft: "16px",
            background: "var(--bg-main)",
            padding: "16px",
            borderRadius: "8px"
          }}>
            "{data.summary}"
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px" }}>
            <div style={{ background: "rgba(79, 70, 229, 0.04)", padding: "20px", borderRadius: "10px", border: "1px solid rgba(79, 70, 229, 0.1)" }}>
              <h4 style={{ color: "var(--primary)", marginBottom: "12px", fontSize: "15px" }}>Key Insights</h4>
              <ul style={{ margin: 0, paddingLeft: "20px", color: "var(--text-main)" }}>
                {(data.insights || []).map((ins, idx) => (
                  <li key={idx} style={{ marginBottom: "8px", fontSize: "14px" }}>{ins}</li>
                ))}
              </ul>
            </div>

            <div style={{ background: "rgba(245, 158, 11, 0.04)", padding: "20px", borderRadius: "10px", border: "1px solid rgba(245, 158, 11, 0.1)" }}>
              <h4 style={{ color: "var(--warning-text)", marginBottom: "12px", fontSize: "15px" }}>Business Suggestions</h4>
              <ul style={{ margin: 0, paddingLeft: "20px", color: "var(--text-main)" }}>
                {(data.suggestions || []).map((sug, idx) => (
                  <li key={idx} style={{ marginBottom: "8px", fontSize: "14px", color: "var(--warning-text)" }}>{sug}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AISummary;
