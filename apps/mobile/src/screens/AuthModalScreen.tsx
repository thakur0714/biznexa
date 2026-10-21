import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../auth/auth-context';
import { colors, radius, spacing } from '../theme';
import { Button, Input, Card } from '../components/common';
import {
  mobileSchema,
  loginSchema,
  registerSchema,
  otpVerifySchema,
} from '@biznexa/types';

interface AuthModalScreenProps {
  readonly navigation: {
    readonly goBack: () => void;
  };
}

type AuthMode = 'otp' | 'password' | 'register';

export function AuthModalScreen({ navigation }: Readonly<AuthModalScreenProps>) {
  const { loginWithPassword, requestOtp, verifyOtp, loginWithGoogle, register } = useAuth();
  const [mode, setMode] = useState<AuthMode>('otp');

  // OTP State
  const [mobile, setMobile] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  // Password State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Register State
  const [regName, setRegName] = useState('');
  const [regMobile, setRegMobile] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // Form handling
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleRequestOtp = async () => {
    setError(null);
    const parsed = mobileSchema.safeParse(mobile);
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? 'Invalid mobile number');
      return;
    }

    setLoading(true);
    try {
      const res = await requestOtp(mobile, 'LOGIN');
      setOtpSent(true);
      setSuccessMsg(res.message || 'OTP sent successfully');
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setError(null);
    const parsed = otpVerifySchema.safeParse({
      channel: 'MOBILE',
      target: mobile,
      code: otpCode,
      purpose: 'LOGIN',
    });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? 'Enter valid 6-digit code');
      return;
    }

    setLoading(true);
    try {
      await verifyOtp(mobile, otpCode, 'LOGIN');
      navigation.goBack();
    } catch (err: unknown) {
      setError((err as Error).message || 'Invalid OTP code');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordLogin = async () => {
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? 'Invalid email or password');
      return;
    }

    setLoading(true);
    try {
      await loginWithPassword(email, password);
      navigation.goBack();
    } catch (err: unknown) {
      setError((err as Error).message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setError(null);
    const parsed = registerSchema.safeParse({
      name: regName,
      mobile: regMobile,
      email: regEmail,
      password: regPassword,
      consent: true,
    });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? 'Please check all required fields');
      return;
    }

    setLoading(true);
    try {
      await register(regName, regMobile, regEmail, regPassword);
      navigation.goBack();
    } catch (err: unknown) {
      setError((err as Error).message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      // Demo ID Token or Google Sign-In SDK token passed to API
      const mockIdToken = 'google-oauth-mock-id-token-tester-app';
      await loginWithGoogle(mockIdToken);
      navigation.goBack();
    } catch (err: unknown) {
      setError((err as Error).message || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.title}>
            {mode === 'register' ? 'Create an Account' : 'Sign in to BizNexa'}
          </Text>
          <Text style={styles.subtitle}>
            Manage your applications, orders, and certificates.
          </Text>
        </View>

        {/* Auth Method Selector */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, mode === 'otp' && styles.tabActive]}
            onPress={() => {
              setMode('otp');
              setError(null);
            }}
          >
            <Text style={[styles.tabText, mode === 'otp' && styles.tabTextActive]}>Mobile OTP</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, mode === 'password' && styles.tabActive]}
            onPress={() => {
              setMode('password');
              setError(null);
            }}
          >
            <Text style={[styles.tabText, mode === 'password' && styles.tabTextActive]}>Password</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, mode === 'register' && styles.tabActive]}
            onPress={() => {
              setMode('register');
              setError(null);
            }}
          >
            <Text style={[styles.tabText, mode === 'register' && styles.tabTextActive]}>Register</Text>
          </TouchableOpacity>
        </View>

        {/* Feedback message */}
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        {successMsg && !error && (
          <View style={styles.successBox}>
            <Text style={styles.successText}>{successMsg}</Text>
          </View>
        )}

        {/* Mobile OTP Form */}
        {mode === 'otp' && (
          <Card style={styles.formCard}>
            <Input
              label="Indian Mobile Number"
              placeholder="e.g. 9876543210"
              keyboardType="phone-pad"
              maxLength={10}
              value={mobile}
              onChangeText={setMobile}
              editable={!otpSent || !loading}
            />

            {!otpSent ? (
              <Button
                title="Send OTP"
                onPress={handleRequestOtp}
                loading={loading}
                variant="primary"
                style={{ marginTop: spacing.sm }}
              />
            ) : (
              <>
                <Input
                  label="6-Digit OTP Code"
                  placeholder="123456"
                  keyboardType="number-pad"
                  maxLength={6}
                  value={otpCode}
                  onChangeText={setOtpCode}
                />
                <Button
                  title="Verify & Sign In"
                  onPress={handleVerifyOtp}
                  loading={loading}
                  variant="primary"
                  style={{ marginTop: spacing.sm }}
                />
                <TouchableOpacity
                  onPress={handleRequestOtp}
                  style={styles.resendBtn}
                  disabled={loading}
                >
                  <Text style={styles.resendText}>Didn&apos;t get the code? Resend OTP</Text>
                </TouchableOpacity>
              </>
            )}
          </Card>
        )}

        {/* Email + Password Form */}
        {mode === 'password' && (
          <Card style={styles.formCard}>
            <Input
              label="Email Address"
              placeholder="you@company.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
            <Input
              label="Password"
              placeholder="••••••••"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <Button
              title="Sign In"
              onPress={handlePasswordLogin}
              loading={loading}
              variant="primary"
              style={{ marginTop: spacing.sm }}
            />
          </Card>
        )}

        {/* Registration Form */}
        {mode === 'register' && (
          <Card style={styles.formCard}>
            <Input
              label="Full Name"
              placeholder="John Doe"
              value={regName}
              onChangeText={setRegName}
            />
            <Input
              label="Mobile Number"
              placeholder="9876543210"
              keyboardType="phone-pad"
              maxLength={10}
              value={regMobile}
              onChangeText={setRegMobile}
            />
            <Input
              label="Email Address"
              placeholder="you@company.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={regEmail}
              onChangeText={setRegEmail}
            />
            <Input
              label="Password (min 8 chars, 1 letter, 1 number)"
              placeholder="••••••••"
              secureTextEntry
              value={regPassword}
              onChangeText={setRegPassword}
            />
            <Button
              title="Create Account"
              onPress={handleRegister}
              loading={loading}
              variant="primary"
              style={{ marginTop: spacing.sm }}
            />
          </Card>
        )}

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Google Sign-in */}
        <Button
          title="Continue with Google"
          variant="secondary"
          onPress={handleGoogleSignIn}
          loading={loading}
          style={styles.googleBtn}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
  },
  header: {
    marginBottom: spacing.lg,
  },
  closeBtn: {
    alignSelf: 'flex-end',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 16,
    color: colors.night,
    fontWeight: '700',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.night,
    marginTop: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    marginTop: 4,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.rule,
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  tabActive: {
    backgroundColor: colors.white,
    shadowColor: colors.night,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.muted,
  },
  tabTextActive: {
    color: colors.ink,
    fontWeight: '700',
  },
  formCard: {
    marginBottom: spacing.lg,
  },
  resendBtn: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
  resendText: {
    fontSize: 13,
    color: colors.ink,
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.rule,
  },
  dividerText: {
    paddingHorizontal: spacing.md,
    fontSize: 12,
    color: colors.muted,
    fontWeight: '600',
  },
  googleBtn: {
    marginBottom: spacing.xxl,
  },
  errorBox: {
    backgroundColor: colors.danger050,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.danger,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '500',
  },
  successBox: {
    backgroundColor: colors.seal050,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.seal,
    marginBottom: spacing.md,
  },
  successText: {
    color: colors.seal,
    fontSize: 13,
    fontWeight: '500',
  },
});
