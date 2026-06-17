import Notification from '../models/Notification.js';
import NotificationSettings from '../models/NotificationSettings.js';
import { getRedis } from '../config/redis.js';
import { getNotificationQueue } from '../queues/index.js';
import { emitNotification } from '../queues/workers/notificationWorker.js';
import logger from '../utils/logger.js';

export const TYPE_SETTING_MAP = {
  DEVICE_OFFLINE: 'deviceOffline',
  DEVICE_ONLINE: 'deviceOnline',
  HIGH_POWER: 'highPower',
  OVER_VOLTAGE: 'overVoltage',
  OVER_CURRENT: 'overCurrent',
  RELAY_CHANGED: 'relayChange',
  APPLIANCE_LEFT_ON: 'applianceLeftOn',
  HIGH_DAILY_COST: 'highCost',
  DATA_LOSS: 'dataLoss',
  CAL_WARNING: 'calWarning',
  ESP32_REBOOT: 'esp32Reboot',
  DAILY_SUMMARY: 'dailySummary',
};

export const DEDUP_TTL_SECONDS = {
  DEVICE_OFFLINE: 300,
  DEVICE_ONLINE: 60,
  HIGH_POWER: 600,
  OVER_VOLTAGE: 60,
  OVER_CURRENT: 60,
  RELAY_CHANGED: 10,
  APPLIANCE_LEFT_ON: 21600,
  HIGH_DAILY_COST: 3600,
  DATA_LOSS: 300,
  CAL_WARNING: 3600,
  ESP32_REBOOT: 30,
  DAILY_SUMMARY: 86400,
};

export const CHANNEL_BY_PRIORITY = {
  max: 'ecoplugify_critical',
  high: 'ecoplugify_alerts',
  default: 'ecoplugify_info',
  low: 'ecoplugify_info',
};

const CRITICAL_TYPES = new Set(['OVER_VOLTAGE', 'OVER_CURRENT']);

const safeRedis = () => {
  try {
    return getRedis();
  } catch (error) {
    logger.warn(`Redis unavailable for notifications: ${error.message}`);
    return null;
  }
};

const dedupKeyFor = ({ userId, type, deviceId }) =>
  `notif:dedup:${userId}:${type}:${deviceId || 'global'}`;

export const isQuietHours = settings => {
  if (!settings?.quietHoursEnabled) {
    return false;
  }

  const now = new Date();
  const pkTime = new Date(
    now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }),
  );
  const currentMinutes = pkTime.getHours() * 60 + pkTime.getMinutes();
  const [sh, sm] = String(settings.quietStart || '23:00').split(':').map(Number);
  const [eh, em] = String(settings.quietEnd || '07:00').split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if ([sh, sm, eh, em].some(value => !Number.isFinite(value))) {
    return false;
  }

  if (startMin <= endMin) {
    return currentMinutes >= startMin && currentMinutes < endMin;
  }

  return currentMinutes >= startMin || currentMinutes < endMin;
};

export const getSettings = async userId =>
  NotificationSettings.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

export const shouldSend = async (userId, notifData) => {
  const settings = await getSettings(userId);
  const settingKey = TYPE_SETTING_MAP[notifData.type];

  if (!settings.masterEnabled) {
    return { send: false, reason: 'master-disabled' };
  }

  if (settingKey && settings[settingKey] === false) {
    return { send: false, reason: `${settingKey}-disabled` };
  }

  if (settings.systemNotifications === false) {
    return { send: false, reason: 'system-notifications-disabled' };
  }

  if (!CRITICAL_TYPES.has(notifData.type) && isQuietHours(settings)) {
    return { send: false, reason: 'quiet-hours' };
  }

  const redis = safeRedis();
  if (!redis) {
    return { send: true, settings };
  }

  try {
    const dedupKey = dedupKeyFor({
      userId,
      type: notifData.type,
      deviceId: notifData.deviceId,
    });
    const exists = await redis.get(dedupKey);

    if (exists) {
      return { send: false, reason: 'deduped' };
    }
  } catch (error) {
    logger.warn(`Notification dedup check failed: ${error.message}`);
  }

  return { send: true, settings };
};

export const setDedup = async (userId, notifData) => {
  const redis = safeRedis();
  if (!redis) {
    return;
  }

  try {
    await redis.setEx(
      dedupKeyFor({
        userId,
        type: notifData.type,
        deviceId: notifData.deviceId,
      }),
      DEDUP_TTL_SECONDS[notifData.type] || 300,
      '1',
    );
  } catch (error) {
    logger.warn(`Notification dedup set failed: ${error.message}`);
  }
};

export const getUnreadCount = async userId => {
  const redis = safeRedis();
  const cacheKey = `notif:unread:${userId}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        return Number(cached || 0);
      }
    } catch (error) {
      logger.warn(`Unread cache read failed: ${error.message}`);
    }
  }

  const count = await Notification.countDocuments({ userId, isRead: false });

  if (redis) {
    try {
      await redis.setEx(cacheKey, 60, String(count));
    } catch (error) {
      logger.warn(`Unread cache write failed: ${error.message}`);
    }
  }

  return count;
};

export const invalidateUnreadCount = async userId => {
  const redis = safeRedis();
  if (!redis) {
    return;
  }

  try {
    await redis.del(`notif:unread:${userId}`);
  } catch (error) {
    logger.warn(`Unread cache invalidation failed: ${error.message}`);
  }
};

export const createAndSend = async (userId, notifData) => {
  try {
    if (!userId || !notifData?.type || !notifData?.title || !notifData?.body) {
      logger.warn('Notification skipped because required fields are missing');
      return null;
    }

    const decision = await shouldSend(userId, notifData);
    if (!decision.send) {
      logger.debug(`Notification skipped: ${decision.reason}`);
      return null;
    }

    const normalized = {
      ...notifData,
      userId,
      priority: notifData.priority || 'default',
      channelId:
        notifData.channelId ||
        CHANNEL_BY_PRIORITY[notifData.priority || 'default'] ||
        'ecoplugify_info',
    };

    const queue = getNotificationQueue?.();
    if (queue) {
      await queue.add('send-notification', normalized, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      });
    } else {
      await emitNotification(normalized);
    }

    await setDedup(userId, normalized);
    return true;
  } catch (error) {
    logger.error(`createAndSend failed: ${error.message}`);
    return null;
  }
};

export default {
  createAndSend,
  getUnreadCount,
  getSettings,
  isQuietHours,
};
