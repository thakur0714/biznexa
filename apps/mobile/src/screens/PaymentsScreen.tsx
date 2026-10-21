import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  CustomerPaymentListResponse,
} from '@biznexa/types';
import { formatDate, formatINR } from '@biznexa/types';
import { useAuth } from '../auth/auth-context';
import { colors, radius, spacing } from '../theme';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '../components/common';
import { resolveApiUrl } from '../api/client';

interface PaymentsScreenProps {
  readonly navigation: {
    readonly goBack: () => void;
    readonly navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

function paymentStatusVariant(status: string): 'seal' | 'marigold' | 'ink' | 'danger' | 'neutral' {
  switch (status) {
    case 'SUCCESS':
      return 'seal';
    case 'PENDING':
    case 'REFUND_INITIATED':
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'marigold';
    case 'FAILED':
      return 'danger';
    case 'CREATED':
    default:
      return 'neutral';
  }
}

export function PaymentsScreen({ navigation }: Readonly<PaymentsScreenProps>) {
  const { api, user } = useAuth();
  const [data, setData] = useState<CustomerPaymentListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPayments = useCallback(
    async (refresh = false) => {
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
        const res = await api.GET('/api/payments', {
          params: {
            query: { page: 1, limit: 30 },
          },
        });

        if (res.data) {
          setData(res.data as CustomerPaymentListResponse);
        } else if (res.error) {
          setError('Failed to fetch payment history');
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
    void fetchPayments();
  }, [fetchPayments]);

  const downloadInvoice = async (invoiceId: string) => {
    try {
      const res = await api.POST('/api/invoices/{id}/link', {
        params: {
          path: { id: invoiceId },
          query: { disposition: 'attachment' },
        },
      });

      if (res.data?.url) {
        const directUrl = resolveApiUrl(res.data.url);
        await Linking.openURL(directUrl);
      } else {
        Alert.alert('Notice', 'Invoice is generating, please retry shortly.');
      }
    } catch (e) {
      Alert.alert('Download Error', e instanceof Error ? e.message : 'Failed to download invoice');
    }
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in to view payments & invoices"
          description="View your transaction history, receipts, tax invoices, and pay any pending balances."
          actionTitle="Sign In"
          onAction={() => navigation.navigate('AuthModal')}
          style={{ flex: 1 }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isLoading && <LoadingState message="Loading payments & invoices…" style={{ flex: 1 }} />}
      {!isLoading && error ? <ErrorState message={error} onRetry={() => void fetchPayments()} style={{ flex: 1 }} /> : null}
      {!isLoading && !error && (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void fetchPayments(true)}
              tintColor={colors.ink}
            />
          }
          ListHeaderComponent={
            data ? (
              <View style={styles.summaryContainer}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Total Paid</Text>
                  <Text style={styles.summaryValue}>{formatINR(data.totalPaid)}</Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Outstanding</Text>
                  <Text
                    style={[
                      styles.summaryValue,
                      data.outstandingBalance > 0 ? styles.summaryAlert : undefined,
                    ]}
                  >
                    {formatINR(data.outstandingBalance)}
                  </Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Refunded</Text>
                  <Text style={styles.summaryValue}>{formatINR(data.totalRefunded)}</Text>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="card-outline"
              title="No payment records found"
              description="Your order payments and tax invoices will appear here once transactions are recorded."
            />
          }
          renderItem={({ item }) => {
            const hasBalance = item.order.balance > 0;

            return (
              <Card style={styles.paymentCard}>
                <View style={styles.paymentCardHeader}>
                  <View>
                    <Text style={styles.orderCode}>{item.order.code}</Text>
                    <Text style={styles.paymentDate}>
                      {formatDate(item.createdAt)} • {item.gateway}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.amountText}>{formatINR(item.amount)}</Text>
                    <Badge label={item.status} variant={paymentStatusVariant(item.status)} />
                  </View>
                </View>

                {/* Balance notice if applicable */}
                {hasBalance && (
                  <View style={styles.balanceRow}>
                    <Text style={styles.balanceText}>
                      Pending Balance: {formatINR(item.order.balance)}
                    </Text>
                    {item.order.applicationId && (
                      <Button
                        title="Pay Balance"
                        variant="primary"
                        size="sm"
                        onPress={() =>
                          navigation.navigate('ApplicationDetail', {
                            applicationId: item.order.applicationId!,
                            initialTab: 'payments',
                          })
                        }
                      />
                    )}
                  </View>
                )}

                {/* Refunds info if any */}
                {item.refunds && item.refunds.length > 0 && (
                  <View style={styles.refundsBox}>
                    {item.refunds.map((ref) => (
                      <Text key={ref.id} style={styles.refundText}>
                        Refund: {formatINR(ref.amount)} ({ref.status})
                      </Text>
                    ))}
                  </View>
                )}

                {/* Invoice Footer */}
                {item.invoice && (
                  <View style={styles.invoiceFooter}>
                    <View style={styles.invoiceInfo}>
                      <Ionicons name="receipt-outline" size={16} color={colors.ink} />
                      <Text style={styles.invoiceNumberText}>{item.invoice.number}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => void downloadInvoice(item.invoice!.id)}
                      style={styles.downloadButton}
                    >
                      <Ionicons name="download-outline" size={16} color={colors.ink} />
                      <Text style={styles.downloadText}>Download Invoice</Text>
                    </TouchableOpacity>
                  </View>
                )}
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
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  summaryContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  summaryLabel: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.night,
    marginTop: 4,
  },
  summaryAlert: {
    color: colors.amber,
  },
  paymentCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.white,
    padding: spacing.md,
  },
  paymentCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  orderCode: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.night,
  },
  paymentDate: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  amountText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 4,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
    backgroundColor: colors.amber050,
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  balanceText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.amber,
  },
  refundsBox: {
    backgroundColor: colors.paper,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
  },
  refundText: {
    fontSize: 12,
    color: colors.muted,
  },
  invoiceFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  invoiceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  invoiceNumberText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.night,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  downloadText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.ink,
  },
});
