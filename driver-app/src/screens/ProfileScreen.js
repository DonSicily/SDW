import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import API from '../services/api';
import { disconnectSocket } from '../services/socket';

export default function ProfileScreen() {
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
    disconnectSocket();
    await SecureStore.deleteItemAsync('userToken');
    await SecureStore.deleteItemAsync('userId');
    await SecureStore.deleteItemAsync('userRole');
    Alert.alert('Logged out');
  };

  if (!user) {
    return <View style={styles.container}><Text>Loading...</Text></View>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Driver Profile</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Name: {user.fullName}</Text>
        <Text style={styles.label}>Phone: {user.phone}</Text>
        <Text style={styles.label}>Rating: {user.driverDetails?.rating || 5.0} ⭐</Text>
        <Text style={styles.label}>Total Trips: {user.driverDetails?.totalTrips || 0}</Text>
        <Text style={styles.label}>Vehicle: {user.driverDetails?.vehicleId?.plateNumber || 'Not assigned'}</Text>
      </View>
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
  logoutBtn: { backgroundColor: '#dc3545', padding: 15, borderRadius: 8, alignItems: 'center' },
  logoutText: { color: 'white', fontWeight: 'bold' }
});
