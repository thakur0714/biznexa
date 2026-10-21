import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  ENTITY_TYPES,
  businessEntityInput,
  businessEntityListSchema,
  businessEntitySchema,
  applicationDetailSchema,
  createApplicationInput,
  draftApplicationSchema,
  formDataValidator,
  prefillAnswers,
  documentChecklistSchema,
  paymentCheckoutSchema,
  paymentStatusSchema,
  mockPaymentResultSchema,
  requirementFileTypes,
  fieldOptions,
  asksForAadhaar,
  conditionMet,
  isKnownFileType,
  OPTION_SOURCES,
  type BusinessEntity,
  type BusinessEntityInput,
  type DocumentChecklist,
  type FormAddress,
  type FormData,
  type FormField,
  type PaymentPlan,
} from '@biznexa/types';
import type { ServiceDetail } from '@biznexa/api-client';
import { Card, Button } from '../components/common';
import { ErrorState } from '../components/common';
import { useAuth } from '../auth/auth-context';
import { uploadMobileFile } from '../api/upload';
import { loadRazorpayCheckout } from '../api/razorpay';
import { colors, radius, spacing } from '../theme';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { isPaymentConfirmed, nextBuyFlowStep, validateWholeForm, type BuyFlowStep } from './buy-flow-logic';

type Route = RootStackParamList['BuyFlow'];
interface Props { route: { params: Route }; navigation: { goBack: () => void; navigate: (screen: string, params?: Record<string, unknown>) => void } }
type Choice = { kind: 'saved'; id: string } | { kind: 'new' } | { kind: 'none' };
type Asset = { uri: string; name: string; mimeType: string; size?: number };
const emptyBusiness: BusinessEntityInput = { legalName: '', entityType: 'PRIVATE_LIMITED', pan: '', gstin: '', cin: '', address: null, state: null };
const stepKey = (id: string) => `bn_apply_step:${id}`;

