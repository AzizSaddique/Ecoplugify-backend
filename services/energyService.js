import { Device } from '../models/Device.js';
import { Reading } from '../models/Reading.js';
import { getStartOfDay, getEndOfDay } from '../utils/helpers.js';
import logger from '../utils/logger.js';
import { getRedis } from '../config/redis.js';

const MIN_ACTIVE_POWER_WATTS = Number(
  process.env.MIN_ACTIVE_POWER_WATTS || 1,
);

const getCurrentHourStart = (date = new Date()) => {
  const start = new Date(date);
  start.setMinutes(0, 0, 0);
  return start;
};

const getMonthStart = (date = new Date()) =>
  new Date(date.getFullYear(), date.getMonth(), 1);

const getDefaultElectricityRate = () => {
  const parsed = Number(process.env.ELECTRICITY_RATE || 22);
  return Number.isFinite(parsed) ? parsed : 22;
};

const getTariffRate = async userId => {
  try {
    const redisClient = getRedis();
    const cachedRate = await redisClient?.get(`user:${userId}:rate`);
    const parsed = Number(cachedRate ?? process.env.ELECTRICITY_RATE ?? 22);
    return Number.isFinite(parsed) ? parsed : getDefaultElectricityRate();
  } catch (error) {
    logger.warn(`Falling back to default electricity rate: ${error.message}`);
    return getDefaultElectricityRate();
  }
};

const calculateTariffCost = (energyKwh, ratePerKwh) =>
  Number(energyKwh || 0) * Number(ratePerKwh || 0);

const toWh = energyKwh => Number((Number(energyKwh || 0) * 1000).toFixed(4));

const getActiveEnergySum = field => ({
  $sum: {
    $cond: [{ $gte: ['$power', MIN_ACTIVE_POWER_WATTS] }, field, 0],
  },
});

const getActiveReadingCount = () => ({
  $sum: {
    $cond: [{ $gte: ['$power', MIN_ACTIVE_POWER_WATTS] }, 1, 0],
  },
});

const flattenAiForClient = reading => {
  const ai = reading?.ai;

  if (!ai) {
    return {};
  }

  return {
    load_type: ai.loadType || ai.subtype || 'unknown',
    load_cat: ai.loadCat || ai.family || 'unknown',
    load_conf: Number(ai.loadConf ?? ai.confidence ?? 0),
    ail_type: ai.ailType || ai.type || 'UNKNOWN',
    ail_state: ai.ailState || ai.state || 'OFF',
    ail_conf: Number(ai.ailConf ?? ai.confidence ?? 0),
    type_locked: Boolean(ai.typeLocked ?? ai.locked),
    cycle_detected: Boolean(ai.cycleDetected ?? ai.cycling),
    ai_pending_type: ai.aiPendingType,
    ai_pending_conf: Number(ai.aiPendingConf ?? ai.lockConfidence ?? 0),
    reasons: ai.reasons || [],
  };
};

export class EnergyService {
  async getRangeTotals(userId, startDate, endDate, ratePerKwh) {
    const [result] = await Reading.aggregate([
      {
        $match: {
          userId,
          timestamp: {
            $gte: startDate,
            $lte: endDate,
          },
        },
      },
      {
        $group: {
          _id: null,
          totalEnergy: getActiveEnergySum('$energy'),
          totalCost: getActiveEnergySum('$cost'),
        },
      },
    ]);

    const energy = Number(result?.totalEnergy || 0);

    return {
      energy,
      cost: calculateTariffCost(energy, ratePerKwh),
    };
  }

