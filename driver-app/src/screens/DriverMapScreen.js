import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import socket from '../services/socket';
import API from '../services/api';

const LOCATION_TASK = 'driver-background-location';

// Define background task
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Background location error:', error);
    return;
  }
  const { locations } = data;
  if (locations && locations.length > 0) {
    const loc = locations[0].coords;
    // Send location via socket
    const driverId = await SecureStore.getItemAsync('userId');
    if (driverId) {
      socket.emit('driver:location', {
        userId: driverId,
        lat: loc.latitude,
        lng: loc.longitude
      });
    }
  }
});

export default function DriverMapScreen({ navigation }) {
  const [isOnline, setIsOnline] = useState(false);
  const [currentRide, setCurrentRide] = useState(null);
  const [driverId, setDriverId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);

  const mapRef = useRef(null);

  useEffect(() => {
    // Get driver ID from storage
    const init = async () => {
      const id = await SecureStore.getItemAsync('userId');
      setDriverId(id);
    };
    init();

    // Request location permissions
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
        if (bgStatus === 'granted') {
          // Start background location tracking
          await Location.startLocationUpdatesAsync(LOCATION_TASK, {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000, // 5 seconds
            distanceInterval: 10, // 10 meters
            foregroundService: {
              notificationTitle: 'Taxi Driver',
              notificationBody: 'Tracking your location for ride requests'
            }
          });
        } else {
          Alert.alert('Permission Denied', 'Background location is required for this app');
        }
      } else {
        Alert.alert('Permission Denied', 'Location permission is required');
      }
    })();

    // Socket listeners
    socket.on('driver:new-ride', (data) => {
      setCurrentRide(data);
      Alert.alert(
        '🚨 New Ride Request',
        `From: ${data.pickup.address || 'Tap to view'} | Fare: ₦${data.fare}`,
        [
          { text: 'Reject', onPress: () => socket.emit('driver:reject', data.rideId) },
          { text: 'Accept', onPress: () => handleAcceptRide(data.rideId) }
        ]
      );
    });

    socket.on('driver:accept-success', (data) => {
      Alert.alert('Accepted', 'Ride accepted successfully');
      setCurrentRide(null);
      // Navigate to pickup - can add navigation logic here
    });

    socket.on('driver:reject-success', (data) => {
      setCurrentRide(null);
    });

    socket.on('driver:error', (data) => {
      Alert.alert('Error', data.message);
    });

    // Location updates from foreground
    const locationSubscription = Location.watchPositionAsync({
      accuracy: Location.Accuracy.High,
      timeInterval: 5000,
      distanceInterval: 10
    }, (location) => {
      const { latitude, longitude } = location.coords;
      setCurrentLocation({ lat: latitude, lng: longitude });
      if (isOnline && driverId) {
        socket.emit('driver:location', {
          userId: driverId,
          lat: latitude,
          lng: longitude
        });
      }
    });

    return () => {
      socket.off('driver:new-ride');
      socket.off('driver:accept-success');
      socket.off('driver:reject-success');
      socket.off('driver:error');
      locationSubscription.remove();
      // Stop background task when unmounting? Better to keep it running.
    };
  }, [isOnline, driverId]);

  const toggleOnlineStatus = async () => {
    if (!driverId) return;
    setLoading(true);
    try {
      const newStatus = !isOnline;
      const res = await API.put('/drivers/status', { 
        isOnline: newStatus,
        location: currentLocation
      });
      if (res.data.success) {
        setIsOnline(newStatus);
        if (newStatus) {
          Alert.alert('Online', 'You are now online and can receive rides');
        } else {
          Alert.alert('Offline', 'You are now offline');
        }
      }
    } catch (error) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to update status');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptRide = (rideId) => {
    socket.emit('driver:accept', { rideId, driverId });
  };

  const completeRide = async () => {
    if (!currentRide) return;
    try {
      const res = await API.put(`/rides/${currentRide.rideId}/complete`, {
        distanceKm: 5, // placeholder - calculate from GPS
        durationMin: 15,
        finalFare: currentRide.fare
      });
      if (res.data.success) {
        Alert.alert('Completed', 'Ride completed successfully');
        setCurrentRide(null);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to complete ride');
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        showsUserLocation
        initialRegion={{
          latitude: currentLocation?.lat || 6.5244,
          longitude: currentLocation?.lng || 3.3792,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421
        }}
      >
        {currentRide && (
          <Marker coordinate={currentRide.pickup} title="Pickup" pinColor="green" />
        )}
      </MapView>

      {/* Bottom Controls */}
      <View style={styles.panel}>
        <View style={styles.statusRow}>
          <Text style={styles.statusText}>Status: {isOnline ? '🟢 Online' : '🔴 Offline'}</Text>
          <TouchableOpacity
            style={[styles.toggleBtn, isOnline ? styles.onlineBtn : styles.offlineBtn]}
            onPress={toggleOnlineStatus}
            disabled={loading}
          >
            <Text style={styles.toggleText}>{loading ? '...' : isOnline ? 'Go Offline' : 'Go Online'}</Text>
          </TouchableOpacity>
        </View>

        {currentRide && (
          <View style={styles.rideCard}>
            <Text style={styles.rideTitle}>Active Ride</Text>
            <Text>Pickup: {currentRide.pickup.address || 'Address not available'}</Text>
            <Text>Fare: ₦{currentRide.fare}</Text>
            <TouchableOpacity style={styles.completeBtn} onPress={completeRide}>
              <Text style={styles.completeText}>Complete Ride</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  panel: {
    backgroundColor: 'white',
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    elevation: 10,
  },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  statusText: { fontSize: 16, fontWeight: 'bold' },
  toggleBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  onlineBtn: { backgroundColor: '#dc3545' },
  offlineBtn: { backgroundColor: '#28a745' },
  toggleText: { color: 'white', fontWeight: 'bold' },
  rideCard: { backgroundColor: '#f8f9fa', padding: 15, borderRadius: 8, marginTop: 10 },
  rideTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  completeBtn: { backgroundColor: '#ff6600', padding: 12, borderRadius: 8, marginTop: 10, alignItems: 'center' },
  completeText: { color: 'white', fontWeight: 'bold' }
});
