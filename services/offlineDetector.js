import DeviceStatus from '../models/DeviceStatus.js';
import { createAndSend } from './notificationService.js';
import logger from '../utils/logger.js';

let offlineDetectorInterval = null;

export const runOfflineDetection = async () => {
  try {
    const cutoff = new Date(Date.now() - Number(process.env.DEVICE_OFFLINE_SECONDS || 90) * 1000);
    const staleDevices = await DeviceStatus.find({
      isOnline: true,
      lastSeen: { $lt: cutoff },
    }).lean();

    await Promise.all(
      staleDevices.map(async device => {
        await DeviceStatus.updateOne(
          { deviceId: device.deviceId },
          {
            $set: {
              isOnline: false,
              relayState: 'OFFLINE',
              offlineNotifiedAt: new Date(),
              updatedAt: new Date(),
            },
          },
        );

        await createAndSend(device.userId, {
          type: 'DEVICE_OFFLINE',
          title: '⚠️ Device Offline',
          body: `${device.deviceName || device.deviceId} is not responding`,
          priority: 'high',
          channelId: 'ecoplugify_alerts',
          deviceId: device.deviceId,
          deviceName: device.deviceName || device.deviceId,
          data: { lastSeen: device.lastSeen },
        });
      }),
    );
  } catch (error) {
    logger.error(`Offline detector failed: ${error.message}`);
  }
};

export const startOfflineDetector = () => {
  if (offlineDetectorInterval) {
    return offlineDetectorInterval;
  }

  const intervalMs = Number(process.env.OFFLINE_DETECTOR_INTERVAL_MS || 30000);
  offlineDetectorInterval = setInterval(runOfflineDetection, intervalMs);
  offlineDetectorInterval.unref?.();
  logger.info('Offline detector started');
  return offlineDetectorInterval;
};

export default startOfflineDetector;
