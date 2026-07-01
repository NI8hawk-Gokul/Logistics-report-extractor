import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import EmailShareModal from "../components/EmailShareModal";

const AnalyticsDashboard = lazy(() => import("../components/AnalyticsDashboard"));
const AISummary = lazy(() => import("../components/AISummary"));
const ForecastChart = lazy(() => import("../components/ForecastChart"));

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

const toCamelCase = (s) => {
  const special = {
    "Job No": "jobNo",
    "Vehicle No": "vehicleNo",
    "AWB No": "awbNo",
    "BOE No": "boeNo",
    "SKU": "sku",
    "HS Code": "hsCode",
    "Employee ID": "employeeId",
    "Audit ID": "auditId",
    "P&L Amount": "plAmount",
    "KPI Metric": "kpiMetric"
  };
  if (special[s]) return special[s];
  const words = s.split(/[^a-zA-Z0-9]+/);
  return words[0].toLowerCase() + words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
};

const isFinancialField = (field) => ["Billing Amount", "Expense", "Profit", "Freight Cost", "Quotation Amount", "Salary", "P&L Amount", "Maintenance Cost", "Duty Amount"].includes(field);

const renderCell = (record, field, index, department, schemas, delayRisks = {}) => {
  const camelKey = toCamelCase(field);
  const val = record[camelKey];
  const isPrimary = index === 0;
  const isStatus = field.toLowerCase().includes("status") || field.toLowerCase() === "attendance" || field.toLowerCase().includes("error type");
  const isMoney = isFinancialField(field);
  const isNumeric = (schemas[department]?.numeric || []).includes(field);

  let content = String(val !== undefined && val !== null ? val : "");
  
  if (isStatus) {
    const riskData = delayRisks[record.id];
    const isPending = ["pending", "in transit", "in-transit", "in progress", "in-progress"].includes(String(val || "").toLowerCase());
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-start" }}>
        <StatusBadge value={val} />
        {isPending && riskData && (
          <span className={`risk-badge risk-${riskData.risk.toLowerCase()}`} title={`Probability of delay: ${riskData.probability}%`} style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", fontWeight: "600", textTransform: "uppercase" }}>
            {riskData.risk} Risk
          </span>
        )}
      </div>
    );
  }
  
  if (isMoney) {
    const numVal = Number(val || 0);
    const isProfitField = field.toLowerCase().includes("profit") || field === "P&L Amount";
    return (
      <span className={isProfitField ? (numVal < 0 ? "negative" : "positive") : ""}>
        {money.format(numVal)}
      </span>
    );
  }
  
  if (isNumeric) {
    return Number(val || 0).toLocaleString();
  }
  
  if (isPrimary) {
    return <strong>{content}</strong>;
  }
  
  return content;
};

const emptyFilters = {
  agentName: [],
  clientName: [],
  jobType: [],
  status: [],
  dateRange: { fromDate: "", toDate: "" },
  profitRange: { minProfit: "", maxProfit: "" },
  billingRange: { minBilling: "", maxBilling: "" },
  searchText: "",
};

