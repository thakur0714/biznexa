import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../auth/auth-context';
import { colors, radius, spacing } from '../theme';
import { Card, Badge } from '../components/common';
import type { ServiceCard, CategorySummary } from '@biznexa/api-client';

type PopularService = ServiceCard;
type SearchResult = ServiceCard;

interface HomeScreenProps {
  readonly navigation: {
    readonly navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

export function HomeScreen({ navigation }: Readonly<HomeScreenProps>) {
  const { api, user } = useAuth();
  const [popularServices, setPopularServices] = useState<PopularService[]>([]);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [popRes, catRes] = await Promise.all([
        api.GET('/api/catalogue/popular'),
        api.GET('/api/catalogue/categories'),
      ]);

      if (popRes.data) {
        setPopularServices(popRes.data);
      }
      if (catRes.data) {
        setCategories(catRes.data);
      }
    } catch {
      // Offline or network error handled gracefully
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    void loadData();
  };

  const handleSearch = async (text: string) => {
    setSearchQuery(text);
    if (text.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const res = await api.GET('/api/catalogue/search', {
        params: { query: { q: text.trim() } },
      });
      if (res.data) {
        const searchData = res.data as unknown as { services: ServiceCard[] };
        setSearchResults(searchData.services);
      }
    } catch {
      // ignore
    } finally {
      setIsSearching(false);
    }
  };

  const formatRupees = (paise?: number | null) => {
    if (paise == null) return 'Price on request';
    return `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.ink]} />}
    >
      {/* Brand Header */}
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <Text style={styles.headerLogo}>BizNexa</Text>
          <Badge label="Verified Portal" variant="seal" />
        </View>
        <Text style={styles.headerTagline}>
          {user ? `Welcome back, ${user.name}` : 'Company registration, trademarks & business compliance made simple.'}
        </Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <TextInput
            placeholder="Search Private Limited, Trademark, GST..."
            placeholderTextColor={colors.muted}
            value={searchQuery}
            onChangeText={handleSearch}
            style={styles.searchInput}
            clearButtonMode="while-editing"
          />
          {isSearching && <ActivityIndicator size="small" color={colors.ink} style={styles.searchSpinner} />}
        </View>

        {/* Live Search Results Overlay */}
        {searchQuery.trim().length >= 2 && (
          <View style={styles.searchResultsBox}>
            {searchResults.length === 0 && !isSearching ? (
              <Text style={styles.noResultsText}>No services found matching &ldquo;{searchQuery}&rdquo;</Text>
            ) : (
              searchResults.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.searchResultItem}
                  onPress={() => {
                    setSearchQuery('');
                    navigation.navigate('ServiceDetail', { slug: item.slug });
                  }}
                >
                  <Text style={styles.searchResultName}>{item.name}</Text>
                  <Text style={styles.searchResultCategory}>{item.category.name} · {formatRupees(item.startingPrice)}</Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </View>

      {/* Trust Banner */}
      <View style={styles.trustBanner}>
        <View style={styles.trustItem}>
          <Text style={styles.trustTitle}>50,000+</Text>
          <Text style={styles.trustSubtitle}>Businesses Served</Text>
        </View>
        <View style={styles.trustDivider} />
        <View style={styles.trustItem}>
          <Text style={styles.trustTitle}>100%</Text>
          <Text style={styles.trustSubtitle}>Transparent Fees</Text>
        </View>
        <View style={styles.trustDivider} />
        <View style={styles.trustItem}>
          <Text style={styles.trustTitle}>Verified</Text>
          <Text style={styles.trustSubtitle}>Govt Filings</Text>
        </View>
      </View>

      {/* Categories */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Browse Categories</Text>
          <TouchableOpacity onPress={() => navigation.navigate('ServicesBrowse')}>
            <Text style={styles.seeAllText}>See all</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.ink} style={styles.loader} />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesScroll}>
            {categories.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={styles.categoryChip}
                onPress={() => navigation.navigate('ServicesBrowse', { categorySlug: cat.slug })}
              >
                <Text style={styles.categoryChipTitle}>{cat.name}</Text>
                <Text style={styles.categoryChipCount}>{cat.serviceCount} services</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Popular Services */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Most Popular Services</Text>
          <TouchableOpacity onPress={() => navigation.navigate('ServicesBrowse', { popular: true })}>
            <Text style={styles.seeAllText}>View all</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.ink} style={styles.loader} />
        ) : (
          popularServices.map((service) => (
            <Card
              key={service.id}
              style={styles.serviceCard}
              onPress={() => navigation.navigate('ServiceDetail', { slug: service.slug })}
            >
              <View style={styles.serviceCardHeader}>
                <Badge label={service.category.name} variant="ink" />
                {service.estimatedTime && (
                  <Text style={styles.serviceTime}>{service.estimatedTime}</Text>
                )}
              </View>

              <Text style={styles.serviceCardName}>{service.name}</Text>
              <Text style={styles.serviceCardDesc} numberOfLines={2}>
                {service.shortDescription}
              </Text>

              <View style={styles.serviceCardFooter}>
                <View>
                  <Text style={styles.priceLabel}>Starting from</Text>
                  <Text style={styles.priceValue}>{formatRupees(service.startingPrice)}</Text>
                </View>
                <View style={styles.viewButton}>
                  <Text style={styles.viewButtonText}>View Details &rarr;</Text>
                </View>
              </View>
            </Card>
          ))
        )}
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
    paddingBottom: spacing.xxxl,
  },
  header: {
    backgroundColor: colors.night,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headerLogo: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: -0.5,
  },
  headerTagline: {
    fontSize: 14,
    color: colors.rule,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  searchSection: {
    paddingHorizontal: spacing.lg,
    marginTop: -spacing.md,
    zIndex: 10,
  },
  searchBar: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.rule,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    shadowColor: colors.night,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: 14,
    color: colors.night,
  },
  searchSpinner: {
    marginLeft: spacing.sm,
  },
  searchResultsBox: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.rule,
    marginTop: spacing.xs,
    padding: spacing.sm,
    shadowColor: colors.night,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  searchResultItem: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  searchResultName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.night,
  },
  searchResultCategory: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  noResultsText: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  trustBanner: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.rule,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  trustItem: {
    alignItems: 'center',
  },
  trustTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  trustSubtitle: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  trustDivider: {
    width: 1,
    height: 24,
    backgroundColor: colors.rule,
  },
  section: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.night,
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
  },
  categoriesScroll: {
    paddingRight: spacing.lg,
    gap: spacing.sm,
  },
  categoryChip: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    minWidth: 130,
  },
  categoryChipTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.night,
  },
  categoryChipCount: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 4,
  },
  serviceCard: {
    marginBottom: spacing.md,
  },
  serviceCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  serviceTime: {
    fontSize: 12,
    color: colors.muted,
  },
  serviceCardName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.night,
    marginTop: 4,
  },
  serviceCardDesc: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
    lineHeight: 18,
  },
  serviceCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.paper,
  },
  priceLabel: {
    fontSize: 11,
    color: colors.muted,
  },
  priceValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  viewButton: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
  },
  viewButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
  },
  loader: {
    marginVertical: spacing.xl,
  },
});
