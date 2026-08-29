import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

/**
 * Resolve API base URL from Expo config.
 * Prefer app.json → expo.extra.apiUrl, or EXPO_PUBLIC_API_URL at build time.
 * Never silently ship against the placeholder host in production builds.
 */
function resolveApiUrl() {
  const fromExtra =
    Constants.expoConfig?.extra?.apiUrl ||
    Constants.manifest?.extra?.apiUrl ||
    Constants.manifest2?.extra?.expoClient?.extra?.apiUrl;

  const fromEnv =
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_URL) ||
    undefined;

  const url = (fromEnv || fromExtra || '').replace(/\/$/, '');

  if (!url || url.includes('your-railway-app')) {
    if (__DEV__) {
      console.warn(
        '[api] Set expo.extra.apiUrl in app.json (or EXPO_PUBLIC_API_URL) to your backend URL. ' +
          'Using placeholder — requests will fail until configured.'
      );
    }
    // Still return a value so the client constructs; calls will 404/network-error
    return url || 'https://your-railway-app.up.railway.app';
  }
  return url;
}

export const API_URL = resolveApiUrl();

const API = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 15000
});

let refreshing = null;

async function refreshAccessToken() {
  const refreshToken = await SecureStore.getItemAsync('refreshToken');
  if (!refreshToken) throw new Error('No refresh token');

  const { data } = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken });
  const access = data.accessToken || data.token;
  await SecureStore.setItemAsync('userToken', access);
  if (data.refreshToken) {
    await SecureStore.setItemAsync('refreshToken', data.refreshToken);
  }
  return access;
}

async function clearSession() {
  await SecureStore.deleteItemAsync('userToken');
  await SecureStore.deleteItemAsync('refreshToken');
  await SecureStore.deleteItemAsync('userId');
  await SecureStore.deleteItemAsync('userRole');
}

API.interceptors.request.use(
  async (config) => {
    const token = await SecureStore.getItemAsync('userToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

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
        await clearSession();
      }
    }
    return Promise.reject(error);
  }
);

export { clearSession, refreshAccessToken };
export default API;
