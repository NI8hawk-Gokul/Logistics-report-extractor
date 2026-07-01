import { useEffect, useMemo, useState } from "react";
import api, { API_BASE } from "../services/api";
import { EmptyState, PageHeading, StatusBadge } from "./CorePages";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function useCollection(endpoint, dependencies = []) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(endpoint);
      setItems(Array.isArray(data) ? data : data.data || []);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "This information could not be loaded.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, dependencies);
  return { items, loading, error, reload: load };
}

function Notice({ message, onClose }) {
  if (!message) return null;
  return <div className="inline-alert info"><span>{message}</span><button onClick={onClose}>×</button></div>;
}

export function TemplatesPage({ reportId }) {
  const { items, loading, error, reload } = useCollection("/templates");
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");

  const create = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    await api.post("/templates", { templateName: name.trim(), filters: { reportId } });
    setName("");
    setNotice("Template saved.");
    reload();
  };
  const remove = async (id) => { await api.delete(`/templates/${id}`); reload(); };

  return (
    <>
      <PageHeading eyebrow="Reusable workflow" title="Report templates" description="Save report configurations so recurring analysis starts from a consistent setup." />
      <div className="two-column-layout">
        <section className="card panel">
          <div className="panel-heading"><div><p className="eyebrow">Saved templates</p><h2>{items.length} available</h2></div></div>
          {error && <div className="inline-alert error">{error}</div>}
          {loading ? <div className="loading-panel">Loading templates...</div> : items.length ? (
            <div className="item-list">
              {items.map((item) => <div className="list-item" key={item.id}><div className="list-icon">T</div><div><strong>{item.templateName}</strong><span>Created by {item.createdBy || "Unknown"} · {new Date(item.createdAt).toLocaleDateString()}</span></div><button className="btn-danger-light" onClick={() => remove(item.id)}>Delete</button></div>)}
            </div>
          ) : <EmptyState title="No templates yet" message="Create the first reusable report template." />}
        </section>
        <aside className="card panel form-panel">
          <p className="eyebrow">New template</p><h2>Save current context</h2>
          <p className="section-description">The selected report version will be stored as the starting point.</p>
          <Notice message={notice} onClose={() => setNotice("")} />
          <form onSubmit={create}>
            <label className="field-group"><span>Template name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Monthly operations review" /></label>
            <label className="field-group"><span>Selected report</span><input value={reportId || "No report selected"} disabled /></label>
            <button disabled={!name.trim()}>Save template</button>
          </form>
        </aside>
      </div>
    </>
  );
}

export function SchedulesPage() {
  const templates = useCollection("/templates");
  const schedules = useCollection("/scheduled-reports");
  const [form, setForm] = useState({ scheduleName: "", templateId: "", receiverEmail: "", emailSubject: "Scheduled logistics report", emailMessage: "Your scheduled report is ready.", attachmentType: "pdf", frequency: "Weekly", deliveryTime: "09:00", dayOfWeek: "Monday" });
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!form.templateId && templates.items[0]) setForm((current) => ({ ...current, templateId: templates.items[0].id }));
  }, [templates.items, form.templateId]);

  const create = async (event) => {
    event.preventDefault();
    await api.post("/scheduled-reports", form);
    setForm((current) => ({ ...current, scheduleName: "", receiverEmail: "" }));
    setNotice("Schedule created.");
    schedules.reload();
  };
  const toggle = async (id) => { await api.patch(`/scheduled-reports/${id}/toggle`); schedules.reload(); };
  const remove = async (id) => { await api.delete(`/scheduled-reports/${id}`); schedules.reload(); };

  return (
    <>
      <PageHeading eyebrow="Automated delivery" title="Scheduled reports" description="Manage recurring report deliveries without mixing them into the reporting screen." />
      <div className="two-column-layout wide-main">
        <section className="card panel">
          <div className="panel-heading"><div><p className="eyebrow">Delivery queue</p><h2>{schedules.items.length} schedules</h2></div></div>
          {schedules.items.length ? <div className="item-list">
            {schedules.items.map((item) => <div className="list-item schedule-item" key={item.id}><div className={`list-icon ${item.isActive ? "success" : ""}`}>S</div><div><strong>{item.scheduleName}</strong><span>{item.frequency} at {item.deliveryTime} · {item.receiverEmail}</span></div><StatusBadge value={item.isActive ? "Active" : "Paused"} /><button className="btn-secondary" onClick={() => toggle(item.id)}>{item.isActive ? "Pause" : "Resume"}</button><button className="btn-danger-light" onClick={() => remove(item.id)}>Delete</button></div>)}
          </div> : <EmptyState title="No scheduled reports" message="Set up a delivery using a saved report template." />}
        </section>
        <aside className="card panel form-panel">
          <p className="eyebrow">New delivery</p><h2>Create schedule</h2><Notice message={notice} onClose={() => setNotice("")} />
          <form onSubmit={create} className="compact-form">
            <label className="field-group"><span>Schedule name</span><input required value={form.scheduleName} onChange={(event) => setForm({ ...form, scheduleName: event.target.value })} /></label>
            <label className="field-group"><span>Template</span><select required value={form.templateId} onChange={(event) => setForm({ ...form, templateId: event.target.value })}><option value="">Choose template</option>{templates.items.map((item) => <option key={item.id} value={item.id}>{item.templateName}</option>)}</select></label>
            <label className="field-group"><span>Receiver email</span><input required type="email" value={form.receiverEmail} onChange={(event) => setForm({ ...form, receiverEmail: event.target.value })} /></label>
            <div className="form-row"><label className="field-group"><span>Frequency</span><select value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value })}><option>Daily</option><option>Weekly</option><option>Monthly</option></select></label><label className="field-group"><span>Delivery time</span><input type="time" value={form.deliveryTime} onChange={(event) => setForm({ ...form, deliveryTime: event.target.value })} /></label></div>
            <label className="field-group"><span>Attachment</span><select value={form.attachmentType} onChange={(event) => setForm({ ...form, attachmentType: event.target.value })}><option value="pdf">PDF</option><option value="excel">Excel</option><option value="both">PDF and Excel</option></select></label>
            <button disabled={!templates.items.length}>Create schedule</button>
          </form>
        </aside>
      </div>
    </>
  );
}

