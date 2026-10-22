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

function TabIcon({ routeName, focused, color, size }: Readonly<{ routeName: keyof RootTabParamList; focused: boolean; color: string; size: number }>) {
  let iconName: keyof typeof Ionicons.glyphMap = 'help-circle-outline';
  if (routeName === 'Home') iconName = focused ? 'home' : 'home-outline';
  else if (routeName === 'ServicesBrowse') iconName = focused ? 'grid' : 'grid-outline';
  else if (routeName === 'MyServices') iconName = focused ? 'briefcase' : 'briefcase-outline';
  else if (routeName === 'Certificates') iconName = focused ? 'ribbon' : 'ribbon-outline';
  else if (routeName === 'Account') iconName = focused ? 'person' : 'person-outline';
  return <Ionicons name={iconName} size={size} color={color} />;
}

export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => <TabIcon routeName={route.name} focused={focused} color={color} size={size} />,
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