  async getUserOverview(userId) {
    try {
      const now = new Date();
      const rate = await getTariffRate(userId);
      const minuteStart = new Date(now.getTime() - 60 * 1000);
      const hourStart = getCurrentHourStart(now);
      const dayStart = getStartOfDay(now);
      const monthStart = getMonthStart(now);

      const [devices, minuteTotals, hourTotals, todayTotals, monthTotals] =
        await Promise.all([
          Device.find({ userId }).lean(),
          this.getRangeTotals(userId, minuteStart, now, rate),
          this.getRangeTotals(userId, hourStart, now, rate),
          this.getRangeTotals(userId, dayStart, now, rate),
          this.getRangeTotals(userId, monthStart, now, rate),
        ]);

      const power = devices.reduce(
        (sum, device) => sum + Number(device.relayState === 'ON' ? device.power || 0 : 0),
        0,
      );

      return {
        power: Number(power || 0),
        energy: {
          minute: minuteTotals.energy,
          hour: hourTotals.energy,
          today: todayTotals.energy,
          month: monthTotals.energy,
        },
        energyWh: {
          minute: toWh(minuteTotals.energy),
          hour: toWh(hourTotals.energy),
          today: toWh(todayTotals.energy),
          month: toWh(monthTotals.energy),
        },
        cost: {
          minute: minuteTotals.cost,
          hour: hourTotals.cost,
          today: todayTotals.cost,
          month: monthTotals.cost,
        },
        hourlyWh: toWh(hourTotals.energy),
        hourlyCost: hourTotals.cost,
        todayWh: toWh(todayTotals.energy),
        todayCost: todayTotals.cost,
        monthlyWh: toWh(monthTotals.energy),
        monthlyCost: monthTotals.cost,
        tariffPerKwh: rate,
        tariffPerWh: rate / 1000,
      };
    } catch (error) {
      logger.error(`Get user overview error: ${error.message}`);
      throw error;
    }
  }

  async getUserHistorySummary(userId, granularity = 'hour', limit = 24) {
    try {
      const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 365);
      const now = new Date();
      const rate = await getTariffRate(userId);

      if (granularity === 'month') {
        const monthStart = new Date(now.getFullYear(), now.getMonth() - (safeLimit - 1), 1);
        const summaries = await Reading.aggregate([
          {
            $match: {
              userId,
              timestamp: { $gte: monthStart, $lte: now },
            },
          },
          {
            $group: {
              _id: {
                year: { $year: '$timestamp' },
                month: { $month: '$timestamp' },
              },
              energy: getActiveEnergySum('$energy'),
              cost: getActiveEnergySum('$cost'),
            },
          },
          { $sort: { '_id.year': 1, '_id.month': 1 } },
        ]);

        return summaries.slice(-safeLimit).map(item => ({
          label: `${item._id.month}/${item._id.year}`,
          energy: Number(item.energy || 0),
          cost: calculateTariffCost(item.energy, rate),
          timestamp: new Date(item._id.year, item._id.month - 1, 1).toISOString(),
        }));
      }

      const startDate =
        granularity === 'day'
          ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - (safeLimit - 1))
          : new Date(now.getTime() - (safeLimit - 1) * 60 * 60 * 1000);

      const groupId =
        granularity === 'day'
          ? {
              year: { $year: '$timestamp' },
              month: { $month: '$timestamp' },
              day: { $dayOfMonth: '$timestamp' },
            }
          : {
              year: { $year: '$timestamp' },
              month: { $month: '$timestamp' },
              day: { $dayOfMonth: '$timestamp' },
              hour: { $hour: '$timestamp' },
            };

