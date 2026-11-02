import api from './api';
import { normalizeMobile } from '../utils/phone';

export interface Profile {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
}

export async function getProfile(): Promise<Profile> {
  const { data } = await api.get('/auth/profile');
  return data.data;
}

export async function updateProfile(payload: { name: string; phone: string }): Promise<Profile> {
  const phone = normalizeMobile(payload.phone);
  if (!phone) {
    throw { response: { data: { error: { message: 'Enter a valid 10-digit mobile number' } } } };
  }
  const { data } = await api.patch('/auth/profile', {
    name: payload.name.trim(),
    phone,
  });
  return data.data;
}

export async function changePassword(payload: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  await api.post('/auth/change-password', payload);
}