type FieldProps = { field: FormField; value: unknown; error?: string; scope: Record<string, unknown>; onChange: (v: unknown) => void };
function Field({ field, value, error, scope, onChange }: Readonly<FieldProps>) {
  if (field.showIf && !conditionMet(field.showIf, scope)) return null;
  if (asksForAadhaar(field)) return <Text style={styles.help}>Aadhaar numbers are not collected. An expert takes Aadhaar OTP consent when filing.</Text>;
  const label = <Text style={styles.label}>{field.label}{field.required ? ' *' : ''}</Text>;
  const help = field.helpText ? <Text style={styles.help}>{field.helpText}</Text> : null;
  const errorText = error ? <Text style={styles.errorText}>{error}</Text> : null;
  if (field.type === 'select' || field.type === 'multi-select') {
    const options = fieldOptions(field);
    return <View style={styles.field}>{label}{help}{options.map((option) => {
      const selected = field.type === 'multi-select' ? Array.isArray(value) && value.includes(option.value) : value === option.value;
      return <TouchableOpacity key={option.value} style={[styles.choice, selected && styles.choiceSelected]} onPress={() => {
        if (field.type === 'multi-select') {
          const current = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
          onChange(selected ? current.filter((item) => item !== option.value) : [...current, option.value]);
        } else onChange(option.value);
      }}><Text style={styles.body}>{selected ? '☑' : '○'}  {option.label}</Text></TouchableOpacity>;
    })}{errorText}</View>;
  }
  if (field.type === 'address') {
    const address: FormAddress = value && typeof value === 'object' && !Array.isArray(value) ? value as FormAddress : { line1: '', line2: '', city: '', state: '', pincode: '' };
    return <View style={styles.field}>{label}{(['line1', 'line2', 'city', 'state', 'pincode'] as const).map((part) => <View key={part}>{<TextInput style={styles.input} placeholder={{ line1: 'Address line 1', line2: 'Address line 2', city: 'City', state: 'State', pincode: 'PIN code' }[part]} value={address[part] ?? ''} onChangeText={(text) => onChange({ ...address, [part]: text })} />}{part === 'state' ? OPTION_SOURCES.states.map((state) => <TouchableOpacity key={state} style={styles.choice} onPress={() => onChange({ ...address, state })}><Text style={styles.body}>{address.state === state ? '☑' : '○'}  {state}</Text></TouchableOpacity>) : null}</View>)}{help}{errorText}</View>;
  }
  if (field.type === 'repeater') {
    const rows = Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row)) : [];
    return <View style={styles.field}>{label}{help}{rows.map((row, index) => <Card key={`${field.name}-${index}`} style={styles.rowCard}><Text style={styles.help}>{field.itemLabel} {index + 1}</Text>{field.fields.map((sub) => <Field key={sub.name} field={sub} value={row[sub.name]} scope={{ ...scope, ...row }} onChange={(v) => onChange(rows.map((item, i) => i === index ? { ...item, [sub.name]: v } : item))} />)}<Button title="Remove" variant="ghost" onPress={() => onChange(rows.filter((_, i) => i !== index))} /></Card>)}<Button title={`Add ${field.itemLabel.toLowerCase()}`} variant="secondary" onPress={() => onChange([...rows, {}])} disabled={field.maxItems !== undefined && rows.length >= field.maxItems} />{errorText}</View>; // NOSONAR: repeater rows have no id and are edited in place; a content key would remount a row on every keystroke
  }
  if (field.type === 'file') {
    const fileIds = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
    return <View style={styles.field}>{label}{help}<Text style={styles.help}>{fileIds.length} file(s) uploaded (max {field.maxSizeMb} MB each)</Text><Button title="Choose a file" variant="secondary" onPress={() => onPickFormFile(field, fileIds, onChange)} disabled={fileIds.length >= field.maxFiles} />{errorText}</View>;
  }
  const isLong = field.type === 'textarea';
  let keyboardType: React.ComponentProps<typeof TextInput>['keyboardType'] = 'default';
  if (field.type === 'number') keyboardType = 'decimal-pad';
  else if (field.type === 'email') keyboardType = 'email-address';
  else if (field.type === 'tel') keyboardType = 'phone-pad';
  const placeholder = 'placeholder' in field ? field.placeholder : undefined;
  const inputValue = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const autoCapitalize = field.type === 'email' ? 'none' : 'sentences';
  return <View style={styles.field}>{label}{help}<TextInput style={[styles.input, isLong && styles.textarea]} value={inputValue} placeholder={placeholder} multiline={isLong} keyboardType={keyboardType} autoCapitalize={autoCapitalize} onChangeText={(text) => onChange(field.type === 'number' && text.trim() !== '' ? Number(text) : text)} />{errorText}</View>;
}

let pickFormFile: ((field: Extract<FormField, { type: 'file' }>, ids: string[], update: (v: unknown) => void) => Promise<void>) | null = null;
function onPickFormFile(field: Extract<FormField, { type: 'file' }>, ids: string[], update: (v: unknown) => void) {
  return pickFormFile?.(field, ids, update);
}

