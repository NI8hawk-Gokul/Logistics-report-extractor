import axios from "axios";

const developmentPorts = new Set(["5173", "5174", "5175"]);
const defaultApiBase = developmentPorts.has(window.location.port)
  ? `${window.location.protocol}//${window.location.hostname}:8080`
  : window.location.origin;

export const API_BASE = import.meta.env.VITE_API_BASE || defaultApiBase;

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

// Request interceptor to attach the JWT token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers["Authorization"] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default api;