const operationConfig = {
  clients: { title: "Clients", fields: [["name", "Client name"], ["email", "Email"], ["phone", "Phone"], ["address", "Address"]] },
  agents: { title: "Agents", fields: [["name", "Agent name"], ["email", "Email"], ["phone", "Phone"], ["branch", "Branch"]] },
  jobs: { title: "Jobs", fields: [["jobNo", "Job number"], ["clientName", "Client"], ["agentName", "Agent"], ["jobType", "Job type"], ["status", "Status"], ["billingAmount", "Billing amount", "number"], ["expense", "Expense", "number"], ["profit", "Profit", "number"], ["date", "Date", "date"], ["branch", "Branch"], ["department", "Department"]] },
  payments: { title: "Payments", fields: [["invoiceNo", "Invoice number"], ["clientName", "Client"], ["amount", "Amount", "number"], ["status", "Status"]] },
  approvals: { title: "Approvals", fields: [["targetType", "Request type"], ["targetId", "Target ID"], ["description", "Description"], ["amount", "Amount", "number"]] },
};

export function OperationsPage({ user }) {
  const [tab, setTab] = useState("clients");
  const { items, loading, error, reload } = useCollection(`/${tab}`, [tab]);
  const [form, setForm] = useState({});
  const [showForm, setShowForm] = useState(false);
  const config = operationConfig[tab];

  useEffect(() => { setForm({}); setShowForm(false); }, [tab]);

  const create = async (event) => {
    event.preventDefault();
    const payload = { ...form };
    config.fields.filter(([, , type]) => type === "number").forEach(([name]) => { payload[name] = Number(payload[name] || 0); });
    await api.post(`/${tab}`, payload);
    setForm({});
    setShowForm(false);
    reload();
  };

  const primary = (item) => item.name || item.jobNo || item.invoiceNo || item.approvalId || item.description || "Record";
  const secondary = (item) => [item.email, item.clientName, item.agentName, item.jobType, item.targetType].filter(Boolean).join(" · ");

  const action = async (item, type) => {
    if (tab === "payments" && type === "paid") await api.patch(`/payments/${item.id}/mark-paid`);
    if (tab === "approvals" && type === "approve") await api.patch(`/approvals/${item.approvalId || item.id}/approve`);
    if (tab === "approvals" && type === "reject") await api.patch(`/approvals/${item.approvalId || item.id}/reject`, { reason: "Rejected from operations workspace" });
    reload();
  };

  return (
    <>
      <PageHeading eyebrow="Operations hub" title="Operational records" description="Clients, agents, jobs, invoices and approvals each have a focused workspace." actions={user.role !== "Staff" && <button onClick={() => setShowForm((value) => !value)}>{showForm ? "Close form" : `Add ${config.title.slice(0, -1)}`}</button>} />
      <div className="segmented-tabs">{Object.entries(operationConfig).map(([key, value]) => <button className={tab === key ? "active" : ""} onClick={() => setTab(key)} key={key}>{value.title}</button>)}</div>
      {error && <div className="inline-alert error">{error}</div>}
      {showForm && user.role !== "Staff" && (
        <section className="card panel inline-form-panel">
          <div><p className="eyebrow">New record</p><h2>Add {config.title.slice(0, -1)}</h2></div>
          <form onSubmit={create} className="dynamic-form">
            {config.fields.map(([name, label, type = "text"]) => <label className="field-group" key={name}><span>{label}</span><input required={name !== "address" && name !== "amount"} type={type} value={form[name] || ""} onChange={(event) => setForm({ ...form, [name]: event.target.value })} /></label>)}
            <button>Save record</button>
          </form>
        </section>
      )}
      <section className="card panel">
        <div className="panel-heading"><div><p className="eyebrow">{config.title}</p><h2>{items.length} records</h2></div></div>
        {loading ? <div className="loading-panel">Loading records...</div> : items.length ? (
          <div className="table-wrap"><table><thead><tr><th>{tab === "jobs" ? "Job" : "Record"}</th><th>Details</th><th>Status</th>{user.role !== "Staff" && ["payments", "approvals"].includes(tab) && <th>Actions</th>}</tr></thead><tbody>
            {items.map((item) => <tr key={item.id || item.approvalId}><td><strong>{primary(item)}</strong>{item.amount != null && <span className="cell-subtitle">{money.format(item.amount)}</span>}</td><td>{secondary(item) || item.description || "No additional details"}</td><td>{item.status ? <StatusBadge value={item.status} /> : "-"}</td>{user.role !== "Staff" && ["payments", "approvals"].includes(tab) && <td className="row-actions">{tab === "payments" && item.status !== "Paid" && <button className="btn-secondary" onClick={() => action(item, "paid")}>Mark paid</button>}{tab === "approvals" && item.status === "Pending" && <><button onClick={() => action(item, "approve")}>Approve</button><button className="btn-danger-light" onClick={() => action(item, "reject")}>Reject</button></>}</td>}</tr>)}
          </tbody></table></div>
        ) : <EmptyState title={`No ${config.title.toLowerCase()} found`} message={`Create the first ${config.title.slice(0, -1).toLowerCase()} record when work begins.`} action={user.role !== "Staff" && <button onClick={() => setShowForm(true)}>Add {config.title.slice(0, -1).toLowerCase()}</button>} />}
      </section>
    </>
  );
}

