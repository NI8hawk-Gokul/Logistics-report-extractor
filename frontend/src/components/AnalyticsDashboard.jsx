import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = ["#4656e8", "#178a63", "#c77c13", "#c53f4c", "#7857c7"];
const tooltipStyle = {
  borderRadius: "9px",
  border: "1px solid #dfe5ef",
  boxShadow: "0 8px 25px rgba(20,33,61,.08)",
};

const formatMoney = (value) => `INR ${Number(value || 0).toLocaleString("en-IN")}`;
const formatNumber = (value) => Number(value || 0).toLocaleString();

const isFinancialField = (field) => {
  if (!field) return false;
  const lf = field.toLowerCase();
  return lf.includes("profit") || lf.includes("billing") || lf.includes("expense") || 
         lf.includes("salary") || lf.includes("duty") || lf.includes("cost") || lf.includes("amount");
};

function ChartCard({ title, children }) {
  return (
    <section className="card padding">
      <h3 style={{ marginBottom: "16px", fontWeight: "600", fontSize: "14px" }}>{title}</h3>
      {children}
    </section>
  );
}

function AnalyticsDashboard({ data, role, department = "Operations" }) {
  const isStaff = role === "Staff";
  if (!data) return <div className="card loading-panel">No analytics data is available.</div>;

  const titles = {
    "Operations": {
      status: "Job Status Distribution",
      agent: "Profit by Agent",
      client: "Billing by Client",
      trend: "Monthly Profit Trend",
      expenseProfit: "Expense and Profit"
    },
    "Transportation / Fleet": {
      status: "Delivery Status Distribution",
      agent: "Driver Margin (Fuel vs Maintenance)",
      client: "Driver Route Assignments",
      trend: "Monthly Performance Trend",
      expenseProfit: "Maintenance Cost vs Fuel Used"
    },
    "Warehouse": {
      status: "Damage Status Distribution",
      agent: "Stock Balance by Location",
      client: "Quantity by SKU",
      trend: "Intake Trend",
      expenseProfit: "Quantity vs Stock Balance"
    },
    "Air Freight": {
      status: "Shipment Status Distribution",
      agent: "Cargo Weight by Airline",
      client: "Freight Cost by Flight",
      trend: "Cargo Weight Trend",
      expenseProfit: "Freight Cost vs Cargo Weight"
    },
    "Customs Clearance": {
      status: "Clearance Status Distribution",
      agent: "Duty Amount by Agent",
      client: "Duty Amount by Importer/Exporter",
      trend: "Clearance Trend",
      expenseProfit: "Duty Amount"
    },
    "Documentation": {
      status: "Document Status Distribution",
      agent: "Verification Count by Auditor",
      client: "Documents by Client",
      trend: "Issue Date Trend",
      expenseProfit: "Documents Volume"
    },
    "Sales & Marketing": {
      status: "Lead Status Distribution",
      agent: "Quotation Amount by Executive",
      client: "Quotation Amount by Lead Client",
      trend: "Sales Pipeline Trend",
      expenseProfit: "Quotation Amount"
    },
    "HR": {
      status: "Attendance Distribution",
      agent: "Salary Expense by Employee",
      client: "Leave Days by Designation",
      trend: "Joining Trend",
      expenseProfit: "Salary vs Leave Days"
    },
    "IT / Software": {
      status: "Error Type Distribution",
      agent: "Activity Logs by User",
      client: "Actions by Module",
      trend: "Login Volume Trend",
      expenseProfit: "Logs Volume"
    },
    "Compliance / Audit": {
      status: "Risk Level Distribution",
      agent: "Audit Count by Auditor",
      client: "Issues Found by Department",
      trend: "Audit Trend",
      expenseProfit: "Audits Checked"
    },
    "Management / Admin": {
      status: "KPI Target Statuses",
      agent: "P&L Amount by Branch",
      client: "KPI Metrics by Department",
      trend: "P&L Performance Trend",
      expenseProfit: "P&L vs Pending Approvals"
    }
  };

  const t = titles[department] || titles["Operations"];
  
  const getTooltipFormatter = (field) => {
    return isFinancialField(field) ? formatMoney : formatNumber;
  };

  return (
    <div className="analytics-dashboard">
      <div className="charts-grid">
        <ChartCard title={t.status}>
          <ResponsiveContainer width="100%" height={270}>
            <PieChart>
              <Pie data={data.jobStatus || []} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={88} innerRadius={45} paddingAngle={2}>
                {(data.jobStatus || []).map((entry, index) => <Cell key={`${entry.status}-${index}`} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={formatNumber} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {!isStaff && (
          <>
            <ChartCard title={t.agent}>
              <ResponsiveContainer width="100%" height={270}>
                <BarChart data={data.profitByAgent || []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ecf3" />
                  <XAxis dataKey="agentName" axisLine={false} tickLine={false} fontSize={11} />
                  <YAxis axisLine={false} tickLine={false} fontSize={11} />
                  <Tooltip formatter={getTooltipFormatter(t.agent)} contentStyle={tooltipStyle} />
                  <Bar dataKey="totalProfit" fill="#4656e8" radius={[5, 5, 0, 0]} name={department === "HR" ? "Salary" : "Profit"} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={t.client}>
              <ResponsiveContainer width="100%" height={270}>
                <BarChart data={data.billingByClient || []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ecf3" />
                  <XAxis dataKey="clientName" axisLine={false} tickLine={false} fontSize={11} />
                  <YAxis axisLine={false} tickLine={false} fontSize={11} />
                  <Tooltip formatter={getTooltipFormatter(t.client)} contentStyle={tooltipStyle} />
                  <Bar dataKey="totalBilling" fill="#178a63" radius={[5, 5, 0, 0]} name="Billing" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={t.trend}>
              <ResponsiveContainer width="100%" height={270}>
                <LineChart data={data.monthlyProfit || []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ecf3" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={11} />
                  <YAxis axisLine={false} tickLine={false} fontSize={11} />
                  <Tooltip formatter={getTooltipFormatter(t.trend)} contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="profit" stroke="#4656e8" strokeWidth={3} name={department === "HR" ? "Salary" : "Profit"} dot={{ r: 3 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={t.expenseProfit}>
              <ResponsiveContainer width="100%" height={270}>
                <BarChart data={data.expenseVsProfit || []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ecf3" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={11} />
                  <YAxis axisLine={false} tickLine={false} fontSize={11} />
                  <Tooltip formatter={getTooltipFormatter(t.expenseProfit)} contentStyle={tooltipStyle} />
                  <Bar dataKey="value" radius={[5, 5, 0, 0]} name="Amount">
                    {(data.expenseVsProfit || []).map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={entry.name === "Expense" ? "#c53f4c" : "#178a63"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </>
        )}
      </div>
    </div>
  );
}

export default AnalyticsDashboard;
