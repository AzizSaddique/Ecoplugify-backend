import DeviceService from '../services/deviceService.js';
import logger from '../utils/logger.js';

const deviceService = new DeviceService();

export const linkDevice = async (req, res, next) => {
  try {
    const { deviceId, name, location, category, forceClaim } = req.body;
    const userId = req.user.uid;

    const device = await deviceService.linkDevice(
      userId,
      deviceId,
      name,
      location,
      category,
      forceClaim
    );

    res.status(201).json({
      success: true,
      data: device,
    });
  } catch (error) {
    logger.error(`Link device controller error: ${error.message}`);
    next(error);
  }
};

export const getUserDevices = async (req, res, next) => {
  try {
    const userId = req.user?.uid;
    
    if (!userId) {
      logger.warn('getUserDevices: No userId found in request');
      return res.status(401).json({
        success: false,
        message: 'User not authenticated',
        data: [],
      });
    }

    logger.debug(`Fetching devices for user: ${userId}`);
    const devices = await deviceService.getUserDevices(userId);

    logger.debug(`Found ${devices.length} devices for user ${userId}`);
    res.status(200).json({
      success: true,
      data: devices || [],
      count: devices?.length || 0,
    });
  } catch (error) {
    logger.error(`Get devices controller error: ${error.message}`, error.stack);
    next(error);
  }
};

export const getDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const device = await deviceService.getDevice(req.user.uid, deviceId);

    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Device not found',
      });
    }

    res.status(200).json({
      success: true,
      data: device,
    });
  } catch (error) {
    logger.error(`Get device controller error: ${error.message}`);
    next(error);
  }
};

export const unlinkDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.uid;

    await deviceService.unlinkDevice(userId, deviceId);

    res.status(200).json({
      success: true,
      message: 'Device unlinked successfully',
    });
  } catch (error) {
    logger.error(`Unlink device controller error: ${error.message}`);
    next(error);
  }
};

export const updateDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.uid;
    const device = await deviceService.updateDevice(userId, deviceId, req.body);

    res.status(200).json({
      success: true,
      data: device,
    });
  } catch (error) {
    logger.error(`Update device controller error: ${error.message}`);
    next(error);
  }
};

export default {
  linkDevice,
  getUserDevices,
  getDevice,
  updateDevice,
  unlinkDevice,
};
