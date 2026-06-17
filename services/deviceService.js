import { Device } from '../models/Device.js';
import { Schedule } from '../models/Schedule.js';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

export class DeviceService {
  async linkDevice(userId, deviceId, name, location, category, forceClaim = false) {
    try {
      // Check if device already linked
      const existing = await Device.findOne({ deviceId });
      if (existing && existing.userId !== userId) {
        const canClaimInDevelopment =
          process.env.NODE_ENV !== 'production' && Boolean(forceClaim);

        if (!canClaimInDevelopment) {
          throw new AppError(
            'Device already linked to another user. Use claim mode to relink it in development.',
            409,
          );
        }

        logger.warn(
          `Device ${deviceId} was reassigned from ${existing.userId} to ${userId}`,
        );
      }

      if (existing) {
        existing.userId = userId;
        existing.name = name;
        existing.location = location || existing.location;
        existing.category = category || existing.category;
        existing.active = true;
        existing.isOnline = false;
        existing.relayState = 'OFF';
        await existing.save();
        return existing;
      }

      // Create new device
      const device = new Device({
        userId,
        deviceId,
        name,
        location,
        category,
        active: true,
        relayState: 'OFF',
      });

      await device.save();
      logger.info(`Device linked: ${deviceId} for user ${userId}`);
      return device;
    } catch (error) {
      logger.error(`Link device error: ${error.message}`);
      throw error;
    }
  }

  async getUserDevices(userId) {
    try {
      const devices = await Device.find({ userId, active: true }).lean();
      return devices;
    } catch (error) {
      logger.error(`Get user devices error: ${error.message}`);
      throw error;
    }
  }

  async getDevice(userId, deviceId) {
    try {
      const device = await Device.findOne({ userId, deviceId, active: true }).lean();
      return device;
    } catch (error) {
      logger.error(`Get device error: ${error.message}`);
      throw error;
    }
  }

  async unlinkDevice(userId, deviceId) {
    try {
      const result = await Device.updateOne({
        userId,
        deviceId,
        active: true,
      }, {
        $set: {
          active: false,
          isOnline: false,
          relayState: 'OFFLINE',
          power: 0,
          current: 0,
          lastSeen: new Date(),
        },
      });

      if (result.matchedCount === 0) {
        throw new AppError('Device not found', 404);
      }

      await Schedule.updateMany(
        { userId, deviceId, isActive: true },
        { $set: { isActive: false } },
      );

      logger.info(`Device unlinked: ${deviceId}`);
      return result;
    } catch (error) {
      logger.error(`Unlink device error: ${error.message}`);
      throw error;
    }
  }

  async updateDevice(userId, deviceId, updates = {}) {
    try {
      const allowedCategories = ['lighting', 'appliance', 'hvac', 'other'];
      const patch = {};

      if (updates.name !== undefined) {
        const name = String(updates.name || '').trim();
        if (!name) {
          throw new AppError('Device name is required', 400);
        }
        patch.name = name;
      }

      if (updates.location !== undefined) {
        patch.location = String(updates.location || '').trim();
      }

      if (updates.category !== undefined) {
        const category = String(updates.category || 'other').toLowerCase();
        if (!allowedCategories.includes(category)) {
          throw new AppError('Invalid device category', 400);
        }
        patch.category = category;
      }

      const device = await Device.findOneAndUpdate(
        { userId, deviceId },
        { $set: patch },
        { new: true, runValidators: true },
      );

      if (!device) {
        throw new AppError('Device not found', 404);
      }

      logger.info(`Device updated: ${deviceId}`);
      return device;
    } catch (error) {
      logger.error(`Update device error: ${error.message}`);
      throw error;
    }
  }

  async updateDeviceState(deviceId, relayState) {
    try {
      const device = await Device.findOneAndUpdate(
        { deviceId },
        { relayState, lastSeen: new Date() },
        { new: true }
      );

      return device;
    } catch (error) {
      logger.error(`Update device state error: ${error.message}`);
      throw error;
    }
  }
}

export default DeviceService;
