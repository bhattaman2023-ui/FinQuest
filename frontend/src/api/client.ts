// Shared API client for FINQUEST frontend
// All requests go through Express (/api/*) — React never calls FastAPI directly.

import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT from localStorage if present (fallback if httpOnly cookie isn't available)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('fq_token');
  if (token && !config.headers['Authorization']) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 → redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('fq_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
