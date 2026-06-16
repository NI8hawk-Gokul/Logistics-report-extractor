/**
 * ForecastChart – displays 30‑day billing forecast using Recharts LineChart.
 */
import React, { useEffect, useState } from "react";
import api from "../services/api";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const ForecastChart = ({ reportId }) => {
  const [data, setData] = useState([]);

  useEffect(() => {
    const fetchForecast = async () => {
      try {
        const { data: resp } = await api.get("/forecast", { params: { reportId } });
        // Expect resp.forecast = [{ ds, yhat }]
        const formatted = resp.forecast.map(item => ({ date: item.ds.split("T")[0], forecast: Math.round(item.yhat) }));
        setData(formatted);
      } catch (e) {
        console.error("Forecast fetch error", e);
      }
    };
    fetchForecast();
  }, [reportId]);

  if (!data.length) return <div>Loading forecast...</div>;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Line type="monotone" dataKey="forecast" stroke="#3b82f6" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default ForecastChart;
