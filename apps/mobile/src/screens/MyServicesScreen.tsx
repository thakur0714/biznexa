import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  CustomerApplicationList,
  CustomerApplicationRow,
  CustomerApplicationTab,
  CustomerApplicationNextAction,
} from '@biznexa/types';
import { formatDate } from '@biznexa/types';
import { useAuth } from '../auth/auth-context';
import { colors, radius, spacing } from '../theme';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '../components/common';

interface MyServicesScreenProps {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

const TABS: { key: CustomerApplicationTab; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

function statusVariant(status: string): 'seal' | 'marigold' | 'ink' | 'danger' | 'neutral' {
  switch (status) {
    case 'COMPLETED':
    case 'DELIVERED':
      return 'seal';
    case 'PAYMENT_PENDING':
    case 'DOCUMENTS_PENDING':
    case 'DOCUMENTS_REJECTED':
      return 'marigold';
    case 'SUBMITTED':
    case 'DOCUMENTS_UNDER_REVIEW':
    case 'IN_PROGRESS':
    case 'GOVERNMENT_PROCESSING':
      return 'ink';
    case 'CANCELLED':
    case 'REJECTED':
      return 'danger';
    default:
      return 'neutral';
  }
}

function nextActionLabel(action: CustomerApplicationNextAction): string {
  switch (action) {
    case 'upload_documents':
      return 'Upload Documents';
    case 'pay_balance':
      return 'Pay Balance';
    case 'download':
      return 'Download Deliverables';
    case 'view':
    default:
      return 'View Application';
  }
}

function nextActionVariant(action: CustomerApplicationNextAction): 'primary' | 'accent' | 'secondary' {
  switch (action) {
    case 'upload_documents':
      return 'accent';
    case 'pay_balance':
      return 'primary';
    case 'download':
      return 'primary';
    case 'view':
    default:
      return 'secondary';
  }
}

export function MyServicesScreen({ navigation }: MyServicesScreenProps) {
  const { api, user } = useAuth();
  const [activeTab, setActiveTab] = useState<CustomerApplicationTab>('active');
  const [data, setData] = useState<CustomerApplicationList | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchApplications = useCallback(
    async (tab: CustomerApplicationTab, refresh = false) => {
      if (!user) {
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      if (refresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const res = await api.GET('/api/applications', {
          params: {
            query: { tab },
          },
        });

        if (res.data) {
          setData(res.data);
        } else {
          setError('Failed to load your applications');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error occurred');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [api, user]
  );

  useEffect(() => {
    void fetchApplications(activeTab);
  }, [activeTab, fetchApplications]);

  const handleTabChange = (tab: CustomerApplicationTab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setData(null);
  };

  const handleOpenDetail = (applicationId: string, initialTab?: string) => {
    navigation.navigate('ApplicationDetail', { applicationId, initialTab });
  };

  const handleAction = (item: CustomerApplicationRow) => {
    let initialTab = 'timeline';
    if (item.nextAction === 'upload_documents') initialTab = 'documents';
    if (item.nextAction === 'pay_balance') initialTab = 'payments';
    if (item.nextAction === 'download') initialTab = 'documents';
    handleOpenDetail(item.id, initialTab);
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in to view your services"
          description="Track your applications, submit required documents, view live timelines, and chat with your assigned expert."
          actionTitle="Sign In / Register"
          onAction={() => navigation.navigate('AuthModal')}
          style={{ flex: 1 }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Segmented Tabs */}
      <View style={styles.tabsHeader}>
        {TABS.map((t) => {
          const isActive = t.key === activeTab;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => handleTabChange(t.key)}
              style={[styles.tabButton, isActive && styles.tabButtonActive]}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content Area */}
      {isLoading ? (
        <LoadingState message="Loading your services…" style={{ flex: 1 }} />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => void fetchApplications(activeTab)}
          style={{ flex: 1 }}
        />
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void fetchApplications(activeTab, true)}
              tintColor={colors.ink}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="briefcase-outline"
              title={
                activeTab === 'active'
                  ? 'No active applications'
                  : activeTab === 'completed'
                  ? 'No completed applications yet'
                  : 'No cancelled applications'
              }
              description={
                activeTab === 'active'
                  ? 'You do not have any ongoing service requests. Browse our legal and compliance catalogue to get started.'
                  : undefined
              }
              actionTitle={activeTab === 'active' ? 'Browse Catalogue' : undefined}
              onAction={
                activeTab === 'active'
                  ? () => navigation.navigate('ServicesBrowse')
                  : undefined
              }
            />
          }
          renderItem={({ item }) => (
            <Card
              style={styles.applicationCard}
              onPress={() => handleOpenDetail(item.id)}
            >
              {/* Card Header: Code & Status */}
              <View style={styles.cardHeader}>
                <View style={styles.codeRow}>
                  <Ionicons name="document-text-outline" size={16} color={colors.ink} />
                  <Text style={styles.codeText}>{item.code}</Text>
                </View>
                <Badge
                  label={item.statusLabel || item.status}
                  variant={statusVariant(item.status)}
                />
              </View>

              {/* Service & Package Name */}
              <Text style={styles.serviceName}>{item.serviceName}</Text>
              <Text style={styles.packageName}>{item.packageName} Package</Text>

              {/* Meta: Created Date */}
              <View style={styles.metaRow}>
                <Ionicons name="calendar-outline" size={14} color={colors.muted} />
                <Text style={styles.metaText}>Started on {formatDate(item.createdAt)}</Text>
              </View>

              {/* Action Button */}
              <View style={styles.cardFooter}>
                <Button
                  title={nextActionLabel(item.nextAction)}
                  variant={nextActionVariant(item.nextAction)}
                  size="sm"
                  onPress={() => handleAction(item)}
                  style={{ alignSelf: 'flex-start' }}
                />
                <TouchableOpacity
                  onPress={() => handleOpenDetail(item.id)}
                  style={styles.detailsLink}
                >
                  <Text style={styles.detailsLinkText}>View Details</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.ink} />
                </TouchableOpacity>
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  tabsHeader: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  tabButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
    marginHorizontal: 4,
  },
  tabButtonActive: {
    backgroundColor: colors.paper,
    borderBottomWidth: 2,
    borderBottomColor: colors.ink,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.muted,
  },
  tabTextActive: {
    color: colors.night,
    fontWeight: '700',
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  applicationCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  codeText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: 0.5,
  },
  serviceName: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.night,
    marginTop: spacing.xs,
  },
  packageName: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  metaText: {
    fontSize: 12,
    color: colors.muted,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  detailsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  detailsLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
  },
});
