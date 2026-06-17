import ScheduleService from '../services/scheduleService.js';
import logger from '../utils/logger.js';

const scheduleService = new ScheduleService();

export const createSchedule = async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const { deviceId, ...scheduleData } = req.body;

    const schedule = await scheduleService.createSchedule(
      userId,
      deviceId,
      scheduleData
    );

    res.status(201).json({
      success: true,
      data: schedule,
    });
  } catch (error) {
    logger.error(`Create schedule error: ${error.message}`);
    next(error);
  }
};

export const getDeviceSchedules = async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const { deviceId } = req.params;

    const schedules = await scheduleService.getDeviceSchedules(userId, deviceId);

    res.status(200).json({
      success: true,
      data: schedules,
      count: schedules.length,
    });
  } catch (error) {
    logger.error(`Get schedules error: ${error.message}`);
    next(error);
  }
};

export const updateSchedule = async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const { scheduleId } = req.params;

    const schedule = await scheduleService.updateSchedule(userId, scheduleId, req.body);

    res.status(200).json({
      success: true,
      data: schedule,
    });
  } catch (error) {
    logger.error(`Update schedule error: ${error.message}`);
    next(error);
  }
};

export const deleteSchedule = async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const { scheduleId } = req.params;

    await scheduleService.deleteSchedule(userId, scheduleId);

    res.status(200).json({
      success: true,
      message: 'Schedule deleted successfully',
    });
  } catch (error) {
    logger.error(`Delete schedule error: ${error.message}`);
    next(error);
  }
};

export default {
  createSchedule,
  getDeviceSchedules,
  updateSchedule,
  deleteSchedule,
};