      const results = await Reading.aggregate([
        {
          $match: {
            userId,
            timestamp: { $gte: startDate, $lte: now },
          },
        },
        {
          $group: {
            _id: groupId,
            energy: getActiveEnergySum('$energy'),
            cost: getActiveEnergySum('$cost'),
            averagePower: { $avg: '$power' },
          },
        },
        {
          $sort:
            granularity === 'day'
              ? { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
              : {
                  '_id.year': 1,
                  '_id.month': 1,
                  '_id.day': 1,
                  '_id.hour': 1,
                },
        },
      ]);

      return results.slice(-safeLimit).map(item => {
        const timestamp =
          granularity === 'day'
            ? new Date(item._id.year, item._id.month - 1, item._id.day)
            : new Date(item._id.year, item._id.month - 1, item._id.day, item._id.hour);

        return {
          label:
            granularity === 'day'
              ? `${item._id.month}/${item._id.day}`
              : timestamp.toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                }),
          energy: Number(item.energy || 0),
          cost: calculateTariffCost(item.energy, rate),
          averagePower: Number(item.averagePower || 0),
          timestamp: timestamp.toISOString(),
        };
      });
    } catch (error) {
      logger.error(`Get user history summary error: ${error.message}`);
      throw error;
    }
  }

  async getLatestReading(deviceId, userId) {
    try {
      const device = await Device.findOne({ deviceId, userId, active: true }).lean();
      const redisClient = getRedis();

      if (redisClient) {
        if (!device) {
          const latestRaw = await redisClient.get(`device:${deviceId}:latest_raw`);
          if (latestRaw) {
            try {
              return {
                ...JSON.parse(latestRaw),
                pendingLink: true,
              };
            } catch (error) {
              logger.warn(`Ignoring invalid raw latest reading cache for ${deviceId}: ${error.message}`);
            }
          }

          return null;
        }

        const latestCached = await redisClient.get(`device:${deviceId}:latest`);
        if (latestCached) {
          try {
            return JSON.parse(latestCached);
          } catch (error) {
            logger.warn(`Ignoring invalid latest reading cache for ${deviceId}: ${error.message}`);
          }
        }

        const latestRaw = await redisClient.get(`device:${deviceId}:latest_raw`);
        if (latestRaw) {
          try {
            return JSON.parse(latestRaw);
          } catch (error) {
            logger.warn(`Ignoring invalid raw latest reading cache for ${deviceId}: ${error.message}`);
          }
        }

        const cached = await redisClient.get(`device:${deviceId}:lastEnergy`);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            return {
              deviceId,
              energy_kwh: Number(parsed.totalEnergy || 0),
              totalEnergy: Number(parsed.totalEnergy || 0),
              timestamp: parsed.timestamp,
              source: 'lastEnergy-cache',
            };
          } catch (error) {
            logger.warn(`Ignoring invalid last energy cache for ${deviceId}: ${error.message}`);
          }
        }
      }

      if (!device) {
        return null;
      }

      const reading = await Reading.findOne({ deviceId, userId })
        .sort({ timestamp: -1, _id: -1 })
        .lean();

      if (reading) {
        return {
          ...reading,
          energy_kwh: Number(reading.totalEnergy ?? reading.cumulativeEnergy ?? reading.energy ?? 0),
          ...flattenAiForClient(reading),
        };
      }

      return null;
    } catch (error) {
      logger.error(`Get latest reading error: ${error.message}`);
      throw error;
    }
  }

  async getReadingsHistory(deviceId, userId, startDate, endDate, limit = 100) {
    try {
      const query = { deviceId, userId };

      if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = new Date(startDate);
        if (endDate) query.timestamp.$lte = new Date(endDate);
      }

      const readings = await Reading.find(query)
        .sort({ timestamp: -1, _id: -1 })
        .limit(limit)
        .lean();

      return readings;
    } catch (error) {
      logger.error(`Get history error: ${error.message}`);
      throw error;
    }
  }

  async getAiAnalytics(deviceId, userId, startDate, endDate, limit = 200) {
    try {
      const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
      const query = {
        deviceId,
        userId,
        'ai.schemaVersion': 2,
      };

      if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = new Date(startDate);
        if (endDate) query.timestamp.$lte = new Date(endDate);
      }

      const readings = await Reading.find(query)
        .select('deviceId power energy totalEnergy relayState ai timestamp')
        .sort({ timestamp: -1, _id: -1 })
        .limit(safeLimit)
        .lean();

      const summary = await Reading.aggregate([
        { $match: query },
        {
          $group: {
            _id: {
              type: '$ai.type',
              state: '$ai.state',
            },
            samples: { $sum: 1 },
            avgConfidence: { $avg: '$ai.confidence' },
            avgPower: { $avg: '$power' },
            energy: { $sum: '$energy' },
            lastSeen: { $max: '$timestamp' },
          },
        },
        { $sort: { samples: -1, lastSeen: -1 } },
      ]);

      return {
        schemaVersion: 2,
        readings,
        summary: summary.map(item => ({
          type: item._id?.type || 'unknown',
          state: item._id?.state || 'unknown',
          samples: Number(item.samples || 0),
          avgConfidence: Number(item.avgConfidence || 0),
          avgPower: Number(item.avgPower || 0),
          energy: Number(item.energy || 0),
          lastSeen: item.lastSeen,
        })),
      };
    } catch (error) {
      logger.error(`Get AI analytics error: ${error.message}`);
      throw error;
    }
  }

  async getTodayCost(deviceId, userId) {
    try {
      const today = getStartOfDay();
      const tomorrow = getEndOfDay();
      const rate = await getTariffRate(userId);

      const readings = await Reading.find({
        deviceId,
        userId,
        timestamp: {
          $gte: today,
          $lte: tomorrow,
        },
      }).lean();

      const activeReadings = readings.filter(
        r => Number(r.power || 0) >= MIN_ACTIVE_POWER_WATTS,
      );
      const totalEnergy = activeReadings.reduce((sum, r) => sum + (r.energy || 0), 0);
      const totalCost = calculateTariffCost(totalEnergy, rate);

      return {
        deviceId,
        totalCost,
        totalEnergy,
        readingCount: readings.length,
        activeReadingCount: activeReadings.length,
        date: today,
      };
    } catch (error) {
      logger.error(`Get today cost error: ${error.message}`);
      throw error;
    }
  }

  async getDailySummary(deviceId, userId, date) {
    try {
      const targetDate = date ? new Date(date) : new Date();
      const start = getStartOfDay(targetDate);
      const end = getEndOfDay(targetDate);
      const rate = await getTariffRate(userId);

      const [summary] = await Reading.aggregate([
        {
          $match: {
            deviceId,
            userId,
            timestamp: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: null,
            totalEnergy: getActiveEnergySum('$energy'),
            totalCost: getActiveEnergySum('$cost'),
            averagePower: { $avg: '$power' },
            maxPower: { $max: '$power' },
            minPower: { $min: '$power' },
            readingCount: { $sum: 1 },
            activeReadingCount: getActiveReadingCount(),
          },
        },
      ]);

      return {
        deviceId,
        userId,
        date: start,
        totalEnergy: Number(summary?.totalEnergy || 0),
        totalCost: calculateTariffCost(summary?.totalEnergy, rate),
        averagePower: Number(summary?.averagePower || 0),
        maxPower: Number(summary?.maxPower || 0),
        minPower: Number(summary?.minPower || 0),
        readingCount: Number(summary?.readingCount || 0),
        activeReadingCount: Number(summary?.activeReadingCount || 0),
      };
    } catch (error) {
      logger.error(`Get daily summary error: ${error.message}`);
      throw error;
    }
  }

  async getMonthlyStats(deviceId, userId, month, year) {
    try {
      const startOfMonth = new Date(year, month - 1, 1);
      const endOfMonth = new Date(year, month, 0, 23, 59, 59);
      const rate = await getTariffRate(userId);

      const summaries = await Reading.aggregate([
        {
          $match: {
            deviceId,
            userId,
            timestamp: {
              $gte: startOfMonth,
              $lte: endOfMonth,
            },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: '$timestamp' },
              month: { $month: '$timestamp' },
              day: { $dayOfMonth: '$timestamp' },
            },
            totalEnergy: getActiveEnergySum('$energy'),
            totalCost: getActiveEnergySum('$cost'),
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
      ]);

      const totalEnergy = summaries.reduce((sum, s) => sum + (s.totalEnergy || 0), 0);
      const totalCost = calculateTariffCost(totalEnergy, rate);
      const avgDailyCost = summaries.length > 0 ? totalCost / summaries.length : 0;

      return {
        month,
        year,
        totalEnergy,
        totalCost,
        avgDailyCost,
        days: summaries.length,
      };
    } catch (error) {
      logger.error(`Get monthly stats error: ${error.message}`);
      throw error;
    }
  }
}

export default EnergyService;
