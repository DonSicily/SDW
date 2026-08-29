import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import API from '../services/api';
import { clearPushToken } from '../utils/pushNotifications';
import { disconnectSocket } from '../services/socket';

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await API.get('/auth/profile');
      setUser(res.data);
    } catch (error) {
      console.error(error);
    }
  };

  const handleLogout = async () => {
    await clearPushToken();
    disconnectSocket();
    await SecureStore.deleteItemAsync('userToken');
    await SecureStore.deleteItemAsync('userId');
    await SecureStore.deleteItemAsync('userRole');
    Alert.alert('Logged out');
    // Force app to re-render - navigation will handle it
    // In a real app, you'd reset navigation
  };

  if (!user) {
    return <View style={styles.container}><Text>Loading...</Text></View>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Name: {user.fullName}</Text>
        <Text style={styles.label}>Phone: {user.phone}</Text>
        <Text style={styles.label}>Role: {user.role}</Text>
        <Text style={styles.label}>Member since: {new Date(user.createdAt).toLocaleDateString()}</Text>
      </View>
      <TouchableOpacity
        style={styles.savedPlacesBtn}
        onPress={() => navigation.navigate('SavedAddresses')}
      >
        <Text style={styles.savedPlacesText}>📍 Saved Places</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#f5f5f5' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  card: { backgroundColor: 'white', padding: 20, borderRadius: 10, marginBottom: 20 },
  label: { fontSize: 16, marginBottom: 8 },
  savedPlacesBtn: { backgroundColor: 'white', padding: 15, borderRadius: 8, alignItems: 'center', marginBottom: 12 },
  savedPlacesText: { color: '#333', fontWeight: 'bold' },
  logoutBtn: { backgroundColor: '#dc3545', padding: 15, borderRadius: 8, alignItems: 'center' },
  logoutText: { color: 'white', fontWeight: 'bold' }
});
