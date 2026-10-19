import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  CustomerCertificateList,
  CustomerCertificateRow,
  CertificateVerifyResult,
} from '@biznexa/types';
import { formatDate } from '@biznexa/types';
import { useAuth } from '../auth/auth-context';
import { colors, radius, spacing } from '../theme';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '../components/common';
import { resolveApiUrl } from '../api/client';
import { fetchCachedList } from '../api/offline-cache';

interface CertificatesScreenProps {
  route?: {
    params?: {
      initialTab?: 'my' | 'verify';
      scannedNumber?: string;
    };
  };
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

type CertTab = 'my' | 'verify';

function certificateStatusVariant(status: string): 'seal' | 'marigold' | 'danger' | 'neutral' {
  switch (status) {
    case 'ACTIVE':
      return 'seal';
    case 'SUSPENDED':
      return 'marigold';
    case 'EXPIRED':
    case 'REVOKED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function CertificatesScreen({ route, navigation }: CertificatesScreenProps) {
  const { api, user } = useAuth();
  const initialTab = route?.params?.initialTab || (user ? 'my' : 'verify');
  const [activeTab, setActiveTab] = useState<CertTab>(initialTab);

  // My Certificates State
  const [myCerts, setMyCerts] = useState<CustomerCertificateRow[]>([]);
  const [isLoadingMyCerts, setIsLoadingMyCerts] = useState(false);
  const [myCertsError, setMyCertsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);

  // Verify State
  const [searchQuery, setSearchQuery] = useState(route?.params?.scannedNumber || '');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<CertificateVerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Fetch My Certificates
  const fetchMyCertificates = useCallback(
    async (refresh = false) => {
      if (!user) return;
      if (refresh) setRefreshing(true);
      else setIsLoadingMyCerts(true);
      setMyCertsError(null);

      try {
        const result = await fetchCachedList(`certificates:${user.id}`, async () => {
          const res = await api.GET('/api/certificates');
          if (!res.data) throw new Error('Failed to load certificates');
          return (res.data as CustomerCertificateList).items;
        });
        setMyCerts(result.data);
        setOffline(result.offline);
      } catch (e) {
        setMyCertsError(e instanceof Error ? e.message : 'Network error');
      } finally {
        setIsLoadingMyCerts(false);
        setRefreshing(false);
      }
    },
    [api, user]
  );

  useEffect(() => {
    if (activeTab === 'my') {
      void fetchMyCertificates();
    }
  }, [activeTab, fetchMyCertificates]);

  // Handle scanned query
  useEffect(() => {
    if (route?.params?.scannedNumber) {
      setSearchQuery(route.params.scannedNumber);
      setActiveTab('verify');
      void executeVerify(route.params.scannedNumber);
    }
  }, [route?.params?.scannedNumber]);

  // Execute Public Verification
  const executeVerify = async (queryToSearch: string) => {
    const trimmed = queryToSearch.trim();
    if (!trimmed) {
      Alert.alert('Search Required', 'Please enter a certificate number or verification ID.');
      return;
    }

    setIsVerifying(true);
    setVerifyError(null);
    setVerifyResult(null);

    try {
      const res = await api.GET('/api/public/certificates/verify', {
        params: {
          query: {
            number: trimmed,
            id: trimmed,
          },
        },
      });

      if (res.data) {
        setVerifyResult(res.data as CertificateVerifyResult);
      } else {
        setVerifyError('Verification check failed');
      }
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : 'Error checking certificate');
    } finally {
      setIsVerifying(false);
    }
  };

  // Download Certificate PDF
  const downloadCertificatePdf = async (certId: string) => {
    try {
      const res = await api.POST('/api/certificates/{id}/link', {
        params: {
          path: { id: certId },
          query: { disposition: 'attachment' },
        },
      });

      if (res.data?.url) {
        const directUrl = resolveApiUrl(res.data.url);
        await Linking.openURL(directUrl);
      } else {
        Alert.alert('Notice', 'Certificate PDF is not yet available or is generating.');
      }
    } catch (e) {
      Alert.alert('Download Error', e instanceof Error ? e.message : 'Failed to download certificate');
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Tabs */}
      <View style={styles.topTabsBar}>
        <TouchableOpacity
          onPress={() => setActiveTab('my')}
          style={[styles.topTab, activeTab === 'my' && styles.topTabActive]}
          activeOpacity={0.8}
        >
          <Text style={[styles.topTabText, activeTab === 'my' && styles.topTabTextActive]}>
            My Certificates
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveTab('verify')}
          style={[styles.topTab, activeTab === 'verify' && styles.topTabActive]}
          activeOpacity={0.8}
        >
          <Text style={[styles.topTabText, activeTab === 'verify' && styles.topTabTextActive]}>
            Verify Certificate
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tab 1: My Certificates */}
      {activeTab === 'my' && (
        <View style={{ flex: 1 }}>
          {!user ? (
            <EmptyState
              icon="lock-closed-outline"
              title="Sign in to view your certificates"
              description="Access issued certificates, licenses, and official compliance documents."
              actionTitle="Sign In"
              onAction={() => navigation.navigate('AuthModal')}
              style={{ flex: 1 }}
            />
          ) : isLoadingMyCerts ? (
            <LoadingState message="Loading your certificates…" style={{ flex: 1 }} />
          ) : myCertsError ? (
            <ErrorState
              message={myCertsError}
              onRetry={() => void fetchMyCertificates()}
              style={{ flex: 1 }}
            />
          ) : (
            <FlatList
              data={myCerts}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListHeaderComponent={offline ? <Text style={{ backgroundColor: '#fff1c2', color: colors.night, padding: spacing.sm, textAlign: 'center', fontWeight: '600' }}>Offline · showing your last loaded certificates</Text> : null}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => void fetchMyCertificates(true)}
                  tintColor={colors.ink}
                />
              }
              ListEmptyComponent={
                <EmptyState
                  icon="ribbon-outline"
                  title="No certificates issued yet"
                  description="When your applications are approved and completed, your official certificates will appear here."
                />
              }
              renderItem={({ item }) => (
                <Card style={styles.certCard}>
                  <View style={styles.certHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.certNumber}>{item.certificateNumber}</Text>
                      <Text style={styles.certType}>{item.type}</Text>
                    </View>
                    <Badge
                      label={item.effectiveStatus}
                      variant={certificateStatusVariant(item.effectiveStatus)}
                    />
                  </View>

                  <Text style={styles.certOrgName}>{item.organizationName}</Text>
                  <Text style={styles.certBodyName}>
                    Issuing Authority: {item.certificationBody.name}
                  </Text>

                  {/* Validity Info */}
                  <View style={styles.validityRow}>
                    <Ionicons name="time-outline" size={14} color={colors.muted} />
                    <Text style={styles.validityText}>
                      Valid until {formatDate(item.validUntil)}
                    </Text>
                  </View>

                  {/* Expiring Soon Notice */}
                  {item.isExpiringSoon && (
                    <View style={styles.expiringSoonBox}>
                      <Ionicons name="warning-outline" size={16} color={colors.amber} />
                      <Text style={styles.expiringSoonText}>
                        Expires in {item.daysUntilExpiry} days. Contact us to renew.
                      </Text>
                    </View>
                  )}

                  {/* Footer actions */}
                  <View style={styles.certFooter}>
                    <Button
                      title="Download PDF"
                      variant="primary"
                      size="sm"
                      onPress={() => void downloadCertificatePdf(item.id)}
                    />
                    <TouchableOpacity
                      onPress={() => {
                        setSearchQuery(item.certificateNumber);
                        setActiveTab('verify');
                        void executeVerify(item.certificateNumber);
                      }}
                      style={styles.verifyLink}
                    >
                      <Ionicons name="shield-checkmark-outline" size={16} color={colors.ink} />
                      <Text style={styles.verifyLinkText}>Public Verify</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              )}
            />
          )}
        </View>
      )}

      {/* Tab 2: Verify Certificate */}
      {activeTab === 'verify' && (
        <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.scrollInner}>
          {/* Search Box Card */}
          <Card style={styles.searchCard}>
            <Text style={styles.searchTitle}>Public Registry Verification</Text>
            <Text style={styles.searchSubtitle}>
              Verify the authenticity of any BizNexa certificate, standard or license.
            </Text>

            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="Certificate No. / Verification ID"
                placeholderTextColor={colors.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <Button
                title={isVerifying ? 'Checking…' : 'Verify'}
                variant="primary"
                size="md"
                loading={isVerifying}
                onPress={() => void executeVerify(searchQuery)}
              />
            </View>

            {/* Scan QR Button */}
            <TouchableOpacity
              onPress={() => navigation.navigate('QrScanner')}
              style={styles.scanQrButton}
              activeOpacity={0.8}
            >
              <Ionicons name="qr-code-outline" size={20} color={colors.ink} />
              <Text style={styles.scanQrText}>Scan Certificate QR Code</Text>
            </TouchableOpacity>
          </Card>

          {/* Verification Results */}
          {verifyError && (
            <ErrorState
              message={verifyError}
              onRetry={() => void executeVerify(searchQuery)}
              style={{ marginTop: spacing.md }}
            />
          )}

          {verifyResult && (
            <View style={{ marginTop: spacing.md }}>
              {verifyResult.found && verifyResult.certificate ? (
                <Card style={styles.resultCard}>
                  {/* Authenticity Badge */}
                  <View style={styles.resultBanner}>
                    <Ionicons name="checkmark-circle" size={28} color={colors.seal} />
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={styles.resultBannerTitle}>Authentic Certificate Found</Text>
                      <Text style={styles.resultBannerSub}>
                        Verified in registry on {formatDate(verifyResult.verifiedAt)}
                      </Text>
                    </View>
                  </View>

                  {/* QR verified indicator */}
                  {verifyResult.qrAuthentic !== null && (
                    <View style={styles.qrAuthenticRow}>
                      <Ionicons
                        name={verifyResult.qrAuthentic ? 'shield-checkmark' : 'alert-circle'}
                        size={16}
                        color={verifyResult.qrAuthentic ? colors.seal : colors.danger}
                      />
                      <Text style={styles.qrAuthenticText}>
                        {verifyResult.qrAuthentic
                          ? 'Digital QR Signature Verified'
                          : 'Warning: QR signature could not be verified'}
                      </Text>
                    </View>
                  )}

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Certificate Number</Text>
                    <Text style={styles.detailValue}>{verifyResult.certificate.certificateNumber}</Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Organization</Text>
                    <Text style={styles.detailValue}>{verifyResult.certificate.organizationName}</Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Type / Standard</Text>
                    <Text style={styles.detailValue}>{verifyResult.certificate.type}</Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Status</Text>
                    <Badge
                      label={verifyResult.certificate.status}
                      variant={certificateStatusVariant(verifyResult.certificate.status)}
                    />
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Validity Period</Text>
                    <Text style={styles.detailValue}>
                      {formatDate(verifyResult.certificate.validFrom)} to{' '}
                      {formatDate(verifyResult.certificate.validUntil)}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Certification Body</Text>
                    <Text style={styles.detailValue}>
                      {verifyResult.certificate.certificationBody.name}
                    </Text>
                  </View>

                  {verifyResult.certificate.scope && (
                    <View style={styles.scopeBox}>
                      <Text style={styles.detailLabel}>Certified Scope</Text>
                      <Text style={styles.scopeText}>{verifyResult.certificate.scope}</Text>
                    </View>
                  )}
                </Card>
              ) : (
                <Card style={styles.notFoundCard}>
                  <Ionicons name="close-circle-outline" size={48} color={colors.danger} />
                  <Text style={styles.notFoundTitle}>Certificate Not Found</Text>
                  <Text style={styles.notFoundDesc}>
                    No record matches the provided certificate number or verification ID in our
                    official registry. Please check the characters or scan the printed QR code.
                  </Text>
                </Card>
              )}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  topTabsBar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  topTab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
    marginHorizontal: 4,
  },
  topTabActive: {
    backgroundColor: colors.paper,
    borderBottomWidth: 2,
    borderBottomColor: colors.ink,
  },
  topTabText: {
    fontSize: 14,
    color: colors.muted,
    fontWeight: '500',
  },
  topTabTextActive: {
    color: colors.night,
    fontWeight: '700',
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollInner: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  certCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.white,
    padding: spacing.md,
  },
  certHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  certNumber: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
  },
  certType: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  certOrgName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.night,
    marginTop: spacing.xs,
  },
  certBodyName: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  validityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  validityText: {
    fontSize: 12,
    color: colors.muted,
  },
  expiringSoonBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.amber050,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
  },
  expiringSoonText: {
    fontSize: 12,
    color: colors.amber,
    fontWeight: '600',
  },
  certFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  verifyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 6,
  },
  verifyLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
  },
  searchCard: {
    backgroundColor: colors.white,
    padding: spacing.md,
  },
  searchTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.night,
  },
  searchSubtitle: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    backgroundColor: colors.paper,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.night,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  scanQrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.paper,
    paddingVertical: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  scanQrText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  resultCard: {
    backgroundColor: colors.white,
    padding: spacing.md,
  },
  resultBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.seal050,
    padding: spacing.md,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  resultBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.seal,
  },
  resultBannerSub: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  qrAuthenticRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  qrAuthenticText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.seal,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  detailLabel: {
    fontSize: 13,
    color: colors.muted,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.night,
    maxWidth: 200,
    textAlign: 'right',
  },
  scopeBox: {
    marginTop: spacing.md,
    backgroundColor: colors.paper,
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  scopeText: {
    fontSize: 13,
    color: colors.night,
    marginTop: 4,
    lineHeight: 18,
  },
  notFoundCard: {
    backgroundColor: colors.white,
    padding: spacing.xl,
    alignItems: 'center',
    textAlign: 'center',
  },
  notFoundTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.danger,
    marginTop: spacing.md,
  },
  notFoundDesc: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: spacing.xs,
    maxWidth: 280,
  },
});
