import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import ThemeToggle from "./ThemeToggle";

const icons = {
  overview: "M3 12 12 3l9 9v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  analytics: "M4 19V9m6 10V5m6 14v-7m5 7H3",
  reports: "M6 3h9l5 5v13H6zM14 3v6h6M9 13h8M9 17h8",
  upload: "M12 16V4m0 0L7 9m5-5 5 5M5 20h14",
  templates: "M5 3h14v18H5zM8 7h8M8 11h8M8 15h5",
  schedules: "M4 5h16v16H4zM8 3v4m8-4v4M4 10h16m-8 3v4l3 2",
  operations: "M4 7h16M7 3v4m10-4v4M5 11h6v9H5zm10 0h4v4h-4zm0 7h4v2h-4z",
  documents: "M6 3h9l5 5v13H6zM14 3v6h6M9 13h6M9 17h6",
  notifications: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-1.6 4.3a8.9 8.9 0 0 1-1.6-.9l-1.3.8a1 1 0 0 1-1.2-.2l-.8-.8a1 1 0 0 1-.2-1.2l.8-1.3a8.9 8.9 0 0 1-.9-1.6l-1.5-.2a1 1 0 0 1-.8-.9v-1.1a1 1 0 0 1 .8-.9l1.5-.2a8.9 8.9 0 0 1 .9-1.6l-.8-1.3a1 1 0 0 1 .2-1.2l.8-.8a1 1 0 0 1 1.2-.2l1.3.8c.5-.3 1-.6 1.6-.9l.2-1.5a1 1 0 0 1 .9-.8h1.1a1 1 0 0 1 .9.8l.2 1.5c.5.3 1 .6 1.6.9l1.3-.8a1 1 0 0 1 1.2.2l.8.8a1 1 0 0 1 .2 1.2l-.8 1.3c.3.5.6 1 .9 1.6l1.5.2a1 1 0 0 1 .8.9v1.1a1 1 0 0 1-.8.9l-1.5.2a8.9 8.9 0 0 1-.9 1.6l.8 1.3a1 1 0 0 1-.2 1.2l-.8.8a1 1 0 0 1-1.2.2l-1.3-.8a8.9 8.9 0 0 1-1.6.9l-.2 1.5a1 1 0 0 1-.9.8h-1.1a1 1 0 0 1-.9-.8z",
  admin: "M12 3l8 4v5c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V7zM9 12l2 2 4-5",
  logs: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
};

function Icon({ name, size = 19 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={icons[name] || icons.overview} />
    </svg>
  );
}

const navGroups = [
  {
    label: "Workspace",
    items: [
      ["overview", "Overview"],
      ["analytics", "Data analysis"],
      ["reports", "Reports"],
    ],
  },
  {
    label: "Workflow",
    items: [
      ["upload", "Upload report", ["Admin"]],
      ["templates", "Templates"],
      ["schedules", "Schedules", ["Admin", "Manager"]],
      ["operations", "Operations"],
      ["documents", "Documents"],
    ],
  },
  {
    label: "System",
    items: [
      ["notifications", "Notifications"],
      ["settings", "Settings"],
      ["admin", "Administration", ["Admin"]],
      ["logs", "Activity logs", ["Admin"]],
    ],
  },
];

function resultLabel(item) {
  return item.reportName || item.jobNo || item.name || item.invoiceNo || item.documentName || item.approvalId || item.code || item.email || "Record";
}

export default function AppShell({
  children,
  user,
  activeView,
  onNavigate,
  versions,
  selectedReportId,
  onReportChange,
  onLogout,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [searching, setSearching] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    api.get("/notifications/unread-count")
      .then(({ data }) => setUnreadCount(data.count || 0))
      .catch(() => setUnreadCount(0));
  }, [activeView]);

  useEffect(() => {
    if (search.trim().length < 2) {
      setSearchResult(null);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await api.get("/global-search", { params: { query: search.trim() } });
        setSearchResult(data);
      } catch {
        setSearchResult({ totalResults: 0, results: {} });
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const currentTitle = useMemo(() => {
    for (const group of navGroups) {
      const item = group.items.find(([key]) => key === activeView);
      if (item) return item[1];
    }
    return "Workspace";
  }, [activeView]);

  const navigate = (view) => {
    onNavigate(view);
    setMobileOpen(false);
  };

  return (
    <div className="app-shell">
      {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">SL</div>
          <div>
            <strong>Smart Logistics</strong>
            <span>Operations intelligence</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {navGroups.map((group) => {
            const visible = group.items.filter(([, , roles]) => !roles || roles.includes(user.role));
            if (!visible.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <p>{group.label}</p>
                {visible.map(([key, label]) => (
                  <button key={key} className={activeView === key ? "active" : ""} onClick={() => navigate(key)}>
                    <Icon name={key} />
                    <span>{label}</span>
                    {key === "notifications" && unreadCount > 0 && <b className="nav-count">{unreadCount}</b>}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-user">
          <div className="avatar">{(user.name || user.email).slice(0, 2).toUpperCase()}</div>
          <div>
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </div>
          <button className="signout-button" onClick={onLogout} title="Sign out" aria-label="Sign out">↪</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation">☰</button>
          <div className="topbar-title">
            <span>Workspace</span>
            <strong>{currentTitle}</strong>
          </div>

          <div className="global-search">
            <span className="search-icon">⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reports, jobs, clients..." aria-label="Global search" />
            {search && <button onClick={() => { setSearch(""); setSearchResult(null); }} aria-label="Clear search">×</button>}
            {(searchResult || searching) && (
              <div className="search-results">
                <div className="search-results-heading">
                  <strong>{searching ? "Searching..." : `${searchResult?.totalResults || 0} results`}</strong>
                  <span>Global search</span>
                </div>
                {!searching && Object.entries(searchResult?.results || {}).map(([module, items]) => items.length > 0 && (
                  <div className="search-result-group" key={module}>
                    <p>{module}</p>
                    {items.map((item) => (
                      <button key={item.id || resultLabel(item)} onClick={() => { navigate(module === "reports" ? "reports" : module === "documents" ? "documents" : "operations"); setSearch(""); setSearchResult(null); }}>
                        <strong>{resultLabel(item)}</strong>
                        <span>{item.status || item.period || item.email || item.documentType || ""}</span>
                      </button>
                    ))}
                  </div>
                ))}
                {!searching && !searchResult?.totalResults && <p className="empty-search">No matching records found.</p>}
              </div>
            )}
          </div>

          <select className="version-select" value={selectedReportId} onChange={(event) => onReportChange(event.target.value)} aria-label="Selected report version">
            <option value="">No report selected</option>
            {versions.filter((version) => !version.isArchived).map((version) => (
              <option key={version.reportId} value={version.reportId}>{version.reportName || version.reportId}</option>
            ))}
          </select>

          <button className="notification-button" onClick={() => navigate("notifications")} aria-label="Notifications">
            <Icon name="notifications" />
            {unreadCount > 0 && <span>{unreadCount > 9 ? "9+" : unreadCount}</span>}
          </button>

          <ThemeToggle />
        </header>

        <main className="page-content">{children}</main>
      </section>
    </div>
  );
}

export { Icon };
