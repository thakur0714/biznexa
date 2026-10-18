import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TabNavigator } from './TabNavigator';
import { ServiceDetailScreen } from '../screens/ServiceDetailScreen';
import { AuthModalScreen } from '../screens/AuthModalScreen';
import { BiometricLockScreen } from '../screens/BiometricLockScreen';
import { useAuth } from '../auth/auth-context';
import { colors } from '../theme';

export type RootStackParamList = {
  MainTabs: undefined;
  ServiceDetail: { slug: string };
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
