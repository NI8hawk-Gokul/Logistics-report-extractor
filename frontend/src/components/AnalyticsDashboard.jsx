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

function ChartCard({ title, children }) {
  return (
    <section className="card padding">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function AnalyticsDashboard({ data, role }) {
  const isStaff = role === "Staff";
  if (!data) return <div className="card loading-panel">No analytics data is available.</div>;

  return (
    <div className="analytics-dashboard">
      <div className="charts-grid">
        <ChartCard title="Job status distribution">
          <ResponsiveContainer width="100%" height={270}>
            <PieChart>
              <Pie data={data.jobStatus || []} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={88} innerRadius={45} paddingAngle={2}>
                {(data.jobStatus || []).map((entry, index) => <Cell key={`${entry.status}-${index}`} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {!isStaff && (
          <>
            <ChartCard title="Profit by agent">
              <ResponsiveContainer width="100%" height={270}>
                <BarChart data={data.profitByAgent || []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ecf3" />
                  <XAxis dataKey="agentName" axisLine={false} tickLine={false} fontSize={11} />
                  <YAxis axisLine={false} tickLine={false} fontSize={11} />
                  <Tooltip formatter={formatMoney} contentStyle={tooltipStyle} />
                  <Bar dataKey="totalProfit" fill="#4656e8" radius={[5, 5, 0, 0]} name="Profit" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Billing by client">
              <ResponsiveContainer width="100%" height={270}>
                <BarChart data={data.billingByClient || []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ecf3" />
                  <XAxis dataKey="clientName" axisLine={false} tickLine={false} fontSize={11} />
                  <YAxis axisLine={false} tickLine={false} fontSize={11} />
                  <Tooltip formatter={formatMoney} contentStyle={tooltipStyle} />
                  <Bar dataKey="totalBilling" fill="#178a63" radius={[5, 5, 0, 0]} name="Billing" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Monthly profit trend">
              <ResponsiveContainer width="100%" height={270}>
                <LineChart data={data.monthlyProfit || []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ecf3" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={11} />
                  <YAxis axisLine={false} tickLine={false} fontSize={11} />
                  <Tooltip formatter={formatMoney} contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="profit" stroke="#4656e8" strokeWidth={3} name="Profit" dot={{ r: 3 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Expense and profit">
              <ResponsiveContainer width="100%" height={270}>
                <BarChart data={data.expenseVsProfit || []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ecf3" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={11} />
                  <YAxis axisLine={false} tickLine={false} fontSize={11} />
                  <Tooltip formatter={formatMoney} contentStyle={tooltipStyle} />
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
