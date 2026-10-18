import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { HomeScreen } from '../screens/HomeScreen';
import { ServicesBrowseScreen } from '../screens/ServicesBrowseScreen';
import { MyServicesScreen } from '../screens/MyServicesScreen';
import { CertificatesScreen } from '../screens/CertificatesScreen';
import { AccountScreen } from '../screens/AccountScreen';
import { colors } from '../theme';

export type RootTabParamList = {
  Home: undefined;
  ServicesBrowse: { categorySlug?: string; popular?: boolean } | undefined;
  MyServices: undefined;
  Certificates: { initialTab?: 'my' | 'verify'; scannedNumber?: string } | undefined;
  Account: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = 'help-circle-outline';

          if (route.name === 'Home') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'ServicesBrowse') {
            iconName = focused ? 'grid' : 'grid-outline';
          } else if (route.name === 'MyServices') {
            iconName = focused ? 'briefcase' : 'briefcase-outline';
          } else if (route.name === 'Certificates') {
            iconName = focused ? 'ribbon' : 'ribbon-outline';
          } else if (route.name === 'Account') {
            iconName = focused ? 'person' : 'person-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.rule,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerShown: false,
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarLabel: 'Home' }}
      />
      <Tab.Screen
        name="ServicesBrowse"
        component={ServicesBrowseScreen}
        options={{
          tabBarLabel: 'Catalogue',
          headerShown: true,
          headerTitle: 'All Services',
          headerTintColor: colors.night,
          headerStyle: { backgroundColor: colors.white },
          headerTitleStyle: { fontWeight: '700' },
        }}
      />
      <Tab.Screen
        name="MyServices"
        component={MyServicesScreen}
        options={{
          tabBarLabel: 'My Services',
          headerShown: true,
          headerTitle: 'My Services & Applications',
          headerTintColor: colors.night,
          headerStyle: { backgroundColor: colors.white },
          headerTitleStyle: { fontWeight: '700' },
        }}
      />
      <Tab.Screen
        name="Certificates"
        component={CertificatesScreen}
        options={{
          tabBarLabel: 'Certificates',
          headerShown: true,
          headerTitle: 'Certificates & Verification',
          headerTintColor: colors.night,
          headerStyle: { backgroundColor: colors.white },
          headerTitleStyle: { fontWeight: '700' },
        }}
      />
      <Tab.Screen
        name="Account"
        component={AccountScreen}
        options={{ tabBarLabel: 'Account' }}
      />
    </Tab.Navigator>
  );
}
