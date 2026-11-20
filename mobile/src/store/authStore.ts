import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { setAuthToken } from '../services/api';
import * as authService from '../services/authService';
import type { LoginResponse } from '../services/authService';
import { normalizeMobile } from '../utils/phone';

export interface SavedLogin {
  shopCode: string;
  mobile: string;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: LoginResponse['user'] | null;
  tenant: LoginResponse['tenant'] | null;
  savedLogin: SavedLogin | null;
  isHydrated: boolean;
  login: (shopCode: string, mobile: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearSavedLogin: () => void;
  updateLocalUser: (patch: Partial<LoginResponse['user']>) => void;
  updateTenant: (patch: Partial<LoginResponse['tenant']>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      tenant: null,
      savedLogin: null,
      isHydrated: false,
      login: async (shopCode, mobile, password) => {
        const normalizedMobile = normalizeMobile(mobile);
        if (!normalizedMobile) {
          throw { response: { data: { error: { message: 'Enter a valid 10-digit mobile number' } } } };
        }
        const code = shopCode.trim().toLowerCase();

        const applySession = async (
          result: authService.LoginResponse,
          plainPassword: string,
        ) => {
          setAuthToken(result.accessToken);
          set({
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            user: result.user,
            tenant: result.tenant,
            savedLogin: {
              shopCode: code,
              mobile: normalizedMobile,
            },
          });
          // Cache credentials locally so the same user can unlock offline later.
          try {
            const { hasSqliteBridge } = await import('../offline/sqliteApi');
            if (hasSqliteBridge()) {
              const { hashPassword, newSalt } = await import('../offline/passwordHash');
              const { localSaveAuthSession } = await import('../offline/localApi');
              const salt = newSalt();
              const passwordHash = await hashPassword(plainPassword, salt);
              await localSaveAuthSession({
                shopCode: code,
                mobile: normalizedMobile,
                passwordHash,
                salt,
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                user: result.user,
                tenant: result.tenant,
              });
            }
          } catch {
            /* ignore cache errors */
          }
        };

        try {
          const result = await authService.login({
            shopCode: code,
            mobile: normalizedMobile,
            password,
          });
          await applySession(result, password);
          return;
        } catch (err) {
          // Offline / network fail → unlock from local SQLite session if password matches.
          try {
            const { hasSqliteBridge } = await import('../offline/sqliteApi');
            const { localReadAuthSession } = await import('../offline/localApi');
            const { hashPassword } = await import('../offline/passwordHash');
            if (!hasSqliteBridge()) throw err;
            const session = await localReadAuthSession(code);
            if (
              !session ||
              String(session.shopCode).toLowerCase() !== code ||
              String(session.mobile) !== normalizedMobile
            ) {
              throw err;
            }
            const hash = await hashPassword(password, String(session.salt || ''));
            if (hash !== session.passwordHash) {
              throw { response: { data: { error: { message: 'Invalid password' } } } };
            }
            setAuthToken(session.accessToken || 'local-offline-token');
            set({
              accessToken: session.accessToken || 'local-offline-token',
              refreshToken: session.refreshToken || null,
              user: session.user,
              tenant: session.tenant,
              savedLogin: { shopCode: code, mobile: normalizedMobile },
            });
            return;
          } catch (offlineErr) {
            if (offlineErr && (offlineErr as { response?: unknown }).response) throw offlineErr;
            throw err;
          }
        }
      },
      logout: async () => {
        const refreshToken = get().refreshToken;
        if (refreshToken) {
          try {
            await authService.logout(refreshToken);
          } catch {
            // ignore logout errors
          }
        }
        setAuthToken(null);
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          tenant: null,
        });
      },
      clearSavedLogin: () => {
        set({ savedLogin: null });
      },
      updateLocalUser: (patch) => {
        const current = get().user;
        if (!current) return;
        const nextUser = { ...current, ...patch };
        const nextSaved = get().savedLogin;
        set({
          user: nextUser,
          savedLogin:
            nextSaved && patch.phone
              ? { ...nextSaved, mobile: String(patch.phone) }
              : nextSaved,
        });
      },
      updateTenant: (patch) => {
        const current = get().tenant;
        if (!current) return;
        set({ tenant: { ...current, ...patch } });
      },
    }),
    {
      name: 'billing-auth',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        tenant: state.tenant,
        savedLogin: state.savedLogin,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.accessToken) {
          setAuthToken(state.accessToken);
        }
        useAuthStore.setState({ isHydrated: true });
      },
    }
  )
);
