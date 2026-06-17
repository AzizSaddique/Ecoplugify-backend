import Notification from '../models/Notification.js';
import NotificationSettings from '../models/NotificationSettings.js';
import { getUnreadCount, invalidateUnreadCount } from '../services/notificationService.js';
import { emitToUser } from '../sockets/socketServer.js';
import logger from '../utils/logger.js';

const allowedSettingFields = new Set([
  'masterEnabled',
  'deviceOffline',
  'deviceOnline',
  'highPower',
  'overVoltage',
  'overCurrent',
  'relayChange',
  'applianceLeftOn',
  'dailySummary',
  'highCost',
  'esp32Reboot',
  'calWarning',
  'dataLoss',
  'systemNotifications',
  'smsAlerts',
  'phoneCallAlerts',
  'powerThreshold',
  'costDailyLimit',
  'quietHoursEnabled',
  'quietStart',
  'quietEnd',
]);

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

const sanitizeSettingsUpdate = body =>
  Object.entries(body || {}).reduce((payload, [key, value]) => {
    if (!allowedSettingFields.has(key)) {
      return payload;
    }

    if (key === 'powerThreshold' || key === 'costDailyLimit') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        payload[key] = parsed;
      }
      return payload;
    }

    if (key === 'quietStart' || key === 'quietEnd') {
      if (timePattern.test(String(value))) {
        payload[key] = String(value);
      }
      return payload;
    }

    payload[key] = Boolean(value);
    return payload;
  }, {});

const publishUnread = async userId => {
  const unread = await getUnreadCount(userId);
  emitToUser(userId, 'notification:unread_count', { count: unread });
  return unread;
};

export const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);
    const query = { userId };

    if (String(req.query.unreadOnly) === 'true') {
      query.isRead = false;
    }

    const [notifications, total, unread] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(query),
      getUnreadCount(userId),
    ]);

    res.json({
      success: true,
      data: {
        notifications,
        total,
        unread,
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    logger.error(`Get notifications failed: ${error.message}`);
    next(error);
  }
};

export const markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.uid },
      { $set: { isRead: true } },
      { new: true },
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    await invalidateUnreadCount(req.user.uid);
    const unread = await publishUnread(req.user.uid);
    return res.json({ success: true, data: { notification, unread } });
  } catch (error) {
    logger.error(`Mark notification read failed: ${error.message}`);
    next(error);
  }
};

export const markAllRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { userId: req.user.uid, isRead: false },
      { $set: { isRead: true } },
    );
    await invalidateUnreadCount(req.user.uid);
    emitToUser(req.user.uid, 'notification:unread_count', { count: 0 });
    res.json({ success: true, data: { unread: 0 } });
  } catch (error) {
    logger.error(`Mark all notifications read failed: ${error.message}`);
    next(error);
  }
};

export const deleteNotification = async (req, res, next) => {
  try {
    const deleted = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.uid,
    });

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    await invalidateUnreadCount(req.user.uid);
    const unread = await publishUnread(req.user.uid);
    return res.json({ success: true, data: { unread } });
  } catch (error) {
    logger.error(`Delete notification failed: ${error.message}`);
    next(error);
  }
};

export const clearAll = async (req, res, next) => {
  try {
    await Notification.deleteMany({ userId: req.user.uid });
    await invalidateUnreadCount(req.user.uid);
    emitToUser(req.user.uid, 'notification:unread_count', { count: 0 });
    res.json({ success: true, data: { unread: 0 } });
  } catch (error) {
    logger.error(`Clear notifications failed: ${error.message}`);
    next(error);
  }
};

export const unreadCount = async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: { count: await getUnreadCount(req.user.uid) },
    });
  } catch (error) {
    logger.error(`Unread count failed: ${error.message}`);
    next(error);
  }
};

export const getSettings = async (req, res, next) => {
  try {
    const settings = await NotificationSettings.findOneAndUpdate(
      { userId: req.user.uid },
      { $setOnInsert: { userId: req.user.uid } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    res.json({ success: true, data: settings });
  } catch (error) {
    logger.error(`Get notification settings failed: ${error.message}`);
    next(error);
  }
};

export const updateSettings = async (req, res, next) => {
  try {
    const payload = sanitizeSettingsUpdate(req.body);
    const settings = await NotificationSettings.findOneAndUpdate(
      { userId: req.user.uid },
      { $set: { ...payload, updatedAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    res.json({ success: true, data: settings });
  } catch (error) {
    logger.error(`Update notification settings failed: ${error.message}`);
    next(error);
  }
};

export default {
  getNotifications,
  markAsRead,
  markAllRead,
  deleteNotification,
  clearAll,
  getUnreadCount: unreadCount,
  getSettings,
  updateSettings,
};
