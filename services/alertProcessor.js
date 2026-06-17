import DeviceStatus from '../models/DeviceStatus.js';
import Reading from '../models/Reading.js';
import NotificationSettings from '../models/NotificationSettings.js';
import { createAndSend } from './notificationService.js';
import { getRedis } from '../config/redis.js';
import logger from '../utils/logger.js';

const VALID_DEVICE_IDS = new Set(['plug1', 'plug2', 'plug3', 'plug4']);
const DEVICE_STATUS_CACHE_TTL = Number(process.env.DEVICE_STATUS_CACHE_TTL || 120);

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeRelay = value => {
  const relay = String(value || 'OFF').toUpperCase();
  return ['ON', 'OFF', 'OFFLINE'].includes(relay) ? relay : 'OFF';
};

const sanitizeDeviceId = deviceId => {
  const normalized = String(deviceId || '').trim();
  return VALID_DEVICE_IDS.has(normalized) ? normalized : null;
};

const getTodayRangePKT = () => {
  const now = new Date();
  const pkNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
  pkNow.setHours(0, 0, 0, 0);

  const start = new Date(pkNow.getTime() - 5 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
};

const cacheDeviceStatus = async status => {
  try {
    const redis = getRedis();
    if (!redis || !status?.deviceId) {
      return;
    }

    await redis.setEx(
      `device:status:${status.deviceId}`,
      DEVICE_STATUS_CACHE_TTL,
      JSON.stringify(status.toObject ? status.toObject() : status),
    );
  } catch (error) {
    logger.warn(`Device status cache write failed: ${error.message}`);
  }
};

const getDailyCost = async userId => {
  const { start, end } = getTodayRangePKT();
  const totals = await Reading.aggregate([
    {
      $match: {
        userId,
        timestamp: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: null,
        totalCost: { $sum: '$cost' },
        totalEnergy: { $sum: '$energy' },
      },
    },
  ]);

  return {
    cost: Number(totals[0]?.totalCost || 0),
    energy: Number(totals[0]?.totalEnergy || 0),
  };
};

const notify = (userId, payload) => createAndSend(userId, payload);

const getSettings = userId =>
  NotificationSettings.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

export const processDataPayload = async (deviceId, payload, userId, deviceName) => {
  const safeDeviceId = sanitizeDeviceId(deviceId);
  if (!safeDeviceId || !userId || !payload || typeof payload !== 'object') {
    return;
  }

  try {
    const now = new Date();
    const relay = normalizeRelay(payload.relay);
    const power = toNumber(payload.power);
    const voltage = toNumber(payload.voltage);
    const current = toNumber(payload.current);
    const uptime = toNumber(payload.uptime, null);
    const dataLoss = toNumber(payload.data_loss_s);
    const settings = await getSettings(userId);

    const previous = await DeviceStatus.findOne({ deviceId: safeDeviceId }).lean();
    const wasOffline = previous && !previous.isOnline;
    const relayChanged =
      previous?.relayState &&
      previous.relayState !== relay &&
      relay !== 'OFFLINE' &&
      previous.relayState !== 'OFFLINE';
    const rebooted =
      uptime !== null &&
      Number.isFinite(uptime) &&
      Number.isFinite(Number(previous?.lastUptime)) &&
      uptime < Number(previous.lastUptime);

    let relayOnSince = previous?.relayOnSince || null;
    if (relay === 'ON' && previous?.relayState !== 'ON') {
      relayOnSince = now;
    }
    if (relay !== 'ON') {
      relayOnSince = null;
    }

    const status = await DeviceStatus.findOneAndUpdate(
      { deviceId: safeDeviceId },
      {
        $set: {
          userId,
          deviceName,
          isOnline: relay !== 'OFFLINE' && payload.online !== false,
          lastSeen: now,
          lastPower: power,
          lastVoltage: voltage,
          lastCurrent: current,
          lastUptime: uptime || 0,
          relayState: relay,
          relayOnSince,
          updatedAt: now,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await cacheDeviceStatus(status);

    if (wasOffline && status.isOnline) {
      await notify(userId, {
        type: 'DEVICE_ONLINE',
        title: `✅ ${deviceName} Online`,
        body: 'Device is back and running',
        priority: 'default',
        channelId: 'ecoplugify_info',
        deviceId: safeDeviceId,
        deviceName,
        data: { deviceId: safeDeviceId },
      });
    }

    if (power > toNumber(settings.powerThreshold, 1500)) {
      await notify(userId, {
        type: 'HIGH_POWER',
        title: '⚡ High Power Usage',
        body: `${deviceName}: ${Math.round(power)}W detected`,
        priority: 'high',
        channelId: 'ecoplugify_alerts',
        deviceId: safeDeviceId,
        deviceName,
        data: { power, threshold: settings.powerThreshold },
      });
    }

    if (voltage > 260) {
      await notify(userId, {
        type: 'OVER_VOLTAGE',
        title: '🔴 Over Voltage Warning',
        body: `${deviceName}: ${voltage.toFixed(1)}V - check immediately!`,
        priority: 'max',
        channelId: 'ecoplugify_critical',
        deviceId: safeDeviceId,
        deviceName,
        data: { voltage },
      });
    }

    if (current > 10) {
      await notify(userId, {
        type: 'OVER_CURRENT',
        title: '🔴 Over Current Warning',
        body: `${deviceName}: ${current.toFixed(2)}A detected`,
        priority: 'max',
        channelId: 'ecoplugify_critical',
        deviceId: safeDeviceId,
        deviceName,
        data: { current },
      });
    }

    if (relayChanged) {
      await notify(userId, {
        type: 'RELAY_CHANGED',
        title: `${deviceName} Turned ${relay}`,
        body: `Device switched ${relay} remotely`,
        priority: 'default',
        channelId: 'ecoplugify_info',
        deviceId: safeDeviceId,
        deviceName,
        data: { relay },
      });
    }

    if (relayOnSince) {
      const hoursOn = (now.getTime() - new Date(relayOnSince).getTime()) / 3600000;
      if (hoursOn >= 6) {
        await notify(userId, {
          type: 'APPLIANCE_LEFT_ON',
          title: '⏰ Still Running',
          body: `${deviceName} has been ON for ${Math.floor(hoursOn)} hours`,
          priority: 'default',
          channelId: 'ecoplugify_alerts',
          deviceId: safeDeviceId,
          deviceName,
          data: { hours: Number(hoursOn.toFixed(2)) },
        });
      }
    }

    if (dataLoss > 120) {
      await notify(userId, {
        type: 'DATA_LOSS',
        title: '📡 Connection Gap',
        body: `${deviceName}: ${Math.round(dataLoss)}s data gap detected`,
        priority: 'default',
        channelId: 'ecoplugify_info',
        deviceId: safeDeviceId,
        deviceName,
        data: { seconds: dataLoss },
      });
    }

    if (payload.cal_warning) {
      await notify(userId, {
        type: 'CAL_WARNING',
        title: '⚙️ Calibration Warning',
        body: `${deviceName}: ${payload.cal_warning}`,
        priority: 'default',
        channelId: 'ecoplugify_info',
        deviceId: safeDeviceId,
        deviceName,
        data: { cal_warning: payload.cal_warning },
      });
    }

    if (rebooted) {
      await notify(userId, {
        type: 'ESP32_REBOOT',
        title: '🔄 Device Restarted',
        body: `${deviceName} was restarted`,
        priority: 'default',
        channelId: 'ecoplugify_info',
        deviceId: safeDeviceId,
        deviceName,
        data: { uptime, previousUptime: previous.lastUptime },
      });
    }

    const totals = await getDailyCost(userId);
    if (totals.cost > toNumber(settings.costDailyLimit, 100)) {
      await notify(userId, {
        type: 'HIGH_DAILY_COST',
        title: '💰 High Energy Cost',
        body: `Today's usage: Rs ${totals.cost.toFixed(0)} - limit Rs ${settings.costDailyLimit}`,
        priority: 'high',
        channelId: 'ecoplugify_alerts',
        deviceId: safeDeviceId,
        deviceName,
        data: { cost: totals.cost, limit: settings.costDailyLimit },
      });
    }
  } catch (error) {
    logger.error(`Alert processing failed for ${safeDeviceId}: ${error.message}`);
  }
};

export const processStatusPayload = async (deviceId, payload, userId, deviceName) => {
  const safeDeviceId = sanitizeDeviceId(deviceId);
  if (!safeDeviceId || !userId) {
    return;
  }

  try {
    const relay = normalizeRelay(payload?.relay);
    const isOnline = relay !== 'OFFLINE' && payload?.online !== false;
    const previous = await DeviceStatus.findOne({ deviceId: safeDeviceId }).lean();

    const status = await DeviceStatus.findOneAndUpdate(
      { deviceId: safeDeviceId },
      {
        $set: {
          userId,
          deviceName,
          isOnline,
          lastSeen: isOnline ? new Date() : previous?.lastSeen || null,
          relayState: relay,
          offlineNotifiedAt:
            isOnline ? null : previous?.offlineNotifiedAt || new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await cacheDeviceStatus(status);

    if (!isOnline) {
      await notify(userId, {
        type: 'DEVICE_OFFLINE',
        title: '⚠️ Device Offline',
        body: `${deviceName} is not responding`,
        priority: 'high',
        channelId: 'ecoplugify_alerts',
        deviceId: safeDeviceId,
        deviceName,
        data: { deviceId: safeDeviceId },
      });
      return;
    }

    if (previous && !previous.isOnline) {
      await notify(userId, {
        type: 'DEVICE_ONLINE',
        title: `✅ ${deviceName} Online`,
        body: 'Device is back and running',
        priority: 'default',
        channelId: 'ecoplugify_info',
        deviceId: safeDeviceId,
        deviceName,
        data: { deviceId: safeDeviceId },
      });
    }
  } catch (error) {
    logger.error(`Status alert processing failed for ${safeDeviceId}: ${error.message}`);
  }
};

export default {
  processDataPayload,
  processStatusPayload,
};