export function BuyFlowScreen({ route, navigation }: Readonly<Props>) {
  const { api, token, user } = useAuth();
  const { slug, packageId, applicationId: incomingId, initialStep } = route.params;
  const [service, setService] = useState<ServiceDetail | null>(null);
  const [businesses, setBusinesses] = useState<BusinessEntity[]>([]);
  const [choice, setChoice] = useState<Choice>({ kind: 'none' });
  const [newBusiness, setNewBusiness] = useState<BusinessEntityInput>(emptyBusiness);
  const [application, setApplication] = useState<ReturnType<typeof applicationDetailSchema.parse> | null>(null);
  const [formValues, setFormValues] = useState<FormData>({});
  const [checklist, setChecklist] = useState<DocumentChecklist | null>(null);
  const [flowStep, setFlowStep] = useState<BuyFlowStep>(incomingId ? (initialStep ?? 'form') : 'form');
  const [formIndex, setFormIndex] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveLabel, setSaveLabel] = useState('Answers save as you type');
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<number | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedPackage = service?.packages.find((item) => item.id === (packageId ?? application?.packageId));

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const serviceResult = await api.GET('/api/catalogue/services/{slug}', { params: { path: { slug } } });
      if (!serviceResult.data) throw new Error('Could not load this service.');
      const svc = serviceResult.data as ServiceDetail;
      setService(svc);
      if (!incomingId) {
        const businessesResult = await api.GET('/api/business-entities');
        setBusinesses(businessEntityListSchema.parse(businessesResult.data).items);
        return;
      }
      const appResult = await api.GET('/api/applications/{id}', { params: { path: { id: incomingId } } });
      const appDetail = applicationDetailSchema.parse(appResult.data);
      if (appDetail.serviceId !== svc.id) throw new Error('Application not found.');
      setApplication(appDetail);
      const parsedValues = formDataValidator(appDetail.formSchema, { partial: true }).safeParse(appDetail.formData);
      const values = parsedValues.success ? parsedValues.data : {};
      if (Object.keys(values).length === 0 && appDetail.businessEntityId) {
        const b = await api.GET('/api/business-entities/{id}', { params: { path: { id: appDetail.businessEntityId } } });
        const business = businessEntitySchema.nullable().parse(b.data);
        setFormValues(formDataValidator(appDetail.formSchema, { partial: true }).parse(prefillAnswers(appDetail.formSchema, { business, user })));
      } else setFormValues(values);
      if (initialStep === 'documents' || initialStep === 'payment') setFlowStep(initialStep);
      const checklistResult = await api.GET('/api/applications/{id}/documents', { params: { path: { id: incomingId } } });
      setChecklist(documentChecklistSchema.parse(checklistResult.data));
      if (initialStep === 'payment') setFlowStep('payment');
      const saved = await AsyncStorage.getItem(stepKey(incomingId));
      if (initialStep == null && saved) {
        const restored = Number(saved);
        if (Number.isInteger(restored) && restored >= 0) setFormIndex(restored);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the application. Check your connection and try again.');
    } finally { setLoading(false); }
  }, [api, slug, incomingId, initialStep, user]);

  useEffect(() => { void load(); }, [load]);

  async function startApplication() {
    if (!selectedPackage) return;
    setBusy(true); setError('');
    try {
      let businessEntityId: string | null = choice.kind === 'saved' ? choice.id : null;
      if (choice.kind === 'new') {
        const clean = businessEntityInput.parse(newBusiness);
        const created = await api.POST('/api/business-entities', { body: clean });
        if (!created.data) throw new Error('Could not save this business.');
        const entity = businessEntitySchema.parse(created.data);
        businessEntityId = entity.id;
      }
      const body = createApplicationInput.parse({ packageId: selectedPackage.id, businessEntityId });
      const result = await api.POST('/api/applications', { body });
      const draft = draftApplicationSchema.parse(result.data);
      navigation.navigate('BuyFlow', { slug, applicationId: draft.id, initialStep: 'form' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start your application.'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!application || !formDirty || application.status !== 'DRAFT') return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const values = formValues;
      setSaveLabel('Saving…');
      saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
        try {
          await api.PATCH('/api/applications/{id}', { params: { path: { id: application.id } }, body: { formData: values } });
          setSaveLabel('All answers saved');
        } catch (cause) {
          setSaveLabel(cause instanceof Error ? `Not saved: ${cause.message}` : 'Not saved. Check your connection and retry.');
        }
      });
    }, 1000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [api, application, formDirty, formValues]);

  async function submitForm() {
    if (!application) return;
    const parsed = validateWholeForm(application.formSchema, formValues);
    if (!parsed.success) {
      const issues = Object.fromEntries(parsed.error.issues.map((item) => [item.path.map(String).join('.'), item.message]));
      setFieldErrors(issues);
      const firstStep = application.formSchema.steps.findIndex((formStep) => formStep.fields.some((field) => Object.keys(issues).some((path) => path === field.name || path.startsWith(`${field.name}.`))));
      if (firstStep >= 0 && firstStep !== formIndex) setFormIndex(firstStep);
      return;
    }
    setBusy(true); setError('');
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await saveQueue.current;
      await api.PATCH('/api/applications/{id}', { params: { path: { id: application.id } }, body: { formData: parsed.data, final: true } });
      setFormDirty(false);
      await AsyncStorage.setItem(stepKey(application.id), String(0));
      setFlowStep('documents');
      const result = await api.GET('/api/applications/{id}/documents', { params: { path: { id: application.id } } });
      setChecklist(documentChecklistSchema.parse(result.data));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your form. Please retry.'); }
    finally { setBusy(false); }
  }

  async function chooseAsset(requirement: DocumentChecklist['items'][number]['requirement'], source: 'camera' | 'gallery' | 'files'): Promise<Asset | null> {
    const accepted = requirementFileTypes(requirement.acceptedTypes);
    if (source === 'camera' || source === 'gallery') {
      if (!accepted.some((type) => type.startsWith('image/'))) { Alert.alert('Photo not accepted', 'This requirement accepts files only.'); return null; }
      // launchCameraAsync fails without the permission (same check as ApplicationDetailScreen).
      if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
        Alert.alert('Camera permission needed', 'Allow camera access in Settings, or choose a photo from the gallery.');
        return null;
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.85, allowsEditing: true, mediaTypes: ['images'] })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.85, allowsEditing: true, mediaTypes: ['images'] });
      if (result.canceled) return null;
      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? 'image/jpeg';
      if (!isKnownFileType(mimeType) || !accepted.includes(mimeType)) { Alert.alert('File type not accepted', `Accepted: ${accepted.join(', ')}`); return null; }
      if (asset.fileSize != null && asset.fileSize > requirement.maxSizeMb * 1024 * 1024) { Alert.alert('File too large', `Maximum size is ${requirement.maxSizeMb} MB.`); return null; }
      return { uri: asset.uri, name: asset.fileName ?? `document-${Date.now()}.jpg`, mimeType, size: asset.fileSize };
    }
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: accepted });
    if (result.canceled) return null;
    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? '';
    if (!isKnownFileType(mimeType) || !accepted.includes(mimeType)) { Alert.alert('File type not accepted', `Accepted: ${accepted.join(', ')}`); return null; }
    if (asset.size != null && asset.size > requirement.maxSizeMb * 1024 * 1024) { Alert.alert('File too large', `Maximum size is ${requirement.maxSizeMb} MB.`); return null; }
    return { uri: asset.uri, name: asset.name, mimeType, size: asset.size };
  }

  async function uploadRequirement(requirementId: string, requirement: DocumentChecklist['items'][number]['requirement'], source: 'camera' | 'gallery' | 'files') {
    if (!application || !checklist?.canUpload) return;
    setBusy(true); setError('');
    try {
      const asset = await chooseAsset(requirement, source);
      if (!asset) return;
      const uploaded = await uploadMobileFile({ ...asset, requirementId, token });
      await api.POST('/api/applications/{id}/documents/{requirementId}', { params: { path: { id: application.id, requirementId } }, body: { fileId: uploaded.id } });
      const fresh = await api.GET('/api/applications/{id}/documents', { params: { path: { id: application.id } } });
      setChecklist(documentChecklistSchema.parse(fresh.data));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Upload failed. Check your connection and retry.'); }
    finally { setBusy(false); }
  }

  pickFormFile = async (field, ids, update) => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: field.accept });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset.size != null && asset.size > field.maxSizeMb * 1024 * 1024) { Alert.alert('File too large', `Maximum size is ${field.maxSizeMb} MB.`); return; }
    const mimeType = asset.mimeType ?? '';
    if (!isKnownFileType(mimeType) || !field.accept.includes(mimeType)) { Alert.alert('File type not accepted', `Accepted: ${field.accept.join(', ')}`); return; }
    try {
      const stored = await uploadMobileFile({ uri: asset.uri, name: asset.name, mimeType, token });
      update([...ids, stored.id]);
    } catch (cause) { Alert.alert('Upload failed', cause instanceof Error ? cause.message : 'Check your connection and retry.'); }
  };

  async function checkout(plan?: PaymentPlan) {
    if (!application) return;
    setBusy(true); setError('');
    try {
      const started = await api.POST('/api/applications/{id}/payment', { params: { path: { id: application.id } }, body: plan ? { plan } : {} });
      const checkout = paymentCheckoutSchema.parse(started.data);
      setPaymentAmount(checkout.amount);
      if (checkout.gateway === 'MOCK') {
        const mocked = await api.POST('/api/payments/mock/{paymentId}/pay', { params: { path: { paymentId: checkout.paymentId } } });
        mockPaymentResultSchema.parse(mocked.data);
      } else {
        const RazorpayCheckout = loadRazorpayCheckout();
        const result = await RazorpayCheckout.open({
          key: checkout.key,
          amount: checkout.amount,
          currency: checkout.currency,
          name: 'BizNexa',
          order_id: checkout.gatewayOrderId,
          description: checkout.description,
          prefill: checkout.prefill,
          method: { upi: true, card: true, netbanking: true, wallet: true, emi: true },
        });
        await api.POST('/api/applications/{id}/payment/callback', { params: { path: { id: application.id } }, body: { paymentId: checkout.paymentId, gatewayOrderId: result.razorpay_order_id, gatewayPaymentId: result.razorpay_payment_id, signature: result.razorpay_signature } }).catch(() => undefined);
      }
      let confirmed = false;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        try {
          const status = await api.GET('/api/applications/{id}/payment', { params: { path: { id: application.id } } }); // NOSONAR: payment confirmation polling must remain sequential
          if (isPaymentConfirmed(paymentStatusSchema.parse(status.data))) { confirmed = true; break; }
        } catch { /* a transient connection issue does not mean a payment failed */ }
        if (attempt < 23) await new Promise<void>((resolve) => setTimeout(resolve, 5_000)); // NOSONAR: wait between sequential payment status checks
      }
      if (!confirmed) {
        setError('Payment is being confirmed by the bank. Please check Payments again before retrying.');
        return;
      }
      setPaymentConfirmed(true);
      setFlowStep('complete');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Checkout was interrupted. You can safely try again.');
    } finally { setBusy(false); }
  }

  const formStep = application?.formSchema.steps[formIndex];
  const visibleFields = useMemo(() => formStep?.fields ?? [], [formStep]);
  let displayedPaymentAmount: number | undefined;
  if (paymentAmount !== null) displayedPaymentAmount = paymentAmount;
  else if (selectedPackage) displayedPaymentAmount = selectedPackage.price.total;

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.ink} /><Text style={styles.body}>Loading your application…</Text></View>;
  if (error && !service) return <ErrorState message={error} onRetry={() => void load()} style={{ flex: 1 }} />;
  if (!service) return <ErrorState message="Service not found." onRetry={() => void load()} style={{ flex: 1 }} />;

  let flowTitle = 'Application submitted';
  if (flowStep === 'form') flowTitle = 'Your details';
  else if (flowStep === 'documents') flowTitle = 'Upload documents';
  else if (flowStep === 'payment') flowTitle = 'Secure payment';
  if (!incomingId) return <ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title}>Start your application</Text>
    <Text style={styles.body}>{service.name} · {selectedPackage?.name ?? 'Choose a package'}</Text>
    <Card style={styles.section}><Text style={styles.sectionTitle}>Who is this application for?</Text><Text style={styles.help}>Choose a saved business, add one, or apply as yourself.</Text>
      {businesses.map((business) => <Choice key={business.id} selected={choice.kind === 'saved' && choice.id === business.id} title={business.legalName} subtitle={business.entityType} onPress={() => setChoice({ kind: 'saved', id: business.id })} />)}
      <Choice selected={choice.kind === 'new'} title="Add a new business" onPress={() => setChoice({ kind: 'new' })} />
      {choice.kind === 'new' && <View>{<Text style={styles.label}>Legal name</Text>}<TextInput style={styles.input} value={newBusiness.legalName} onChangeText={(legalName) => setNewBusiness({ ...newBusiness, legalName })} placeholder="Legal name" />{ENTITY_TYPES.map((entity) => <Choice key={entity.value} selected={newBusiness.entityType === entity.value} title={entity.label} onPress={() => setNewBusiness({ ...newBusiness, entityType: entity.value })} />)}<TextInput style={styles.input} value={newBusiness.pan ?? ''} onChangeText={(pan) => setNewBusiness({ ...newBusiness, pan: pan.toUpperCase() })} placeholder="PAN (optional)" maxLength={10} /><TextInput style={styles.input} value={newBusiness.gstin ?? ''} onChangeText={(gstin) => setNewBusiness({ ...newBusiness, gstin: gstin.toUpperCase() })} placeholder="GSTIN (optional)" maxLength={15} /></View>}
      <Choice selected={choice.kind === 'none'} title="Myself" subtitle="Not for a business" onPress={() => setChoice({ kind: 'none' })} />
    </Card>
    {error ? <Text style={styles.errorText}>{error}</Text> : null}
    <Button title={busy ? 'Starting…' : 'Continue to your details'} onPress={() => void startApplication()} loading={busy} />
  </ScrollView>;

  return <ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title}>{flowTitle}</Text>
    <Text style={styles.body}>{service.name} · Application {application?.code ?? incomingId}</Text>
    {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
    {flowStep === 'form' && application && formStep && <>
      <Text style={styles.sectionTitle}>{formStep.title}</Text>{formStep.description ? <Text style={styles.help}>{formStep.description}</Text> : null}
      <View style={styles.row}><Text style={styles.saveState}>{saveLabel}</Text>{saveLabel.startsWith('Not saved') ? <Button title="Retry save" variant="ghost" onPress={() => setFormValues({ ...formValues })} /> : null}</View>
      {visibleFields.map((field) => <Field key={field.name} field={field} value={formValues[field.name]} error={fieldErrors[field.name]} scope={formValues} onChange={(value) => { setFormValues({ ...formValues, [field.name]: value as FormData[string] }); setFormDirty(true); setFieldErrors({}); }} />)}
      <View style={styles.row}>{formIndex > 0 && <Button title="Back" variant="secondary" onPress={() => { const next = formIndex - 1; setFormIndex(next); void AsyncStorage.setItem(stepKey(application.id), String(next)); }} />}
        {formIndex < application.formSchema.steps.length - 1 ? <Button title="Continue" onPress={() => { const next = formIndex + 1; setFormIndex(next); void AsyncStorage.setItem(stepKey(application.id), String(next)); }} /> : <Button title={busy ? 'Saving…' : 'Save and continue'} onPress={() => void submitForm()} loading={busy} />}</View>
    </>}
    {flowStep === 'documents' && checklist && <>
      <Text style={styles.help}>Upload clear scans or photos. You can skip and upload later from My Services.</Text>
      {checklist.items.map(({ requirement, current, canReplace }) => <Card key={requirement.id} style={styles.section}><Text style={styles.label}>{requirement.name}{requirement.isMandatory ? ' · Required' : ' · Optional'}</Text>{requirement.description ? <Text style={styles.help}>{requirement.description}</Text> : null}<Text style={styles.help}>Accepted: {requirement.acceptedTypes.join(', ')} · Maximum {requirement.maxSizeMb} MB</Text><Text style={styles.body}>{current ? `${current.fileName} · ${current.scanStatus}` : 'Not uploaded'}</Text>{checklist.canUpload && (!current || canReplace) && <View style={styles.row}><Button title="Camera" variant="secondary" onPress={() => void uploadRequirement(requirement.id, requirement, 'camera')} disabled={busy} /><Button title="Gallery" variant="secondary" onPress={() => void uploadRequirement(requirement.id, requirement, 'gallery')} disabled={busy} /><Button title="Files" variant="secondary" onPress={() => void uploadRequirement(requirement.id, requirement, 'files')} disabled={busy} /></View>}</Card>)}
      {checklist.additional.map(({ request }) => <Card key={request.id} style={styles.section}><Text style={styles.label}>{request.name}</Text><Text style={styles.help}>Additional team requests can be uploaded from the Documents screen after continuing.</Text></Card>)}
      <Button title={checklist.pendingMandatory > 0 ? `Continue · ${checklist.pendingMandatory} required remaining` : 'Continue to payment'} variant={checklist.pendingMandatory > 0 ? 'secondary' : 'primary'} onPress={() => setFlowStep(nextBuyFlowStep('documents'))} />
      <Button title="Back to details" variant="ghost" onPress={() => setFlowStep('form')} />
    </>}
    {flowStep === 'payment' && application && <>
      <Card style={styles.section}><Text style={styles.label}>Order summary</Text><Text style={styles.body}>Application {application.code}</Text>{displayedPaymentAmount !== undefined ? <Text style={styles.sectionTitle}>{`₹${Math.round(displayedPaymentAmount / 100).toLocaleString('en-IN')}`}</Text> : null}<Text style={styles.help}>The server calculates the final amount due. Payment success appears only after server confirmation.</Text></Card>
      <Button title={busy ? 'Opening checkout…' : 'Pay securely'} onPress={() => void checkout()} loading={busy} />
      {selectedPackage?.allowPartial && selectedPackage.advancePercent ? <Button title={`Pay ${selectedPackage.advancePercent}% advance`} variant="secondary" onPress={() => void checkout('ADVANCE')} disabled={busy} /> : null}
      <Button title="Back to documents" variant="ghost" onPress={() => setFlowStep('documents')} />
      <Text style={styles.help}>Razorpay offers UPI intent, cards, net banking and wallets when enabled for this order.</Text>
    </>}
    {flowStep === 'complete' && paymentConfirmed && <><Card style={styles.section}><Text style={styles.sectionTitle}>Payment confirmed</Text><Text style={styles.body}>Application {application?.code} is submitted and visible in My Services.</Text></Card><Button title="View my services" onPress={() => navigation.navigate('MainTabs')} /></>}
  </ScrollView>;
}

