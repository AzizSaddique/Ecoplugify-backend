import { admin, isFirebaseReady } from '../config/firebase.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';

const invalidTokenCodes = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

const normalizePriority = priority =>
  priority === 'max' || priority === 'high' ? 'high' : 'normal';

const normalizeNotificationPriority = priority => {
  if (priority === 'max') {
    return 'max';
  }

  if (priority === 'high') {
    return 'high';
  }

  return 'default';
};

export const sendPushNotification = async (
  userId,
  { title, body, data = {}, priority = 'default', channelId },
) => {
  try {
    if (!isFirebaseReady()) {
      logger.warn('FCM skipped because Firebase Admin is not ready');
      return false;
    }

    const user = await User.findOne({ uid: userId }).select('fcmToken').lean();
    if (!user?.fcmToken) {
      logger.debug(`FCM skipped for ${userId}: no token`);
      return false;
    }

    const message = {
      token: user.fcmToken,
      notification: {
        title,
        body,
      },
      data: Object.entries({
        ...data,
        title,
        body,
        priority,
        channelId,
      }).reduce((payload, [key, value]) => {
        if (value !== undefined && value !== null) {
          payload[key] = String(value);
        }
        return payload;
      }, {}),
      android: {
        priority: normalizePriority(priority),
        notification: {
          channelId: channelId || 'ecoplugify_info',
          priority: normalizeNotificationPriority(priority),
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            contentAvailable: true,
          },
        },
      },
    };

    await admin.messaging().send(message);
    return true;
  } catch (error) {
    if (invalidTokenCodes.has(error.code)) {
      await User.updateOne({ uid: userId }, { $set: { fcmToken: null } });
      logger.warn(`Cleared invalid FCM token for user ${userId}`);
      return false;
    }

    logger.error(`FCM send failed for user ${userId}: ${error.message}`);
    return false;
  }
};

export default {
  sendPushNotification,
};
