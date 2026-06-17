import { getRedis } from '../config/redis.js';
import logger from '../utils/logger.js';

export class CostService {
  async setUserElectricityRate(userId, rate) {
    try {
      const redisClient = getRedis();
      const key = `user:${userId}:rate`;
      await redisClient?.setEx(key, 365 * 24 * 60 * 60, String(rate));
      logger.info(`Electricity rate set for user ${userId}: ${rate}`);
      return true;
    } catch (error) {
      logger.error(`Set electricity rate error: ${error.message}`);
      throw error;
    }
  }

  async getUserElectricityRate(userId) {
    try {
      const redisClient = getRedis();
      const key = `user:${userId}:rate`;
      const rate = await redisClient?.get(key);
      return rate ? parseFloat(rate) : parseFloat(process.env.ELECTRICITY_RATE || 15);
    } catch (error) {
      logger.error(`Get electricity rate error: ${error.message}`);
      return parseFloat(process.env.ELECTRICITY_RATE || 15);
    }
  }
}

export default CostService;
