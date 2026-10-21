import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../auth/auth-context';
import { colors, radius, spacing } from '../theme';
import { Card, Badge, Button } from '../components/common';
import type { ServiceDetail } from '@biznexa/api-client';

interface ServiceDetailScreenProps {
  readonly route: {
    readonly params: {
      readonly slug: string;
    };
  };
  readonly navigation: {
    readonly goBack: () => void;
    readonly navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

export function ServiceDetailScreen({ route, navigation }: Readonly<ServiceDetailScreenProps>) {
  const { slug } = route.params;
  const { api, user } = useAuth();
  const [service, setService] = useState<ServiceDetail | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [expandedFaqIndex, setExpandedFaqIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchService = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await api.GET('/api/catalogue/services/{slug}', {
        params: { path: { slug } },
      });
      if (res.data) {
        const data = res.data as ServiceDetail;
        setService(data);
        const popularPkg = data.packages?.find((p) => p.isMostPopular);
        setSelectedPackageId(popularPkg ? popularPkg.id : data.packages?.[0]?.id ?? null);
      } else {
        setError('Could not load service details.');
      }
    } catch {
      setError('Unable to reach server. Please check your connection.');
    } finally {
      setIsLoading(false);
    }
  }, [api, slug]);

  useEffect(() => {
    void fetchService();
  }, [fetchService]);

