import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import API from '../services/api';

// Paystack redirects here once checkout completes; we treat that as our signal
// to stop polling and verify the payment server-side (the webhook is the real
// source of truth, but a quick verify on return gives instant UI feedback).
const CALLBACK_MARKER = 'payment-complete';

export default function PaymentScreen({ route, navigation }) {
  const { rideId } = route.params;
  const [checkoutUrl, setCheckoutUrl] = useState(null);
  const [reference, setReference] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const handledRef = useRef(false);

  useEffect(() => {
    startCheckout();
  }, []);

  const startCheckout = async () => {
    setLoading(true);
    try {
      const res = await API.post('/payments/initialize', { rideId });
      setCheckoutUrl(res.data.authorizationUrl);
      setReference(res.data.reference);
    } catch (error) {
      Alert.alert('Payment error', error.response?.data?.message || 'Could not start payment');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const verifyAndClose = async (ref) => {
    if (handledRef.current) return;
    handledRef.current = true;
    setVerifying(true);
    try {
      const res = await API.get(`/payments/verify/${ref}`);
      if (res.data.paid) {
        Alert.alert('Payment successful', 'Your ride has been paid for.');
      } else {
        Alert.alert('Payment pending', 'We could not confirm payment yet. Check ride history shortly.');
      }
    } catch (error) {
      Alert.alert('Verification error', 'Could not confirm payment status.');
    } finally {
      setVerifying(false);
      navigation.goBack();
    }
  };

  // Paystack's hosted checkout redirects to callback_url (or its own success
  // page) once done. We watch navigation state for that and stop the flow.
  const handleNavChange = (navState) => {
    const url = navState.url || '';
    if (url.includes(CALLBACK_MARKER) || url.includes('/close') || url.includes('trxref=')) {
      verifyAndClose(reference);
    }
  };

  if (loading || !checkoutUrl) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#ff6600" />
        <Text style={styles.statusText}>Starting secure checkout…</Text>
      </View>
    );
  }

  if (verifying) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#ff6600" />
        <Text style={styles.statusText}>Confirming payment…</Text>
      </View>
    );
  }

  return (
    <WebView
      source={{ uri: checkoutUrl }}
      onNavigationStateChange={handleNavChange}
      startInLoadingState
      renderLoading={() => (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#ff6600" />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'white' },
  statusText: { marginTop: 12, fontSize: 14, color: '#666' }
});
