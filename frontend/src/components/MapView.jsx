import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import api from "../services/api";

const BRANCH_COORDS = {
  chennai: [13.0827, 80.2707],
  mumbai: [19.0760, 72.8777],
  bangalore: [12.9716, 77.5946],
  bengaluru: [12.9716, 77.5946],
  delhi: [28.7041, 77.1025],
  kolkata: [22.5726, 88.3639],
};

const MapView = ({ reportId }) => {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersGroupRef = useRef(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initialize map if it doesn't exist
    if (!mapInstanceRef.current && mapContainerRef.current) {
      const map = L.map(mapContainerRef.current).setView([20.5937, 78.9629], 5); // Center on India
      
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

      mapInstanceRef.current = map;
      markersGroupRef.current = L.layerGroup().addTo(map);
    }

    // Clean up on unmount
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!reportId || !mapInstanceRef.current) return;

    const fetchMapData = async () => {
      setLoading(true);
      try {
        const { data: resp } = await api.post("/filter-report", { reportId });
        const records = resp.data || [];

        // Clear existing markers and lines
        if (markersGroupRef.current) {
          markersGroupRef.current.clearLayers();
        }

        // Aggregate stats by branch
        const branchStats = {};
        records.forEach((record) => {
          const rawBranch = String(record.branch || "").toLowerCase().trim();
          let matchedKey = "chennai"; // Default fallback
          for (const key of Object.keys(BRANCH_COORDS)) {
            if (rawBranch.includes(key)) {
              matchedKey = key;
              break;
            }
          }

          if (!branchStats[matchedKey]) {
            branchStats[matchedKey] = {
              name: record.branch || "Chennai",
              jobsCount: 0,
              pendingJobs: 0,
              completedJobs: 0,
              billing: 0,
              profit: 0,
            };
          }

          const stats = branchStats[matchedKey];
          stats.jobsCount += 1;
          if (String(record.status).toLowerCase() === "pending") {
            stats.pendingJobs += 1;
          } else if (String(record.status).toLowerCase() === "completed") {
            stats.completedJobs += 1;
          }
          stats.billing += Number(record.billingAmount || 0);
          stats.profit += Number(record.profit || 0);
        });

        const activeCoords = [];

        // Add markers for branches that have jobs
        Object.entries(branchStats).forEach(([key, stats]) => {
          const coords = BRANCH_COORDS[key];
          if (!coords) return;

          activeCoords.push(coords);

          const popupContent = `
            <div style="font-family: sans-serif; font-size: 13px; min-width: 180px; color: #1e293b;">
              <strong style="font-size: 14px; color: #4f46e5; display: block; margin-bottom: 4px;">${stats.name}</strong>
              <hr style="margin: 6px 0; border: none; border-top: 1px solid #e2e8f0;" />
              <div style="margin-bottom: 2px;"><strong>Jobs:</strong> ${stats.jobsCount} (${stats.pendingJobs} pending, ${stats.completedJobs} comp.)</div>
              <div style="margin-bottom: 2px;"><strong>Billing:</strong> ₹${stats.billing.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
              <div><strong>Profit:</strong> ₹${stats.profit.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
            </div>
          `;

          L.marker(coords)
            .bindPopup(popupContent)
            .addTo(markersGroupRef.current);
        });

        // Draw connecting routes from Chennai central hub to other active branches
        if (activeCoords.length > 1) {
          const primaryCoords = BRANCH_COORDS.chennai;
          activeCoords.forEach((coords) => {
            if (coords !== primaryCoords) {
              L.polyline([primaryCoords, coords], {
                color: "#4f46e5",
                weight: 2,
                dashArray: "5, 10",
                opacity: 0.7,
              }).addTo(markersGroupRef.current);
            }
          });
        }

        // Fit map bounds to active markers if any exist
        if (activeCoords.length > 0) {
          const bounds = L.latLngBounds(activeCoords);
          mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
        }
      } catch (e) {
        console.error("Map data fetch error", e);
      } finally {
        setLoading(false);
      }
    };

    fetchMapData();
  }, [reportId]);

  return (
    <div style={{ position: "relative", width: "100%", height: "400px" }}>
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1000,
            background: "rgba(255, 255, 255, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          className="dark:bg-slate-900/70"
        >
          <span className="font-semibold text-indigo-600 dark:text-indigo-400">Loading map data...</span>
        </div>
      )}
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%", borderRadius: "8px", border: "1px solid #e2e8f0" }} />
    </div>
  );
};

export default MapView;
