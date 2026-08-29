import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MapScreen from '../screens/MapScreen';
import ProfileScreen from '../screens/ProfileScreen'; // We'll create this
import RideHistoryScreen from '../screens/RideHistoryScreen'; // We'll create this
import PaymentScreen from '../screens/PaymentScreen';
import RatingScreen from '../screens/RatingScreen';
import SavedAddressesScreen from '../screens/SavedAddressesScreen';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

function HomeTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Map" component={MapScreen} options={{ title: 'Ride' }} />
      <Tab.Screen name="History" component={RideHistoryScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeTabs" component={HomeTabs} />
      <Stack.Screen
        name="Payment"
        component={PaymentScreen}
        options={{ headerShown: true, title: 'Pay for ride' }}
      />
      <Stack.Screen
        name="Rating"
        component={RatingScreen}
        options={{ headerShown: true, title: 'Rate your ride' }}
      />
      <Stack.Screen
        name="SavedAddresses"
        component={SavedAddressesScreen}
        options={{ headerShown: true, title: 'Saved Places' }}
      />
    </Stack.Navigator>
  );
}
