import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import API from '../services/api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});

// Requests permission, grabs an Expo push token, and saves it on the backend
// so the server can reach this device even when the app is backgrounded.
// Safe to call repeatedly (e.g. on every login) — it's a no-op on simulators
// and silently does nothing if the user declines permission.
export async function registerForPushNotificationsAsync() {
  try {
    if (!Device.isDevice) {
      return null; // push tokens aren't available on simulators/emulators
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return null;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync();

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT
      });
    }

    await API.put('/auth/push-token', { token });
    return token;
  } catch (error) {
    console.log('Push registration skipped:', error.message);
    return null;
  }
}

export async function clearPushToken() {
  try {
    await API.put('/auth/push-token', { token: null });
  } catch (error) {
    // Not worth surfacing to the user — logout should proceed regardless.
    console.log('Could not clear push token:', error.message);
  }
}