export function DocumentsPage({ user, reportId }) {
  const { items, loading, error, reload } = useCollection("/documents");
  const [form, setForm] = useState({ file: null, documentType: "Report support", linkedEntityType: "report", linkedEntityId: reportId || "" });
  const [uploading, setUploading] = useState(false);

  useEffect(() => setForm((current) => ({ ...current, linkedEntityId: reportId || "" })), [reportId]);

  const upload = async (event) => {
    event.preventDefault();
    if (!form.file) return;
    setUploading(true);
    const body = new FormData();
    body.append("file", form.file); body.append("documentType", form.documentType); body.append("linkedEntityType", form.linkedEntityType); body.append("linkedEntityId", form.linkedEntityId);
    await api.post("/documents/upload", body);
    setForm((current) => ({ ...current, file: null }));
    setUploading(false);
    reload();
  };
  const download = async (item) => {
    const response = await api.get(`/documents/${item.id}/download`, { responseType: "blob" });
    const url = URL.createObjectURL(response.data); const anchor = document.createElement("a"); anchor.href = url; anchor.download = item.documentName; anchor.click(); URL.revokeObjectURL(url);
  };
  const remove = async (id) => { await api.delete(`/documents/${id}`); reload(); };

  return (
    <>
      <PageHeading eyebrow="Document centre" title="Supporting documents" description="Store contracts, invoices, proofs and report files in a dedicated document view." />
      <div className="two-column-layout">
        <section className="card panel">
          <div className="panel-heading"><div><p className="eyebrow">Document library</p><h2>{items.length} files</h2></div></div>
          {error && <div className="inline-alert error">{error}</div>}
          {loading ? <div className="loading-panel">Loading documents...</div> : items.length ? <div className="item-list">
            {items.map((item) => <div className="list-item" key={item.id}><div className="list-icon">D</div><div><strong>{item.documentName}</strong><span>{item.documentType} · {Math.max(1, Math.round((item.fileSize || 0) / 1024))} KB · {item.uploadedBy}</span></div><button className="btn-secondary" onClick={() => download(item)}>Download</button>{user.role !== "Staff" && <button className="btn-danger-light" onClick={() => remove(item.id)}>Delete</button>}</div>)}
          </div> : <EmptyState title="No documents uploaded" message="Add supporting files using the upload panel." action={<button onClick={() => document.querySelector(".file-field input")?.click()}>Choose file</button>} />}
        </section>
        <aside className="card panel form-panel">
          <p className="eyebrow">Upload file</p><h2>Add a document</h2>
          <form onSubmit={upload}>
            <label className="file-field"><input type="file" onChange={(event) => setForm({ ...form, file: event.target.files?.[0] })} /><strong>{form.file?.name || "Choose a file"}</strong><span>Any business document supported by your browser</span></label>
            <label className="field-group"><span>Document type</span><select value={form.documentType} onChange={(event) => setForm({ ...form, documentType: event.target.value })}><option>Report support</option><option>Invoice</option><option>Contract</option><option>Proof of delivery</option><option>Other</option></select></label>
            <label className="field-group"><span>Linked report</span><input value={form.linkedEntityId} onChange={(event) => setForm({ ...form, linkedEntityId: event.target.value })} placeholder="Optional report ID" /></label>
            <button disabled={!form.file || uploading}>{uploading ? "Uploading..." : "Upload document"}</button>
          </form>
        </aside>
      </div>
    </>
  );
}

