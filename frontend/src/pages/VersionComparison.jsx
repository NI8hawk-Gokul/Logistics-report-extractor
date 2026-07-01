import { useState } from "react";
import api from "../services/api";
import { PageHeading, StatusBadge } from "./CorePages";

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export default function VersionComparison({ versions, user }) {
  const [versionA, setVersionA] = useState("");
  const [versionB, setVersionB] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("billing");

  const availableVersions = versions.filter((v) => !v.isArchived);

  const handleCompare = async () => {
    if (!versionA || !versionB) {
      setError("Please select two different report versions to compare.");
      return;
    }
    if (versionA === versionB) {
      setError("Please select two different report versions. You cannot compare a report with itself.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const { data } = await api.get("/reports/compare", { params: { versionA, versionB } });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not retrieve comparison data.");
    } finally {
      setLoading(false);
    }
  };

  const deltaStyle = (value) => {
    if (value > 0) return { color: "var(--success)", fontWeight: "bold" };
    if (value < 0) return { color: "var(--danger)", fontWeight: "bold" };
    return { color: "var(--text-muted)" };
  };

  const deltaSign = (value) => (value > 0 ? "+" : "");

  return (
    <>
      <PageHeading
        eyebrow="Intelligence Tools"
        title="Version Comparison"
        description="Compare two report versions side-by-side to understand growth, data updates, and changes in jobs, billing, and status."
      />

      <section className="card panel" style={{ marginBottom: "24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "16px", alignItems: "end" }}>
          <label className="field-group" style={{ margin: 0 }}>
            <span>Base Version (Version A)</span>
            <select value={versionA} onChange={(e) => setVersionA(e.target.value)}>
              <option value="">Select Base Report</option>
              {availableVersions.map((v) => (
                <option key={v.reportId} value={v.reportId}>
                  {v.reportName || v.reportId} ({v.period})
                </option>
              ))}
            </select>
          </label>
          <label className="field-group" style={{ margin: 0 }}>
            <span>Target Version (Version B)</span>
            <select value={versionB} onChange={(e) => setVersionB(e.target.value)}>
              <option value="">Select Target Report</option>
              {availableVersions.map((v) => (
                <option key={v.reportId} value={v.reportId}>
                  {v.reportName || v.reportId} ({v.period})
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={handleCompare}
            disabled={loading || !versionA || !versionB}
            style={{ height: "40px", padding: "0 24px" }}
          >
            {loading ? "Comparing..." : "Compare"}
          </button>
        </div>
        {error && <div className="inline-alert error" style={{ marginTop: "16px" }}>{error}</div>}
      </section>

      {loading && <div className="loading-panel card">Performing differential analysis...</div>}

      {result && (
        <>
          <div className="metrics-grid">
            <div className="metric-card card">
              <span className="metric-icon blue">#</span>
              <div>
                <p>Record Delta</p>
                <strong>{deltaSign(result.deltas.records)}{result.deltas.records.toLocaleString()}</strong>
                <span style={deltaStyle(result.deltas.records)}>
                  {result.meta.versionA.totalRecords} → {result.meta.versionB.totalRecords}
                </span>
              </div>
            </div>
            {user.role !== "Staff" && (
              <>
                <div className="metric-card card">
                  <span className="metric-icon green">₹</span>
                  <div>
                    <p>Billing Delta</p>
                    <strong>{deltaSign(result.deltas.billing)}{money.format(result.deltas.billing)}</strong>
                    <span style={deltaStyle(result.deltas.billing)}>
                      {money.format(result.meta.versionA.totalBilling)} → {money.format(result.meta.versionB.totalBilling)}
                    </span>
                  </div>
                </div>
                <div className="metric-card card">
                  <span className="metric-icon amber">₹</span>
                  <div>
                    <p>Profit Delta</p>
                    <strong>{deltaSign(result.deltas.profit)}{money.format(result.deltas.profit)}</strong>
                    <span style={deltaStyle(result.deltas.profit)}>
                      {money.format(result.meta.versionA.totalProfit)} → {money.format(result.meta.versionB.totalProfit)}
                    </span>
                  </div>
                </div>
              </>
            )}
            <div className="metric-card card">
              <span className="metric-icon">Δ</span>
              <div>
                <p>Modified Jobs</p>
                <strong>{result.counts.modifiedBilling + result.counts.modifiedProfit + result.counts.modifiedStatus}</strong>
                <span>Common jobs with diffs</span>
              </div>
            </div>
          </div>

          <section className="card panel">
            <div className="segmented-tabs" style={{ marginBottom: "20px" }}>
              <button className={activeTab === "billing" ? "active" : ""} onClick={() => setActiveTab("billing")}>
                Billing Changes ({result.counts.modifiedBilling})
              </button>
              <button className={activeTab === "profit" ? "active" : ""} onClick={() => setActiveTab("profit")}>
                Profit Changes ({result.counts.modifiedProfit})
              </button>
              <button className={activeTab === "status" ? "active" : ""} onClick={() => setActiveTab("status")}>
                Status Changes ({result.counts.modifiedStatus})
              </button>
              <button className={activeTab === "added" ? "active" : ""} onClick={() => setActiveTab("added")}>
                Added Jobs ({result.counts.added})
              </button>
              <button className={activeTab === "removed" ? "active" : ""} onClick={() => setActiveTab("removed")}>
                Removed Jobs ({result.counts.removed})
              </button>
            </div>

            <div className="table-wrap">
              {activeTab === "billing" && (
                <table>
                  <thead>
                    <tr>
                      <th>Job No</th>
                      <th>Client Name</th>
                      <th>Old Billing</th>
                      <th>New Billing</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.modifiedBillingRecords.map((r) => (
                      <tr key={r.jobNo}>
                        <td><strong>{r.jobNo}</strong></td>
                        <td>{r.clientName}</td>
                        <td>{money.format(r.oldValue)}</td>
                        <td>{money.format(r.newValue)}</td>
                        <td style={deltaStyle(r.delta)}>{deltaSign(r.delta)}{money.format(r.delta)}</td>
                      </tr>
                    ))}
                    {!result.modifiedBillingRecords.length && (
                      <tr><td colSpan="5" className="table-empty">No billing differences found.</td></tr>
                    )}
                  </tbody>
                </table>
              )}

              {activeTab === "profit" && (
                <table>
                  <thead>
                    <tr>
                      <th>Job No</th>
                      <th>Client Name</th>
                      <th>Old Profit</th>
                      <th>New Profit</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.modifiedProfitRecords.map((r) => (
                      <tr key={r.jobNo}>
                        <td><strong>{r.jobNo}</strong></td>
                        <td>{r.clientName}</td>
                        <td>{money.format(r.oldValue)}</td>
                        <td>{money.format(r.newValue)}</td>
                        <td style={deltaStyle(r.delta)}>{deltaSign(r.delta)}{money.format(r.delta)}</td>
                      </tr>
                    ))}
                    {!result.modifiedProfitRecords.length && (
                      <tr><td colSpan="5" className="table-empty">No profit differences found.</td></tr>
                    )}
                  </tbody>
                </table>
              )}

              {activeTab === "status" && (
                <table>
                  <thead>
                    <tr>
                      <th>Job No</th>
                      <th>Client Name</th>
                      <th>Old Status</th>
                      <th>New Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.modifiedStatusRecords.map((r) => (
                      <tr key={r.jobNo}>
                        <td><strong>{r.jobNo}</strong></td>
                        <td>{r.clientName}</td>
                        <td><StatusBadge value={r.oldValue} /></td>
                        <td><StatusBadge value={r.newValue} /></td>
                      </tr>
                    ))}
                    {!result.modifiedStatusRecords.length && (
                      <tr><td colSpan="4" className="table-empty">No status changes found.</td></tr>
                    )}
                  </tbody>
                </table>
              )}

              {activeTab === "added" && (
                <table>
                  <thead>
                    <tr>
                      <th>Job No</th>
                      <th>Client</th>
                      <th>Agent</th>
                      <th>Billing</th>
                      <th>Profit</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.addedRecords.map((r) => (
                      <tr key={r.jobNo}>
                        <td><strong>{r.jobNo}</strong></td>
                        <td>{r.clientName}</td>
                        <td>{r.agentName}</td>
                        <td>{money.format(r.billingAmount)}</td>
                        <td className={r.profit < 0 ? "negative" : "positive"}>{money.format(r.profit)}</td>
                        <td><StatusBadge value={r.status} /></td>
                        <td>{r.date}</td>
                      </tr>
                    ))}
                    {!result.addedRecords.length && (
                      <tr><td colSpan="7" className="table-empty">No added jobs found in Target version.</td></tr>
                    )}
                  </tbody>
                </table>
              )}

              {activeTab === "removed" && (
                <table>
                  <thead>
                    <tr>
                      <th>Job No</th>
                      <th>Client</th>
                      <th>Agent</th>
                      <th>Billing</th>
                      <th>Profit</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.removedRecords.map((r) => (
                      <tr key={r.jobNo}>
                        <td><strong>{r.jobNo}</strong></td>
                        <td>{r.clientName}</td>
                        <td>{r.agentName}</td>
                        <td>{money.format(r.billingAmount)}</td>
                        <td className={r.profit < 0 ? "negative" : "positive"}>{money.format(r.profit)}</td>
                        <td><StatusBadge value={r.status} /></td>
                        <td>{r.date}</td>
                      </tr>
                    ))}
                    {!result.removedRecords.length && (
                      <tr><td colSpan="7" className="table-empty">No removed jobs found in Target version.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
