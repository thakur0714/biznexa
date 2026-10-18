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
import type { CustomerDocuments, DocumentChecklistItem } from '@biznexa/types';
import { formatDate } from '@biznexa/types';
import { useAuth } from '../auth/auth-context';
import { colors, radius, spacing } from '../theme';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '../components/common';

interface DocumentsScreenProps {
  navigation: {
    goBack: () => void;
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

type FilterOption = 'needs_action' | 'all';

function statusVariant(status: string): 'seal' | 'marigold' | 'ink' | 'danger' | 'neutral' {
  switch (status) {
    case 'APPROVED':
      return 'seal';
    case 'REQUIRED':
    case 'REJECTED':
      return 'danger';
    case 'UPLOADED':
    case 'UNDER_REVIEW':
      return 'ink';
    default:
      return 'neutral';
  }
}

export function DocumentsScreen({ navigation }: DocumentsScreenProps) {
  const { api, user } = useAuth();
  const [filter, setFilter] = useState<FilterOption>('needs_action');
  const [documentsData, setDocumentsData] = useState<CustomerDocuments | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(
    async (currentFilter: FilterOption, refresh = false) => {
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
        const res = await api.GET('/api/documents', {
          params: {
            query: { status: currentFilter },
          },
        });

        if (res.data) {
          setDocumentsData(res.data as CustomerDocuments);
        } else if (res.error) {
          setError('Failed to fetch your documents');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [api, user]
  );

  useEffect(() => {
    void fetchDocuments(filter);
  }, [filter, fetchDocuments]);

  if (!user) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in to view your documents"
          description="Access and manage compliance documents across all your applications in one place."
          actionTitle="Sign In"
          onAction={() => navigation.navigate('AuthModal')}
          style={{ flex: 1 }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Filter Tabs */}
      <View style={styles.filterBar}>
        <TouchableOpacity
          onPress={() => setFilter('needs_action')}
          style={[styles.filterTab, filter === 'needs_action' && styles.filterTabActive]}
          activeOpacity={0.8}
        >
          <Text style={[styles.filterText, filter === 'needs_action' && styles.filterTextActive]}>
            Needs Action
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setFilter('all')}
          style={[styles.filterTab, filter === 'all' && styles.filterTabActive]}
          activeOpacity={0.8}
        >
          <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>
            All Applications
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {isLoading ? (
        <LoadingState message="Loading documents…" style={{ flex: 1 }} />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => void fetchDocuments(filter)}
          style={{ flex: 1 }}
        />
      ) : (
        <FlatList
          data={documentsData ?? []}
          keyExtractor={(item) => item.applicationId}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void fetchDocuments(filter, true)}
              tintColor={colors.ink}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="document-text-outline"
              title={filter === 'needs_action' ? 'All caught up!' : 'No documents found'}
              description={
                filter === 'needs_action'
                  ? 'No documents currently require upload or revision.'
                  : 'You do not have any applications with document checklists.'
              }
            />
          }
          renderItem={({ item }) => {
            const pending = item.checklist.pendingMandatory;

            return (
              <Card style={styles.appDocCard}>
                <View style={styles.appDocHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.appCode}>{item.applicationCode}</Text>
                    <Text style={styles.serviceTitle}>{item.serviceName}</Text>
                  </View>
                  {pending > 0 ? (
                    <Badge label={`${pending} Pending`} variant="marigold" />
                  ) : (
                    <Badge label="Complete" variant="seal" />
                  )}
                </View>

                {/* Items preview */}
                <View style={styles.checklistSummary}>
                  {item.checklist.items.map((doc: DocumentChecklistItem) => {
                    const status = doc.current?.status || (doc.requirement.isMandatory ? 'REQUIRED' : 'OPTIONAL');
                    return (
                      <View key={doc.requirement.id} style={styles.docRow}>
                        <Ionicons
                          name={
                            status === 'APPROVED'
                              ? 'checkmark-circle'
                              : status === 'REJECTED' || status === 'REQUIRED'
                              ? 'alert-circle-outline'
                              : 'time-outline'
                          }
                          size={16}
                          color={
                            status === 'APPROVED'
                              ? colors.seal
                              : status === 'REJECTED' || status === 'REQUIRED'
                              ? colors.danger
                              : colors.muted
                          }
                        />
                        <Text numberOfLines={1} style={styles.docRowTitle}>
                          {doc.requirement.name}
                        </Text>
                        <Badge label={status} variant={statusVariant(status)} />
                      </View>
                    );
                  })}
                </View>

                {/* Action button */}
                <Button
                  title="Upload / Manage Documents"
                  variant="primary"
                  size="sm"
                  onPress={() =>
                    navigation.navigate('ApplicationDetail', {
                      applicationId: item.applicationId,
                      initialTab: 'documents',
                    })
                  }
                  style={{ marginTop: spacing.md }}
                />
              </Card>
            );
          }}
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
  filterBar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  filterTab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
    marginHorizontal: 4,
  },
  filterTabActive: {
    backgroundColor: colors.paper,
    borderBottomWidth: 2,
    borderBottomColor: colors.ink,
  },
  filterText: {
    fontSize: 14,
    color: colors.muted,
    fontWeight: '500',
  },
  filterTextActive: {
    color: colors.night,
    fontWeight: '700',
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  appDocCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.white,
    padding: spacing.md,
  },
  appDocHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  appCode: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
  },
  serviceTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.night,
    marginTop: 2,
  },
  checklistSummary: {
    backgroundColor: colors.paper,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 8,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  docRowTitle: {
    flex: 1,
    fontSize: 13,
    color: colors.night,
    fontWeight: '500',
  },
});
