import express from 'express';
import scheduleController from '../controllers/scheduleController.js';
import { validateScheduleCreate } from '../middleware/validation.js';
import authenticate from '../middleware/auth.js';

const router = express.Router();

// Protect all routes
router.use(authenticate);

// Schedule endpoints
router.post('/', validateScheduleCreate, scheduleController.createSchedule);
router.get('/:deviceId', scheduleController.getDeviceSchedules);
router.put('/:scheduleId', scheduleController.updateSchedule);
router.delete('/:scheduleId', scheduleController.deleteSchedule);

export default router;
