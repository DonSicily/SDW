import io from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from './api';

// Single shared instance; we connect (or reconnect) once we have a token.
const socket = io(API_URL, {
  transports: ['websocket'],
  autoConnect: false // wait until we have a JWT
});

/**
 * Connect (or reconnect) the socket using the stored JWT.
 * Call this after login / on app start when a token is present.
 */
export async function connectSocket() {
  const token = await SecureStore.getItemAsync('userToken');
  if (!token) {
    console.warn('connectSocket: no token available');
    return;
  }

  socket.auth = { token };
  if (socket.connected) {
    socket.disconnect();
  }
  socket.connect();
}

/**
 * Disconnect and clear auth (call on logout).
 */
export function disconnectSocket() {
  socket.auth = {};
  if (socket.connected) {
    socket.disconnect();
  }
}

export default socket;
