import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/auth-context';
import { colors, radius, spacing } from '../theme';
import { Button } from '../components/common';

export function BiometricLockScreen() {
  const { unlockWithBiometrics, logout } = useAuth();

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Text style={styles.iconText}>🔒</Text>
        </View>
        <Text style={styles.title}>BizNexa is Locked</Text>
        <Text style={styles.subtitle}>
          Use your biometric authentication (FaceID or Fingerprint) to access your account.
        </Text>
        <Button
          title="Unlock with Biometrics"
          variant="primary"
          size="lg"
          onPress={() => unlockWithBiometrics()}
          style={styles.unlockBtn}
        />
        <Button
          title="Sign in with different account"
          variant="ghost"
          size="sm"
          onPress={() => logout()}
          style={styles.switchBtn}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  content: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.xl,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.ink050,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  iconText: {
    fontSize: 28,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.night,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  unlockBtn: {
    width: '100%',
    marginTop: spacing.xl,
  },
  switchBtn: {
    marginTop: spacing.sm,
  },
});
