import React from 'react';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import appConfig from './app.json';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNavigationContainerRef, NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { AuthProvider } from './src/auth/auth-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import type { RootStackParamList } from './src/navigation/RootNavigator';
import { notificationDestination, notificationLink } from './src/navigation/notification-routing';
import { useAuth } from './src/auth/auth-context';
import { isVersionBelow } from './src/api/version';

const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
Sentry.init({
  dsn: sentryDsn,
  enabled: sentryDsn.length > 0,
  tracesSampleRate: 0,
  beforeSend(event) {
    const clean = (value: string) => value
      .replaceAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
      .replaceAll(/(?<![\w-])(?:\+?91[ -]?)?[6-9]\d{9}(?![\w-])/g, '[mobile]')
      .replaceAll(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]');
    event.user = undefined;
    event.extra = undefined;
    event.tags = undefined;
    event.contexts = undefined;
    event.breadcrumbs = undefined;
    event.message = event.message ? clean(event.message) : undefined;
    event.transaction = event.transaction ? clean(event.transaction) : undefined;
    if (event.request) {
      event.request = { url: event.request.url ? clean(event.request.url.split('?')[0]) : undefined, method: event.request.method };
    }
    for (const exception of event.exception?.values ?? []) {
      if (exception.value) exception.value = clean(exception.value);
    }
    return event;
  },
});

const navigationRef = createNavigationContainerRef<RootStackParamList>();
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['biznexa://'],
  config: { screens: { BuyFlow: 'apply/:slug/:applicationId/:initialStep?', ServiceDetail: 'services/:slug' } },
};
let pendingDestination: ReturnType<typeof notificationDestination> | null = null;

function VersionGate({ children }: Readonly<{ children: React.ReactNode }>): React.ReactNode {
  const { api } = useAuth();
  const [minimum, setMinimum] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let alive = true;
    // Give up after 5 s and open the app. React Native 0.76 has no AbortSignal.timeout, so use a timer.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    void api.GET('/api/mobile/version', { signal: controller.signal }).then(({ data }) => {
      if (alive && data) setMinimum(data.minSupportedVersion);
    }).catch(() => undefined).finally(() => { clearTimeout(timer); if (alive) setChecked(true); });
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [api]);
  if (!checked) return <View style={gateStyles.center}><ActivityIndicator /><Text style={gateStyles.message}>Checking for updates…</Text></View>;
  if (minimum && isVersionBelow(appConfig.expo.version, minimum)) return <View style={gateStyles.center}>
    <Text style={gateStyles.title}>Update required</Text>
    <Text style={gateStyles.message}>BizNexa {minimum} or later is required. Install the latest version from your tester distribution, then reopen the app.</Text>
  </View>;
  return <>{children}</>;
}

const gateStyles = StyleSheet.create({ center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#fff' }, title: { fontSize: 24, fontWeight: '700', color: '#17213f', textAlign: 'center' }, message: { marginTop: 12, fontSize: 15, color: '#586174', textAlign: 'center' } });

Notifications.setNotificationHandler({
  handleNotification: () => Promise.resolve({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
});

function navigateToNotification(data: Record<string, unknown>) {
  const destination = notificationDestination(notificationLink(data), data.event);
  if (!navigationRef.isReady()) {
    pendingDestination = destination;
    return;
  }
  switch (destination.screen) {
    case 'ApplicationDetail': navigationRef.navigate('ApplicationDetail', destination.params); break;
    case 'BuyFlow': navigationRef.navigate('BuyFlow', destination.params); break;
    case 'Documents': navigationRef.navigate('Documents'); break;
    case 'Payments': navigationRef.navigate('Payments'); break;
    case 'Certificates': navigationRef.navigate('Certificates'); break;
    case 'MainTabs': navigationRef.navigate('MainTabs'); break;
  }
}

export function App() {
  const responseHandled = useRef(false);
  useEffect(() => {
    const response = Notifications.addNotificationResponseReceivedListener((event) => {
      navigateToNotification(event.notification.request.content.data);
    });
    const foreground = Notifications.addNotificationReceivedListener(() => {
      // The global handler keeps notifications visible while the app is foregrounded.
    });
    if (!responseHandled.current) {
      responseHandled.current = true;
      void Notifications.getLastNotificationResponseAsync().then((event) => {
        if (event) {
          navigateToNotification(event.notification.request.content.data);
          return Notifications.clearLastNotificationResponseAsync();
        }
        return undefined;
      });
    }
    return () => { response.remove(); foreground.remove(); };
  }, []);

  function onNavigationReady() {
    if (!pendingDestination) return;
    const destination = pendingDestination;
    pendingDestination = null;
    switch (destination.screen) {
      case 'ApplicationDetail': navigationRef.navigate('ApplicationDetail', destination.params); break;
      case 'BuyFlow': navigationRef.navigate('BuyFlow', destination.params); break;
      case 'Documents': navigationRef.navigate('Documents'); break;
      case 'Payments': navigationRef.navigate('Payments'); break;
      case 'Certificates': navigationRef.navigate('Certificates'); break;
      case 'MainTabs': navigationRef.navigate('MainTabs'); break;
    }
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer ref={navigationRef} linking={linking} onReady={onNavigationReady}>
          <StatusBar style="dark" />
          <VersionGate><RootNavigator /></VersionGate>
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(App);
