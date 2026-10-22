import React from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/auth-context';
import { colors, spacing } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Badge } from '../components/common';

interface AccountScreenProps {
  readonly navigation: {
    readonly navigate: (screen: string) => void;
  };
}

export function AccountScreen({ navigation }: Readonly<AccountScreenProps>) {
  const insets = useSafeAreaInsets();
  const { user, logout, isBiometricsEnabled, toggleBiometrics } = useAuth();

  const handleBiometricsToggle = async (val: boolean) => {
    const success = await toggleBiometrics(val);
    if (!success && val) {
      Alert.alert(
        'Biometrics Unavailable',
        'Your device does not have biometric hardware enrolled or setup was cancelled.'
      );
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={[styles.header, { marginTop: insets.top }]}>
        <Text style={styles.headerTitle}>Account & Settings</Text>
      </View>

      {user ? (
        <>
          {/* User Profile Card */}
          <Card style={styles.profileCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{user.name.slice(0, 2).toUpperCase()}</Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.userName}>{user.name}</Text>
              {user.email && <Text style={styles.userEmail}>{user.email}</Text>}
              {user.mobile && <Text style={styles.userMobile}>+91 {user.mobile}</Text>}
              <View style={styles.roleBadges}>
                {user.roles.map((r) => (
                  <Badge key={r} label={r} variant="ink" style={{ marginRight: 4, marginTop: 4 }} />
                ))}
              </View>
            </View>
          </Card>

          {/* Shortcuts Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>My Workspace</Text>
            <Card style={styles.menuCard}>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => navigation.navigate('MyServices')}
                activeOpacity={0.7}
              >
                <View style={styles.menuItemLeft}>
                  <Ionicons name="briefcase-outline" size={20} color={colors.ink} />
                  <Text style={styles.menuItemText}>My Services & Applications</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </TouchableOpacity>

              <View style={styles.menuDivider} />

              <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Support')} activeOpacity={0.7}>
                <View style={styles.menuItemLeft}><Ionicons name="help-circle-outline" size={20} color={colors.ink} /><Text style={styles.menuItemText}>Support tickets</Text></View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </TouchableOpacity>

              <View style={styles.menuDivider} />

              <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Consultations')} activeOpacity={0.7}>
                <View style={styles.menuItemLeft}><Ionicons name="calendar-outline" size={20} color={colors.ink} /><Text style={styles.menuItemText}>Consultations & bookings</Text></View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </TouchableOpacity>

              <View style={styles.menuDivider} />

              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => navigation.navigate('Documents')}
                activeOpacity={0.7}
              >
                <View style={styles.menuItemLeft}>
                  <Ionicons name="document-text-outline" size={20} color={colors.ink} />
                  <Text style={styles.menuItemText}>My Compliance Documents</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </TouchableOpacity>

              <View style={styles.menuDivider} />

              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => navigation.navigate('Payments')}
                activeOpacity={0.7}
              >
                <View style={styles.menuItemLeft}>
                  <Ionicons name="card-outline" size={20} color={colors.ink} />
                  <Text style={styles.menuItemText}>Payments & Invoices</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </TouchableOpacity>

              <View style={styles.menuDivider} />

              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => navigation.navigate('Certificates')}
                activeOpacity={0.7}
              >
                <View style={styles.menuItemLeft}>
                  <Ionicons name="ribbon-outline" size={20} color={colors.ink} />
                  <Text style={styles.menuItemText}>Certificates & Verification</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </TouchableOpacity>
            </Card>
          </View>

          {/* Security & Preferences */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Security & Biometrics</Text>
            <Card style={styles.settingCard}>
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>Biometric Unlock</Text>
                  <Text style={styles.settingDesc}>
                    Use FaceID or Fingerprint to unlock BizNexa
                  </Text>
                </View>
                <Switch
                  value={isBiometricsEnabled}
                  onValueChange={handleBiometricsToggle}
                  trackColor={{ false: colors.rule, true: colors.ink }}
                  thumbColor={colors.white}
                />
              </View>
            </Card>
          </View>

          {/* Sign Out */}
          <View style={styles.section}>
            <Button
              title="Sign Out"
              variant="danger"
              onPress={handleLogout}
              style={{ marginTop: spacing.md }}
            />
          </View>
        </>
      ) : (
        /* Guest / Not logged in */
        <Card style={styles.guestCard}>
          <Text style={styles.guestTitle}>Sign in to your account</Text>
          <Text style={styles.guestDesc}>
            Access your active business applications, download verified certificates, track orders, and talk with consultants.
          </Text>
          <Button
            title="Sign In / Register"
            variant="primary"
            onPress={() => navigation.navigate('AuthModal')}
            style={{ marginTop: spacing.lg }}
          />
        </Card>
      )}

      {/* App Build Information */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>BizNexa Mobile v1.0.0 (Expo)</Text>
        <Text style={styles.footerSubtext}>Android Tester APK · Internal Distribution</Text>
        <Text style={styles.footerSubtext}>18-Oct-2026 Target Release</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    padding: spacing.lg,
  },
  header: {
    marginBottom: spacing.lg,
    paddingTop: spacing.md,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.night,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
  profileInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.night,
  },
  userEmail: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  userMobile: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  roleBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.night,
    marginBottom: spacing.xs,
  },
  settingCard: {
    padding: spacing.md,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingInfo: {
    flex: 1,
    paddingRight: spacing.md,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.night,
  },
  settingDesc: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  guestCard: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  guestTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.night,
    textAlign: 'center',
  },
  guestDesc: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  footer: {
    alignItems: 'center',
    marginTop: spacing.xxl,
    paddingBottom: spacing.xl,
  },
  footerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  footerSubtext: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  menuCard: {
    padding: 0,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.night,
  },
  menuDivider: {
    height: 1,
    backgroundColor: colors.rule,
    marginHorizontal: spacing.md,
  },
});