function Choice({ selected, title, subtitle, onPress }: Readonly<{ selected: boolean; title: string; subtitle?: string; onPress: () => void }>) {
  return <TouchableOpacity onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}><Text style={styles.body}>{selected ? '◉' : '○'}  {title}</Text>{subtitle ? <Text style={styles.help}>{subtitle}</Text> : null}</TouchableOpacity>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  title: { fontSize: 26, fontWeight: '700', color: colors.night },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.night },
  label: { fontSize: 15, fontWeight: '600', color: colors.night },
  body: { color: colors.night, fontSize: 15 },
  help: { color: colors.muted, fontSize: 13, marginTop: 4 },
  saveState: { color: colors.muted, fontSize: 12 },
  field: { gap: spacing.xs, marginTop: spacing.md },
  input: { borderWidth: 1, borderColor: colors.rule, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.night, backgroundColor: colors.white },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
  choice: { borderWidth: 1, borderColor: colors.rule, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  choiceSelected: { borderColor: colors.ink, backgroundColor: colors.ink050 },
  section: { padding: spacing.md, gap: spacing.sm },
  rowCard: { padding: spacing.md, marginTop: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  errorText: { color: colors.danger, fontSize: 13 },
  errorBox: { padding: spacing.md, backgroundColor: colors.danger050, borderRadius: radius.md },
});

