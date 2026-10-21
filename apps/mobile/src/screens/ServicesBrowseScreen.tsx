import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import { Card, Badge, Button } from '../components/common';
import type { ServiceCard, CategorySummary, ServiceList } from '@biznexa/api-client';

interface ServicesBrowseScreenProps {
  readonly route?: {
    readonly params?: {
      categorySlug?: string;
      popular?: boolean;
    };
  };
  readonly navigation: {
    readonly navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

export function ServicesBrowseScreen({ route, navigation }: Readonly<ServicesBrowseScreenProps>) {
  const { api } = useAuth();
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [services, setServices] = useState<ServiceCard[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(route?.params?.categorySlug ?? null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'popular' | 'price_asc' | 'price_desc' | 'name'>('popular');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await api.GET('/api/catalogue/categories');
      if (res.data) {
        setCategories(res.data);
      }
    } catch {
      // ignore
    }
  }, [api]);

  const fetchServices = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await api.GET('/api/catalogue/services', {
        params: {
          query: {
            category: selectedCategory ?? undefined,
            q: search.trim() || undefined,
            sort: sortBy,
            limit: 50,
          },
        },
      });
      if (res.data) {
        const data = res.data as unknown as ServiceList;
        setServices(data.items);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [api, selectedCategory, search, sortBy]);

  useEffect(() => {
    void fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    if (route?.params?.categorySlug !== undefined) {
      setSelectedCategory(route.params.categorySlug);
    }
  }, [route?.params?.categorySlug]);

  useEffect(() => {
    void fetchServices();
  }, [fetchServices]);

  const onRefresh = () => {
    setRefreshing(true);
    void fetchServices();
  };

  const formatRupees = (paise?: number | null) => {
    if (paise == null) return 'Price on request';
    return `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
  };

  let servicesContent: React.ReactNode;
  if (isLoading && !refreshing) {
    servicesContent = (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.ink} />
        <Text style={styles.loadingText}>Loading catalogue...</Text>
      </View>
    );
  } else if (services.length === 0) {
    servicesContent = (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyTitle}>No services found</Text>
        <Text style={styles.emptySubtitle}>Try adjusting your search or category filters.</Text>
        <Button
          title="Reset Filters"
          variant="secondary"
          size="sm"
          style={{ marginTop: spacing.md }}
          onPress={() => {
            setSearch('');
            setSelectedCategory(null);
          }}
        />
      </View>
    );
  } else {
    servicesContent = (
      <FlatList
        data={services}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.ink]} />}
        renderItem={({ item }) => (
          <Card
            style={styles.card}
            onPress={() => navigation.navigate('ServiceDetail', { slug: item.slug })}
          >
            <View style={styles.cardTop}>
              <Badge label={item.category.name} variant="ink" />
              {item.estimatedTime && <Text style={styles.cardTimeline}>{item.estimatedTime}</Text>}
            </View>
            <Text style={styles.cardTitle}>{item.name}</Text>
            <Text style={styles.cardDesc} numberOfLines={2}>{item.shortDescription}</Text>
            <View style={styles.cardBottom}>
              <View>
                <Text style={styles.cardPriceLabel}>Starting at</Text>
                <Text style={styles.cardPriceValue}>{formatRupees(item.startingPrice)}</Text>
              </View>
              {item.governmentFeeFrom > 0 && (
                <Text style={styles.cardGovtFee}>+ {formatRupees(item.governmentFeeFrom)} govt fee</Text>
              )}
            </View>
          </Card>
        )}
      />
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Search & Filter Bar */}
      <View style={styles.searchContainer}>
        <TextInput
          placeholder="Filter by service name or keyword..."
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
          style={styles.searchInput}
          clearButtonMode="while-editing"
        />

        {/* Category Filter Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterPills}
        >
          <TouchableOpacity
            style={[styles.pill, selectedCategory === null && styles.pillActive]}
            onPress={() => setSelectedCategory(null)}
          >
            <Text style={[styles.pillText, selectedCategory === null && styles.pillTextActive]}>
              All Services
            </Text>
          </TouchableOpacity>
          {categories.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.pill, selectedCategory === c.slug && styles.pillActive]}
              onPress={() => setSelectedCategory(selectedCategory === c.slug ? null : c.slug)}
            >
              <Text style={[styles.pillText, selectedCategory === c.slug && styles.pillTextActive]}>
                {c.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Sort Options */}
        <View style={styles.sortBar}>
          <Text style={styles.sortLabel}>Sort by:</Text>
          <TouchableOpacity onPress={() => setSortBy('popular')}>
            <Text style={[styles.sortOption, sortBy === 'popular' && styles.sortOptionActive]}>Popular</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSortBy('price_asc')}>
            <Text style={[styles.sortOption, sortBy === 'price_asc' && styles.sortOptionActive]}>Price &uarr;</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSortBy('price_desc')}>
            <Text style={[styles.sortOption, sortBy === 'price_desc' && styles.sortOptionActive]}>Price &darr;</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSortBy('name')}>
            <Text style={[styles.sortOption, sortBy === 'name' && styles.sortOptionActive]}>A-Z</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Services List */}
      {servicesContent}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  searchContainer: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  searchInput: {
    backgroundColor: colors.paper,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.rule,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.night,
    marginBottom: spacing.sm,
  },
  filterPills: {
    paddingVertical: spacing.xs,
    gap: spacing.xs + 2,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  pillActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.muted,
  },
  pillTextActive: {
    color: colors.white,
    fontWeight: '600',
  },
  sortBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
  },
  sortLabel: {
    fontSize: 12,
    color: colors.muted,
  },
  sortOption: {
    fontSize: 12,
    color: colors.muted,
  },
  sortOptionActive: {
    color: colors.ink,
    fontWeight: '700',
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  card: {
    marginBottom: spacing.md,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  cardTimeline: {
    fontSize: 12,
    color: colors.muted,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.night,
    marginTop: 2,
  },
  cardDesc: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
    lineHeight: 18,
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.paper,
  },
  cardPriceLabel: {
    fontSize: 11,
    color: colors.muted,
  },
  cardPriceValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  cardGovtFee: {
    fontSize: 12,
    color: colors.muted,
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
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.night,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.muted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
