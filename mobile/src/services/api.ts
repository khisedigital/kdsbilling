import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { getApiBaseUrl, getCachedApiUrl } from '../config/api';
import { APP_DISPLAY_NAME } from '../constants/branding';

const api = axios.create({
  baseURL: getCachedApiUrl(),
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

function getAuthStore() {
  // Lazy require avoids circular dependency with authStore -> api
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../store/authStore').useAuthStore as typeof import('../store/authStore').useAuthStore;
}

function attachAuthHeader(config: InternalAxiosRequestConfig, token: string | null) {
  if (!token) return config;
  config.headers.set('Authorization', `Bearer ${token}`);
  return config;
}

api.interceptors.request.use(async (config) => {
  config.baseURL = await getApiBaseUrl();
  const token = getAuthStore().getState().accessToken;
  return attachAuthHeader(config, token);
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const store = getAuthStore();
  const { refreshToken } = store.getState();
  if (!refreshToken) return null;

  const baseURL = await getApiBaseUrl();
  const { data } = await axios.post(
    `${baseURL}/auth/refresh`,
    { refreshToken },
    { headers: { 'Content-Type': 'application/json' }, timeout: 15000 },
  );

  const newToken = data?.data?.accessToken as string | undefined;
  if (!newToken) return null;

  store.setState({ accessToken: newToken });
  return newToken;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (!error.response) {
      error.message =
        `Cannot connect to the ${APP_DISPLAY_NAME} server. Check your internet connection and try again.`;
      return Promise.reject(error);
    }

    const status = error.response.status;
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    if (
      status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      originalRequest.url?.includes('/auth/login') ||
      originalRequest.url?.includes('/auth/refresh')
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }

      const newToken = await refreshPromise;
      if (!newToken) {
        await getAuthStore().getState().logout();
        return Promise.reject(error);
      }

      attachAuthHeader(originalRequest, newToken);
      return api(originalRequest);
    } catch (refreshError) {
      await getAuthStore().getState().logout();
      return Promise.reject(refreshError);
    }
  },
);

export async function initApiClient(): Promise<void> {
  const url = await getApiBaseUrl();
  api.defaults.baseURL = url;
  const token = getAuthStore().getState().accessToken;
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  }
}

export function setAuthToken(token: string | null) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

export default api;
