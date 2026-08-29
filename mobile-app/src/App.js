import React, { useEffect, useState, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AppNavigator from './navigation/AppNavigator';
import AuthScreen from './screens/AuthScreen';
import { registerForPushNotificationsAsync } from './utils/pushNotifications';
import { connectSocket, disconnectSocket } from './services/socket';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigationRef = useRef(null);

  useEffect(() => {
    const checkToken = async () => {
      const token = await SecureStore.getItemAsync('userToken');
      setIsAuthenticated(!!token);
      setLoading(false);
    };
    checkToken();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket();
      return;
    }
    connectSocket();
    registerForPushNotificationsAsync();

    // Tapping a notification (ride accepted / completed) while the app was
    // backgrounded should take the rider straight to the relevant screen.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.type === 'ride-completed' && data?.rideId && navigationRef.current) {
        navigationRef.current.navigate('Rating', { rideId: data.rideId });
      }
    });
    return () => sub.remove();
  }, [isAuthenticated]);

  if (loading) {
    return null; // Or a loading splash
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer ref={navigationRef}>
        <StatusBar style="auto" />
        {isAuthenticated ? <AppNavigator /> : <AuthScreen setIsAuthenticated={setIsAuthenticated} />}
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
