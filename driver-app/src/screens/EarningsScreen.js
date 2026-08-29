import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import API from '../services/api';

export default function EarningsScreen() {
  const [earnings, setEarnings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEarnings();
  }, []);

  const fetchEarnings = async () => {
    try {
      const res = await API.get('/drivers/earnings');
      setEarnings(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#007bff" /></View>;
  }

  if (!earnings) {
    return <View style={styles.center}><Text>No earnings data</Text></View>;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Earnings</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Today</Text>
        <Text style={styles.amount}>₦{earnings.today?.earnings || 0}</Text>
        <Text style={styles.detail}>{earnings.today?.trips || 0} trips</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>This Week</Text>
        <Text style={styles.amount}>₦{earnings.weekly?.earnings || 0}</Text>
        <Text style={styles.detail}>{earnings.weekly?.trips || 0} trips</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Total Trips Completed</Text>
        <Text style={styles.amount}>{earnings.totalTrips || 0}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#f5f5f5', flexGrow: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  card: { backgroundColor: 'white', padding: 20, borderRadius: 10, marginBottom: 15, elevation: 2 },
  label: { fontSize: 14, color: '#666' },
  amount: { fontSize: 28, fontWeight: 'bold', marginVertical: 8 },
  detail: { fontSize: 12, color: '#888' }
});
