import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { BookingList, BookingView, PublicConsultantDirectory, PublicConsultantSlots, PublicConsultantCard } from '@biznexa/types';
import { formatDateTime, formatINR } from '@biznexa/types';
import { useAuth } from '../auth/auth-context';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '../components/common';
import { colors, spacing } from '../theme';
import { canChangeBooking, getJoinLink } from './consultation-logic';

export function ConsultationsScreen({ route }: { route?: { params?: { bookingId?: string } } }) {
  const { api } = useAuth();
  const [tab, setTab] = useState<'consultants' | 'bookings'>(route?.params?.bookingId ? 'bookings' : 'consultants');
  const [consultants, setConsultants] = useState<PublicConsultantCard[]>([]);
  const [bookings, setBookings] = useState<BookingView[]>([]);
  const [consultant, setConsultant] = useState<PublicConsultantCard | null>(null);
  const [slots, setSlots] = useState<PublicConsultantSlots['slots']>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [type, setType] = useState<'AUDIO' | 'VIDEO' | 'CHAT' | 'MEETING'>('VIDEO');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [changeBooking, setChangeBooking] = useState<BookingView | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [directory, mine] = await Promise.all([
        api.GET('/api/public/consultants', { params: { query: { page: 1, limit: 100 } } }),
        api.GET('/api/bookings'),
      ]);
      if (directory.error || !directory.data || mine.error || !mine.data) throw new Error('Could not load consultations.');
      setConsultants((directory.data as PublicConsultantDirectory).items);
      setBookings((mine.data as BookingList).items);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load consultations.'); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  async function chooseConsultant(item: PublicConsultantCard) {
    setConsultant(item); setSelectedSlot(null); setType(item.consultationTypes[0] ?? 'VIDEO'); setLoading(true);
    try {
      const end = new Date(new Date(`${from}T00:00:00`).getTime() + 13 * 86_400_000).toISOString().slice(0, 10);
      const { data, error: apiError } = await api.GET('/api/public/consultants/{slug}/slots', { params: { path: { slug: item.slug }, query: { from, to: end } } });
      if (apiError || !data) throw new Error('Could not load available slots.');
      setSlots((data as PublicConsultantSlots).slots);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load slots.'); }
    finally { setLoading(false); }
  }
  async function book() {
    if (!consultant || !selectedSlot) return;
    setBusy(true);
    try {
      const webBase = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://biznexa.in';
      await Linking.openURL(`${webBase}/consultants/${encodeURIComponent(consultant.slug)}/book?type=${encodeURIComponent(type)}&slot=${encodeURIComponent(selectedSlot)}`);
      setConsultant(null); setTab('bookings'); await load();
    } catch (e) { Alert.alert('Booking not completed', e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  async function cancel(booking: BookingView) {
    try { await api.POST('/api/bookings/{id}/cancel', { params: { path: { id: booking.id } }, body: {} }); await load(); }
    catch (e) { Alert.alert('Cannot cancel booking', e instanceof Error ? e.message : 'The configured change window may have passed.'); }
  }
  async function reschedule() {
    if (!changeBooking || !selectedSlot) return;
    try { await api.POST('/api/bookings/{id}/reschedule', { params: { path: { id: changeBooking.id } }, body: { startAt: selectedSlot } }); setChangeBooking(null); setSelectedSlot(null); await load(); }
    catch (e) { Alert.alert('Cannot reschedule booking', e instanceof Error ? e.message : 'Choose an available future slot inside the configured change window.'); }
  }
  async function loadChangeSlots() {
    if (!changeBooking) return;
    setLoading(true);
    try {
      const end = new Date(new Date(`${from}T00:00:00`).getTime() + 13 * 86_400_000).toISOString().slice(0, 10);
      const { data, error: apiError } = await api.GET('/api/public/consultants/{slug}/slots', { params: { path: { slug: changeBooking.consultant.slug }, query: { from, to: end } } });
      if (apiError || !data) throw new Error('Could not load available slots.');
      setSlots((data as PublicConsultantSlots).slots);
    } catch (e) { Alert.alert('Could not load slots', e instanceof Error ? e.message : 'Please try again.'); }
    finally { setLoading(false); }
  }

  if (loading) return <LoadingState message="Loading consultations…" />;
  if (error) return <ErrorState message={error} onRetry={() => { setError(''); void load(); }} />;
  if (consultant) return <ScrollView contentContainerStyle={styles.content}>
    <Button title="Back to consultants" variant="ghost" onPress={() => setConsultant(null)} />
    <Text style={styles.title}>Book {consultant.name}</Text><Text style={styles.muted}>{consultant.qualification} · {consultant.city}</Text><Text style={styles.text}>{formatINR(consultant.feePerSession)} · {consultant.sessionMinutes} minutes</Text>
    <Text style={styles.label}>Consultation type</Text><View style={styles.row}>{consultant.consultationTypes.map((item) => <Button key={item} title={item} size="sm" variant={item === type ? 'primary' : 'secondary'} onPress={() => setType(item)} />)}</View>
    <TextInput value={from} onChangeText={(value) => setFrom(value)} placeholder="Start date (YYYY-MM-DD)" style={styles.input} />
    {slots.map((slot) => <TouchableOpacity key={slot.startAt} onPress={() => setSelectedSlot(slot.startAt)}><Card style={selectedSlot === slot.startAt ? styles.selected : undefined}><Text style={styles.text}>{formatDateTime(slot.startAt)}</Text></Card></TouchableOpacity>)}
    {!slots.length && <EmptyState title="No slots listed" description="Try another date range or consultant." />}
    <Button title="Continue to web checkout" loading={busy} disabled={!selectedSlot} onPress={book} />
  </ScrollView>;
  if (changeBooking) return <ScrollView contentContainerStyle={styles.content}><Button title="Back to bookings" variant="ghost" onPress={() => { setChangeBooking(null); setSelectedSlot(null); }} /><Text style={styles.title}>Reschedule {changeBooking.code}</Text><TextInput value={from} onChangeText={setFrom} placeholder="Start date (YYYY-MM-DD)" style={styles.input} /><Button title="Find available slots" variant="secondary" onPress={loadChangeSlots} />{slots.map((slot) => <TouchableOpacity key={slot.startAt} onPress={() => setSelectedSlot(slot.startAt)}><Card style={selectedSlot === slot.startAt ? styles.selected : undefined}><Text style={styles.text}>{formatDateTime(slot.startAt)}</Text></Card></TouchableOpacity>)}<Button title="Confirm reschedule" disabled={!selectedSlot} onPress={reschedule} /></ScrollView>;
  return <View style={styles.flex}>
    <View style={styles.row}><Button title="Consultants" variant={tab === 'consultants' ? 'primary' : 'secondary'} onPress={() => setTab('consultants')} /><Button title="My bookings" variant={tab === 'bookings' ? 'primary' : 'secondary'} onPress={() => setTab('bookings')} /></View>
    {tab === 'consultants' ? <FlatList data={consultants} keyExtractor={(item) => item.id} contentContainerStyle={styles.content} ListEmptyComponent={<EmptyState title="No consultants available" description="Check back soon." />} renderItem={({ item }) => <TouchableOpacity onPress={() => void chooseConsultant(item)}><Card><Text style={styles.text}>{item.name}</Text><Text style={styles.muted}>{item.qualification} · {item.city} · {item.rating.toFixed(1)} ★</Text><Text style={styles.text}>{formatINR(item.feePerSession)} / {item.sessionMinutes} min</Text></Card></TouchableOpacity>} /> : <FlatList data={bookings} keyExtractor={(item) => item.id} contentContainerStyle={styles.content} ListEmptyComponent={<EmptyState title="No bookings yet" description="Book a consultation with a verified expert." />} renderItem={({ item }) => <Card><Text style={styles.text}>{item.consultant.name} · {item.status}</Text><Text style={styles.muted}>{item.code} · {formatDateTime(item.startAt)}</Text>{getJoinLink(item) && <Button title="Join consultation" onPress={() => void Linking.openURL(getJoinLink(item)!)} />}{canChangeBooking(item) && <View style={styles.row}><Button title="Reschedule" variant="secondary" onPress={() => setChangeBooking(item)} /><Button title="Cancel" variant="danger" onPress={() => Alert.alert('Cancel booking?', 'The change window is enforced by the server.', [{ text: 'Keep', style: 'cancel' }, { text: 'Cancel booking', style: 'destructive', onPress: () => void cancel(item) }])} /></View>}</Card>} />}
  </View>;
}

const styles = StyleSheet.create({ flex: { flex: 1, backgroundColor: colors.paper }, content: { padding: spacing.lg, gap: spacing.md }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md }, title: { color: colors.night, fontSize: 22, fontWeight: '700' }, label: { color: colors.night, fontWeight: '700' }, text: { color: colors.night, fontSize: 16, fontWeight: '600' }, muted: { color: colors.muted, marginTop: 4 }, input: { borderWidth: 1, borderColor: colors.rule, borderRadius: 10, backgroundColor: colors.white, padding: 12 }, selected: { borderColor: colors.ink, borderWidth: 2 } });