  const formatRupees = (paise?: number | null) => {
    if (paise == null) return '₹0';
    return `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.ink} />
        <Text style={styles.loadingText}>Loading service details...</Text>
      </View>
    );
  }

  if (error || !service) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorTitle}>Error</Text>
        <Text style={styles.errorSubtitle}>{error ?? 'Service not found.'}</Text>
        <Button title="Go Back" variant="secondary" onPress={() => navigation.goBack()} style={{ marginTop: spacing.md }} />
      </View>
    );
  }

  const selectedPkg = service.packages?.find((p) => p.id === selectedPackageId);

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Header Breadcrumbs / Title */}
        <View style={styles.header}>
          <View style={styles.badgeRow}>
            <Badge label={service.category.name} variant="ink" />
            {service.estimatedTime && <Badge label={service.estimatedTime} variant="neutral" />}
          </View>
          <Text style={styles.serviceName}>{service.name}</Text>
          <Text style={styles.serviceShortDesc}>{service.shortDescription}</Text>
        </View>

        {/* Packages Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Available Packages</Text>
          <Text style={styles.sectionSubtitle}>Select the package that fits your business needs.</Text>

          {service.packages?.map((pkg) => {
            const isSelected = pkg.id === selectedPackageId;
            return (
              <TouchableOpacity
                key={pkg.id}
                activeOpacity={0.8}
                onPress={() => setSelectedPackageId(pkg.id)}
                style={[styles.packageCard, isSelected && styles.packageCardSelected]}
              >
                <View style={styles.packageCardHeader}>
                  <View style={styles.packageCardTitleWrap}>
                    <Text style={[styles.packageName, isSelected && styles.packageNameSelected]}>
                      {pkg.name}
                    </Text>
                    {pkg.isMostPopular && <Badge label="Most Popular" variant="marigold" style={{ marginLeft: spacing.xs }} />}
                  </View>
                  <Text style={styles.packagePriceTotal}>{formatRupees(pkg.price.total)}</Text>
                </View>

                {/* Price Breakdown */}
                <View style={styles.priceBreakdown}>
                  <Text style={styles.priceBreakdownItem}>
                    Prof. fee: {formatRupees(pkg.professionalFee)} + GST: {formatRupees(pkg.price.totalTax)}
                  </Text>
                  {pkg.governmentFee > 0 && (
                    <Text style={styles.priceBreakdownGovt}>
                      Govt Fee: {formatRupees(pkg.governmentFee)}
                    </Text>
                  )}
                  {pkg.allowPartial && pkg.advancePercent && (
                    <Badge
                      label={`Partial payment available: ${pkg.advancePercent}% advance`}
                      variant="seal"
                      style={{ marginTop: 4 }}
                    />
                  )}
                </View>

                {/* Inclusions */}
                <View style={styles.inclusionsList}>
                  {pkg.inclusions?.map((inc) => (
                    <View key={inc} style={styles.inclusionRow}>
                      <Text style={styles.checkIcon}>✓</Text>
                      <Text style={styles.inclusionText}>{inc}</Text>
                    </View>
                  ))}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Documents Required */}
        {service.documents && service.documents.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Documents Required</Text>
            <Card style={styles.documentsCard}>
              {service.documents.map((doc, idx) => (
                <View key={doc.id ?? `${doc.name}-${doc.description ?? ''}`} style={[styles.docRow, idx > 0 && styles.docDivider]}>
                  <View style={styles.docInfo}>
                    <Text style={styles.docName}>{doc.name}</Text>
                    {doc.description && <Text style={styles.docDesc}>{doc.description}</Text>}
                  </View>
                  <Badge label={doc.isMandatory ? 'Mandatory' : 'Optional'} variant={doc.isMandatory ? 'ink' : 'neutral'} />
                </View>
              ))}
            </Card>
          </View>
        )}

        {/* Process Stages */}
        {service.stages && service.stages.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Process & Timeline</Text>
            <View style={styles.timelineList}>
              {service.stages.map((stage, idx) => (
                <View key={stage.id ?? `${stage.name}-${stage.description ?? ''}`} style={styles.timelineItem}>
                  <View style={styles.timelineMarker}>
                    <Text style={styles.timelineNumber}>{idx + 1}</Text>
                  </View>
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineTitle}>{stage.name}</Text>
                    {stage.description && <Text style={styles.timelineDesc}>{stage.description}</Text>}
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* FAQs */}
        {service.faqs && service.faqs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
            {service.faqs.map((faq, idx) => {
              const isOpen = expandedFaqIndex === idx;
              return (
                <Card key={`${faq.question}-${faq.answer}`} style={styles.faqCard}>
                  <TouchableOpacity
                    onPress={() => setExpandedFaqIndex(isOpen ? null : idx)}
                    style={styles.faqHeader}
                  >
                    <Text style={styles.faqQuestion}>{faq.question}</Text>
                    <Text style={styles.faqArrow}>{isOpen ? '▲' : '▼'}</Text>
                  </TouchableOpacity>
                  {isOpen && <Text style={styles.faqAnswer}>{faq.answer}</Text>}
                </Card>
              );
            })}
          </View>
        )}

        {/* Related Services */}
        {service.related && service.related.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Related Services</Text>
            {service.related.map((rel) => (
              <Card
                key={rel.id}
                style={styles.relatedCard}
                onPress={() => navigation.navigate('ServiceDetail', { slug: rel.slug })}
              >
                <Text style={styles.relatedName}>{rel.name}</Text>
                <Text style={styles.relatedPrice}>Starting at {formatRupees(rel.startingPrice)}</Text>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Sticky Bottom Booking Bar */}
      <View style={styles.bottomBar}>
        <View style={styles.bottomBarInfo}>
          <Text style={styles.bottomBarPkgName}>{selectedPkg?.name ?? 'Selected Package'}</Text>
          <Text style={styles.bottomBarPrice}>{formatRupees(selectedPkg?.price.total)}</Text>
        </View>
        <Button
          title={user ? 'Get Started' : 'Sign in to Apply'}
          variant="primary"
          size="md"
          onPress={() => {
            if (!user) {
              navigation.navigate('AuthModal');
            } else {
              if (!selectedPkg) return;
              navigation.navigate('BuyFlow', { slug: service.slug, packageId: selectedPkg.id });
            }
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 100,
  },
  header: {
    backgroundColor: colors.white,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  serviceName: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.night,
    marginTop: 4,
  },
  serviceShortDesc: {
    fontSize: 14,
    color: colors.muted,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  section: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.night,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: spacing.md,
  },
  packageCard: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.rule,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  packageCardSelected: {
    borderColor: colors.ink,
    backgroundColor: colors.ink050,
  },
  packageCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  packageCardTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  packageName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.night,
  },
  packageNameSelected: {
    color: colors.ink,
  },
  packagePriceTotal: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.ink,
  },
  priceBreakdown: {
    marginTop: spacing.xs,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  priceBreakdownItem: {
    fontSize: 12,
    color: colors.muted,
  },
  priceBreakdownGovt: {
    fontSize: 12,
    color: colors.amber,
    fontWeight: '500',
    marginTop: 2,
  },
  inclusionsList: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  inclusionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkIcon: {
    color: colors.seal,
    fontSize: 13,
    fontWeight: '700',
    marginRight: spacing.xs,
  },
  inclusionText: {
    fontSize: 13,
    color: colors.night,
    flex: 1,
  },
  documentsCard: {
    padding: spacing.md,
  },
  docRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  docDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  docInfo: {
    flex: 1,
    paddingRight: spacing.md,
  },
  docName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.night,
  },
  docDesc: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  timelineList: {
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  timelineMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  timelineNumber: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 13,
  },
  timelineContent: {
    flex: 1,
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  timelineTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.night,
  },
  timelineDesc: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 4,
    lineHeight: 16,
  },
  faqCard: {
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  faqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  faqQuestion: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.night,
    flex: 1,
    paddingRight: spacing.sm,
  },
  faqArrow: {
    fontSize: 10,
    color: colors.muted,
  },
  faqAnswer: {
    fontSize: 13,
    color: colors.muted,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  relatedCard: {
    marginBottom: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  relatedName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.night,
  },
  relatedPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    elevation: 8,
    shadowColor: colors.night,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  bottomBarInfo: {
    flex: 1,
  },
  bottomBarPkgName: {
    fontSize: 12,
    color: colors.muted,
  },
  bottomBarPrice: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.ink,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    fontSize: 14,
    color: colors.muted,
    marginTop: spacing.md,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.danger,
  },
  errorSubtitle: {
    fontSize: 14,
    color: colors.muted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
