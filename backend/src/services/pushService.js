const axios = require('axios');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Send a single push notification via Expo's push service.
// Silently no-ops if there's no token (e.g. user hasn't granted permission,
// or is on a simulator) so callers never need to check first.
const sendPushNotification = async (pushToken, title, body, data = {}) => {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) {
    return;
  }

  try {
    await axios.post(
      EXPO_PUSH_URL,
      {
        to: pushToken,
        sound: 'default',
        title,
        body,
        data
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    // Push failures shouldn't break the request that triggered them —
    // the in-app socket event is still the primary delivery path.
    console.error('Push notification error:', error.response?.data || error.message);
  }
};

module.exports = { sendPushNotification };
