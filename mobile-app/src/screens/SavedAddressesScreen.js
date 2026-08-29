import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import API from '../services/api';

export default function SavedAddressesScreen() {
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    API.get('/users/addresses')
      .then((res) => setAddresses(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Refresh whenever this screen regains focus (e.g. after saving a new
  // place from the map screen).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const remove = async (id) => {
    try {
      await API.delete(`/users/addresses/${id}`);
      setAddresses((prev) => prev.filter((a) => a._id !== id));
    } catch (error) {
      // Non-critical; leave the list as-is on failure
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#ff6600" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {addresses.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>
            No saved places yet. Pick a dropoff on the map, then tap "Save this place" to add one.
          </Text>
        </View>
      ) : (
        <FlatList
          data={addresses}
          keyExtractor={(item) => item._id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{item.label}</Text>
                <Text style={styles.address}>{item.address}</Text>
              </View>
              <TouchableOpacity onPress={() => remove(item._id)}>
                <Text style={styles.remove}>Remove</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  empty: { textAlign: 'center', color: '#888', fontSize: 15 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 10,
    marginBottom: 10
  },
  label: { fontSize: 15, fontWeight: 'bold', marginBottom: 2 },
  address: { fontSize: 13, color: '#777' },
  remove: { color: '#dc3545', fontWeight: 'bold', fontSize: 13 }
});