export function NotificationsPage() {
  const { items, loading, error, reload } = useCollection("/notifications");
  const markRead = async (id) => { await api.patch(`/notifications/${id}/read`); reload(); };
  const markAll = async () => { await api.patch("/notifications/mark-all-read"); reload(); };
  const remove = async (id) => { await api.delete(`/notifications/${id}`); reload(); };
  const unread = items.filter((item) => !item.isRead).length;

  return (
    <>
      <PageHeading eyebrow="Inbox" title="Notifications" description="Review system updates, report events and pending work in one quiet place." actions={unread > 0 && <button className="btn-secondary" onClick={markAll}>Mark all read</button>} />
      {error && <div className="inline-alert error">{error}</div>}
      <section className="card panel notification-list">
        {loading ? <div className="loading-panel">Loading notifications...</div> : items.length ? items.map((item) => (
          <article className={item.isRead ? "" : "unread"} key={item.id}>
            <span className="notification-dot" />
            <div><strong>{item.title || item.type || "System notification"}</strong><p>{item.message || item.description || "An update is available."}</p><span>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}</span></div>
            {!item.isRead && <button className="btn-secondary" onClick={() => markRead(item.id)}>Mark read</button>}
            <button className="icon-button" onClick={() => remove(item.id)} aria-label="Delete notification">×</button>
          </article>
        )) : <EmptyState title="You are all caught up" message="New report and workflow notifications will appear here." />}
      </section>
    </>
  );
}