function PageHeading({ eyebrow, title, description, actions }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

function EmptyState({ title, message, action, onAdd }) {
  const handler = onAdd || action?.props?.onClick;
  return (
    <div className="empty-state card">
      <div
        className="empty-state-mark"
        onClick={handler}
        style={handler ? { cursor: "pointer" } : undefined}
      >
        +
      </div>
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </div>
  );
}

function StatusBadge({ value }) {
  const normalized = String(value || "Unknown").toLowerCase().replace(/\s+/g, "-");
  return <span className={`status-badge status-${normalized}`}>{value || "Unknown"}</span>;
}

function Metric({ label, value, detail, tone = "indigo" }) {
  return (
    <div className="metric-card card">
      <span className={`metric-icon ${tone}`}>{label.slice(0, 1)}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function WidgetOverlay({ item, onToggle, onResize, onMoveUp, onMoveDown, isFirst, isLast }) {
  return (
    <div className="widget-edit-toolbar" style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "8px 12px",
      backgroundColor: "rgba(99, 102, 241, 0.08)",
      border: "1px dashed #6366f1",
      borderRadius: "6px",
      marginBottom: "12px",
      fontSize: "12px",
      color: "#4f46e5",
      fontWeight: "500",
      width: "100%",
      boxSizing: "border-box"
    }}>
      <span>🔧 Widget: <strong>{item.title}</strong> ({item.size === "full" ? "Full Width" : "Half Width"})</span>
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="button" className="btn-secondary" style={{ padding: "2px 6px", fontSize: "11px", height: "24px" }} onClick={onResize}>
          ↔️ Resize
        </button>
        <button type="button" className="btn-secondary" style={{ padding: "2px 6px", fontSize: "11px", height: "24px" }} onClick={onMoveUp} disabled={isFirst}>
          ⬆️ Up
        </button>
        <button type="button" className="btn-secondary" style={{ padding: "2px 6px", fontSize: "11px", height: "24px" }} onClick={onMoveDown} disabled={isLast}>
          ⬇️ Down
        </button>
        <button type="button" className="btn-secondary" style={{ padding: "2px 6px", fontSize: "11px", height: "24px", color: "#dc2626" }} onClick={onToggle}>
          👁️ Hide
        </button>
      </div>
    </div>
  );
}

export function OverviewPage({ user, reportId, versions, onNavigate }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [schemas, setSchemas] = useState({});
  const [delayRisks, setDelayRisks] = useState({});
  const [clientAlerts, setClientAlerts] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [layout, setLayout] = useState(() => {
    const saved = localStorage.getItem(`layout_${user.email}`);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      { id: "metrics", title: "Key Metrics", visible: true, size: "full" },
      { id: "alerts", title: "Client Health Alerts", visible: true, size: "full" },
      { id: "activity", title: "Recent Records", visible: true, size: "half" },
      { id: "actions", title: "Quick Actions", visible: true, size: "half" },
    ];
  });

  const currentVersion = versions.find((version) => version.reportId === reportId);
  const department = currentVersion?.department || "Operations";

  useEffect(() => {
    api.get("/reports/schemas")
      .then(({ data }) => setSchemas(data || {}))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!reportId) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api.post("/filter-report", { ...emptyFilters, reportId })
      .then(({ data }) => setRecords(data.data || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [reportId]);

  useEffect(() => {
    if (!reportId) {
      setDelayRisks({});
      return;
    }
    api.get(`/reports/${reportId}/delay-risk`)
      .then(({ data }) => setDelayRisks(data || {}))
      .catch(() => setDelayRisks({}));
  }, [reportId]);

  useEffect(() => {
    if (!reportId) {
      setClientAlerts([]);
      return;
    }
    api.get(`/reports/${reportId}/client-alerts`)
      .then(({ data }) => setClientAlerts(data || []))
      .catch(() => setClientAlerts([]));
  }, [reportId]);

  const saveLayout = (newLayout) => {
    setLayout(newLayout);
    localStorage.setItem(`layout_${user.email}`, JSON.stringify(newLayout));
  };

  const moveItem = (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= layout.length) return;
    const newLayout = [...layout];
    const temp = newLayout[index];
    newLayout[index] = newLayout[nextIndex];
    newLayout[nextIndex] = temp;
    saveLayout(newLayout);
  };

  const toggleVisibility = (index) => {
    const newLayout = [...layout];
    newLayout[index] = { ...newLayout[index], visible: !newLayout[index].visible };
    saveLayout(newLayout);
  };

  const toggleSize = (index) => {
    const newLayout = [...layout];
    newLayout[index] = { ...newLayout[index], size: newLayout[index].size === "full" ? "half" : "full" };
    saveLayout(newLayout);
  };

  const kpiConfig = schemas[department]?.kpi || {
    sum: ["Billing Amount", "Profit"],
    count_label: "Total Jobs",
    active_filter: { field: "Status", exclude: ["completed", "cancelled"] }
  };

  const activeCount = useMemo(() => {
    if (loading || !records.length) return 0;
    const field = kpiConfig.active_filter?.field || "Status";
    const exclude = kpiConfig.active_filter?.exclude || [];
    const camelField = toCamelCase(field);
    return records.filter(item => {
      const val = String(item[camelField] || "").toLowerCase();
      return !exclude.map(x => String(x).toLowerCase()).includes(val);
    }).length;
  }, [records, kpiConfig, loading]);

  const metricSums = useMemo(() => {
    const sums = {};
    (kpiConfig.sum || []).forEach(field => {
      const camelKey = toCamelCase(field);
      sums[field] = records.reduce((acc, item) => acc + Number(item[camelKey] || 0), 0);
    });
    return sums;
  }, [records, kpiConfig]);

  const activeFields = schemas[department]?.fields || [
    "Job No", "Date", "Client Name", "Agent Name", "Shipment Type", "Status", "Billing Amount", "Expense", "Profit"
  ];

  const displayFields = activeFields.filter(field => {
    if (user.role === "Staff" && isFinancialField(field)) return false;
    return true;
  });

  const recentFields = displayFields.slice(0, 5);

  const renderWidget = (item) => {
    const index = layout.findIndex(x => x.id === item.id);
    const isFirst = index === 0;
    const isLast = index === layout.length - 1;

    if (!item.visible) {
      if (isEditing) {
        return (
          <div key={item.id} className="dashboard-widget size-full" style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            border: "1px dashed #cbd5e1",
            borderRadius: "6px",
            backgroundColor: "rgba(0,0,0,0.01)",
            color: "#94a3b8",
            fontSize: "12px",
            marginBottom: "16px"
          }}>
            <span>👁️‍🗨️ Hidden Widget: <strong>{item.title}</strong></span>
            <button type="button" className="btn-secondary" style={{ padding: "2px 6px", fontSize: "11px", height: "24px" }} onClick={() => toggleVisibility(index)}>
              Show Widget
            </button>
          </div>
        );
      }
      return null;
    }

    switch (item.id) {
      case "metrics":
        return (
          <div key="metrics" className={`dashboard-widget size-${item.size}`}>
            {isEditing && <WidgetOverlay item={item} onToggle={() => toggleVisibility(index)} onResize={() => toggleSize(index)} onMoveUp={() => moveItem(index, -1)} onMoveDown={() => moveItem(index, 1)} isFirst={isFirst} isLast={isLast} />}
            <div className="metrics-grid" style={{ marginBottom: 0 }}>
              <Metric label={kpiConfig.count_label || "Total Records"} value={loading ? "..." : records.length.toLocaleString()} detail="Rows in selected report" />
              <Metric label="Open workload" value={loading ? "..." : activeCount.toLocaleString()} detail="Pending items in progress" tone="blue" />
              {user.role !== "Staff" && (kpiConfig.sum || []).map((field, idx) => {
                const val = metricSums[field] || 0;
                const isMoney = isFinancialField(field);
                const tone = idx === 0 ? "green" : "amber";
                const displayVal = isMoney ? money.format(val) : val.toLocaleString();
                return (
                  <Metric 
                    key={field} 
                    label={field} 
                    value={loading ? "..." : displayVal} 
                    detail={`Sum of ${field}`} 
                    tone={tone} 
                  />
                );
              })}
            </div>
          </div>
        );
      case "alerts":
        if (clientAlerts.length === 0 && !isEditing) return null;
        return (
          <div key="alerts" className={`dashboard-widget size-${item.size}`}>
            {isEditing && <WidgetOverlay item={item} onToggle={() => toggleVisibility(index)} onResize={() => toggleSize(index)} onMoveUp={() => moveItem(index, -1)} onMoveDown={() => moveItem(index, 1)} isFirst={isFirst} isLast={isLast} />}
            {clientAlerts.length > 0 ? (
              <div className="card panel client-alerts-panel" style={{ marginBottom: 0 }}>
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow" style={{ color: "#b91c1c" }}>Intelligence Alert</p>
                    <h2>Client Health Alerts</h2>
                  </div>
                  <span className="badge" style={{ backgroundColor: "#fee2e2", color: "#b91c1c", padding: "4px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: "600" }}>
                    {clientAlerts.length} Action Required
                  </span>
                </div>
                <div className="alerts-list" style={{ display: "grid", gap: "16px", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", marginTop: "16px" }}>
                  {clientAlerts.map((alert, idx) => (
                    <div key={idx} className={`alert-card severity-${alert.severity.toLowerCase()}`} style={{ borderLeft: `4px solid ${alert.severity === "High" ? "#dc2626" : alert.severity === "Medium" ? "#d97706" : "#2563eb"}`, padding: "16px", borderRadius: "4px", backgroundColor: "var(--panel-bg, #ffffff)", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                        <strong style={{ fontSize: "14px" }}>{alert.title}</strong>
                        <span className={`status-badge status-${alert.severity.toLowerCase()}`} style={{ fontSize: "10px" }}>{alert.severity}</span>
                      </div>
                      <p style={{ fontSize: "12px", color: "var(--text-secondary, #64748b)", margin: "0 0 12px 0", lineHeight: "1.5" }}>{alert.message}</p>
                      <div style={{ fontSize: "11px", padding: "8px 12px", backgroundColor: "rgba(0,0,0,0.02)", borderLeft: "2px solid #64748b", color: "var(--text-primary, #334155)" }}>
                        <strong>Recommendation: </strong> {alert.recommendation}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="card panel" style={{ padding: "20px", color: "#94a3b8", textAlign: "center", fontSize: "13px" }}>
                No active client health alerts.
              </div>
            )}
          </div>
        );
      case "activity":
        return (
          <div key="activity" className={`dashboard-widget size-${item.size}`}>
            {isEditing && <WidgetOverlay item={item} onToggle={() => toggleVisibility(index)} onResize={() => toggleSize(index)} onMoveUp={() => moveItem(index, -1)} onMoveDown={() => moveItem(index, 1)} isFirst={isFirst} isLast={isLast} />}
            <section className="card panel" style={{ marginBottom: 0 }}>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Latest activity</p>
                  <h2>Recent report records</h2>
                </div>
                <button className="btn-secondary" onClick={() => onNavigate("reports")}>View all</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {recentFields.map(field => <th key={field}>{field}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {records.slice(0, 7).map((record) => (
                      <tr key={record.id}>
                        {recentFields.map((field, idx) => (
                          <td key={field}>{renderCell(record, field, idx, department, schemas, delayRisks)}</td>
                        ))}
                      </tr>
                    ))}
                    {!records.length && !loading && <tr><td colSpan={recentFields.length} className="table-empty">No report records found.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        );
      case "actions":
        return (
          <div key="actions" className={`dashboard-widget size-${item.size}`}>
            {isEditing && <WidgetOverlay item={item} onToggle={() => toggleVisibility(index)} onResize={() => toggleSize(index)} onMoveUp={() => moveItem(index, -1)} onMoveDown={() => moveItem(index, 1)} isFirst={isFirst} isLast={isLast} />}
            <aside className="card panel quick-actions" style={{ marginBottom: 0 }}>
              <p className="eyebrow">Quick actions</p>
              <h2>Keep work moving</h2>
              <button onClick={() => onNavigate("analytics")}><strong>Review data analysis</strong><span>Charts, trends and AI insights</span></button>
              <button onClick={() => onNavigate("reports")}><strong>Build a focused report</strong><span>Filter, export or share records</span></button>
              <button onClick={() => onNavigate("operations")}><strong>Manage operations</strong><span>Clients, jobs and payments</span></button>
              <button onClick={() => onNavigate("documents")}><strong>Open documents</strong><span>Supporting files in one place</span></button>
            </aside>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <PageHeading
        eyebrow={`${department} overview`}
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${user.name.split(" ")[0]}`}
        description={currentVersion ? `A clear view of ${currentVersion.reportName || currentVersion.reportId}.` : "Select or upload a report to begin."}
        actions={
          <div style={{ display: "flex", gap: "10px" }}>
            {reportId && (
              <button 
                type="button" 
                className={isEditing ? "btn-primary" : "btn-secondary"} 
                onClick={() => setIsEditing(!isEditing)}
              >
                {isEditing ? "💾 Save Layout" : "⚙️ Customize"}
              </button>
            )}
            <button onClick={() => onNavigate(user.role === "Admin" ? "upload" : "reports")}>
              {user.role === "Admin" ? "Upload report" : "Open reports"}
            </button>
          </div>
        }
      />

      {!reportId ? (
        <EmptyState
          title="Your workspace is ready"
          message={user.role === "Admin" ? "Upload the first Excel or CSV report, map its columns, and the dashboard will populate automatically." : "Ask an administrator to upload a report and grant your account access."}
          action={user.role === "Admin" ? <button onClick={() => onNavigate("upload")}>Start an upload</button> : null}
        />
      ) : (
        <div className="dynamic-dashboard-grid" style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: "18px" }}>
          {layout.map((item) => renderWidget(item))}
        </div>
      )}
    </>
  );
}

export function AnalyticsPage({ user, reportId, versions }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const currentVersion = versions.find((v) => v.reportId === reportId);
  const department = currentVersion?.department || "Operations";

  useEffect(() => {
    if (!reportId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    api.get("/analytics", { params: { reportId } })
      .then(({ data: response }) => setData(response))
      .catch((requestError) => setError(requestError.response?.data?.detail || "Analytics could not be loaded."))
      .finally(() => setLoading(false));
  }, [reportId]);

  return (
    <>
      <PageHeading eyebrow="Data analysis" title="Performance and trends" description="Explore operational patterns separately from the detailed report table." />
      {!reportId ? <EmptyState title="Select a report" message="Choose a report version from the top bar to open its analytics." /> : (
        <>
          {error && <div className="inline-alert error">{error}</div>}
          {loading ? <div className="loading-panel card">Preparing charts...</div> : (
            <Suspense fallback={<div className="loading-panel card">Loading visualizations...</div>}>
              <AnalyticsDashboard data={data} role={user.role} department={department} />
              
              {user.role !== "Staff" && (
                <section className="card panel analytics-extra-view" style={{ marginTop: "24px", padding: "20px" }}>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-700 pb-2 mb-4">30-Day Billing Forecast</h3>
                  <ForecastChart reportId={reportId} />
                </section>
              )}


              {user.role !== "Staff" && <AISummary reportId={reportId} />}
            </Suspense>
          )}
        </>
      )}
    </>
  );
}

function MultiSelect({ label, options, value, onChange }) {
  return (
    <label className="field-group">
      <span>{label}</span>
      <select value={value[0] || ""} onChange={(event) => onChange(event.target.value ? [event.target.value] : [])}>
        <option value="">All {label.toLowerCase()}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

async function download(endpoint, payload, filename) {
  const response = await api.post(endpoint, payload, { responseType: "blob" });
  const url = URL.createObjectURL(response.data);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage({ user, reportId, versions }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [options, setOptions] = useState({ agents: [], clients: [], jobTypes: [], statuses: [] });
  const [records, setRecords] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState({ key: "date", direction: "desc" });
  const [selected, setSelected] = useState([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [schemas, setSchemas] = useState({});
  const [delayRisks, setDelayRisks] = useState({});

  const currentVersion = versions.find((v) => v.reportId === reportId);
  const department = currentVersion?.department || "Operations";

  useEffect(() => {
    api.get("/reports/schemas")
      .then(({ data }) => setSchemas(data || {}))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!reportId) {
      setDelayRisks({});
      return;
    }
    api.get(`/reports/${reportId}/delay-risk`)
      .then(({ data }) => setDelayRisks(data || {}))
      .catch(() => setDelayRisks({}));
  }, [reportId]);

  const getFilterLabel = (stdKey, defaultLabel) => {
    const stdMap = {
      agentName: {
        "Operations": "Agents",
        "Transportation / Fleet": "Drivers",
        "Warehouse": "Locations",
        "Air Freight": "Airlines",
        "Customs Clearance": "Customs Agent",
        "Documentation": "Verifiers",
        "Sales & Marketing": "Executives",
        "HR": "Employees",
        "IT / Software": "Roles",
        "Compliance / Audit": "Auditors",
        "Management / Admin": "Branches"
      },
      clientName: {
        "Operations": "Clients",
        "Customs Clearance": "Importers/Exporters",
        "Documentation": "Clients",
        "Sales & Marketing": "Leads"
      },
      status: {
        "Operations": "Statuses",
        "Transportation / Fleet": "Trip Statuses",
        "Warehouse": "Stock Statuses",
        "Air Freight": "Flight Statuses",
        "Customs Clearance": "Clearance Statuses",
        "Documentation": "Doc Statuses",
        "Sales & Marketing": "Lead Statuses",
        "HR": "Attendance",
        "IT / Software": "Error Types",
        "Compliance / Audit": "Audit Statuses",
        "Management / Admin": "KPI Statuses"
      }
    };
    return stdMap[stdKey]?.[department] || defaultLabel;
  };

  const activeFields = schemas[department]?.fields || [
    "Job No", "Date", "Client Name", "Agent Name", "Shipment Type", "Status", "Billing Amount", "Expense", "Profit"
  ];

  const displayFields = activeFields.filter(field => {
    if (user.role === "Staff" && isFinancialField(field)) return false;
    return true;
  });

  const payload = useMemo(() => ({
    ...filters,
    reportId,
    page,
    pageSize,
    sortBy: sort.key,
    sortOrder: sort.direction
  }), [filters, reportId, page, pageSize, sort]);

  useEffect(() => {
    if (!reportId) return;
    api.get("/filters", { params: { reportId } }).then(({ data }) => setOptions(data)).catch(() => {});
  }, [reportId]);

  useEffect(() => {
    if (!reportId) {
      setRecords([]);
      setTotalRecords(0);
      return;
    }
    setLoading(true);
    api.post("/filter-report", payload)
      .then(({ data }) => {
        setRecords(data.data || []);
        setTotalRecords(data.total_records || 0);
      })
      .catch((error) => setNotice(error.response?.data?.detail || "Report data could not be loaded."))
      .finally(() => setLoading(false));
  }, [payload, reportId]);

  useEffect(() => { setPage(1); setSelected([]); }, [filters, reportId]);

  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const visible = records;

  const toggleSort = (key) => setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  const sortMark = (key) => sort.key === key ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
  const toggleAll = () => setSelected(visible.every((row) => selected.includes(row.id)) ? selected.filter((id) => !visible.some((row) => row.id === id)) : [...new Set([...selected, ...visible.map((row) => row.id)])]);

  const exportSelected = async (format) => {
    try {
      await download(`/reports/bulk-export-${format}`, { selectedIds: selected }, `selected_reports.${format === "excel" ? "xlsx" : "pdf"}`);
    } catch (error) {
      setNotice(error.response?.data?.detail || "The selected records could not be exported.");
    }
  };

  return (
    <>
      <PageHeading
        eyebrow="Report workspace"
        title="Focused reports"
        description="Search, filter, sort and export the detailed records without leaving this page."
        actions={user.role !== "Staff" && reportId ? <>
          <button className="btn-secondary" onClick={() => download("/download-excel", payload, "logistics_report.xlsx")}>Export Excel</button>
          <button className="btn-secondary" onClick={() => download("/download-csv", payload, "logistics_report.csv")}>Export CSV</button>
          <button className="btn-secondary" onClick={() => download("/download-pdf", payload, "logistics_report.pdf")}>Export PDF</button>
          <button onClick={() => setShareOpen(true)}>Share report</button>
        </> : null}
      />

      {!reportId ? <EmptyState title="No report selected" message="Choose a report version from the top bar to view its records." /> : (
        <>
          {notice && <div className="inline-alert info"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}
          <section className="card filter-panel">
            <div className="filter-search" style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-end" }}>
              <label className="field-group" style={{ flex: 1, minWidth: "200px", margin: 0 }}>
                <span>Search records</span>
                <input value={filters.searchText} onChange={(event) => setFilters({ ...filters, searchText: event.target.value })} placeholder="Search..." />
              </label>
              {options.agents?.length > 0 && (
                <div style={{ minWidth: "150px" }}>
                  <MultiSelect label={getFilterLabel("agentName", "Agents")} options={options.agents || []} value={filters.agentName} onChange={(value) => setFilters({ ...filters, agentName: value })} />
                </div>
              )}
              {options.clients?.length > 0 && getFilterLabel("clientName", "") && (
                <div style={{ minWidth: "150px" }}>
                  <MultiSelect label={getFilterLabel("clientName", "Clients")} options={options.clients || []} value={filters.clientName} onChange={(value) => setFilters({ ...filters, clientName: value })} />
                </div>
              )}
              {options.statuses?.length > 0 && (
                <div style={{ minWidth: "150px" }}>
                  <MultiSelect label={getFilterLabel("status", "Statuses")} options={options.statuses || []} value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} />
                </div>
              )}
              <button className="btn-ghost reset-filter" style={{ height: "40px" }} onClick={() => setFilters(emptyFilters)}>Reset</button>
            </div>
          </section>

          {selected.length > 0 && user.role !== "Staff" && (
            <div className="bulk-bar">
              <strong>{selected.length} selected</strong>
              <button onClick={() => exportSelected("excel")}>Export Excel</button>
              <button onClick={() => exportSelected("pdf")}>Export PDF</button>
              <button className="btn-text" onClick={() => setSelected([])}>Clear</button>
            </div>
          )}

          <section className="card report-table-card">
            <div className="table-toolbar">
              <div><strong>{totalRecords.toLocaleString()} records</strong><span>{loading ? "Refreshing..." : "Filtered results"}</span></div>
              <label>Rows <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option>10</option><option>20</option><option>50</option></select></label>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {user.role !== "Staff" && <th className="check-cell"><input type="checkbox" checked={visible.length > 0 && visible.every((row) => selected.includes(row.id))} onChange={toggleAll} /></th>}
                    {displayFields.map((field) => {
                      const camelKey = toCamelCase(field);
                      return (
                        <th key={field}>
                          <button onClick={() => toggleSort(camelKey)}>
                            {field}{sortMark(camelKey)}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((record) => (
                    <tr key={record.id}>
                      {user.role !== "Staff" && <td className="check-cell"><input type="checkbox" checked={selected.includes(record.id)} onChange={() => setSelected((current) => current.includes(record.id) ? current.filter((id) => id !== record.id) : [...current, record.id])} /></td>}
                      {displayFields.map((field, idx) => (
                        <td key={field}>{renderCell(record, field, idx, department, schemas, delayRisks)}</td>
                      ))}
                    </tr>
                  ))}
                  {!visible.length && !loading && <tr><td colSpan={displayFields.length + 1} className="table-empty">No records match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>Page {page} of {totalPages}</span>
              <div><button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</button></div>
            </div>
          </section>
        </>
      )}
      <EmailShareModal isOpen={shareOpen} onClose={() => setShareOpen(false)} onSuccess={() => setNotice("The report was queued for email delivery.")} filters={payload} />
    </>
  );
}

export function UploadPage({ onUploaded }) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [meta, setMeta] = useState({ reportName: "", reportType: "Monthly", period: "", description: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadResult, setUploadResult] = useState(null);
  const [schemas, setSchemas] = useState({});
  const [department, setDepartment] = useState("Operations");

  useEffect(() => {
    api.get("/reports/schemas")
      .then(({ data }) => {
        setSchemas(data || {});
        if (data && Object.keys(data).length > 0) {
          setDepartment(Object.keys(data)[0]);
        }
      })
      .catch(() => {});
  }, []);

  const chooseFile = async (selectedFile) => {
    if (!selectedFile) return;
    setFile(selectedFile);
    setLoading(true);
    setError("");
    const body = new FormData();
    body.append("file", selectedFile);
    body.append("department", department);
    try {
      const { data } = await api.post("/upload-preview", body);
      setPreview(data);
      const autoMapping = {};
      const fieldsToMap = schemas[department]?.fields || [];
      data.uploadedColumns.forEach((column) => {
        autoMapping[column] = fieldsToMap.find((field) => field.toLowerCase().replace(/\s/g, "") === column.toLowerCase().replace(/[\s_-]/g, "")) || "";
      });
      setMapping(autoMapping);
      setMeta((current) => ({ ...current, reportName: selectedFile.name.replace(/\.(xlsx|csv|pdf|png|jpg|jpeg)$/i, ""), period: new Date().toLocaleString("en-US", { month: "long", year: "numeric" }) }));
      setStep(2);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "The file could not be read. Check that the API is running and the file is valid.");
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!meta.reportName.trim()) {
      setError("Give this report a clear name.");
      return;
    }
    const mappedFields = Object.values(mapping);
    const requiredFields = schemas[department]?.required || [];
    
    for (const reqField of requiredFields) {
      if (!mappedFields.includes(reqField)) {
        setError(`You must map one of your columns to the required field: '${reqField}'.`);
        return;
      }
    }

    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/confirm-column-mapping", { tempId: preview.tempId, mapping, ...meta, department });
      setUploadResult(data);
      setStep(3);
      onUploaded?.(data.reportId);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "The report could not be imported.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setStep(1); setFile(null); setPreview(null); setMapping({}); setError(""); setUploadResult(null); };

  return (
    <>
      <PageHeading eyebrow="Report Ingestion" title="Upload a logistics report" description="A guided import checks the file, maps its columns, and creates a new report version." />
      <div className="stepper">
        {["Choose file", "Map columns", "Complete"].map((label, index) => <div className={step >= index + 1 ? "active" : ""} key={label}><span>{index + 1}</span><strong>{label}</strong></div>)}
      </div>
      {error && <div className="inline-alert error">{error}</div>}

      {step === 1 && (
        <div style={{ maxWidth: "600px", margin: "0 auto 30px", display: "flex", flexDirection: "column", gap: "20px" }}>
          <section className="card panel" style={{ padding: "20px" }}>
            <p className="eyebrow" style={{ marginBottom: "8px" }}>Ingestion Scope</p>
            <h2 style={{ fontSize: "18px", marginBottom: "16px" }}>Select Target Department</h2>
            <label className="field-group" style={{ margin: 0 }}>
              <select value={department} onChange={(event) => setDepartment(event.target.value)}>
                {Object.keys(schemas).map((dept) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </label>
          </section>

          <section className="card upload-card" style={{ padding: "40px 20px" }}>
            <label className="upload-dropzone">
              <input type="file" accept=".xlsx,.csv,.pdf,image/png,image/jpeg" onChange={(event) => chooseFile(event.target.files?.[0])} />
              <span className="upload-icon">↑</span>
              <h2>{loading ? "Reading your file..." : "Drop an Excel, CSV, PDF, or image here"}</h2>
              <p>or click to browse. Tabular data will be extracted/parsed before import.</p>
              <b>Choose file</b>
            </label>
            <div className="upload-help"><strong>Before uploading</strong><span>Use one header row, keep dates consistent, and include the department's required fields.</span></div>
          </section>
        </div>
      )}

      {step === 2 && preview && (
        <div className="upload-layout">
          <section className="card panel">
            <div className="panel-heading"><div><p className="eyebrow">Column mapping</p><h2>{file?.name}</h2></div><button className="btn-secondary" onClick={reset}>Choose another file</button></div>
            <p className="section-description">Match uploaded headings to the fields Smart Logistics understands for the <strong>{department}</strong> department. Unmapped optional columns are retained in the source but not used in reporting.</p>
            <div className="mapping-list">
              {preview.uploadedColumns.map((column) => (
                <div className="mapping-row" key={column}>
                  <strong>{column}</strong><span>→</span>
                  <select value={mapping[column] || ""} onChange={(event) => setMapping({ ...mapping, [column]: event.target.value })}>
                    <option value="">Do not map</option>
                    {(schemas[department]?.fields || []).map((field) => <option key={field} value={field}>{field}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </section>
          <aside className="card panel upload-details">
            <p className="eyebrow">Report details</p>
            <h2>Create report version</h2>
            <label className="field-group"><span>Report name</span><input value={meta.reportName} onChange={(event) => setMeta({ ...meta, reportName: event.target.value })} /></label>
            <label className="field-group"><span>Report type</span><select value={meta.reportType} onChange={(event) => setMeta({ ...meta, reportType: event.target.value })}><option>Monthly</option><option>Weekly</option><option>Quarterly</option><option>Custom</option></select></label>
            <label className="field-group"><span>Reporting period</span><input value={meta.period} onChange={(event) => setMeta({ ...meta, period: event.target.value })} /></label>
            <label className="field-group"><span>Description</span><textarea rows="3" value={meta.description} onChange={(event) => setMeta({ ...meta, description: event.target.value })} /></label>
            <button onClick={confirm} disabled={loading}>{loading ? "Importing report..." : "Confirm and import"}</button>
          </aside>
          <section className="card panel preview-panel">
            <div className="panel-heading"><div><p className="eyebrow">File preview</p><h2>First {preview.previewRows.length} rows</h2></div></div>
            <div className="table-wrap"><table><thead><tr>{preview.uploadedColumns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.previewRows.map((row, index) => <tr key={index}>{preview.uploadedColumns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}</tr>)}</tbody></table></div>
          </section>
        </div>
      )}

      {step === 3 && (
        <section className="card success-state" style={{ maxWidth: "800px", margin: "30px auto" }}>
          <span style={{ display: "inline-grid", placeItems: "center", width: "64px", height: "64px", borderRadius: "50%", background: "var(--success-light)", color: "var(--success)", fontSize: "28px", fontWeight: "bold", margin: "0 auto 16px" }}>✓</span>
          <h2>Report Ingestion Completed</h2>
          <p style={{ color: "var(--text-muted)", marginBottom: "24px" }}>
            The new report version is parsed and available across the workspace.
          </p>

          {uploadResult && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "24px", textAlign: "left" }}>
              <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: "600" }}>Total Rows</span>
                <strong style={{ fontSize: "20px", color: "var(--text-heading)" }}>{uploadResult.totalRows?.toLocaleString()}</strong>
              </div>
              <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--success)", fontWeight: "600" }}>Inserted Rows</span>
                <strong style={{ fontSize: "20px", color: "var(--success)" }}>{uploadResult.insertedRows?.toLocaleString()}</strong>
              </div>
              <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "11px", textTransform: "uppercase", color: uploadResult.failedRows > 0 ? "var(--danger)" : "var(--text-muted)", fontWeight: "600" }}>Failed Rows</span>
                <strong style={{ fontSize: "20px", color: uploadResult.failedRows > 0 ? "var(--danger)" : "var(--text-heading)" }}>{uploadResult.failedRows?.toLocaleString()}</strong>
              </div>
              <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: "600" }}>Upload Time</span>
                <strong style={{ fontSize: "20px", color: "var(--text-heading)" }}>{uploadResult.uploadTime}s</strong>
              </div>
            </div>
          )}

          {uploadResult && uploadResult.failedRows > 0 && (
            <div style={{ textAlign: "left", marginBottom: "24px" }}>
              <div className="inline-alert error" style={{ marginBottom: "12px" }}>
                <strong>Validation Failures Alert</strong>
                <span>{uploadResult.failedRows} rows failed validation and were skipped. Details of the first 20 errors are listed below.</span>
              </div>
              <div className="card" style={{ padding: "16px", maxHeight: "250px", overflowY: "auto", border: "1px solid var(--border-color)" }}>
                <h3 style={{ fontSize: "13px", fontWeight: "700", marginBottom: "10px", color: "var(--text-heading)" }}>Failure Details</h3>
                <ul style={{ paddingLeft: "20px", margin: 0, fontSize: "12px", color: "var(--text-main)", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {uploadResult.failedDetails?.map((err, i) => (
                    <li key={i}>
                      <strong>Row {err.row}:</strong> <span style={{ color: "var(--danger)" }}>{err.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginTop: "12px" }}>
            <button onClick={() => onUploaded?.()}>Open report</button>
            <button className="btn-secondary" onClick={reset}>Upload another</button>
          </div>
        </section>
      )}
    </>
  );
}

export { EmptyState, PageHeading, StatusBadge };
