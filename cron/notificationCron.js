import Notification from '../models/Notification.js';
import DeviceStatus from '../models/DeviceStatus.js';
import Reading from '../models/Reading.js';
import { createAndSend } from '../services/notificationService.js';
import logger from '../utils/logger.js';

const cronTimers = [];

const getTodayRangePKT = () => {
  const now = new Date();
  const pkNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
  pkNow.setHours(0, 0, 0, 0);

  const start = new Date(pkNow.getTime() - 5 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
};

const msUntilNext = (hour, minute) => {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, minute, 0, 0);
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
};

const scheduleDaily = (hour, minute, task) => {
  let timeout = null;

  const run = async () => {
    try {
      await task();
    } catch (error) {
      logger.error(`Notification cron task failed: ${error.message}`);
    } finally {
      timeout = setTimeout(run, msUntilNext(hour, minute));
      timeout.unref?.();
      cronTimers.push(timeout);
    }
  };

  timeout = setTimeout(run, msUntilNext(hour, minute));
  timeout.unref?.();
  cronTimers.push(timeout);
};

export const dailySummary = async () => {
  const { start, end } = getTodayRangePKT();
  const totals = await Reading.aggregate([
    { $match: { timestamp: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: '$userId',
        kwh: { $sum: '$energy' },
        cost: { $sum: '$cost' },
      },
    },
  ]);

  await Promise.all(
    totals.map(total =>
      createAndSend(total._id, {
        type: 'DAILY_SUMMARY',
        title: '📊 Daily Energy Report',
        body: `Today: ${Number(total.kwh || 0).toFixed(2)} kWh used - Rs ${Number(total.cost || 0).toFixed(0)}`,
        priority: 'default',
        channelId: 'ecoplugify_info',
        data: {
          kwh: Number(total.kwh || 0),
          cost: Number(total.cost || 0),
        },
      }),
    ),
  );
};

export const applianceCheck = async () => {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const runningDevices = await DeviceStatus.find({
    relayState: 'ON',
    relayOnSince: { $lte: cutoff },
  }).lean();

  await Promise.all(
    runningDevices.map(device => {
      const hours = Math.floor(
        (Date.now() - new Date(device.relayOnSince).getTime()) / 3600000,
      );

      return createAndSend(device.userId, {
        type: 'APPLIANCE_LEFT_ON',
        title: '⏰ Still Running',
        body: `${device.deviceName || device.deviceId} has been ON for ${hours} hours`,
        priority: 'default',
        channelId: 'ecoplugify_alerts',
        deviceId: device.deviceId,
        deviceName: device.deviceName || device.deviceId,
        data: { hours },
      });
    }),
  );
};

export const cleanup = async () => {
  await Notification.deleteMany({
    expiresAt: { $lte: new Date() },
  });
};

export const startCrons = () => {
  scheduleDaily(17, 0, dailySummary);

  const hourly = setInterval(applianceCheck, 60 * 60 * 1000);
  hourly.unref?.();
  cronTimers.push(hourly);

  scheduleDaily(0, 0, cleanup);
  logger.info('Notification cron jobs started');
};

export default startCrons;
