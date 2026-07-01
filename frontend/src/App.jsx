import { useEffect, useState } from "react";
import "./App.css";
import api, { API_BASE } from "./services/api";
import AppShell from "./components/AppShell";
import AIChatDrawer from "./components/AIChatDrawer";
import Settings from "./components/Settings";
import { AnalyticsPage, OverviewPage, ReportsPage, UploadPage } from "./pages/CorePages";
import ClientAnalytics from "./pages/ClientAnalytics";
import PredictionAnalysis from "./pages/PredictionAnalysis";
import VersionComparison from "./pages/VersionComparison";
import {
  ActivityLogsPage,
  AdminPage,
  DocumentsPage,
  NotificationsPage,
  OperationsPage,
  SchedulesPage,
  TemplatesPage,
} from "./pages/ManagementPages";

const views = {
  overview: OverviewPage,
  analytics: AnalyticsPage,
  clientAnalytics: ClientAnalytics,
  predictionAnalysis: PredictionAnalysis,
  reports: ReportsPage,
  versionComparison: VersionComparison,
  upload: UploadPage,
  templates: TemplatesPage,
  schedules: SchedulesPage,
  operations: OperationsPage,
  documents: DocumentsPage,
  notifications: NotificationsPage,
  admin: AdminPage,
  logs: ActivityLogsPage,
  settings: Settings,
};

const roleViews = {
  Admin: Object.keys(views),
  Manager: ["overview", "analytics", "clientAnalytics", "predictionAnalysis", "reports", "versionComparison", "templates", "schedules", "operations", "documents", "notifications", "settings"],
  Staff: ["overview", "analytics", "clientAnalytics", "predictionAnalysis", "reports", "templates", "operations", "documents", "notifications", "settings"],
};