export function AdminPage({ versions, onRefreshVersions }) {
  const [tab, setTab] = useState("users");
  const users = useCollection("/users");
  const branches = useCollection("/branches");
  const departments = useCollection("/departments");
  const access = useCollection("/report-access");
  const integrations = useCollection("/api-integrations");
  const backups = useCollection("/backups");
  const validation = useCollection("/validation-logs");
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({});
  const [notice, setNotice] = useState("");

  useEffect(() => { api.get("/settings").then(({ data }) => setSettings(data)); }, []);

  const createUser = async (event) => {
    event.preventDefault();
    await api.post("/users", form);
    setForm({});
    setNotice("User created.");
    users.reload();
  };
  const toggleUser = async (item) => { await api.patch(`/users/${item.id}/${item.isActive === false ? "reactivate" : "deactivate"}`); users.reload(); };
  const versionAction = async (item, action) => { await api[action === "delete" ? "delete" : "patch"](`/report-versions/${item.reportId}/${action === "delete" ? "" : action}`.replace(/\/$/, "")); onRefreshVersions(); };
  const saveSettings = async () => { await api.patch("/settings", { settings }); setNotice("Settings saved."); };
  const restoreBackup = async (item) => {
    if (window.confirm(`Are you sure you want to restore backup ${item.backupId}? This will overwrite the current database!`)) {
      try {
        await api.post(`/backups/${item.backupId}/restore`);
        setNotice(`Database restored from recovery point ${item.backupId}.`);
      } catch (err) {
        setNotice(err.response?.data?.detail || "Could not restore backup.");
      }
    }
  };

  const tabs = [["users", "Users"], ["versions", "Report versions"], ["organization", "Organization"], ["access", "Access rules"], ["settings", "Settings"], ["integrations", "Integrations"], ["backups", "Backups"], ["validation", "Validation"]];
  return (
    <>
      <PageHeading eyebrow="Administration" title="System administration" description="Manage people, report versions, permissions, configuration and data health." />
      <div className="segmented-tabs admin-tabs">{tabs.map(([key, label]) => <button className={tab === key ? "active" : ""} key={key} onClick={() => { setTab(key); setForm({}); }}>{label}</button>)}</div>
      <Notice message={notice} onClose={() => setNotice("")} />

      {tab === "users" && <div className="two-column-layout wide-main">
        <section className="card panel"><div className="panel-heading"><div><p className="eyebrow">Accounts</p><h2>{users.items.length} users</h2></div></div><div className="item-list">{users.items.map((item) => <div className="list-item" key={item.id}><div className="avatar small">{item.name?.slice(0, 2).toUpperCase()}</div><div><strong>{item.name}</strong><span>{item.email} · {item.role}</span></div><StatusBadge value={item.isActive === false ? "Inactive" : "Active"} /><button className="btn-secondary" onClick={() => toggleUser(item)}>{item.isActive === false ? "Reactivate" : "Deactivate"}</button></div>)}</div></section>
        <aside className="card panel form-panel"><p className="eyebrow">New account</p><h2>Create user</h2><form onSubmit={createUser}><label className="field-group"><span>Name</span><input required value={form.name || ""} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label className="field-group"><span>Email</span><input required type="email" value={form.email || ""} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label className="field-group"><span>Temporary password</span><input required minLength="8" type="password" value={form.password || ""} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label><label className="field-group"><span>Role</span><select value={form.role || "Staff"} onChange={(event) => setForm({ ...form, role: event.target.value })}><option>Staff</option><option>Manager</option><option>Admin</option></select></label><button>Create user</button></form></aside>
      </div>}

      {tab === "versions" && <section className="card panel"><div className="panel-heading"><div><p className="eyebrow">Report versions</p><h2>{versions.length} versions</h2></div></div><div className="item-list">{versions.map((item) => <div className="list-item" key={item.reportId}><div className="list-icon">R</div><div><strong>{item.reportName || item.reportId}</strong><span>{item.reportId} · {item.period} · {item.totalRecords || 0} records</span></div><StatusBadge value={item.isArchived ? "Archived" : item.isActive ? "Active" : "Available"} /><button className="btn-secondary" onClick={() => versionAction(item, item.isArchived ? "restore" : "archive")}>{item.isArchived ? "Restore" : "Archive"}</button><button className="btn-danger-light" onClick={() => versionAction(item, "delete")}>Delete</button></div>)}</div></section>}

      {tab === "organization" && <div className="two-column-layout"><section className="card panel"><p className="eyebrow">Branches</p><h2>{branches.items.length} locations</h2><div className="item-list">{branches.items.map((item) => <div className="list-item" key={item.id}><div className="list-icon">B</div><div><strong>{item.name}</strong><span>{item.code} · {item.address}</span></div></div>)}</div></section><section className="card panel"><p className="eyebrow">Departments</p><h2>{departments.items.length} teams</h2><div className="item-list">{departments.items.map((item) => <div className="list-item" key={item.id}><div className="list-icon">D</div><div><strong>{item.name}</strong><span>{item.code} · {item.manager}</span></div></div>)}</div></section></div>}

      {tab === "access" && <section className="card panel"><div className="panel-heading"><div><p className="eyebrow">Report permissions</p><h2>{access.items.length} access rules</h2></div></div>{access.items.length ? <div className="item-list">{access.items.map((item) => <div className="list-item" key={item.id}><div className="list-icon">A</div><div><strong>{item.assignedTo}</strong><span>{item.assignedToType} access to {item.reportId}</span></div><button className="btn-danger-light" onClick={async () => { await api.delete(`/report-access/${item.id}`); access.reload(); }}>Revoke</button></div>)}</div> : <EmptyState title="No custom access rules" message="Administrators automatically retain access to all reports." />}</section>}

      {tab === "settings" && settings && <section className="card panel settings-panel"><p className="eyebrow">Global preferences</p><h2>Workspace settings</h2><div className="settings-grid"><label className="field-group"><span>Company name</span><input value={settings.company?.name || ""} onChange={(event) => setSettings({ ...settings, company: { ...settings.company, name: event.target.value } })} /></label><label className="field-group"><span>Currency</span><select value={settings.company?.currency || "INR"} onChange={(event) => setSettings({ ...settings, company: { ...settings.company, currency: event.target.value } })}><option>INR</option><option>USD</option><option>EUR</option></select></label><label className="field-group"><span>Timezone</span><input value={settings.company?.timezone || ""} onChange={(event) => setSettings({ ...settings, company: { ...settings.company, timezone: event.target.value } })} /></label><label className="field-group"><span>Default rows per page</span><input type="number" value={settings.reports?.defaultPageSize || 25} onChange={(event) => setSettings({ ...settings, reports: { ...settings.reports, defaultPageSize: Number(event.target.value) } })} /></label></div><button onClick={saveSettings}>Save settings</button></section>}

      {tab === "integrations" && <section className="card panel"><div className="panel-heading"><div><p className="eyebrow">External systems</p><h2>{integrations.items.length} integrations</h2></div></div>{integrations.items.length ? <div className="item-list">{integrations.items.map((item) => <div className="list-item" key={item.id}><div className="list-icon">I</div><div><strong>{item.name}</strong><span>{item.integrationType} · {item.baseUrl}</span></div><StatusBadge value={item.isActive ? "Active" : "Inactive"} /><button className="btn-secondary" onClick={async () => { const { data } = await api.post(`/api-integrations/${item.id}/test`); setNotice(data.message); }}>Test</button></div>)}</div> : <EmptyState title="No integrations configured" message="API connection records will appear here once configured." />}</section>}

      {tab === "backups" && <section className="card panel"><div className="panel-heading"><div><p className="eyebrow">Recovery points</p><h2>{backups.items.length} backups</h2></div><button onClick={async () => { await api.post("/backups/create"); backups.reload(); }}>Create backup</button></div>{backups.items.length ? <div className="item-list">{backups.items.map((item) => <div className="list-item" key={item.id}><div className="list-icon">B</div><div><strong>{item.backupName || item.backupId}</strong><span>{item.createdAt} · {item.status}</span></div><button className="btn-secondary" onClick={() => restoreBackup(item)}>Restore</button></div>)}</div> : <EmptyState title="No recovery points" message="Create a metadata backup before significant administrative changes." />}</section>}

      {tab === "validation" && <section className="card panel"><div className="panel-heading"><div><p className="eyebrow">Data quality</p><h2>{validation.items.length} validation runs</h2></div></div>{validation.items.length ? <div className="item-list">{validation.items.map((item) => <div className="list-item" key={item.id}><div className={`list-icon ${item.valid ? "success" : ""}`}>V</div><div><strong>{item.filename}</strong><span>{item.totalRows} rows · {item.duplicateJobNumbers} duplicate jobs · {(item.missingColumns || []).length} missing columns</span></div><StatusBadge value={item.valid ? "Valid" : "Needs attention"} /></div>)}</div> : <EmptyState title="No validation history" message="Validation results from the upload quality check will appear here." />}</section>}
    </>
  );
}

export function ActivityLogsPage() {
  const { items, loading, error } = useCollection("/activity-logs");
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => items.filter((item) => `${item.action} ${item.description} ${item.userEmail}`.toLowerCase().includes(search.toLowerCase())), [items, search]);
  return (
    <>
      <PageHeading eyebrow="Audit trail" title="Activity logs" description="Trace authentication, reporting, export and administrative events." />
      {error && <div className="inline-alert error">{error}</div>}
      <section className="card panel"><div className="table-toolbar"><div><strong>{filtered.length} events</strong><span>Newest activity first</span></div><input className="toolbar-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter logs..." /></div>{loading ? <div className="loading-panel">Loading activity...</div> : <div className="table-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Description</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td>{new Date(item.timestamp).toLocaleString()}</td><td>{item.userEmail || item.user?.email || "System"}</td><td><StatusBadge value={item.action} /></td><td>{item.description}</td></tr>)}{!filtered.length && <tr><td colSpan="4" className="table-empty">No matching log events.</td></tr>}</tbody></table></div>}</section>
      <p className="api-footnote">API endpoint: {API_BASE}</p>
    </>
  );
}
