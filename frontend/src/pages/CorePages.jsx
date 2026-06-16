import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import EmailShareModal from "../components/EmailShareModal";

const AnalyticsDashboard = lazy(() => import("../components/AnalyticsDashboard"));
const AISummary = lazy(() => import("../components/AISummary"));
const MapView = lazy(() => import("../components/MapView"));
const ForecastChart = lazy(() => import("../components/ForecastChart"));

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
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

function EmptyState({ title, message, action }) {
  return (
    <div className="empty-state card">
      <div className="empty-state-mark">+</div>
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

export function OverviewPage({ user, reportId, versions, onNavigate }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const currentVersion = versions.find((version) => version.reportId === reportId);

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

  const summary = useMemo(() => ({
    records: records.length,
    active: records.filter((item) => !["completed", "cancelled"].includes(String(item.status).toLowerCase())).length,
    billing: records.reduce((sum, item) => sum + Number(item.billingAmount || 0), 0),
    profit: records.reduce((sum, item) => sum + Number(item.profit || 0), 0),
  }), [records]);

  return (
    <>
      <PageHeading
        eyebrow="Operations overview"
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${user.name.split(" ")[0]}`}
        description={currentVersion ? `A clear view of ${currentVersion.reportName || currentVersion.reportId}.` : "Select or upload a report to begin."}
        actions={<button onClick={() => onNavigate(user.role === "Admin" ? "upload" : "reports")}>{user.role === "Admin" ? "Upload report" : "Open reports"}</button>}
      />

      {!reportId ? (
        <EmptyState
          title="Your workspace is ready"
          message={user.role === "Admin" ? "Upload the first Excel or CSV report, map its columns, and the dashboard will populate automatically." : "Ask an administrator to upload a report and grant your account access."}
          action={user.role === "Admin" ? <button onClick={() => onNavigate("upload")}>Start an upload</button> : null}
        />
      ) : (
        <>
          <div className="metrics-grid">
            <Metric label="Total records" value={loading ? "..." : summary.records.toLocaleString()} detail="Rows in selected report" />
            <Metric label="Open workload" value={loading ? "..." : summary.active.toLocaleString()} detail="Jobs still in progress" tone="blue" />
            {user.role !== "Staff" && <Metric label="Total billing" value={loading ? "..." : money.format(summary.billing)} detail="Gross invoiced amount" tone="green" />}
            {user.role !== "Staff" && <Metric label="Operating profit" value={loading ? "..." : money.format(summary.profit)} detail="Across selected records" tone="amber" />}
          </div>

          <div className="overview-grid">
            <section className="card panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Latest activity</p>
                  <h2>Recent report records</h2>
                </div>
                <button className="btn-secondary" onClick={() => onNavigate("reports")}>View all</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Job</th><th>Client</th><th>Agent</th><th>Status</th><th>Date</th></tr></thead>
                  <tbody>
                    {records.slice(0, 7).map((record) => (
                      <tr key={record.id}>
                        <td><strong>{record.jobNo}</strong><span className="cell-subtitle">{record.jobType}</span></td>
                        <td>{record.clientName}</td>
                        <td>{record.agentName}</td>
                        <td><StatusBadge value={record.status} /></td>
                        <td>{record.date}</td>
                      </tr>
                    ))}
                    {!records.length && !loading && <tr><td colSpan="5" className="table-empty">No report records found.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <aside className="card panel quick-actions">
              <p className="eyebrow">Quick actions</p>
              <h2>Keep work moving</h2>
              <button onClick={() => onNavigate("analytics")}><strong>Review data analysis</strong><span>Charts, trends and AI insights</span></button>
              <button onClick={() => onNavigate("reports")}><strong>Build a focused report</strong><span>Filter, export or share records</span></button>
              <button onClick={() => onNavigate("operations")}><strong>Manage operations</strong><span>Clients, jobs and payments</span></button>
              <button onClick={() => onNavigate("documents")}><strong>Open documents</strong><span>Supporting files in one place</span></button>
            </aside>
          </div>
        </>
      )}
    </>
  );
}

export function AnalyticsPage({ user, reportId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
              <AnalyticsDashboard data={data} role={user.role} />
              
              {user.role !== "Staff" && (
                <section className="card panel analytics-extra-view" style={{ marginTop: "24px", padding: "20px" }}>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-700 pb-2 mb-4">30-Day Billing Forecast</h3>
                  <ForecastChart reportId={reportId} />
                </section>
              )}

              <section className="card panel analytics-extra-view" style={{ marginTop: "24px", padding: "20px" }}>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-700 pb-2 mb-4">Shipment Routes & Branches Map</h3>
                <MapView reportId={reportId} />
              </section>

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

export function ReportsPage({ user, reportId }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [options, setOptions] = useState({ agents: [], clients: [], jobTypes: [], statuses: [] });
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState({ key: "date", direction: "desc" });
  const [selected, setSelected] = useState([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const payload = useMemo(() => ({ ...filters, reportId }), [filters, reportId]);

  useEffect(() => {
    if (!reportId) return;
    api.get("/filters", { params: { reportId } }).then(({ data }) => setOptions(data)).catch(() => {});
  }, [reportId]);

  useEffect(() => {
    if (!reportId) {
      setRecords([]);
      return;
    }
    setLoading(true);
    api.post("/filter-report", payload)
      .then(({ data }) => setRecords(data.data || []))
      .catch((error) => setNotice(error.response?.data?.detail || "Report data could not be loaded."))
      .finally(() => setLoading(false));
  }, [payload, reportId]);

  useEffect(() => { setPage(1); setSelected([]); }, [filters, reportId]);

  const sorted = useMemo(() => [...records].sort((a, b) => {
    const left = a[sort.key] ?? "";
    const right = b[sort.key] ?? "";
    const comparison = typeof left === "number" ? left - Number(right) : String(left).localeCompare(String(right));
    return sort.direction === "asc" ? comparison : -comparison;
  }), [records, sort]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const visible = sorted.slice((page - 1) * pageSize, page * pageSize);

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
          <button onClick={() => setShareOpen(true)}>Share report</button>
        </> : null}
      />

      {!reportId ? <EmptyState title="No report selected" message="Choose a report version from the top bar to view its records." /> : (
        <>
          {notice && <div className="inline-alert info"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}
          <section className="card filter-panel">
            <div className="filter-search">
              <label className="field-group">
                <span>Search records</span>
                <input value={filters.searchText} onChange={(event) => setFilters({ ...filters, searchText: event.target.value })} placeholder="Job, client, agent or status" />
              </label>
              <MultiSelect label="Agents" options={options.agents || []} value={filters.agentName} onChange={(value) => setFilters({ ...filters, agentName: value })} />
              <MultiSelect label="Clients" options={options.clients || []} value={filters.clientName} onChange={(value) => setFilters({ ...filters, clientName: value })} />
              <MultiSelect label="Statuses" options={options.statuses || []} value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} />
              <button className="btn-ghost reset-filter" onClick={() => setFilters(emptyFilters)}>Reset</button>
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
              <div><strong>{records.length.toLocaleString()} records</strong><span>{loading ? "Refreshing..." : "Filtered results"}</span></div>
              <label>Rows <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option>10</option><option>20</option><option>50</option></select></label>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {user.role !== "Staff" && <th className="check-cell"><input type="checkbox" checked={visible.length > 0 && visible.every((row) => selected.includes(row.id))} onChange={toggleAll} /></th>}
                    <th><button onClick={() => toggleSort("jobNo")}>Job{sortMark("jobNo")}</button></th>
                    <th><button onClick={() => toggleSort("clientName")}>Client{sortMark("clientName")}</button></th>
                    <th><button onClick={() => toggleSort("agentName")}>Agent{sortMark("agentName")}</button></th>
                    <th>Type</th><th>Status</th>
                    {user.role !== "Staff" && <><th><button onClick={() => toggleSort("billingAmount")}>Billing{sortMark("billingAmount")}</button></th><th>Profit</th></>}
                    <th><button onClick={() => toggleSort("date")}>Date{sortMark("date")}</button></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((record) => (
                    <tr key={record.id}>
                      {user.role !== "Staff" && <td className="check-cell"><input type="checkbox" checked={selected.includes(record.id)} onChange={() => setSelected((current) => current.includes(record.id) ? current.filter((id) => id !== record.id) : [...current, record.id])} /></td>}
                      <td><strong>{record.jobNo}</strong></td><td>{record.clientName}</td><td>{record.agentName}</td><td>{record.jobType}</td><td><StatusBadge value={record.status} /></td>
                      {user.role !== "Staff" && <><td>{money.format(record.billingAmount || 0)}</td><td className={Number(record.profit) < 0 ? "negative" : "positive"}>{money.format(record.profit || 0)}</td></>}
                      <td>{record.date}</td>
                    </tr>
                  ))}
                  {!visible.length && !loading && <tr><td colSpan="10" className="table-empty">No records match these filters.</td></tr>}
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

const systemFields = ["Agent Name", "Client Name", "Job Type", "Status", "Job No", "Billing Amount", "Expense", "Profit", "Date", "Branch", "Department"];

export function UploadPage({ onUploaded }) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [meta, setMeta] = useState({ reportName: "", reportType: "Monthly", period: "", description: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const chooseFile = async (selectedFile) => {
    if (!selectedFile) return;
    setFile(selectedFile);
    setLoading(true);
    setError("");
    const body = new FormData();
    body.append("file", selectedFile);
    try {
      const { data } = await api.post("/upload-preview", body);
      setPreview(data);
      const autoMapping = {};
      data.uploadedColumns.forEach((column) => {
        autoMapping[column] = systemFields.find((field) => field.toLowerCase().replace(/\s/g, "") === column.toLowerCase().replace(/[\s_-]/g, "")) || "";
      });
      setMapping(autoMapping);
      setMeta((current) => ({ ...current, reportName: selectedFile.name.replace(/\.(xlsx|csv)$/i, ""), period: new Date().toLocaleString("en-US", { month: "long", year: "numeric" }) }));
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
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/confirm-column-mapping", { tempId: preview.tempId, mapping, ...meta });
      setStep(3);
      onUploaded?.(data.reportId);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "The report could not be imported.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setStep(1); setFile(null); setPreview(null); setMapping({}); setError(""); };

  return (
    <>
      <PageHeading eyebrow="Report ingestion" title="Upload a logistics report" description="A guided import checks the file, maps its columns, and creates a new report version." />
      <div className="stepper">
        {["Choose file", "Map columns", "Complete"].map((label, index) => <div className={step >= index + 1 ? "active" : ""} key={label}><span>{index + 1}</span><strong>{label}</strong></div>)}
      </div>
      {error && <div className="inline-alert error">{error}</div>}

      {step === 1 && (
        <section className="card upload-card">
          <label className="upload-dropzone">
            <input type="file" accept=".xlsx,.csv" onChange={(event) => chooseFile(event.target.files?.[0])} />
            <span className="upload-icon">↑</span>
            <h2>{loading ? "Reading your file..." : "Drop an Excel or CSV file here"}</h2>
            <p>or click to browse. The first 10 rows will be previewed before import.</p>
            <b>Choose file</b>
          </label>
          <div className="upload-help"><strong>Before uploading</strong><span>Use one header row, keep dates consistent, and include a unique job number where possible.</span></div>
        </section>
      )}

      {step === 2 && preview && (
        <div className="upload-layout">
          <section className="card panel">
            <div className="panel-heading"><div><p className="eyebrow">Column mapping</p><h2>{file?.name}</h2></div><button className="btn-secondary" onClick={reset}>Choose another file</button></div>
            <p className="section-description">Match uploaded headings to the fields Smart Logistics understands. Unmapped optional columns are retained in the source but not used in reporting.</p>
            <div className="mapping-list">
              {preview.uploadedColumns.map((column) => (
                <div className="mapping-row" key={column}>
                  <strong>{column}</strong><span>→</span>
                  <select value={mapping[column] || ""} onChange={(event) => setMapping({ ...mapping, [column]: event.target.value })}>
                    <option value="">Do not map</option>
                    {systemFields.map((field) => <option key={field} value={field}>{field}</option>)}
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
        <section className="card success-state">
          <span>✓</span><h2>Report imported successfully</h2><p>The new version is available across Overview, Data analysis, and Reports.</p>
          <div><button onClick={() => onUploaded?.()}>Open report</button><button className="btn-secondary" onClick={reset}>Upload another</button></div>
        </section>
      )}
    </>
  );
}

export { EmptyState, PageHeading, StatusBadge };
