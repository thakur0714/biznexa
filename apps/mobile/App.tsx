import React from 'react';
import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { AuthProvider } from './src/auth/auth-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import type { RootStackParamList } from './src/navigation/RootNavigator';
import { notificationDestination, notificationLink } from './src/navigation/notification-routing';

const navigationRef = createNavigationContainerRef<RootStackParamList>();
let pendingDestination: ReturnType<typeof notificationDestination> | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
});

function navigateToNotification(data: Record<string, unknown>) {
  const destination = notificationDestination(notificationLink(data), data.event);
  if (!navigationRef.isReady()) {
    pendingDestination = destination;
    return;
  }
  switch (destination.screen) {
    case 'ApplicationDetail': navigationRef.navigate('ApplicationDetail', destination.params); break;
    case 'Documents': navigationRef.navigate('Documents'); break;
    case 'Payments': navigationRef.navigate('Payments'); break;
    case 'Certificates': navigationRef.navigate('Certificates'); break;
    case 'MainTabs': navigationRef.navigate('MainTabs'); break;
  }
}

export default function App() {
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
      case 'Documents': navigationRef.navigate('Documents'); break;
      case 'Payments': navigationRef.navigate('Payments'); break;
      case 'Certificates': navigationRef.navigate('Certificates'); break;
      case 'MainTabs': navigationRef.navigate('MainTabs'); break;
    }
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer ref={navigationRef} onReady={onNavigationReady}>
          <StatusBar style="dark" />
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
