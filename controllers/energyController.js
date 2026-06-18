import EnergyService from '../services/energyService.js';
import logger from '../utils/logger.js';

const energyService = new EnergyService();

export const getUserOverview = async (req, res, next) => {
  try {
    const overview = await energyService.getUserOverview(req.user.uid);

    res.status(200).json({
      success: true,
      data: overview,
    });
  } catch (error) {
    logger.error(`Get user overview error: ${error.message}`);
    next(error);
  }
};

export const getUserHistorySummary = async (req, res, next) => {
  try {
    const { granularity = 'hour', limit = 24 } = req.query;
    const history = await energyService.getUserHistorySummary(
      req.user.uid,
      granularity,
      parseInt(limit, 10),
    );

    res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    logger.error(`Get user history summary error: ${error.message}`);
    next(error);
  }
};

export const getLatestReading = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const reading = await energyService.getLatestReading(deviceId, req.user.uid);

    if (!reading) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'No readings found yet',
      });
    }

    res.status(200).json({
      success: true,
      data: reading,
    });
  } catch (error) {
    logger.error(`Get latest reading error: ${error.message}`);
    next(error);
  }
};

export const getReadingsHistory = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { startDate, endDate, limit } = req.query;

    const readings = await energyService.getReadingsHistory(
      deviceId,
      req.user.uid,
      startDate,
      endDate,
      limit ? parseInt(limit) : 100
    );

    res.status(200).json({
      success: true,
      data: readings,
      count: readings.length,
    });
  } catch (error) {
    logger.error(`Get history error: ${error.message}`);
    next(error);
  }
};

export const getTodayCost = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.uid;

    const costData = await energyService.getTodayCost(deviceId, userId);

    res.status(200).json({
      success: true,
      data: costData,
    });
  } catch (error) {
    logger.error(`Get today cost error: ${error.message}`);
    next(error);
  }
};

export const getAiAnalytics = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { startDate, endDate, limit } = req.query;

    const analytics = await energyService.getAiAnalytics(
      deviceId,
      req.user.uid,
      startDate,
      endDate,
      limit ? parseInt(limit, 10) : 200,
    );

    res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    logger.error(`Get AI analytics error: ${error.message}`);
    next(error);
  }
};

export const getAiReadings = getAiAnalytics;

export const getDailySummary = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { date } = req.query;
    const userId = req.user.uid;

    const summary = await energyService.getDailySummary(deviceId, userId, date);

    if (!summary) {
      return res.status(404).json({
        success: false,
        message: 'No summary found',
      });
    }

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    logger.error(`Get daily summary error: ${error.message}`);
    next(error);
  }
};

export const getMonthlyStats = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { month, year } = req.query;
    const userId = req.user.uid;

    const stats = await energyService.getMonthlyStats(
      deviceId,
      userId,
      parseInt(month),
      parseInt(year)
    );

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error(`Get monthly stats error: ${error.message}`);
    next(error);
  }
};

export default {
  getUserOverview,
  getUserHistorySummary,
  getLatestReading,
  getReadingsHistory,
  getAiAnalytics,
  getAiReadings,
  getTodayCost,
  getDailySummary,
  getMonthlyStats,
};
