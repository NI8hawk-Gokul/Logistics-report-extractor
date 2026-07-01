import { useEffect, useMemo, useState } from "react";
import api, { API_BASE } from "../services/api";
import { PageHeading, StatusBadge, EmptyState } from "./CorePages";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie
} from "recharts";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const SEGMENT_COLORS = {
  "High Value Client": "#10b981",       // green
  "Regular Client": "#3b82f6",          // blue
  "Low Profit Client": "#f59e0b",       // orange
  "Inactive Client": "#6b7280",         // gray
  "Payment Risk Client": "#ef4444",     // red
  "Hidden": "#9ca3af"                   // slate gray
};

const tooltipStyle = {
  borderRadius: "9px",
  border: "1px solid #dfe5ef",
  boxShadow: "0 8px 25px rgba(20,33,61,.08)",
};

const formatMoney = (value) => `INR ${Number(value || 0).toLocaleString("en-IN")}`;

function ChartCard({ title, children }) {
  return (
    <section className="card padding">
      <h3 style={{ marginBottom: "16px", fontWeight: "600", fontSize: "14px" }}>{title}</h3>
      {children}
    </section>
  );
}

function MetricCard({ label, value, detail, icon, tone = "indigo" }) {
  return (
    <div className="metric-card card">
      <span className={`metric-icon ${tone}`} style={{ fontSize: "16px", fontWeight: "bold" }}>
        {icon}
      </span>
      <div>
        <p style={{ margin: 0, fontSize: "11px", color: "var(--text-muted)", fontWeight: "700" }}>{label}</p>
        <strong style={{ display: "block", fontSize: "21px", color: "var(--text-heading)", marginTop: "2px" }}>{value}</strong>
        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{detail}</span>
      </div>
    </div>
  );
}

