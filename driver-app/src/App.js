import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import DriverNavigator from './navigation/DriverNavigator';
import AuthScreen from './screens/AuthScreen';
import { connectSocket, disconnectSocket } from './services/socket';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

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
  }, [isAuthenticated]);

  if (loading) {
    return null;
  }

  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      {isAuthenticated ? <DriverNavigator /> : <AuthScreen setIsAuthenticated={setIsAuthenticated} isDriver={true} />}
    </NavigationContainer>
  );
}
