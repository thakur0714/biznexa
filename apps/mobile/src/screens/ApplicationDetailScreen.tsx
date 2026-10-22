import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  type CustomerApplicationTimeline,
  type CustomerTimelineStage,
  type DocumentChecklist,
  type DocumentChecklistItem,
  type AdditionalDocumentItem,
  type Message,
  type MessageThreadPage,
  type InvoiceSummary,
  type PaymentCheckout,
  type FileMimeType,
  formatDate,
  formatDateTime,
  formatINR,
  describeFileTypes,
  isKnownFileType,
} from '@biznexa/types';
import { useAuth } from '../auth/auth-context';
import { colors, radius, spacing } from '../theme';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '../components/common';
import { resolveApiUrl } from '../api/client';
import { uploadMobileFile } from '../api/upload';

type DetailTab = 'timeline' | 'messages' | 'documents' | 'payments';

interface ApplicationDetailScreenProps {
  route: {
    params: {
      applicationId: string;
      initialTab?: DetailTab;
    };
  };
  navigation: {
    goBack: () => void;
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

function statusVariant(status: string): 'seal' | 'marigold' | 'ink' | 'danger' | 'neutral' {
  switch (status) {
    case 'COMPLETED':
    case 'DELIVERED':
    case 'APPROVED':
      return 'seal';
    case 'PAYMENT_PENDING':
    case 'DOCUMENTS_PENDING':
    case 'DOCUMENTS_REJECTED':
      return 'marigold';
    case 'SUBMITTED':
    case 'DOCUMENTS_UNDER_REVIEW':
    case 'UNDER_REVIEW':
    case 'IN_PROGRESS':
    case 'GOVERNMENT_PROCESSING':
    case 'UPLOADED':
      return 'ink';
    case 'CANCELLED':
    case 'REJECTED':
      return 'danger';
    default:
      return 'neutral';
  }
}

function loadStateContent(loading: boolean, hasError: boolean, loadingContent: React.ReactNode, errorContent: React.ReactNode, content: React.ReactNode): React.ReactNode {
  if (loading) return loadingContent;
  if (hasError) return errorContent;
  return content;
}

function stageIndicator(isDone: boolean, isCurrent: boolean) {
  if (isDone) return <Ionicons name="checkmark" size={14} color={colors.white} />;
  if (isCurrent) return <View style={styles.stageInnerDot} />;
  return <View style={styles.stageUpcomingDot} />;
}

/** Banner above the checklist: how many mandatory documents still need the customer. */
function DocumentsNotice({ pendingMandatory }: Readonly<{ pendingMandatory: number }>) {
  const pending = pendingMandatory > 0;
  return (
    <View style={[styles.docNoticeBanner, pending ? styles.docNoticePending : styles.docNoticeSuccess]}>
      <Ionicons name={pending ? 'alert-circle' : 'checkmark-circle'} size={20} color={pending ? colors.amber : colors.seal} />
      <Text style={styles.docNoticeText}>
        {pending ? `${pendingMandatory} mandatory document(s) still require your action.` : 'All mandatory documents have been uploaded.'}
      </Text>
    </View>
  );
}

/** A file picked from the camera, gallery or files. */
interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number | undefined;
}

/** Where a picked document goes, and what it may be. */
interface UploadTarget {
  requirementId: string | undefined;
  requestId: string | undefined;
  acceptedTypes: string[];
  maxSizeMb: number;
  isAdditional: boolean;
}
export function ApplicationDetailScreen({ route, navigation }: Readonly<ApplicationDetailScreenProps>) {
  const { applicationId, initialTab = 'timeline' } = route.params;
  const { api, token } = useAuth();

  const [activeTab, setActiveTab] = useState<DetailTab>(initialTab);

  // Timeline state
  const [timeline, setTimeline] = useState<CustomerApplicationTimeline | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  // Messages state
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [newMessageText, setNewMessageText] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  // Documents state
  const [documents, setDocuments] = useState<DocumentChecklist | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [uploadingRequirementId, setUploadingRequirementId] = useState<string | null>(null);

  // Payments & Invoices state
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [isPayingBalance, setIsPayingBalance] = useState(false);

  const [refreshing, setRefreshing] = useState(false);

  // 1. Fetch Timeline
  const loadTimeline = useCallback(async () => {
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const res = await api.GET('/api/applications/{id}/timeline', {
        params: { path: { id: applicationId } },
      });
      if (res.data) {
        setTimeline(res.data);
      } else if (res.error) {
        setTimelineError(
          typeof res.error === 'object' && res.error && 'message' in res.error
            ? String((res.error as { message: unknown }).message)
            : 'Failed to load timeline'
        );
      }
    } catch (err) {
      setTimelineError(err instanceof Error ? err.message : 'Error loading timeline');
    } finally {
      setTimelineLoading(false);
    }
  }, [api, applicationId]);

