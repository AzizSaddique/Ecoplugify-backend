import { publishMQTT } from '../config/mqtt.js';
import { Device } from '../models/Device.js';
import logger from '../utils/logger.js';
import { getSocketIO } from '../sockets/socketServer.js';
import { getRedis } from '../config/redis.js';

const RELAY_COMMAND_TTL_SECONDS = Number(
  process.env.RELAY_COMMAND_TTL_SECONDS || 15,
);

export class RelayService {
  async controlRelay(userId, deviceId, action) {
    try {
      // Verify device belongs to user
      const device = await Device.findOne({ deviceId });
      if (!device || device.userId !== userId) {
        throw new Error('Device not found or not authorized');
      }

      // Publish MQTT command
      const topic = `ecoplugify/v1/${deviceId}/relay`;
      publishMQTT(topic, action);

      // Update device state
      device.relayState = action;
      if (action === 'OFF') {
        device.power = 0;
        device.current = 0;
      }
      await device.save();

      const redisClient = getRedis();
      await redisClient?.setEx(
        `device:${deviceId}:desiredRelay`,
        RELAY_COMMAND_TTL_SECONDS,
        JSON.stringify({
          relayState: action,
          timestamp: new Date().toISOString(),
        }),
      );

      if (redisClient) {
        const latestRaw = await redisClient.get(`device:${deviceId}:latest`);
        let latest = {};

        if (latestRaw) {
          try {
            latest = JSON.parse(latestRaw);
          } catch {
            latest = {};
          }
        }

        await redisClient.setEx(
          `device:${deviceId}:latest`,
          300,
          JSON.stringify({
            ...latest,
            deviceId,
            device: deviceId,
            relay: action,
            relayState: action,
            power: action === 'OFF' ? 0 : Number(latest.power ?? device.power ?? 0),
            current: action === 'OFF' ? 0 : Number(latest.current ?? device.current ?? 0),
            timestamp: new Date().toISOString(),
          }),
        );
      }

      // Emit socket event
      const io = getSocketIO();
      if (io) {
        io.to(`user:${userId}`).emit('device:update', {
          deviceId,
          relayState: action,
          ...(action === 'OFF' ? { power: 0, current: 0 } : {}),
          timestamp: new Date(),
        });
      }

      logger.info(`Relay controlled: ${deviceId} = ${action}`);
      return { deviceId, relayState: action };
    } catch (error) {
      logger.error(`Control relay error: ${error.message}`);
      throw error;
    }
  }

  async setPreset(userId, deviceId, preset) {
    try {
      const device = await Device.findOne({ deviceId });
      if (!device || device.userId !== userId) {
        throw new Error('Device not found or not authorized');
      }

      const topic = `ecoplugify/v1/${deviceId}/relay`;
      const message = {
        cmd: 'set_preset',
        preset,
      };
      const published = publishMQTT(topic, message);

      const io = getSocketIO();
      if (io) {
        io.to(`user:${userId}`).emit('device:preset', {
          deviceId,
          preset,
          published,
          timestamp: new Date(),
        });
      }

      logger.info(`Preset command sent: ${deviceId} = ${preset}`);
      return { deviceId, preset, published };
    } catch (error) {
      logger.error(`Set preset error: ${error.message}`);
      throw error;
    }
  }
}

export default RelayService;
