import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Modal, TextInput } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import API from '../services/api';
import socket from '../services/socket';
import BottomSheet from '../components/BottomSheet';
import { customMapStyle } from '../utils/mapStyle';

export default function MapScreen({ navigation }) {
  const [pickup, setPickup] = useState(null);
  const [dropoff, setDropoff] = useState(null);
  const [price, setPrice] = useState({ standard: 0, minBid: 0, distanceKm: 0, durationMin: 0 });
  const [rideStatus, setRideStatus] = useState('idle'); // idle, searching, accepted, started, completed
  const [currentRide, setCurrentRide] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [saveLabelVisible, setSaveLabelVisible] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');

  const mapRef = useRef(null);

  useEffect(() => {
    // Get user's current location
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({});
        setUserLocation({
          lat: location.coords.latitude,
          lng: location.coords.longitude
        });
        // Set default pickup to user location
        setPickup({
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          address: 'Current Location'
        });
      }
    })();

    // Load favorite/saved addresses for the quick-select row
    API.get('/users/addresses').then((res) => setSavedAddresses(res.data)).catch(() => {});

    // Socket listeners
    socket.on('rider:searching', (data) => {
      setRideStatus('searching');
      setSheetOpen(true);
      Alert.alert('Searching', 'Looking for nearest driver...');
    });

    socket.on('rider:ride-accepted', (data) => {
      setRideStatus('accepted');
      setCurrentRide(data.rideId);
      setSheetOpen(true);
      if (data.driverLocation) {
        setDriverLocation(data.driverLocation);
      }
      Alert.alert('Driver Found!', 'Your driver is on the way.');
    });

    socket.on('rider:ride-completed', (data) => {
      const rideId = currentRide || data.rideId;
      setRideStatus('idle');
      setCurrentRide(null);
      setDriverLocation(null);
      setDropoff(null);
      setPrice({ standard: 0, minBid: 0 });
      setSheetOpen(true);
      navigation.navigate('Rating', { rideId });
    });

    socket.on('rider:no-drivers', (data) => {
      setRideStatus('idle');
      Alert.alert('No Drivers', data.message || 'Please try again later.');
    });

    socket.on('rider:error', (data) => {
      setRideStatus('idle');
      Alert.alert('Error', data.message);
    });

    socket.on('driver:location-update', (data) => {
      if (rideStatus === 'accepted' || rideStatus === 'started') {
        setDriverLocation({ lat: data.lat, lng: data.lng });
      }
    });

    return () => {
      socket.off('rider:searching');
      socket.off('rider:ride-accepted');
      socket.off('rider:ride-completed');
      socket.off('rider:no-drivers');
      socket.off('rider:error');
      socket.off('driver:location-update');
    };
  }, [rideStatus, currentRide]);

  const handleMapPress = (e) => {
    if (rideStatus !== 'idle') return;
    const coord = e.nativeEvent.coordinate;
    if (!pickup) {
      setPickup({ lat: coord.latitude, lng: coord.longitude, address: 'Selected Pickup' });
    } else if (!dropoff) {
      setDropoff({ lat: coord.latitude, lng: coord.longitude, address: 'Selected Dropoff' });
      // Automatically estimate fare
      fetchEstimate();
    } else {
      // Reset: set new pickup, clear dropoff
      setPickup({ lat: coord.latitude, lng: coord.longitude, address: 'Selected Pickup' });
      setDropoff(null);
      setPrice({ standard: 0, minBid: 0 });
    }
  };

  const fetchEstimate = async () => {
    if (!pickup || !dropoff) return;
    setLoading(true);
    try {
      const res = await API.post('/rides/estimate', { pickup, dropoff });
      setPrice(res.data);
      setSheetOpen(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to calculate fare');
    } finally {
      setLoading(false);
    }
  };

  const requestRide = async (fareType) => {
    if (rideStatus !== 'idle') return;
    if (!pickup || !dropoff) {
      Alert.alert('Error', 'Please select pickup and dropoff points');
      return;
    }
    setLoading(true);
    try {
      const fare = fareType === 'standard' ? price.standard : price.minBid;
      const token = await SecureStore.getItemAsync('userToken');
      const res = await API.post('/rides/request', {
        pickup,
        dropoff,
        fare: { standard: price.standard, minBid: price.minBid, chosen: fare }
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.success) {
        setRideStatus('searching');
      }
    } catch (error) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to request ride');
    } finally {
      setLoading(false);
    }
  };

  const cancelRide = async () => {
    if (!currentRide) return;
    try {
      await API.put(`/rides/${currentRide}/cancel`);
      setRideStatus('idle');
      setCurrentRide(null);
      setDriverLocation(null);
      Alert.alert('Cancelled', 'Ride cancelled');
    } catch (error) {
      Alert.alert('Error', 'Failed to cancel');
    }
  };

  const selectSavedAddress = async (addr) => {
    if (!pickup) return;
    const newDropoff = { lat: addr.lat, lng: addr.lng, address: addr.address };
    setDropoff(newDropoff);
    setLoading(true);
    try {
      const res = await API.post('/rides/estimate', { pickup, dropoff: newDropoff });
      setPrice(res.data);
      setSheetOpen(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to calculate fare');
    } finally {
      setLoading(false);
    }
  };

  const confirmSaveAddress = async () => {
    if (!saveLabel.trim() || !dropoff) return;
    try {
      const res = await API.post('/users/addresses', {
        label: saveLabel.trim(),
        address: dropoff.address,
        lat: dropoff.lat,
        lng: dropoff.lng
      });
      setSavedAddresses((prev) => [...prev, res.data]);
      setSaveLabelVisible(false);
      setSaveLabel('');
    } catch (error) {
      Alert.alert('Error', error.response?.data?.message || 'Could not save address');
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: userLocation?.lat || 6.5244,
          longitude: userLocation?.lng || 3.3792,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421
        }}
        onPress={handleMapPress}
        showsUserLocation
        customMapStyle={customMapStyle}
      >
        {pickup && <Marker coordinate={pickup} title="Pickup" pinColor="green" />}
        {dropoff && <Marker coordinate={dropoff} title="Dropoff" pinColor="red" />}
        {driverLocation && (
          <Marker coordinate={driverLocation} title="Driver" pinColor="blue">
            <View style={styles.driverMarker}><Text style={{fontSize:10}}>🚗</Text></View>
          </Marker>
        )}
        {pickup && dropoff && (
          <Polyline
            coordinates={[pickup, dropoff]}
            strokeColor="#ff6600"
            strokeWidth={3}
          />
        )}
      </MapView>

      {/* Bottom Sheet */}
      <BottomSheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        headerComponent={
          <TouchableOpacity onPress={() => setSheetOpen(!sheetOpen)}>
            <Text style={styles.sheetHeaderText}>
              {rideStatus === 'idle'
                ? (price.standard > 0 ? `From ₦${price.standard}` : 'Where to?')
                : rideStatus === 'searching'
                ? 'Finding your driver…'
                : '✅ Driver on the way'}
            </Text>
          </TouchableOpacity>
        }
      >
        {rideStatus === 'idle' ? (
          <>
            <View style={styles.row}>
              <Text style={styles.label}>Pickup: {pickup?.address || 'Tap map'}</Text>
              <TouchableOpacity onPress={() => { setPickup(null); setDropoff(null); setPrice({}); }}>
                <Text style={styles.clear}>Clear</Text>
              </TouchableOpacity>
            </View>
            {dropoff ? (
              <View style={styles.row}>
                <Text style={styles.label}>Dropoff: {dropoff?.address || 'Tap map'}</Text>
                <TouchableOpacity onPress={() => setSaveLabelVisible(true)}>
                  <Text style={styles.clear}>☆ Save</Text>
                </TouchableOpacity>
              </View>
            ) : savedAddresses.length > 0 ? (
              <View style={styles.savedRow}>
                {savedAddresses.map((addr) => (
                  <TouchableOpacity
                    key={addr._id}
                    style={styles.savedChip}
                    onPress={() => selectSavedAddress(addr)}
                  >
                    <Text style={styles.savedChipText}>📍 {addr.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            {price.standard > 0 && (
              <View style={styles.priceContainer}>
                <Text style={styles.price}>Standard: ₦{price.standard}</Text>
                <Text style={styles.price}>Bid: ₦{price.minBid}</Text>
                <Text style={styles.detail}>{price.distanceKm}km · {price.durationMin}min</Text>
              </View>
            )}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.standardBtn]}
                onPress={() => requestRide('standard')}
                disabled={loading || !dropoff}
              >
                <Text style={styles.buttonText}>Book Standard</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.bidBtn]}
                onPress={() => requestRide('bid')}
                disabled={loading || !dropoff}
              >
                <Text style={styles.buttonText}>Bid & Save</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : rideStatus === 'searching' ? (
          <View style={styles.statusContainer}>
            <ActivityIndicator size="large" color="#ff6600" />
            <Text style={styles.statusText}>Searching for a driver...</Text>
            <TouchableOpacity onPress={cancelRide}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : rideStatus === 'accepted' ? (
          <View style={styles.statusContainer}>
            <Text style={styles.statusText}>✅ Driver accepted!</Text>
            {driverLocation && (
              <Text style={styles.detail}>Driver is {calculateDistance(userLocation, driverLocation)}m away</Text>
            )}
            <TouchableOpacity onPress={cancelRide} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel Ride</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </BottomSheet>

      <Modal visible={saveLabelVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Save this place</Text>
            <Text style={styles.modalAddress}>{dropoff?.address}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Home, Work, Mum's house"
              value={saveLabel}
              onChangeText={setSaveLabel}
              autoFocus
            />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancelBtn]}
                onPress={() => { setSaveLabelVisible(false); setSaveLabel(''); }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalSaveBtn]}
                onPress={confirmSaveAddress}
              >
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
      );
}

// Helper: distance in meters
function calculateDistance(loc1, loc2) {
  if (!loc1 || !loc2) return 0;
  const R = 6371e3;
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(loc2.lat - loc1.lat);
  const dLng = toRad(loc2.lng - loc1.lng);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(loc1.lat)) * Math.cos(toRad(loc2.lat)) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c);
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  sheetHeaderText: { fontSize: 16, fontWeight: 'bold', color: '#222', textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  label: { fontSize: 14, color: '#333' },
  clear: { color: '#ff6600', fontWeight: 'bold' },
  priceContainer: { marginVertical: 10, alignItems: 'center' },
  price: { fontSize: 18, fontWeight: 'bold', color: '#ff6600' },
  detail: { fontSize: 12, color: '#666', marginTop: 4 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  button: { flex: 1, padding: 14, borderRadius: 8, alignItems: 'center', marginHorizontal: 4 },
  standardBtn: { backgroundColor: '#ff6600' },
  bidBtn: { backgroundColor: '#28a745' },
  buttonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  statusContainer: { alignItems: 'center', justifyContent: 'center', padding: 10 },
  statusText: { fontSize: 18, marginVertical: 10 },
  cancelText: { color: 'red', marginTop: 10 },
  cancelBtn: { marginTop: 10, padding: 10, backgroundColor: '#dc3545', borderRadius: 8 },
  cancelBtnText: { color: 'white', fontWeight: 'bold' },
  driverMarker: { backgroundColor: 'white', borderRadius: 20, padding: 4, borderWidth: 2, borderColor: 'blue' },
  savedRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  savedChip: {
    backgroundColor: '#f2f2f2',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
    marginBottom: 8
  },
  savedChipText: { fontSize: 13, color: '#333', fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { backgroundColor: 'white', borderRadius: 14, padding: 20, width: '85%' },
  modalTitle: { fontSize: 17, fontWeight: 'bold', marginBottom: 4 },
  modalAddress: { fontSize: 13, color: '#777', marginBottom: 14 },
  modalInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 15, marginBottom: 16 },
  modalButtonRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  modalBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, marginLeft: 8 },
  modalCancelBtn: { backgroundColor: '#eee' },
  modalCancelText: { color: '#333', fontWeight: 'bold' },
  modalSaveBtn: { backgroundColor: '#ff6600' },
  modalSaveText: { color: 'white', fontWeight: 'bold' }
});
