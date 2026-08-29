import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');

const API = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 15000
});

let refreshing = null;

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('adminRefreshToken');
  if (!refreshToken) throw new Error('No refresh token');

  // Use bare axios to avoid interceptor recursion
  const { data } = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken });
  const access = data.accessToken || data.token;
  localStorage.setItem('adminToken', access);
  if (data.refreshToken) {
    localStorage.setItem('adminRefreshToken', data.refreshToken);
  }
  return access;
}

function clearAdminSession() {
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminRefreshToken');
  localStorage.removeItem('adminUser');
}

API.interceptors.request.use((config) => {
  const token = localStorage.getItem('adminToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

API.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      try {
        if (!refreshing) {
          refreshing = refreshAccessToken().finally(() => {
            refreshing = null;
          });
        }
        const access = await refreshing;
        original.headers.Authorization = `Bearer ${access}`;
        return API(original);
      } catch (_) {
        clearAdminSession();
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

export { clearAdminSession, refreshAccessToken };
export default API;
