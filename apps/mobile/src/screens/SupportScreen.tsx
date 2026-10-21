import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import type { CustomerTicketListPage, TicketDetail, TicketSummary } from '@biznexa/types';
import { useAuth } from '../auth/auth-context';
import { uploadMobileFile } from '../api/upload';
import { Button, Card, EmptyState, ErrorState, LoadingState } from '../components/common';
import { colors, spacing } from '../theme';
import { fetchCachedList } from '../api/offline-cache';

export function SupportScreen({ route }: Readonly<{ readonly route?: { readonly params?: { readonly ticketId?: string } } }>) {
  const { api, token, user } = useAuth();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(route?.params?.ticketId ?? null);
  const [creating, setCreating] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    if (!user) { setTickets([]); setTicket(null); setOffline(false); setLoading(false); return; }
    try {
      if (ticketId) {
        const { data, error: apiError } = await api.GET('/api/tickets/{id}', { params: { path: { id: ticketId } } });
        if (apiError || !data) throw new Error('Could not load this ticket.');
        setTicket(data as TicketDetail);
      } else {
        const result = await fetchCachedList(`tickets:${user.id}`, async () => {
          const { data, error: apiError } = await api.GET('/api/tickets', { params: { query: { page: 1, limit: 100 } } });
          if (apiError || !data) throw new Error('Could not load your tickets.');
          return (data as CustomerTicketListPage).items;
        });
        setTickets(result.data);
        setOffline(result.offline);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load support.'); }
    finally { setLoading(false); }
  }, [api, ticketId, user]);
  useEffect(() => { void load(); }, [load]);

  async function createTicket() {
    setBusy(true);
    try {
      const { data, error: apiError } = await api.POST('/api/tickets', { body: { subject, description: message, priority: 'MEDIUM' } });
      if (apiError || !data) throw new Error('Could not create your ticket.');
      const summary = data as TicketSummary;
      // The ticket exists now: if the attachment fails, open the ticket anyway (retrying would create a duplicate).
      if (attachment) {
        try {
          const uploaded = await uploadMobileFile({ uri: attachment.uri, name: attachment.name, mimeType: attachment.mimeType ?? 'application/octet-stream', token });
          const { error: msgError } = await api.POST('/api/tickets/{id}/messages', { params: { path: { id: summary.id } }, body: { body: 'Attachment for this request', fileIds: [uploaded.id] } });
          if (msgError) throw new Error('Attachment could not be sent.');
        } catch {
          Alert.alert('Ticket created', 'Your attachment could not be sent. Add it again from the ticket.');
        }
      }
      setCreating(false); setSubject(''); setMessage(''); setAttachment(null); setTicketId(summary.id);
    } catch (e) { Alert.alert('Could not create ticket', e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  async function sendReply() {
    if (!ticket || !reply.trim()) return;
    setBusy(true);
    try {
      let fileIds: string[] = [];
      if (attachment) {
        const uploaded = await uploadMobileFile({ uri: attachment.uri, name: attachment.name, mimeType: attachment.mimeType ?? 'application/octet-stream', token });
        fileIds = [uploaded.id];
      }
      const { error: apiError } = await api.POST('/api/tickets/{id}/messages', { params: { path: { id: ticket.id } }, body: { body: reply.trim(), fileIds: fileIds.length ? fileIds : undefined } });
      if (apiError) throw new Error('Message could not be sent.');
      setReply(''); setAttachment(null); await load();
    } catch (e) { Alert.alert('Could not send message', e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  const chooseAttachment = async () => { const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: ['application/pdf', 'image/*'] }); if (!result.canceled) setAttachment(result.assets[0]); };

  if (loading) return <LoadingState message="Loading support…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (ticketId && ticket) return <ScrollView contentContainerStyle={styles.content}>
    <Button title="Back to tickets" variant="ghost" onPress={() => { setTicketId(null); setTicket(null); }} />
    <Text style={styles.title}>{ticket.subject}</Text><Text style={styles.muted}>{ticket.code} · {ticket.status}</Text>
    {ticket.messages.map((item) => <Card key={item.id}><Text style={styles.muted}>{item.sender.name}</Text><Text style={styles.text}>{item.body}</Text>{item.attachments?.map((file) => <Text key={file.id} style={styles.link}>📎 {file.fileName}</Text>)}</Card>)}
    <TextInput value={reply} onChangeText={setReply} placeholder="Write a reply" multiline style={styles.input} />
    <Button title={attachment ? `Attach: ${attachment.name}` : 'Add attachment'} variant="secondary" onPress={chooseAttachment} />
    <Button title="Send reply" loading={busy} disabled={!reply.trim()} onPress={sendReply} />
  </ScrollView>;
  if (creating) return <ScrollView contentContainerStyle={styles.content}>
    <Button title="Cancel" variant="ghost" onPress={() => setCreating(false)} /><Text style={styles.title}>New support ticket</Text>
    <TextInput value={subject} onChangeText={setSubject} placeholder="Subject" style={styles.input} />
    <TextInput value={message} onChangeText={setMessage} placeholder="Describe how we can help" multiline style={[styles.input, styles.multiline]} />
    <Button title={attachment ? `Attach: ${attachment.name}` : 'Add attachment'} variant="secondary" onPress={chooseAttachment} />
    <Button title="Create ticket" loading={busy} disabled={subject.trim().length < 3 || message.trim().length < 5} onPress={createTicket} />
  </ScrollView>;
  return <View style={styles.flex}>
    <View style={styles.header}><Text style={styles.title}>Support tickets</Text><Button title="New ticket" size="sm" onPress={() => setCreating(true)} /></View>
    <FlatList data={tickets} keyExtractor={(item) => item.id} contentContainerStyle={styles.content} ListHeaderComponent={offline ? <Text accessibilityRole="alert" style={styles.offline}>Offline · showing your last loaded tickets</Text> : null} ListEmptyComponent={<EmptyState title="No support tickets" description="Create a ticket and our team will help." />} renderItem={({ item }) => <TouchableOpacity onPress={() => { setTicketId(item.id); setLoading(true); }}><Card><Text style={styles.text}>{item.subject}</Text><Text style={styles.muted}>{item.code} · {item.status}</Text></Card></TouchableOpacity>} />
  </View>;
}

const styles = StyleSheet.create({ flex: { flex: 1, backgroundColor: colors.paper }, content: { padding: spacing.lg, gap: spacing.md }, header: { padding: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { fontSize: 22, fontWeight: '700', color: colors.night }, muted: { color: colors.muted, fontSize: 13 }, text: { color: colors.night, fontSize: 16, fontWeight: '600' }, link: { color: colors.ink, marginTop: 8 }, input: { borderWidth: 1, borderColor: colors.rule, borderRadius: 10, padding: 12, color: colors.night, backgroundColor: colors.white }, multiline: { minHeight: 130, textAlignVertical: 'top' }, offline: { backgroundColor: '#fff1c2', color: colors.night, textAlign: 'center', padding: spacing.sm, fontWeight: '600' } });
