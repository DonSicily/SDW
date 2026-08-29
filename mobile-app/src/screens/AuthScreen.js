import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import API from '../services/api';

export default function AuthScreen({ setIsAuthenticated }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);

  const persistSession = async (data) => {
    const access = data.accessToken || data.token;
    await SecureStore.setItemAsync('userToken', access);
    if (data.refreshToken) {
      await SecureStore.setItemAsync('refreshToken', data.refreshToken);
    }
    await SecureStore.setItemAsync('userId', data._id);
    await SecureStore.setItemAsync('userRole', data.role);
    setIsAuthenticated(true);
  };

  const handleSendOtp = async () => {
    if (!phone) {
      Alert.alert('Error', 'Enter your phone number first');
      return;
    }
    setLoading(true);
    try {
      const res = await API.post('/auth/send-otp', { phone });
      setOtpSent(true);
      const hint = res.data.debugCode
        ? ` (dev code: ${res.data.debugCode})`
        : '';
      Alert.alert('OTP sent', `Check your SMS for the verification code${hint}`);
    } catch (error) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!phone || !password) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }
    if (!isLogin && !fullName?.trim()) {
      Alert.alert('Error', 'Full name is required to register');
      return;
    }
    if (!isLogin && !otpCode) {
      Alert.alert('Error', 'Request an OTP and enter the code to register');
      return;
    }
    setLoading(true);
    try {
      if (isLogin) {
        const res = await API.post('/auth/login', { phone, password });
        if (res.data.token || res.data.accessToken) {
          await persistSession(res.data);
        } else {
          Alert.alert('Error', res.data.message || 'Authentication failed');
        }
      } else {
        const res = await API.post('/auth/register', {
          phone,
          password,
          fullName: fullName.trim(),
          role: 'rider',
          otpCode
        });
        if (res.data.token || res.data.accessToken) {
          await persistSession(res.data);
        } else {
          Alert.alert('Error', res.data.message || 'Registration failed');
        }
      }
    } catch (error) {
      Alert.alert('Error', error.response?.data?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={styles.title}>SDW Taxi Rider</Text>
      <View style={styles.card}>
        {!isLogin && (
          <TextInput
            style={styles.input}
            placeholder="Full Name"
            value={fullName}
            onChangeText={setFullName}
          />
        )}
        <TextInput
          style={styles.input}
          placeholder="Phone (e.g. 08012345678)"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        {!isLogin && (
          <>
            <TextInput
              style={styles.input}
              placeholder="OTP code"
              value={otpCode}
              onChangeText={setOtpCode}
              keyboardType="number-pad"
              maxLength={8}
            />
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={handleSendOtp}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Sending...' : otpSent ? 'Resend OTP' : 'Send OTP'}
              </Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
          <Text style={styles.buttonText}>
            {loading ? 'Processing...' : isLogin ? 'Login' : 'Register'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setIsLogin(!isLogin);
            setOtpSent(false);
            setOtpCode('');
          }}
        >
          <Text style={styles.switchText}>
            {isLogin ? "Don't have an account? Register" : 'Already have an account? Login'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  logo: { width: 120, height: 110, marginBottom: 12 },
  title: { fontSize: 26, fontWeight: 'bold', marginBottom: 28, color: '#333' },
  card: { width: '90%', backgroundColor: 'white', padding: 20, borderRadius: 10, elevation: 3 },
  input: { borderWidth: 1, borderColor: '#ddd', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 16 },
  button: { backgroundColor: '#ff6600', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  secondaryButton: { backgroundColor: '#555', marginTop: 0, marginBottom: 4 },
  buttonText: { color: 'white', fontSize: 18, fontWeight: 'bold' },
  switchText: { marginTop: 15, textAlign: 'center', color: '#007bff', fontSize: 14 }
});