function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("admin@logistics.com");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [apiOffline, setApiOffline] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setApiOffline(false);
    try {
      const { data } = await api.post("/login", { email: email.trim(), password });
      localStorage.setItem("token", data.access_token);
      localStorage.setItem("user", JSON.stringify(data.user));
      onLogin(data.user);
    } catch (requestError) {
      const unreachable = !requestError.response;
      setApiOffline(unreachable);
      setError(unreachable
        ? `The API is not reachable at ${API_BASE}. Start the backend service and try again.`
        : requestError.response?.data?.detail || "The email or password is incorrect.");
    } finally {
      setLoading(false);
    }
  };

  const selectDemoAccount = (role) => {
    const accounts = {
      Admin: ["admin@logistics.com", "admin123"],
      Manager: ["manager@logistics.com", "manager123"],
      Staff: ["staff@logistics.com", "staff123"],
    };
    setEmail(accounts[role][0]);
    setPassword(accounts[role][1]);
    setError("");
  };

  return (
    <div className="login-page">
      <section className="login-story">
        <div className="login-brand"><span>SL</span><strong>Smart Logistics</strong></div>
        <div className="login-copy">
          <p className="eyebrow">Operations intelligence</p>
          <h1>Turn logistics reports into clear daily decisions.</h1>
          <p>Upload, validate, analyse and share operational data from one focused workspace.</p>
          <div className="login-features">
            <div><span>01</span><strong>Focused analysis</strong><p>Charts and AI insights live in a dedicated view.</p></div>
            <div><span>02</span><strong>Controlled reporting</strong><p>Role-aware filters, exports and version access.</p></div>
            <div><span>03</span><strong>Operational clarity</strong><p>Jobs, clients, payments and documents stay organized.</p></div>
          </div>
        </div>
        <p className="login-footer">Secure internal operations workspace</p>
      </section>

      <section className="login-form-side">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-login-brand"><span>SL</span><strong>Smart Logistics</strong></div>
          <p className="eyebrow">Welcome back</p>
          <h2>Sign in to your workspace</h2>
          <p className="login-intro">Use your organization account to continue.</p>

          {error && (
            <div className={`login-error ${apiOffline ? "offline" : ""}`}>
              <strong>{apiOffline ? "API connection unavailable" : "Sign in failed"}</strong>
              <span>{error}</span>
            </div>
          )}

          <label className="field-group">
            <span>Email address</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
          </label>
          <label className="field-group">
            <span>Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          </label>
          <button className="login-submit" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button>

          <div className="demo-accounts">
            <span>Demo accounts</span>
            <div>{Object.keys(roleViews).map((role) => <button type="button" onClick={() => selectDemoAccount(role)} key={role}>{role}</button>)}</div>
          </div>
          <p className="api-address">API: {API_BASE}</p>
        </form>
      </section>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("user")); } catch { return null; }
  });
  const [versions, setVersions] = useState([]);
  const [dbMode, setDbMode] = useState("mongodb");
  const [selectedReportId, setSelectedReportId] = useState(localStorage.getItem("selectedReportId") || "");
  const [activeView, setActiveView] = useState(() => window.location.hash.replace("#/", "") || "overview");
  const [loadingSession, setLoadingSession] = useState(Boolean(localStorage.getItem("token")));

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("selectedReportId");
    setUser(null);
    setVersions([]);
    setSelectedReportId("");
  };

  const refreshVersions = async (preferredId = "") => {
    try {
      const { data } = await api.get("/report-versions");
      setVersions(data);
      const available = data.filter((item) => !item.isArchived);
      const next = preferredId && available.some((item) => item.reportId === preferredId)
        ? preferredId
        : available.some((item) => item.reportId === selectedReportId)
          ? selectedReportId
          : (available.find((item) => item.isActive) || available[0])?.reportId || "";
      setSelectedReportId(next);
      if (next) localStorage.setItem("selectedReportId", next);
    } catch (error) {
      if (error.response?.status === 401 || error.response?.status === 403) logout();
    }
  };

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      setLoadingSession(false);
      return;
    }
    api.get("/me")
      .then(({ data }) => {
        setUser(data);
        localStorage.setItem("user", JSON.stringify(data));
      })
      .catch(logout)
      .finally(() => setLoadingSession(false));
  }, []);

  useEffect(() => {
    api.get("/health")
      .then(({ data }) => setDbMode(data.database || "mongodb"))
      .catch(() => setDbMode("mongodb"));
  }, []);

  useEffect(() => {
    if (user) refreshVersions();
  }, [user]);

  useEffect(() => {
    const sync = () => setActiveView(window.location.hash.replace("#/", "") || "overview");
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (!user) return;
    const allowed = roleViews[user.role] || roleViews.Staff;
    if (!allowed.includes(activeView)) {
      navigate("overview");
      return;
    }
    if (activeView === "clientAnalytics" && selectedReportId) {
      const activeVer = versions.find((v) => v.reportId === selectedReportId);
      if (activeVer && activeVer.department && !["Operations", "Customs Clearance", "Documentation", "Sales & Marketing"].includes(activeVer.department)) {
        navigate("overview");
      }
    }
  }, [activeView, user, selectedReportId, versions]);

  const navigate = (view) => {
    window.location.hash = `/${view}`;
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const changeReport = (reportId) => {
    setSelectedReportId(reportId);
    if (reportId) localStorage.setItem("selectedReportId", reportId);
    else localStorage.removeItem("selectedReportId");
  };

  const handleUploaded = async (reportId) => {
    await refreshVersions(reportId || selectedReportId);
    if (!reportId) navigate("reports");
  };

  if (loadingSession) return <div className="app-loading"><span>SL</span><p>Opening your workspace...</p></div>;
  if (!user) return <LoginScreen onLogin={setUser} />;

  const ActivePage = views[activeView] || OverviewPage;
  const sharedProps = {
    user,
    reportId: selectedReportId,
    versions,
    onNavigate: navigate,
    onRefreshVersions: refreshVersions,
    onUploaded: handleUploaded,
    dbMode,
  };

  return (
    <AppShell
      user={user}
      activeView={activeView}
      onNavigate={navigate}
      versions={versions}
      selectedReportId={selectedReportId}
      onReportChange={changeReport}
      onLogout={logout}
      dbMode={dbMode}
    >
      <ActivePage {...sharedProps} />
      <AIChatDrawer reportId={selectedReportId} />
    </AppShell>
  );
}

export default App;