export default function ClientAnalytics({ user, reportId, onNavigate }) {
  const [clvData, setClvData] = useState([]);
  const [segData, setSegData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // Filtering & searching
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSegment, setSelectedSegment] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "clientScore", direction: "desc" });

  // Detail Modal
  const [selectedClient, setSelectedClient] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [relatedJobs, setRelatedJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  const isStaff = user.role === "Staff";

  const loadData = async () => {
    if (!reportId) return;
    setLoading(true);
    setError("");
    try {
      const [clvRes, segRes] = await Promise.all([
        api.get("/clients/clv-analysis", { params: { reportId } }),
        api.get("/clients/segmentation", { params: { reportId } })
      ]);
      setClvData(clvRes.data.data || []);
      setSegData(segRes.data || null);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not load client analytics data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [reportId]);

  // Handle Detail Modal Related Jobs
  const loadRelatedJobs = async (clientName) => {
    setLoadingJobs(true);
    try {
      const { data } = await api.post("/filter-report", {
        reportId,
        clientName: [clientName],
        agentName: [],
        jobType: [],
        status: [],
        dateRange: { fromDate: "", toDate: "" },
        profitRange: { minProfit: "", maxProfit: "" },
        billingRange: { minBilling: "", maxBilling: "" },
        searchText: ""
      });
      setRelatedJobs(data.data || []);
    } catch {
      setRelatedJobs([]);
    } finally {
      setLoadingJobs(false);
    }
  };

  const handleOpenDetails = async (client) => {
    setSelectedClient(client);
    setShowModal(true);
    loadRelatedJobs(client.clientName);
    try {
      await api.post("/clients/log-activity", {
        action: "CLIENT_DETAIL_VIEWED",
        description: `Viewed details for client: ${client.clientName}`
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleExport = async (format) => {
    try {
      const response = await api.post(`/clients/analytics/export-${format}`, { reportId }, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `client_analytics_${reportId}.${format === "excel" ? "xlsx" : "pdf"}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.detail || "Export failed.");
    }
  };

  // Metrics summary
  const summary = useMemo(() => {
    if (!segData || !segData.summary) {
      return { total: clvData.length, highValue: 0, lowProfit: 0, paymentRisk: 0, inactive: 0 };
    }
    const s = segData.summary;
    return {
      total: clvData.length,
      highValue: s.highValueClients || 0,
      lowProfit: s.lowProfitClients || 0,
      paymentRisk: s.paymentRiskClients || 0,
      inactive: s.inactiveClients || 0
    };
  }, [clvData, segData]);

  // Filter & Search
  const filteredClients = useMemo(() => {
    return clvData.filter((client) => {
      const nameMatch = client.clientName.toLowerCase().includes(searchQuery.toLowerCase());
      const segmentMatch = !selectedSegment || client.segment === selectedSegment;
      return nameMatch && segmentMatch;
    });
  }, [clvData, searchQuery, selectedSegment]);

  // Sort
  const sortedClients = useMemo(() => {
    const list = [...filteredClients];
    list.sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (typeof aVal === "number") {
        return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortConfig.direction === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
    return list;
  }, [filteredClients, sortConfig]);

  const handleSort = (key) => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
    }));
  };

  // Visualizations datasets
  const scatterData = useMemo(() => {
    if (!segData || !segData.clusters) return [];
    return segData.clusters;
  }, [segData]);

  const topBillingData = useMemo(() => {
    return [...clvData]
      .sort((a, b) => b.totalBilling - a.totalBilling)
      .slice(0, 5)
      .map(c => ({ clientName: c.clientName, totalBilling: c.totalBilling }));
  }, [clvData]);

  const topProfitData = useMemo(() => {
    return [...clvData]
      .sort((a, b) => b.totalProfit - a.totalProfit)
      .slice(0, 5)
      .map(c => ({ clientName: c.clientName, totalProfit: c.totalProfit }));
  }, [clvData]);

  const jobCountData = useMemo(() => {
    return [...clvData]
      .sort((a, b) => b.totalJobs - a.totalJobs)
      .slice(0, 5)
      .map(c => ({ clientName: c.clientName, totalJobs: c.totalJobs }));
  }, [clvData]);

  const segmentsPieData = useMemo(() => {
    if (!segData || !segData.summary) return [];
    const s = segData.summary;
    return [
      { name: "High Value", value: s.highValueClients || 0 },
      { name: "Regular", value: s.regularClients || 0 },
      { name: "Low Profit", value: s.lowProfitClients || 0 },
      { name: "Payment Risk", value: s.paymentRiskClients || 0 },
      { name: "Inactive", value: s.inactiveClients || 0 }
    ].filter(item => item.value > 0);
  }, [segData]);

  return (
    <>
      <PageHeading
        eyebrow="Business intelligence"
        title="Client segmentation & CLV"
        description="Analyze logistics client segments, scoring values, and lifetime metrics to optimize customer success workflows."
        actions={
          user.role !== "Staff" && reportId ? (
            <>
              <button className="btn-secondary" onClick={() => handleExport("excel")}>Export Excel</button>
              <button onClick={() => handleExport("pdf")}>Export PDF</button>
            </>
          ) : null
        }
      />

      {!reportId ? (
        <EmptyState title="Select a report version" message="Select an active logistics database report version in the top navigation bar to compute client segmentation metrics." />
      ) : error ? (
        <div className="inline-alert error">{error}</div>
      ) : loading ? (
        <div className="loading-panel card">Calculating customer lifetime value metrics and running KMeans algorithms...</div>
      ) : (
        <div style={{ display: "grid", gap: "24px" }}>
          
          {/* Summary Cards */}
          <div className="metrics-grid">
            <MetricCard label="Total Clients" value={summary.total} detail="Distinct companies" icon="👥" tone="indigo" />
            <MetricCard label="High Value Clients" value={isStaff ? "Hidden" : summary.highValue} detail="Top revenue scorers" icon="★" tone="green" />
            <MetricCard label="Low Profit Clients" value={isStaff ? "Hidden" : summary.lowProfit} detail="Audit recommended" icon="⚠" tone="amber" />
            <MetricCard label="Payment Risk Clients" value={isStaff ? "Hidden" : summary.paymentRisk} detail="Outstanding balances" icon="💳" tone="red" />
            <MetricCard label="Inactive Clients" value={isStaff ? "Hidden" : summary.inactive} detail="No jobs in 45+ days" icon="⏳" tone="gray" />
          </div>

          {/* Charts Section */}
          {!isStaff && (
            <div className="charts-grid">
              {/* Scatter Clustering Chart */}
              <ChartCard title="KMeans Clustering (Billing vs Profit)">
                <ResponsiveContainer width="100%" height={270}>
                  <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8ecf3" />
                    <XAxis type="number" dataKey="x" name="Billing" unit=" INR" fontSize={11} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                    <YAxis type="number" dataKey="y" name="Profit" unit=" INR" fontSize={11} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v) => Number(v).toLocaleString("en-IN")} contentStyle={tooltipStyle} />
                    <Legend />
                    {Object.keys(SEGMENT_COLORS).map(segmentName => {
                      const segmentSubset = scatterData.filter(d => d.segment === segmentName);
                      if (segmentSubset.length === 0) return null;
                      return (
                        <Scatter
                          key={segmentName}
                          name={segmentName}
                          data={segmentSubset}
                          fill={SEGMENT_COLORS[segmentName]}
                          shape="circle"
                        />
                      );
                    })}
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Pie Chart of Segments */}
              <ChartCard title="Client segment distribution">
                <ResponsiveContainer width="100%" height={270}>
                  <PieChart>
                    <Pie data={segmentsPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={40} paddingAngle={3} label>
                      {segmentsPieData.map((entry, index) => {
                        const segName = entry.name === "High Value" ? "High Value Client" :
                                        entry.name === "Regular" ? "Regular Client" :
                                        entry.name === "Low Profit" ? "Low Profit Client" :
                                        entry.name === "Payment Risk" ? "Payment Risk Client" : "Inactive Client";
                        return <Cell key={`cell-${index}`} fill={SEGMENT_COLORS[segName] || "#9cb3d8"} />;
                      })}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Bar: Top Clients by Billing */}
              <ChartCard title="Top clients by billing (INR)">
                <ResponsiveContainer width="100%" height={270}>
                  <BarChart data={topBillingData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ecf3" />
                    <XAxis dataKey="clientName" axisLine={false} tickLine={false} fontSize={11} />
                    <YAxis axisLine={false} tickLine={false} fontSize={11} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={formatMoney} contentStyle={tooltipStyle} />
                    <Bar dataKey="totalBilling" fill="#3b82f6" radius={[5, 5, 0, 0]} name="Billing" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Bar: Top Clients by Profit */}
              <ChartCard title="Top clients by profit (INR)">
                <ResponsiveContainer width="100%" height={270}>
                  <BarChart data={topProfitData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ecf3" />
                    <XAxis dataKey="clientName" axisLine={false} tickLine={false} fontSize={11} />
                    <YAxis axisLine={false} tickLine={false} fontSize={11} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={formatMoney} contentStyle={tooltipStyle} />
                    <Bar dataKey="totalProfit" fill="#10b981" radius={[5, 5, 0, 0]} name="Profit" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          )}

          {/* If staff, render a non-financial chart for job counts */}
          {isStaff && (
            <div className="charts-grid" style={{ gridTemplateColumns: "1fr" }}>
              <ChartCard title="Top clients by job volume">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={jobCountData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ecf3" />
                    <XAxis dataKey="clientName" axisLine={false} tickLine={false} fontSize={11} />
                    <YAxis axisLine={false} tickLine={false} fontSize={11} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="totalJobs" fill="#4f46e5" radius={[5, 5, 0, 0]} name="Jobs Count" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          )}

          {/* Filters Bar & Ranking Table */}
          <section className="card filter-panel">
            <div className="filter-search" style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center" }}>
              <label className="field-group" style={{ margin: 0, flex: 1, minWidth: "200px" }}>
                <span style={{ fontSize: "11px", fontWeight: "bold", display: "block", marginBottom: "4px" }}>Search Client Name</span>
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Enter company name..." />
              </label>
              
              {!isStaff && (
                <label className="field-group" style={{ margin: 0, minWidth: "180px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "bold", display: "block", marginBottom: "4px" }}>Filter Segment</span>
                  <select value={selectedSegment} onChange={(e) => setSelectedSegment(e.target.value)}>
                    <option value="">All Segments</option>
                    <option value="High Value Client">High Value Client</option>
                    <option value="Regular Client">Regular Client</option>
                    <option value="Low Profit Client">Low Profit Client</option>
                    <option value="Inactive Client">Inactive Client</option>
                    <option value="Payment Risk Client">Payment Risk Client</option>
                  </select>
                </label>
              )}
              
              <button className="btn-ghost" style={{ alignSelf: "flex-end" }} onClick={() => { setSearchQuery(""); setSelectedSegment(""); }}>Reset Filters</button>
            </div>
          </section>

          {/* Detailed Ranking Table */}
          <section className="card report-table-card">
            <div className="table-toolbar">
              <div>
                <strong>Client Value Rankings</strong>
                <span>Sorted by custom scoring algorithm</span>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th><button onClick={() => handleSort("clientName")}>Client Name</button></th>
                    {!isStaff && (
                      <>
                        <th><button onClick={() => handleSort("totalBilling")}>Billing</button></th>
                        <th><button onClick={() => handleSort("totalProfit")}>Profit</button></th>
                      </>
                    )}
                    <th><button onClick={() => handleSort("totalJobs")}>Jobs</button></th>
                    {!isStaff && (
                      <>
                        <th>Avg Profit/Job</th>
                        <th>Pending Payment</th>
                        <th><button onClick={() => handleSort("clientScore")}>Score</button></th>
                        <th>Segment</th>
                      </>
                    )}
                    <th>Suggested Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedClients.map((client, idx) => (
                    <tr key={client.clientName} onClick={() => handleOpenDetails(client)} style={{ cursor: "pointer" }}>
                      <td><strong>{idx + 1}</strong></td>
                      <td><strong>{client.clientName}</strong></td>
                      {!isStaff && (
                        <>
                          <td>{money.format(client.totalBilling)}</td>
                          <td className={client.totalProfit < 0 ? "negative" : "positive"}>{money.format(client.totalProfit)}</td>
                        </>
                      )}
                      <td>{client.totalJobs}</td>
                      {!isStaff && (
                        <>
                          <td>{money.format(client.averageProfitPerJob)}</td>
                          <td style={{ color: client.pendingPayment > 0 ? "var(--danger)" : "inherit" }}>
                            {money.format(client.pendingPayment)}
                          </td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <b style={{ color: "var(--primary)" }}>{client.clientScore}</b>
                              <div style={{ flex: 1, height: "6px", width: "40px", background: "#e2e8f0", borderRadius: "3px", overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${client.clientScore}%`, background: "var(--primary)" }} />
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="status-badge" style={{ backgroundColor: `${SEGMENT_COLORS[client.segment]}15`, color: SEGMENT_COLORS[client.segment] }}>
                              {client.segment}
                            </span>
                          </td>
                        </>
                      )}
                      <td>
                        <StatusBadge value={client.suggestedAction} />
                      </td>
                    </tr>
                  ))}
                  {!sortedClients.length && (
                    <tr>
                      <td colSpan="11" className="table-empty">No clients match the filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

        </div>
      )}

      {/* Client Details Modal */}
      {showModal && selectedClient && (
        <>
          <div className="modal-backdrop" onClick={() => setShowModal(false)} />
          <div className="modal-card" style={{ width: "min(640px, 95vw)" }}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Client Details Profile</p>
                <h2 style={{ fontSize: "20px", marginTop: "4px" }}>{selectedClient.clientName}</h2>
              </div>
              <button className="icon-button" style={{ border: 0 }} onClick={() => setShowModal(false)}>×</button>
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
              <div className="card" style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: "700" }}>CURRENT SEGMENT</span>
                {isStaff ? (
                  <strong>Hidden</strong>
                ) : (
                  <span className="status-badge" style={{ width: "fit-content", backgroundColor: `${SEGMENT_COLORS[selectedClient.segment]}15`, color: SEGMENT_COLORS[selectedClient.segment] }}>
                    {selectedClient.segment}
                  </span>
                )}
              </div>
              
              <div className="card" style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: "700" }}>SUGGESTED ACTION</span>
                <strong>{selectedClient.suggestedAction}</strong>
              </div>
            </div>

            <div className="form-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Total Jobs History</span>
                <strong style={{ fontSize: "16px", color: "var(--text-heading)" }}>{selectedClient.totalJobs} jobs</strong>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Last Shipping Date</span>
                <strong style={{ fontSize: "16px", color: "var(--text-heading)" }}>{selectedClient.lastJobDate || "N/A"}</strong>
              </div>

              {!isStaff && (
                <>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Total Billing Value</span>
                    <strong style={{ fontSize: "16px", color: "var(--text-heading)" }}>{money.format(selectedClient.totalBilling)}</strong>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Total Net Profit</span>
                    <strong style={{ fontSize: "16px", color: selectedClient.totalProfit < 0 ? "var(--danger)" : "var(--success)" }}>
                      {money.format(selectedClient.totalProfit)}
                    </strong>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Avg Margin Per Job</span>
                    <strong style={{ fontSize: "16px", color: "var(--text-heading)" }}>{money.format(selectedClient.averageProfitPerJob)}</strong>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Pending Balances</span>
                    <strong style={{ fontSize: "16px", color: selectedClient.pendingPayment > 0 ? "var(--danger)" : "var(--text-heading)" }}>
                      {money.format(selectedClient.pendingPayment)}
                    </strong>
                  </div>
                </>
              )}
            </div>

            {/* Related Jobs Section */}
            <h3 style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "6px", marginBottom: "12px", fontSize: "13px" }}>
              Related Shipment Jobs in this Report
            </h3>
            {loadingJobs ? (
              <div style={{ textAlign: "center", padding: "16px", color: "var(--text-muted)" }}>Loading client jobs history...</div>
            ) : relatedJobs.length > 0 ? (
              <div className="table-wrap" style={{ maxHeight: "200px" }}>
                <table style={{ minWidth: "100%" }}>
                  <thead>
                    <tr>
                      <th>Job No</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Date</th>
                      {!isStaff && <th>Billing</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {relatedJobs.map(job => (
                      <tr key={job.id}>
                        <td><strong>{job.jobNo}</strong></td>
                        <td>{job.jobType}</td>
                        <td><StatusBadge value={job.status} /></td>
                        <td>{job.date}</td>
                        {!isStaff && <td>{money.format(job.billingAmount || 0)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "16px", color: "var(--text-muted)", fontSize: "12px" }}>No shipping jobs found for this client.</div>
            )}

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowModal(false)}>Close Window</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
