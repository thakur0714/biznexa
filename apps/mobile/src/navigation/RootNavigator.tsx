import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TabNavigator } from './TabNavigator';
import { ServiceDetailScreen } from '../screens/ServiceDetailScreen';
import { ApplicationDetailScreen } from '../screens/ApplicationDetailScreen';
import { DocumentsScreen } from '../screens/DocumentsScreen';
import { PaymentsScreen } from '../screens/PaymentsScreen';
import { CertificatesScreen } from '../screens/CertificatesScreen';
import { QrScannerScreen } from '../screens/QrScannerScreen';
import { AuthModalScreen } from '../screens/AuthModalScreen';
import { BiometricLockScreen } from '../screens/BiometricLockScreen';
import { useAuth } from '../auth/auth-context';
import { colors } from '../theme';

export type RootStackParamList = {
  MainTabs: undefined;
  ServiceDetail: { slug: string };
  ApplicationDetail: {
    applicationId: string;
    initialTab?: 'timeline' | 'messages' | 'documents' | 'payments';
  };
  Documents: undefined;
  Payments: undefined;
  Certificates: { initialTab?: 'my' | 'verify'; scannedNumber?: string } | undefined;
  QrScanner: { onScan?: (certNumber: string) => void } | undefined;
  AuthModal: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { isLocked } = useAuth();

  if (isLocked) {
    return <BiometricLockScreen />;
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.white },
        headerTintColor: colors.night,
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Stack.Screen
        name="MainTabs"
        component={TabNavigator}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ServiceDetail"
        component={ServiceDetailScreen}
        options={{
          title: 'Service Details',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="ApplicationDetail"
        component={ApplicationDetailScreen}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="Documents"
        component={DocumentsScreen}
        options={{
          title: 'My Documents',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="Payments"
        component={PaymentsScreen}
        options={{
          title: 'Payments & Invoices',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="Certificates"
        component={CertificatesScreen}
        options={{
          title: 'Certificates',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="QrScanner"
        component={QrScannerScreen}
        options={{
          headerShown: false,
          presentation: 'fullScreenModal',
        }}
      />
      <Stack.Screen
        name="AuthModal"
        component={AuthModalScreen}
        options={{
          headerShown: false,
          presentation: 'modal',
        }}
      />
    </Stack.Navigator>
  );
}
