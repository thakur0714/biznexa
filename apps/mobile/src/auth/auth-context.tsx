import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { AuthMeResponse } from '@biznexa/types';
import { createMobileApiClient, type ApiClient, MobileApiError } from '../api/client';
import {
  getStoredRefreshToken,
  setStoredRefreshToken,
  removeStoredRefreshToken,
  getStoredBiometricsEnabled,
  setStoredBiometricsEnabled,
} from './secure-storage';
import { clearOfflineCache } from '../api/offline-cache';
import { promptBiometricAuth, checkBiometrics } from './biometrics';

export interface MobileSessionData {
  accessToken: string;
  refreshToken?: string;
  user: AuthMeResponse;
}

export interface AuthContextValue {
  user: AuthMeResponse | null;
  token: string | null;
  isLoading: boolean;
  isLocked: boolean;
  isBiometricsEnabled: boolean;
  api: ApiClient;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  requestOtp: (mobile: string, purpose?: OtpPurpose) => Promise<OtpRequestResult>;
  verifyOtp: (mobile: string, code: string, purpose?: OtpPurpose) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  register: (name: string, mobile: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<string | null>;
  toggleBiometrics: (enabled: boolean) => Promise<boolean>;
  unlockWithBiometrics: () => Promise<boolean>;
}

type OtpPurpose = 'LOGIN' | 'VERIFY_MOBILE' | 'RESET_PASSWORD';
type OtpRequestResult = { message: string; resendAfterSec?: number; devCode?: string };

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, baseUrl }: Readonly<{ children: React.ReactNode; baseUrl?: string }>) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthMeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [isBiometricsEnabled, setIsBiometricsEnabled] = useState(false);
  const registeredDeviceToken = useRef<string | null>(null);

  // Maintain reference to current in-memory token for client
  const getToken = useCallback(() => token, [token]);

  // Session handler for silent refresh
  const refreshSession = useCallback(async (): Promise<string | null> => {
    const storedRefresh = await getStoredRefreshToken();
    if (!storedRefresh) {
      setToken(null);
      setUser(null);
      return null;
    }

    try {
      const unauthClient = createMobileApiClient({ baseUrl });
      const { data, response } = await unauthClient.POST('/api/auth/refresh', {
        headers: { 'x-client': 'mobile' },
        body: { refreshToken: storedRefresh },
      });

      if (!response.ok || !data) {
        await removeStoredRefreshToken();
        setToken(null);
        setUser(null);
        return null;
      }

      const res = data as unknown as MobileSessionData;
      setToken(res.accessToken);
      if (res.refreshToken) {
        await setStoredRefreshToken(res.refreshToken);
      }
      if (res.user) {
        setUser(res.user);
      }
      return res.accessToken;
    } catch {
      return null;
    }
  }, [baseUrl]);

  const session = useMemo(
    () => ({
      getToken,
      getRefreshToken: getStoredRefreshToken,
      refresh: refreshSession,
    }),
    [getToken, refreshSession]
  );

  const api = useMemo(
    () => createMobileApiClient({ baseUrl, session }),
    [baseUrl, session]
  );

  const registerDeviceToken = useCallback(async (accessToken: string, deviceToken: string) => {
    let platform: 'ios' | 'android' | 'web' = 'web';
    if (Platform.OS === 'ios') platform = 'ios';
    else if (Platform.OS === 'android') platform = 'android';
    const { response } = await api.POST('/api/notifications/devices/register', {
      headers: { authorization: `Bearer ${accessToken}`, 'x-client': 'mobile' },
      body: { token: deviceToken, platform },
    });
    if (response.ok) registeredDeviceToken.current = deviceToken;
  }, [api]);

  const syncDeviceTokenIfPermitted = useCallback(async (accessToken: string) => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', { name: 'BizNexa updates', importance: Notifications.AndroidImportance.DEFAULT });
      }
      const permission = await Notifications.getPermissionsAsync();
      if (!permission.granted) return;
      const devicePushToken = await Notifications.getDevicePushTokenAsync();
      await registerDeviceToken(accessToken, devicePushToken.data);
    } catch {
      // Push registration is optional; authentication remains available if the OS or FCM is unavailable.
    }
  }, [registerDeviceToken]);

  const requestPushPermissionAfterLogin = useCallback(async (accessToken: string) => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', { name: 'BizNexa updates', importance: Notifications.AndroidImportance.DEFAULT });
      }
      const current = await Notifications.getPermissionsAsync();
      const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
      if (!permission.granted) return;
      await syncDeviceTokenIfPermitted(accessToken);
    } catch {
      // Push registration is optional; authentication remains available if the OS permission request fails.
    }
  }, [syncDeviceTokenIfPermitted]);

  const handleAuthSuccess = useCallback(async (data: MobileSessionData) => {
    setToken(data.accessToken);
    if (data.refreshToken) {
      await setStoredRefreshToken(data.refreshToken);
    }
    if (data.user) {
      setUser(data.user);
    } else {
      // Fetch user profile if not in session response
      try {
        const meRes = await api.GET('/api/auth/me', {
          headers: {
            authorization: `Bearer ${data.accessToken}`,
            'x-client': 'mobile',
          },
        });
        if (meRes.data) {
          setUser(meRes.data as unknown as AuthMeResponse);
        }
      } catch {
        // ignore
      }
    }
    setIsLocked(false);
    void requestPushPermissionAfterLogin(data.accessToken);
  }, [api, requestPushPermissionAfterLogin]);

  useEffect(() => {
    if (!token) return;
    void syncDeviceTokenIfPermitted(token);
    const listener = Notifications.addPushTokenListener((next) => {
      void registerDeviceToken(token, next.data).catch(() => undefined);
    });
    return () => listener.remove();
  }, [token, registerDeviceToken, syncDeviceTokenIfPermitted]);

  const loginWithPassword = useCallback(async (email: string, password: string) => {
    const { data, error, response } = await api.POST('/api/auth/login', {
      headers: { 'x-client': 'mobile' },
      body: { email, password },
    });

    if (!response.ok || !data) {
      const err = (error ?? {}) as { message?: string; errors?: [] };
      throw new MobileApiError(response.status, err.message ?? 'Login failed', err.errors);
    }

    await handleAuthSuccess(data as unknown as MobileSessionData);
  }, [api, handleAuthSuccess]);

  const requestOtp = useCallback(async (mobile: string, purpose: 'LOGIN' | 'VERIFY_MOBILE' | 'RESET_PASSWORD' = 'LOGIN') => {
    const { data, error, response } = await api.POST('/api/auth/otp/request', {
      headers: { 'x-client': 'mobile' },
      body: {
        channel: 'MOBILE',
        target: mobile,
        purpose,
      },
    });

    if (!response.ok || !data) {
      const err = (error ?? {}) as { message?: string };
      throw new MobileApiError(response.status, err.message ?? 'Failed to send OTP');
    }

    return data as OtpRequestResult;
  }, [api]);

  const verifyOtp = useCallback(async (mobile: string, code: string, purpose: 'LOGIN' | 'VERIFY_MOBILE' | 'RESET_PASSWORD' = 'LOGIN') => {
    const { data, error, response } = await api.POST('/api/auth/otp/verify', {
      headers: { 'x-client': 'mobile' },
      body: {
        channel: 'MOBILE',
        target: mobile,
        code,
        purpose,
      },
    });

    if (!response.ok || !data) {
      const err = (error ?? {}) as { message?: string; errors?: [] };
      throw new MobileApiError(response.status, err.message ?? 'Invalid OTP code', err.errors);
    }

    await handleAuthSuccess(data as unknown as MobileSessionData);
  }, [api, handleAuthSuccess]);

  const loginWithGoogle = useCallback(async (idToken: string) => {
    const { data, error, response } = await api.POST('/api/auth/google', {
      headers: { 'x-client': 'mobile' },
      body: { idToken },
    });

    if (!response.ok || !data) {
      const err = (error ?? {}) as { message?: string; errors?: [] };
      throw new MobileApiError(response.status, err.message ?? 'Google sign-in failed', err.errors);
    }

    await handleAuthSuccess(data as unknown as MobileSessionData);
  }, [api, handleAuthSuccess]);

  const register = useCallback(async (name: string, mobile: string, email: string, password: string) => {
    const { data, error, response } = await api.POST('/api/auth/register', {
      headers: { 'x-client': 'mobile' },
      body: {
        name,
        mobile,
        email,
        password,
        consent: true,
      },
    });

    if (!response.ok || !data) {
      const err = (error ?? {}) as { message?: string; errors?: [] };
      throw new MobileApiError(response.status, err.message ?? 'Registration failed', err.errors);
    }

    await handleAuthSuccess(data as unknown as MobileSessionData);
  }, [api, handleAuthSuccess]);

  const logout = useCallback(async () => {
    try {
      if (token) {
        let deviceToken = registeredDeviceToken.current;
        if (!deviceToken && (Platform.OS === 'ios' || Platform.OS === 'android')) {
          try {
            deviceToken = (await Notifications.getDevicePushTokenAsync()).data;
          } catch {
            // A missing native token is fine; continue with the API session logout.
          }
        }
        if (deviceToken) {
          try {
            await api.POST('/api/notifications/devices/unregister', {
              headers: { authorization: `Bearer ${token}`, 'x-client': 'mobile' },
              body: { token: deviceToken },
            });
          } catch {
            // Continue server logout and local cleanup if device unregistration fails.
          }
        }
        await api.POST('/api/auth/logout', {
          headers: {
            authorization: `Bearer ${token}`,
            'x-client': 'mobile',
          },
        });
      }
    } catch {
      // Continue cleanup even if server logout request fails
    }
    await removeStoredRefreshToken();
    await clearOfflineCache().catch(() => undefined);
    registeredDeviceToken.current = null;
    setToken(null);
    setUser(null);
    setIsLocked(false);
  }, [api, token]);

  const toggleBiometrics = useCallback(async (enabled: boolean): Promise<boolean> => {
    if (enabled) {
      const status = await checkBiometrics();
      if (!status.hasHardware || !status.isEnrolled) {
        return false;
      }
      const success = await promptBiometricAuth('Confirm biometric setup for BizNexa');
      if (!success) {
        return false;
      }
    }
    await setStoredBiometricsEnabled(enabled);
    setIsBiometricsEnabled(enabled);
    return true;
  }, []);

  const unlockWithBiometrics = useCallback(async (): Promise<boolean> => {
    const success = await promptBiometricAuth('Unlock BizNexa');
    if (success) {
      setIsLocked(false);
      return true;
    }
    return false;
  }, []);

  // Initialize session on mount
  useEffect(() => {
    let isMounted = true;
    void (async () => {
      try {
        const [bioEnabled, storedRefresh] = await Promise.all([
          getStoredBiometricsEnabled(),
          getStoredRefreshToken(),
        ]);

        if (!isMounted) return;
        setIsBiometricsEnabled(bioEnabled);

        if (storedRefresh) {
          if (bioEnabled) {
            setIsLocked(true);
          }
          await refreshSession();
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [refreshSession]);

  const value = useMemo(
    () => ({
      user,
      token,
      isLoading,
      isLocked,
      isBiometricsEnabled,
      api,
      loginWithPassword,
      requestOtp,
      verifyOtp,
      loginWithGoogle,
      register,
      logout,
      refreshSession,
      toggleBiometrics,
      unlockWithBiometrics,
    }),
    [
      user,
      token,
      isLoading,
      isLocked,
      isBiometricsEnabled,
      api,
      loginWithPassword,
      requestOtp,
      verifyOtp,
      loginWithGoogle,
      register,
      logout,
      refreshSession,
      toggleBiometrics,
      unlockWithBiometrics,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
