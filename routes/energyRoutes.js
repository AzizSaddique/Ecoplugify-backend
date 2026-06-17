import express from 'express';
import energyController from '../controllers/energyController.js';
import { validateEnergyQuery } from '../middleware/validation.js';
import authenticate from '../middleware/auth.js';

const router = express.Router();

// Protect all routes
router.use(authenticate);

// Energy endpoints
router.get('/overview', energyController.getUserOverview);
router.get('/history-summary', energyController.getUserHistorySummary);
router.get('/hourly', energyController.getUserHistorySummary); // Alias for hourly data
router.get('/latest/:deviceId', energyController.getLatestReading);
router.get('/history/:deviceId', validateEnergyQuery, energyController.getReadingsHistory);
router.get('/ai/:deviceId', energyController.getAiAnalytics);
router.get('/today-cost/:deviceId', energyController.getTodayCost);
router.get('/daily-summary/:deviceId', energyController.getDailySummary);
router.get('/monthly-stats/:deviceId', energyController.getMonthlyStats);

export default router;