  // 2. Fetch Messages
  const loadMessages = useCallback(async () => {
    setMessagesLoading(true);
    setMessagesError(null);
    try {
      const res = await api.GET('/api/applications/{id}/messages', {
        params: {
          path: { id: applicationId },
          query: { limit: 50 },
        },
      });
      if (res.data) {
        const pageData = res.data as MessageThreadPage;
        setMessages(pageData.items);
        // Mark as read
        void api.POST('/api/applications/{id}/messages/read', {
          params: { path: { id: applicationId } },
        });
      } else if (res.error) {
        setMessagesError('Failed to load messages');
      }
    } catch (err) {
      setMessagesError(err instanceof Error ? err.message : 'Error loading messages');
    } finally {
      setMessagesLoading(false);
    }
  }, [api, applicationId]);

  // 3. Fetch Documents
  const loadDocuments = useCallback(async () => {
    setDocumentsLoading(true);
    setDocumentsError(null);
    try {
      const res = await api.GET('/api/applications/{id}/documents', {
        params: { path: { id: applicationId } },
      });
      if (res.data) {
        setDocuments(res.data);
      } else if (res.error) {
        setDocumentsError('Failed to load documents checklist');
      }
    } catch (err) {
      setDocumentsError(err instanceof Error ? err.message : 'Error loading documents');
    } finally {
      setDocumentsLoading(false);
    }
  }, [api, applicationId]);

