import RelayService from '../services/relayService.js';
import logger from '../utils/logger.js';

const relayService = new RelayService();

export const controlRelay = async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const { deviceId, action } = req.body;

    const result = await relayService.controlRelay(userId, deviceId, action);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(`Control relay error: ${error.message}`);
    next(error);
  }
};

export const setPreset = async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const { deviceId, preset } = req.body;

    const result = await relayService.setPreset(userId, deviceId, preset);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(`Set preset error: ${error.message}`);
    next(error);
  }
};

export default {
  controlRelay,
  setPreset,
};
