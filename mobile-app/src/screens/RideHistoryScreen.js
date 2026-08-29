import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import API from '../services/api';

export default function RideHistoryScreen({ navigation }) {
  const [rides, setRides] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await API.get('/rides/history');
      setRides(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item }) => {
    const isPayable = item.status === 'completed' && item.paymentStatus !== 'paid';
    return (
      <View style={styles.card}>
        <Text style={styles.date}>{new Date(item.createdAt).toLocaleString()}</Text>
        <Text>From: {item.pickup.address}</Text>
        <Text>To: {item.dropoff.address}</Text>
        <Text style={styles.fare}>Fare: ₦{item.finalFare || item.fare?.standard || 0}</Text>
        <Text style={styles.status}>Status: {item.status.toUpperCase()}</Text>
        <Text style={styles.status}>Payment: {(item.paymentStatus || 'unpaid').toUpperCase()}</Text>
        {isPayable && (
          <TouchableOpacity
            style={styles.payBtn}
            onPress={() => navigation.navigate('Payment', { rideId: item._id })}
          >
            <Text style={styles.payBtnText}>Pay with Paystack</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#ff6600" /></View>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ride History</Text>
      {rides.length === 0 ? (
        <Text style={styles.empty}>No rides yet</Text>
      ) : (
        <FlatList
          data={rides}
          renderItem={renderItem}
          keyExtractor={(item) => item._id}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 10 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 10 },
  card: { backgroundColor: 'white', padding: 15, borderRadius: 8, marginBottom: 10 },
  date: { fontSize: 12, color: '#666', marginBottom: 5 },
  fare: { fontWeight: 'bold', marginTop: 5 },
  status: { marginTop: 5, color: '#28a745' },
  empty: { textAlign: 'center', marginTop: 50, fontSize: 16, color: '#666' },
  payBtn: { marginTop: 10, backgroundColor: '#ff6600', padding: 10, borderRadius: 8, alignItems: 'center' },
  payBtnText: { color: 'white', fontWeight: 'bold' }
});