  // 4. Fetch Payments / Invoices
  const loadInvoices = useCallback(async () => {
    setPaymentsLoading(true);
    setPaymentsError(null);
    try {
      const res = await api.GET('/api/invoices', {
        params: {
          query: { applicationId },
        },
      });
      if (res.data) {
        setInvoices(res.data as InvoiceSummary[]);
      } else if (res.error) {
        setPaymentsError('Failed to load invoices');
      }
    } catch (err) {
      setPaymentsError(err instanceof Error ? err.message : 'Error loading payments');
    } finally {
      setPaymentsLoading(false);
    }
  }, [api, applicationId]);

  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline]);

  useEffect(() => {
    if (activeTab === 'messages') void loadMessages();
    if (activeTab === 'documents') void loadDocuments();
    if (activeTab === 'payments') void loadInvoices();
  }, [activeTab, loadMessages, loadDocuments, loadInvoices]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      loadTimeline(),
      activeTab === 'messages' ? loadMessages() : Promise.resolve(),
      activeTab === 'documents' ? loadDocuments() : Promise.resolve(),
      activeTab === 'payments' ? loadInvoices() : Promise.resolve(),
    ]);
    setRefreshing(false);
  };

  // Open / Download File link
  const openFileLink = async (fileId: string) => {
    try {
      const res = await api.POST('/api/files/{id}/link', {
        params: {
          path: { id: fileId },
          query: { disposition: 'attachment' },
        },
      });
      if (res.data?.url) {
        const directUrl = resolveApiUrl(res.data.url);
        await Linking.openURL(directUrl);
      } else {
        Alert.alert('File Notice', 'File is currently being scanned or is not ready for download.');
      }
    } catch (e) {
      Alert.alert('Download Error', e instanceof Error ? e.message : 'Unable to open file link');
    }
  };

  // Open / Download Invoice PDF
  const openInvoiceLink = async (invoiceId: string) => {
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
        Alert.alert('Invoice Notice', 'Invoice PDF is being generated. Please try again shortly.');
      }
    } catch (e) {
      Alert.alert('Invoice Error', e instanceof Error ? e.message : 'Unable to download invoice');
    }
  };

  // Send Message
  const handleSendMessage = async (attachmentFileId?: string) => {
    if (!newMessageText.trim() && !attachmentFileId) return;
    setIsSendingMessage(true);
    try {
      const body = newMessageText.trim() ? newMessageText.trim() : undefined;
      const fileIds = attachmentFileId ? [attachmentFileId] : undefined;

      const res = await api.POST('/api/applications/{id}/messages', {
        params: { path: { id: applicationId } },
        body: { body, fileIds },
      });

      if (res.data) {
        setNewMessageText('');
        void loadMessages();
      } else {
        Alert.alert('Message Failed', 'Could not send message.');
      }
    } catch (e) {
      Alert.alert('Send Error', e instanceof Error ? e.message : 'Failed to send message');
    } finally {
      setIsSendingMessage(false);
    }
  };

  // Send message attachment from photo picker
  const handlePickMessageAttachment = () => {
    Alert.alert('Attach File', 'Choose source', [
      {
        text: 'Camera',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) return Alert.alert('Camera Permission Required');
          const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
          if (!res.canceled && res.assets[0]) {
            await uploadAndSendMessage(res.assets[0].uri, res.assets[0].fileName || 'camera.jpg', 'image/jpeg');
          }
        },
      },
      {
        text: 'Photo Gallery',
        onPress: async () => {
          const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
          if (!res.canceled && res.assets[0]) {
            await uploadAndSendMessage(res.assets[0].uri, res.assets[0].fileName || 'photo.jpg', 'image/jpeg');
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const uploadAndSendMessage = async (uri: string, name: string, mimeType: string) => {
    setIsSendingMessage(true);
    try {
      const stored = await uploadMobileFile({ uri, name, mimeType, token });
      await handleSendMessage(stored.id);
    } catch (e) {
      Alert.alert('Upload Error', e instanceof Error ? e.message : 'Failed to upload attachment');
      setIsSendingMessage(false);
    }
  };

  // Document Upload Options & Validation
  const promptDocumentUpload = (item: DocumentChecklistItem | AdditionalDocumentItem, isAdditional = false) => {
    const isChecklist = 'requirement' in item;
    const requirementId = isChecklist ? item.requirement.id : undefined;
    const requestId = !isChecklist ? item.request.id : undefined;
    const acceptedTypes = isChecklist ? item.requirement.acceptedTypes : ['application/pdf', 'image/jpeg', 'image/png'];
    const maxSizeMb = isChecklist ? item.requirement.maxSizeMb : 10;
    const target: UploadTarget = { requirementId, requestId, acceptedTypes, maxSizeMb, isAdditional };

    Alert.alert('Upload Document', 'Select a file source:', [
      {
        text: 'Take Photo',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) return Alert.alert('Permission Denied', 'Camera permission is required.');
          const res = await ImagePicker.launchCameraAsync({ quality: 0.85 });
          if (!res.canceled && res.assets[0]) {
            await processAndAttach(
              { uri: res.assets[0].uri, name: res.assets[0].fileName || 'document_photo.jpg', mimeType: 'image/jpeg', sizeBytes: res.assets[0].fileSize },
              target,
            );
          }
        },
      },
      {
        text: 'Choose from Gallery',
        onPress: async () => {
          const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.85 });
          if (!res.canceled && res.assets[0]) {
            await processAndAttach(
              { uri: res.assets[0].uri, name: res.assets[0].fileName || 'document_image.jpg', mimeType: 'image/jpeg', sizeBytes: res.assets[0].fileSize },
              target,
            );
          }
        },
      },
      {
        text: 'Choose Document (PDF/File)',
        onPress: async () => {
          const res = await DocumentPicker.getDocumentAsync({
            type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
            copyToCacheDirectory: true,
          });
          if (!res.canceled && res.assets[0]) {
            await processAndAttach(
              { uri: res.assets[0].uri, name: res.assets[0].name, mimeType: res.assets[0].mimeType || 'application/pdf', sizeBytes: res.assets[0].size },
              target,
            );
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const processAndAttach = async (
    { uri, name, mimeType, sizeBytes }: PickedFile,
    { requirementId, requestId, acceptedTypes, maxSizeMb, isAdditional }: UploadTarget,
  ) => {
    // 1. Validate file size
    if (sizeBytes && sizeBytes > maxSizeMb * 1024 * 1024) {
      Alert.alert('File Too Large', `Selected file exceeds the ${maxSizeMb} MB limit.`);
      return;
    }

    // 2. Validate MIME type
    if (acceptedTypes.length > 0 && !acceptedTypes.includes(mimeType)) {
      const validTypes = acceptedTypes.filter((item) => isKnownFileType(item)) as FileMimeType[];
      Alert.alert('Invalid File Type', `Please upload one of: ${describeFileTypes(validTypes)}.`);
      return;
    }

    const key = requirementId || requestId || 'file';
    setUploadingRequirementId(key);

    try {
      // 3. Upload file to /api/files
      const stored = await uploadMobileFile({
        uri,
        name,
        mimeType,
        requirementId,
        token,
      });

      // 4. Attach to application
      if (isAdditional && requestId) {
        await api.POST('/api/applications/{id}/documents/additional/{requestId}', {
          params: { path: { id: applicationId, requestId } },
          body: { fileId: stored.id },
        });
      } else if (requirementId) {
        await api.POST('/api/applications/{id}/documents/{requirementId}', {
          params: { path: { id: applicationId, requirementId } },
          body: { fileId: stored.id },
        });
      }

      Alert.alert('Document Uploaded', 'Your document has been submitted for review.');
      void loadDocuments();
    } catch (e) {
      Alert.alert('Upload Error', e instanceof Error ? e.message : 'Failed to attach document');
    } finally {
      setUploadingRequirementId(null);
    }
  };

  // Pay Balance Flow
  const handlePayBalance = async () => {
    setIsPayingBalance(true);
    try {
      const res = await api.POST('/api/applications/{id}/payment', {
        params: { path: { id: applicationId } },
        body: { plan: 'BALANCE' },
      });

      if (res.data) {
        const checkout = res.data as PaymentCheckout;

        if (checkout.gateway === 'MOCK') {
          Alert.alert(
            'Test Payment Gateway',
            `Mock checkout initiated for ${formatINR(checkout.amount)}. Complete the simulated payment?`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => setIsPayingBalance(false) },
              {
                text: 'Pay Now (Mock)',
                onPress: async () => {
                  try {
                    await api.POST('/api/payments/mock/{paymentId}/pay', {
                      params: { path: { paymentId: checkout.paymentId } },
                    });
                    Alert.alert('Payment Succeeded', 'Your balance payment has been confirmed.');
                    void loadTimeline();
                    void loadInvoices();
                  } catch (e) {
                    Alert.alert('Mock Payment Failed', e instanceof Error ? e.message : 'Error');
                  } finally {
                    setIsPayingBalance(false);
                  }
                },
              },
            ]
          );
        } else {
          Alert.alert(
            'Proceed to Payment',
            `Amount: ${formatINR(checkout.amount)}\nOrder: ${checkout.orderCode}\nGateway: ${checkout.gateway}`,
            [
              { text: 'OK', onPress: () => setIsPayingBalance(false) },
            ]
          );
        }
      } else {
        Alert.alert('Payment Error', 'Could not initiate balance payment.');
        setIsPayingBalance(false);
      }
    } catch (e) {
      Alert.alert('Payment Error', e instanceof Error ? e.message : 'Payment call failed');
      setIsPayingBalance(false);
    }
  };

  const statusBadge = timeline?.status ? (
    <Badge label={timeline.statusLabel || timeline.status} variant={statusVariant(timeline.status)} />
  ) : null;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header Summary */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.night} />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerCode}>{timeline?.code || 'Application'}</Text>
            <Text numberOfLines={1} style={styles.headerServiceName}>
              {timeline?.serviceName || 'Service Details'}
            </Text>
          </View>
          {statusBadge}
        </View>

        {/* Tab Segment Controls */}
        <View style={styles.tabBar}>
          {(['timeline', 'messages', 'documents', 'payments'] as DetailTab[]).map((tab) => {
            const isActive = tab === activeTab;
            const labels: Record<DetailTab, string> = {
              timeline: 'Timeline',
              messages: 'Messages',
              documents: 'Documents',
              payments: 'Payments',
            };
            return (
              <TouchableOpacity
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={[styles.tabItem, isActive && styles.tabItemActive]}
                activeOpacity={0.8}
              >
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {labels[tab]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Tab 1: Timeline */}
      {activeTab === 'timeline' && (
        <ScrollView
          style={styles.tabContent}
          contentContainerStyle={styles.scrollInner}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {loadStateContent(timelineLoading, Boolean(timelineError), <LoadingState message="Loading timeline…" />, <ErrorState message={timelineError ?? ''} onRetry={loadTimeline} />, timeline ? (
            <>
              {/* Assigned Expert Card */}
              {timeline.assignedExpert && (
                <Card style={styles.expertCard}>
                  <View style={styles.expertAvatar}>
                    <Ionicons name="person-circle" size={44} color={colors.ink} />
                  </View>
                  <View style={styles.expertInfo}>
                    <Text style={styles.expertTitle}>Assigned Compliance Specialist</Text>
                    <Text style={styles.expertName}>{timeline.assignedExpert.name}</Text>
                    <Text style={styles.expertDesc}>
                      Managing your application & government filings
                    </Text>
                  </View>
                </Card>
              )}

              {/* Progress Stepper Stages */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Application Stages</Text>
              </View>

              <View style={styles.stagesContainer}>
                {timeline.stages.map((stage: CustomerTimelineStage, index: number) => {
                  const isDone = stage.state === 'done';
                  const isCurrent = stage.state === 'current';
                  const isLast = index === timeline.stages.length - 1;

                  return (
                    <View key={stage.id} style={styles.stageRow}>
                      <View style={styles.stageIndicatorCol}>
                        <View
                          style={[
                            styles.stageCircle,
                            isDone && styles.stageCircleDone,
                            isCurrent && styles.stageCircleCurrent,
                          ]}
                        >
                          {stageIndicator(isDone, isCurrent)}
                        </View>
                        {!isLast && (
                          <View
                            style={[
                              styles.stageLine,
                              isDone ? styles.stageLineDone : styles.stageLineUpcoming,
                            ]}
                          />
                        )}
                      </View>

                      <View style={styles.stageContent}>
                        <View style={styles.stageHeader}>
                          <Text
                            style={[
                              styles.stageName,
                              isCurrent && styles.stageNameCurrent,
                              isDone && styles.stageNameDone,
                            ]}
                          >
                            {stage.name}
                          </Text>
                          {stage.reachedAt && (
                            <Text style={styles.stageDate}>{formatDate(stage.reachedAt)}</Text>
                          )}
                        </View>
                        {stage.description && (
                          <Text style={styles.stageDescription}>{stage.description}</Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* History Audit Log */}
              {timeline.history.length > 0 && (
                <>
                  <View style={[styles.sectionHeader, { marginTop: spacing.xl }]}>
                    <Text style={styles.sectionTitle}>Recent Activity Log</Text>
                  </View>
                  <Card style={styles.historyCard}>
                    {timeline.history.map((h, i) => (
                      <View
                        key={h.id}
                        style={[
                          styles.historyItem,
                          i < timeline.history.length - 1 && styles.historyItemBorder,
                        ]}
                      >
                        <View style={styles.historyTimeRow}>
                          <Text style={styles.historyLabel}>{h.statusLabel || h.status}</Text>
                          <Text style={styles.historyDate}>{formatDateTime(h.changedAt)}</Text>
                        </View>
                        {h.note && <Text style={styles.historyNote}>{h.note}</Text>}
                        {h.stageName && (
                          <Text style={styles.historyStage}>Stage: {h.stageName}</Text>
                        )}
                      </View>
                    ))}
                  </Card>
                </>
              )}
            </>
          ) : null)}
        </ScrollView>
      )}

      {/* Tab 2: Messages */}
      {activeTab === 'messages' && (
        <View style={{ flex: 1 }}>
          {loadStateContent(messagesLoading && messages.length === 0, Boolean(messagesError), <LoadingState message="Loading message thread…" style={{ flex: 1 }} />, <ErrorState message={messagesError ?? ''} onRetry={loadMessages} style={{ flex: 1 }} />, (
            <FlatList
              data={messages}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.messagesList}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              ListEmptyComponent={
                <EmptyState
                  icon="chatbubble-ellipses-outline"
                  title="No messages yet"
                  description="Have questions or updates regarding your application? Send a message directly to your assigned expert."
                />
              }
              renderItem={({ item }) => {
                const isCustomer = !item.sender.isStaff;
                return (
                  <View
                    style={[
                      styles.messageRow,
                      isCustomer ? styles.messageRowCustomer : styles.messageRowStaff,
                    ]}
                  >
                    <View
                      style={[
                        styles.messageBubble,
                        isCustomer ? styles.messageBubbleCustomer : styles.messageBubbleStaff,
                      ]}
                    >
                      <View style={styles.messageSenderRow}>
                        <Text
                          style={[
                            styles.messageSender,
                            isCustomer ? styles.messageSenderCustomer : styles.messageSenderStaff,
                          ]}
                        >
                          {item.sender.name}
                          {item.sender.isStaff ? ' (Expert)' : ''}
                        </Text>
                        <Text
                          style={[
                            styles.messageTime,
                            isCustomer ? styles.messageTimeCustomer : styles.messageTimeStaff,
                          ]}
                        >
                          {formatDateTime(item.createdAt)}
                        </Text>
                      </View>

                      {item.body && (
                        <Text
                          style={[
                            styles.messageText,
                            isCustomer ? styles.messageTextCustomer : styles.messageTextStaff,
                          ]}
                        >
                          {item.body}
                        </Text>
                      )}

                      {/* Attachments */}
                      {item.attachments && item.attachments.length > 0 && (
                        <View style={styles.attachmentsContainer}>
                          {item.attachments.map((att) => (
                            <TouchableOpacity
                              key={att.id}
                              style={styles.attachmentButton}
                              onPress={() => void openFileLink(att.id)}
                            >
                              <Ionicons name="attach" size={16} color={colors.ink} />
                              <Text numberOfLines={1} style={styles.attachmentName}>
                                {att.fileName}
                              </Text>
                              <Text style={styles.attachmentSize}>
                                ({Math.round(att.sizeBytes / 1024)} KB)
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  </View>
                );
              }}
            />
          ))}

          {/* Message Input Box */}
          <View style={styles.messageInputContainer}>
            <TouchableOpacity
              onPress={handlePickMessageAttachment}
              style={styles.attachIconButton}
              disabled={isSendingMessage}
            >
              <Ionicons name="camera-outline" size={24} color={colors.ink} />
            </TouchableOpacity>

            <TextInput
              style={styles.messageInputField}
              placeholder="Type your message…"
              placeholderTextColor={colors.muted}
              value={newMessageText}
              onChangeText={setNewMessageText}
              multiline
              maxLength={4000}
            />

            <TouchableOpacity
              onPress={() => void handleSendMessage()}
              disabled={isSendingMessage || !newMessageText.trim()}
              style={[
                styles.sendButton,
                (!newMessageText.trim() || isSendingMessage) && styles.sendButtonDisabled,
              ]}
            >
              {isSendingMessage ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Ionicons name="send" size={18} color={colors.white} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Tab 3: Documents */}
      {activeTab === 'documents' && (
        <ScrollView
          style={styles.tabContent}
          contentContainerStyle={styles.scrollInner}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {loadStateContent(documentsLoading, Boolean(documentsError), <LoadingState message="Loading documents checklist…" />, <ErrorState message={documentsError ?? ''} onRetry={loadDocuments} />, documents ? (
            <>
              {/* Submission Notice Banner */}
              <DocumentsNotice pendingMandatory={documents.pendingMandatory} />

              {/* Service Checklist Documents */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Required Service Documents</Text>
              </View>

              {documents.items.map((item: DocumentChecklistItem) => {
                const current = item.current;
                const isUploadingThis = uploadingRequirementId === item.requirement.id;
                const canUploadNow = documents.canUpload && item.canReplace;

                return (
                  <Card key={item.requirement.id} style={styles.documentCard}>
                    <View style={styles.docHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.docTitle}>{item.requirement.name}</Text>
                        {item.requirement.description && (
                          <Text style={styles.docDesc}>{item.requirement.description}</Text>
                        )}
                      </View>
                      <Badge
                        label={item.requirement.isMandatory ? 'Mandatory' : 'Optional'}
                        variant={item.requirement.isMandatory ? 'marigold' : 'neutral'}
                      />
                    </View>

                    {/* Requirements Spec Rules */}
                    <Text style={styles.docRules}>
                      Accepted: {item.requirement.acceptedTypes.map((t) => t.replace('image/', '').replace('application/', '').toUpperCase()).join(', ')} • Max {item.requirement.maxSizeMb} MB
                    </Text>

                    {/* Current File Status */}
                    {current ? (
                      <View style={styles.uploadedFileBox}>
                        <View style={styles.fileRow}>
                          <Ionicons name="document-attach" size={20} color={colors.ink} />
                          <View style={{ flex: 1, marginHorizontal: 8 }}>
                            <Text numberOfLines={1} style={styles.fileNameText}>
                              {current.fileName}
                            </Text>
                            <Text style={styles.fileMetaText}>
                              Uploaded {formatDate(current.uploadedAt)} • Version {current.version}
                            </Text>
                          </View>
                          <Badge
                            label={current.status}
                            variant={statusVariant(current.status)}
                          />
                        </View>

                        {/* Rejection Alert */}
                        {current.status === 'REJECTED' && current.rejectionReason && (
                          <View style={styles.rejectionBox}>
                            <Text style={styles.rejectionTitle}>Document Rejected</Text>
                            <Text style={styles.rejectionReason}>{current.rejectionReason}</Text>
                          </View>
                        )}

                        <View style={styles.fileActionsRow}>
                          <Button
                            title="View / Download"
                            variant="secondary"
                            size="sm"
                            onPress={() => void openFileLink(current.fileId)}
                          />
                          {canUploadNow && (
                            <Button
                              title={isUploadingThis ? 'Uploading…' : 'Replace'}
                              variant="accent"
                              size="sm"
                              loading={isUploadingThis}
                              onPress={() => promptDocumentUpload(item)}
                            />
                          )}
                        </View>
                      </View>
                    ) : (
                      <View style={styles.uploadPromptBox}>
                        <Text style={styles.noFileText}>No document uploaded yet</Text>
                        {canUploadNow && (
                          <Button
                            title={isUploadingThis ? 'Uploading…' : 'Upload Document'}
                            variant="primary"
                            size="sm"
                            loading={isUploadingThis}
                            onPress={() => promptDocumentUpload(item)}
                          />
                        )}
                      </View>
                    )}
                  </Card>
                );
              })}

              {/* Additional Requested Documents (Staff Requests) */}
              {documents.additional && documents.additional.length > 0 && (
                <>
                  <View style={[styles.sectionHeader, { marginTop: spacing.xl }]}>
                    <Text style={styles.sectionTitle}>Specifically Requested Documents</Text>
                  </View>
                  {documents.additional.map((add: AdditionalDocumentItem) => {
                    const current = add.current;
                    const isUploadingThis = uploadingRequirementId === add.request.id;

                    return (
                      <Card key={add.request.id} style={styles.documentCard}>
                        <Text style={styles.docTitle}>{add.request.name}</Text>
                        {add.request.description && (
                          <Text style={styles.docDesc}>{add.request.description}</Text>
                        )}
                        <Text style={styles.docRules}>
                          Requested on {formatDate(add.request.requestedAt)}
                        </Text>

                        {current ? (
                          <View style={styles.uploadedFileBox}>
                            <View style={styles.fileRow}>
                              <Ionicons name="document-attach" size={20} color={colors.ink} />
                              <Text numberOfLines={1} style={[styles.fileNameText, { flex: 1, marginHorizontal: 8 }]}>
                                {current.fileName}
                              </Text>
                              <Badge label={current.status} variant={statusVariant(current.status)} />
                            </View>
                            <View style={styles.fileActionsRow}>
                              <Button
                                title="View / Download"
                                variant="secondary"
                                size="sm"
                                onPress={() => void openFileLink(current.fileId)}
                              />
                              {add.canReplace && (
                                <Button
                                  title={isUploadingThis ? 'Uploading…' : 'Replace'}
                                  variant="accent"
                                  size="sm"
                                  loading={isUploadingThis}
                                  onPress={() => promptDocumentUpload(add, true)}
                                />
                              )}
                            </View>
                          </View>
                        ) : (
                          <View style={styles.uploadPromptBox}>
                            <Text style={styles.noFileText}>Requested by review team</Text>
                            <Button
                              title={isUploadingThis ? 'Uploading…' : 'Upload Document'}
                              variant="primary"
                              size="sm"
                              loading={isUploadingThis}
                              onPress={() => promptDocumentUpload(add, true)}
                            />
                          </View>
                        )}
                      </Card>
                    );
                  })}
                </>
              )}
            </>
          ) : null)}
        </ScrollView>
      )}

      {/* Tab 4: Payments & Invoices */}
      {activeTab === 'payments' && (
        <ScrollView
          style={styles.tabContent}
          contentContainerStyle={styles.scrollInner}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {loadStateContent(paymentsLoading && invoices.length === 0, Boolean(paymentsError), <LoadingState message="Loading payment details…" />, <ErrorState message={paymentsError ?? ''} onRetry={loadInvoices} />, (
            <>
              {/* Payment Action Card */}
              <Card style={styles.paymentSummaryCard}>
                <View style={styles.paymentHeaderRow}>
                  <View>
                    <Text style={styles.paymentSummaryLabel}>Order Status</Text>
                    <Text style={styles.paymentServiceName}>{timeline?.serviceName}</Text>
                    <Text style={styles.paymentPackageName}>{timeline?.packageName} Package</Text>
                  </View>
                  <Ionicons name="card-outline" size={36} color={colors.ink} />
                </View>

                <View style={styles.payBalanceActionBox}>
                  <Text style={styles.payBalanceNotice}>
                    Complete any remaining package balance or advance payments securely.
                  </Text>
                  <Button
                    title={isPayingBalance ? 'Processing…' : 'Pay Balance / Checkout'}
                    variant="primary"
                    size="md"
                    loading={isPayingBalance}
                    onPress={() => void handlePayBalance()}
                    style={{ marginTop: spacing.sm }}
                  />
                </View>
              </Card>

              {/* Invoices List */}
              <View style={[styles.sectionHeader, { marginTop: spacing.xl }]}>
                <Text style={styles.sectionTitle}>Invoices & Receipts</Text>
              </View>

              {invoices.length === 0 ? (
                <EmptyState
                  icon="receipt-outline"
                  title="No invoices yet"
                  description="Invoices are issued automatically once payments are completed and confirmed."
                />
              ) : (
                invoices.map((inv) => (
                  <Card key={inv.id} style={styles.invoiceCard}>
                    <View style={styles.invoiceHeaderRow}>
                      <View>
                        <Text style={styles.invoiceNumber}>{inv.number}</Text>
                        <Text style={styles.invoiceDate}>
                          Issued on {formatDate(inv.issuedAt)}
                        </Text>
                      </View>
                      <Text style={styles.invoiceAmount}>{formatINR(inv.total)}</Text>
                    </View>

                    <View style={styles.invoiceFooterRow}>
                      <Badge label="PAID" variant="seal" />
                      <Button
                        title="Download PDF"
                        variant="secondary"
                        size="sm"
                        onPress={() => void openInvoiceLink(inv.id)}
                      />
                    </View>
                  </Card>
                ))
              )}
            </>
          ))}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    paddingTop: spacing.sm,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  backButton: {
    padding: 4,
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerCode: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
  },
  headerServiceName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.night,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    marginTop: spacing.xs,
  },
  tabItem: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: colors.ink,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  tabLabelActive: {
    color: colors.night,
    fontWeight: '700',
  },
  tabContent: {
    flex: 1,
  },
  scrollInner: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  expertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  expertAvatar: {
    marginRight: spacing.md,
  },
  expertInfo: {
    flex: 1,
  },
  expertTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
  },
  expertName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.night,
    marginTop: 2,
  },
  expertDesc: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  sectionHeader: {
    marginVertical: spacing.sm,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.night,
  },
  stagesContainer: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  stageRow: {
    flexDirection: 'row',
  },
  stageIndicatorCol: {
    alignItems: 'center',
    width: 28,
  },
  stageCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.paper,
    borderWidth: 2,
    borderColor: colors.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageCircleDone: {
    backgroundColor: colors.seal,
    borderColor: colors.seal,
  },
  stageCircleCurrent: {
    backgroundColor: colors.white,
    borderColor: colors.ink,
  },
  stageInnerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.ink,
  },
  stageUpcomingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.rule,
  },
  stageLine: {
    width: 2,
    flex: 1,
    minHeight: 28,
  },
  stageLineDone: {
    backgroundColor: colors.seal,
  },
  stageLineUpcoming: {
    backgroundColor: colors.rule,
  },
  stageContent: {
    flex: 1,
    paddingLeft: spacing.sm,
    paddingBottom: spacing.lg,
  },
  stageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stageName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
  },
  stageNameCurrent: {
    color: colors.ink,
    fontWeight: '700',
  },
  stageNameDone: {
    color: colors.night,
  },
  stageDate: {
    fontSize: 12,
    color: colors.muted,
  },
  stageDescription: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  historyCard: {
    padding: spacing.md,
    backgroundColor: colors.white,
  },
  historyItem: {
    paddingVertical: spacing.sm,
  },
  historyItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  historyTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  historyLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.night,
  },
  historyDate: {
    fontSize: 12,
    color: colors.muted,
  },
  historyNote: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  historyStage: {
    fontSize: 11,
    color: colors.ink,
    marginTop: 2,
    fontWeight: '500',
  },
  messagesList: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  messageRow: {
    marginVertical: 4,
    flexDirection: 'row',
  },
  messageRowCustomer: {
    justifyContent: 'flex-end',
  },
  messageRowStaff: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '82%',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  messageBubbleCustomer: {
    backgroundColor: colors.ink,
    borderBottomRightRadius: 2,
  },
  messageBubbleStaff: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.rule,
    borderBottomLeftRadius: 2,
  },
  messageSenderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 8,
  },
  messageSender: {
    fontSize: 12,
    fontWeight: '700',
  },
  messageSenderCustomer: {
    color: colors.white,
  },
  messageSenderStaff: {
    color: colors.night,
  },
  messageTime: {
    fontSize: 10,
  },
  messageTimeCustomer: {
    color: colors.rule,
  },
  messageTimeStaff: {
    color: colors.muted,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  messageTextCustomer: {
    color: colors.white,
  },
  messageTextStaff: {
    color: colors.night,
  },
  attachmentsContainer: {
    marginTop: spacing.xs,
    gap: 4,
  },
  attachmentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.paper,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    gap: 4,
  },
  attachmentName: {
    fontSize: 12,
    color: colors.night,
    fontWeight: '500',
    maxWidth: 160,
  },
  attachmentSize: {
    fontSize: 11,
    color: colors.muted,
  },
  messageInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
    gap: spacing.sm,
  },
  attachIconButton: {
    padding: 6,
  },
  messageInputField: {
    flex: 1,
    backgroundColor: colors.paper,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.night,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: colors.ink,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.muted,
  },
  docNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  docNoticePending: {
    backgroundColor: colors.amber050,
  },
  docNoticeSuccess: {
    backgroundColor: colors.seal050,
  },
  docNoticeText: {
    flex: 1,
    fontSize: 13,
    color: colors.night,
    fontWeight: '500',
  },
  documentCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.white,
    padding: spacing.md,
  },
  docHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  docTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.night,
  },
  docDesc: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  docRules: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 6,
    marginBottom: spacing.sm,
  },
  uploadedFileBox: {
    backgroundColor: colors.paper,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileNameText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.night,
  },
  fileMetaText: {
    fontSize: 11,
    color: colors.muted,
  },
  rejectionBox: {
    backgroundColor: colors.danger050,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  rejectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.danger,
  },
  rejectionReason: {
    fontSize: 12,
    color: colors.danger,
    marginTop: 2,
  },
  fileActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  uploadPromptBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  noFileText: {
    fontSize: 13,
    color: colors.muted,
    fontStyle: 'italic',
  },
  paymentSummaryCard: {
    backgroundColor: colors.white,
    padding: spacing.md,
  },
  paymentHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  paymentSummaryLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
  },
  paymentServiceName: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.night,
    marginTop: 2,
  },
  paymentPackageName: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  payBalanceActionBox: {
    backgroundColor: colors.paper,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  payBalanceNotice: {
    fontSize: 13,
    color: colors.night,
    lineHeight: 18,
  },
  invoiceCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.white,
    padding: spacing.md,
  },
  invoiceHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  invoiceNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.night,
  },
  invoiceDate: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  invoiceAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  invoiceFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
});
