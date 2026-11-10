import api from './api';
import { normalizeMobile } from '../utils/phone';

export interface LoginPayload {
  shopCode: string;
  mobile: string;
  password: string;
  deviceInfo?: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string;
    branch: { id: string; name: string; code: string };
    branches: Array<{
      id: string;
      name: string;
      code: string;
      isDefault: boolean;
    }>;
    permissions: string[];
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    currencyCode: string;
    countryCode: string;
    businessTypeId?: string | null;
    businessTypeCode?: string | null;
    businessTypeName?: string | null;
  };
}

export async function login(payload: LoginPayload): Promise<LoginResponse> {
  const mobile = normalizeMobile(payload.mobile);
  if (!mobile) {
    throw { response: { data: { error: { message: 'Enter a valid 10-digit mobile number' } } } };
  }

  const { data } = await api.post('/auth/login', {
    shopCode: payload.shopCode.trim().toLowerCase(),
    mobile,
    password: payload.password,
    deviceInfo: payload.deviceInfo,
  });

  if (!data?.success || !data?.data) {
    throw { response: { data: { error: { message: data?.error?.message || 'Login failed' } } } };
  }

  return data.data;
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
  const { data } = await api.post('/auth/refresh', { refreshToken });
  if (!data?.success || !data?.data?.accessToken) {
    throw { response: { data: { error: { message: 'Session expired. Please sign in again.' } } } };
  }
  return data.data;
}

export async function logout(refreshToken: string): Promise<void> {
  await api.post('/auth/logout', { refreshToken });
}

export async function fetchMe(): Promise<{
  auth: unknown;
  tenant: LoginResponse['tenant'];
}> {
  const { data } = await api.get('/auth/me');
  return data.data;
}
