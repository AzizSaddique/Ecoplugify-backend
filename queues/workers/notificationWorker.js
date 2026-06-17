import { Worker } from 'bullmq';
import Notification from '../../models/Notification.js';
import { sendPushNotification } from '../../services/fcmService.js';
import { getRedis } from '../../config/redis.js';
import { getSocketIO } from '../../sockets/socketServer.js';
import logger from '../../utils/logger.js';

const getConnection = () => ({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const updateUnreadCache = async userId => {
  try {
    const count = await Notification.countDocuments({ userId, isRead: false });
    const redis = getRedis();

    if (redis) {
      await redis.setEx(`notif:unread:${userId}`, 60, String(count));
    }

    const io = getSocketIO();
    if (io) {
      io.to(`user:${userId}`).emit('notification:unread_count', { count });
    }

    return count;
  } catch (error) {
    logger.warn(`Unread cache update failed: ${error.message}`);
    return null;
  }
};

const emitSocketEvents = (notification, unreadCount) => {
  const io = getSocketIO();
  if (!io) {
    return;
  }

  const userRoom = `user:${notification.userId}`;
  const payload = notification.toObject ? notification.toObject() : notification;

  io.to(userRoom).emit('notification:new', payload);
  io.to(userRoom).emit('notification:alert', {
    type: payload.type,
    title: payload.title,
    body: payload.body,
    priority: payload.priority,
    deviceId: payload.deviceId,
    deviceName: payload.deviceName,
    channelId: payload.channelId,
  });

  if (unreadCount !== null && unreadCount !== undefined) {
    io.to(userRoom).emit('notification:unread_count', { count: unreadCount });
  }

  if (payload.type === 'DEVICE_OFFLINE') {
    io.to(userRoom).emit('notification:device_offline', {
      deviceId: payload.deviceId,
      deviceName: payload.deviceName,
    });
  }

  if (payload.type === 'DEVICE_ONLINE') {
    io.to(userRoom).emit('notification:device_online', {
      deviceId: payload.deviceId,
      deviceName: payload.deviceName,
    });
  }
};

export const emitNotification = async notifData => {
  let notification = null;

  try {
    notification = await Notification.create(notifData);
  } catch (error) {
    logger.error(`Notification Mongo save failed: ${error.message}`);
  }

  const pushPayload = {
    title: notifData.title,
    body: notifData.body,
    priority: notifData.priority,
    channelId: notifData.channelId,
    data: {
      ...(notifData.data || {}),
      notificationId: notification?._id?.toString() || '',
      type: notifData.type,
      deviceId: notifData.deviceId || '',
      deviceName: notifData.deviceName || '',
    },
  };

  await sendPushNotification(notifData.userId, pushPayload);

  const unreadCount = notification ? await updateUnreadCache(notifData.userId) : null;
  emitSocketEvents(notification || notifData, unreadCount);

  return notification;
};

export const startNotificationWorker = () => {
  const worker = new Worker(
    'notification-processing',
    async job => {
      if (job.name !== 'send-notification') {
        logger.warn(`Unknown notification job skipped: ${job.name}`);
        return { success: false, skipped: 'unknown-job' };
      }

      await emitNotification(job.data);
      return { success: true };
    },
    {
      skipVersionCheck: true,
      connection: getConnection(),
      concurrency: Number(process.env.NOTIFICATION_WORKER_CONCURRENCY || 5),
    },
  );

  worker.on('failed', (job, err) => {
    logger.error(`[NotificationWorker] Failed ${job?.id}: ${err.message}`);
  });

  worker.on('completed', job => {
    logger.debug(`[NotificationWorker] Done ${job.id}`);
  });

  logger.info('Notification worker started');
  return worker;
};

export default startNotificationWorker;
