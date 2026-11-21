import api from './api';
import { normalizeMobile } from '../utils/phone';
import { useAuthStore } from '../store/authStore';

export interface Profile {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
}

export async function getProfile(): Promise<Profile> {
  try {
    const { data } = await api.get('/auth/profile');
    return data.data;
  } catch (err) {
    const user = useAuthStore.getState().user;
    if (user) {
      return {
        id: user.id,
        name: user.name,
        email: user.email || null,
        phone: user.phone || null,
        role: user.role || null,
      };
    }
    throw err;
  }
}

export async function updateProfile(payload: { name: string; phone: string }): Promise<Profile> {
  const phone = normalizeMobile(payload.phone);
  if (!phone) {
    throw { response: { data: { error: { message: 'Enter a valid 10-digit mobile number' } } } };
  }
  const cleanName = payload.name.trim();

  try {
    const { data } = await api.patch('/auth/profile', {
      name: cleanName,
      phone,
    });
    return data.data;
  } catch (err) {
    const { hasSqliteBridge } = await import('../offline/sqliteApi');
    const currentUser = useAuthStore.getState().user;

    // Offline / local fallback
    if (hasSqliteBridge() || !navigator.onLine) {
      const updatedUser = {
        ...(currentUser || { id: 'local-user', role: 'admin', email: null }),
        name: cleanName,
        phone,
      };
      useAuthStore.getState().updateLocalUser(updatedUser);

      if (hasSqliteBridge()) {
        try {
          const { localReadAuthSession, localSaveAuthSession, localEnqueueSync } = await import('../offline/localApi');
          const session = await localReadAuthSession();
          if (session) {
            await localSaveAuthSession({
              ...session,
              user: { ...(session.user as Record<string, unknown> || {}), name: cleanName, phone },
            });
          }
          await localEnqueueSync({
            entityType: 'profile',
            entityId: currentUser?.id || 'profile',
            op: 'update',
            payload: { name: cleanName, phone },
          });
        } catch {
          /* ignore session caching errors */
        }
      }
      return {
        id: currentUser?.id || 'local-user',
        name: cleanName,
        phone,
        email: currentUser?.email || null,
        role: currentUser?.role || null,
      };
    }
    throw err;
  }
}

export async function changePassword(payload: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  await api.post('/auth/change-password', payload);
}
