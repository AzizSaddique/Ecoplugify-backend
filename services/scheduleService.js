import { Schedule } from '../models/Schedule.js';
import { getScheduleQueue } from '../queues/index.js';
import { publishMQTT } from '../config/mqtt.js';
import { getSocketIO } from '../sockets/socketServer.js';
import logger from '../utils/logger.js';

const getReverseAction = action => (action === 'ON' ? 'OFF' : 'ON');

const getDurationMinutes = (startTime, endTime) => {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const startTotal = startHour * 60 + startMinute;
  let endTotal = endHour * 60 + endMinute;

  if (endTotal <= startTotal) {
    endTotal += 24 * 60;
  }

  return endTotal - startTotal;
};

const normalizeScheduleData = scheduleData => ({
  ...scheduleData,
  endAction: scheduleData.endAction || getReverseAction(scheduleData.action),
  durationMinutes:
    scheduleData.durationMinutes ||
    getDurationMinutes(scheduleData.startTime, scheduleData.endTime),
});

const getMinuteKey = date =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;

const hasExecutedInMinute = (executedAt, now) => {
  if (!executedAt) {
    return false;
  }

  return getMinuteKey(new Date(executedAt)) === getMinuteKey(now);
};

export class ScheduleService {
  async createSchedule(userId, deviceId, scheduleData) {
    try {
      const schedule = new Schedule({
        userId,
        deviceId,
        ...normalizeScheduleData(scheduleData),
      });

      await schedule.save();
      logger.info(`Schedule created: ${schedule._id}`);
      return schedule;
    } catch (error) {
      logger.error(`Create schedule error: ${error.message}`);
      throw error;
    }
  }

  async getDeviceSchedules(userId, deviceId) {
    try {
      const schedules = await Schedule.find({
        userId,
        deviceId,
      }).lean();

      return schedules;
    } catch (error) {
      logger.error(`Get schedules error: ${error.message}`);
      throw error;
    }
  }

  async updateSchedule(userId, scheduleId, updateData) {
    try {
      const currentSchedule = await Schedule.findOne({ _id: scheduleId, userId });

      if (!currentSchedule) {
        throw new Error('Schedule not found');
      }

      const schedule = await Schedule.findOneAndUpdate(
        { _id: scheduleId, userId },
        normalizeScheduleData({
          action: updateData.action || currentSchedule.action,
          startTime: updateData.startTime || currentSchedule.startTime,
          endTime: updateData.endTime || currentSchedule.endTime,
          ...updateData,
        }),
        { new: true }
      );

      logger.info(`Schedule updated: ${scheduleId}`);
      return schedule;
    } catch (error) {
      logger.error(`Update schedule error: ${error.message}`);
      throw error;
    }
  }

  async deleteSchedule(userId, scheduleId) {
    try {
      const result = await Schedule.deleteOne({
        _id: scheduleId,
        userId,
      });

      if (result.deletedCount === 0) {
        throw new Error('Schedule not found');
      }

      logger.info(`Schedule deleted: ${scheduleId}`);
      return result;
    } catch (error) {
      logger.error(`Delete schedule error: ${error.message}`);
      throw error;
    }
  }

  async executeSchedule(scheduleId, trigger = 'start') {
    try {
      const schedule = await Schedule.findById(scheduleId);
      if (!schedule) {
        throw new Error('Schedule not found');
      }

      const now = new Date();

      if (
        (trigger === 'start' && hasExecutedInMinute(schedule.lastStartExecutedAt, now)) ||
        (trigger === 'end' && hasExecutedInMinute(schedule.lastEndExecutedAt, now))
      ) {
        logger.info(
          `Skipping duplicate schedule execution: ${scheduleId} (${trigger}) for ${getMinuteKey(now)}`,
        );
        return false;
      }

      const action =
        trigger === 'end'
          ? schedule.endAction || getReverseAction(schedule.action)
          : schedule.action;

      if (trigger === 'start') {
        schedule.lastStartExecutedAt = now;
      } else {
        schedule.lastEndExecutedAt = now;
      }

      if (schedule.mode === 'once' && trigger === 'end') {
        schedule.isActive = false;
      }

      await schedule.save();

      const scheduleQueue = getScheduleQueue();
      if (scheduleQueue) {
        await scheduleQueue.add('execute-schedule', {
          scheduleId: schedule._id.toString(),
          deviceId: schedule.deviceId,
          userId: schedule.userId,
          action,
          trigger,
        });
      } else {
        const topic = `ecoplugify/v1/${schedule.deviceId}/relay`;
        publishMQTT(topic, action);

        const io = getSocketIO();
        if (io) {
          io.to(`user:${schedule.userId}`).emit('schedule:trigger', {
            scheduleId: schedule._id.toString(),
            deviceId: schedule.deviceId,
            action,
            trigger,
            timestamp: new Date(),
          });
        }
      }

      return true;
    } catch (error) {
      logger.error(`Execute schedule error: ${error.message}`);
      throw error;
    }
  }

  async checkAndExecuteSchedules() {
    try {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const dayOfWeek = now.getDay();

      const activeSchedules = await Schedule.find({
        isActive: true,
        daysOfWeek: dayOfWeek,
      });

      let executedCount = 0;

      for (const schedule of activeSchedules) {
        if (schedule.startTime === currentTime) {
          const executed = await this.executeSchedule(schedule._id.toString(), 'start');
          if (executed) {
            executedCount += 1;
          }
        }

        if (schedule.endTime === currentTime && schedule.endTime !== schedule.startTime) {
          const executed = await this.executeSchedule(schedule._id.toString(), 'end');
          if (executed) {
            executedCount += 1;
          }
        }
      }

      logger.info(
        `Checked ${activeSchedules.length} schedules, executed ${executedCount}`
      );
      return executedCount;
    } catch (error) {
      logger.error(`Check schedules error: ${error.message}`);
      throw error;
    }
  }
}

export default ScheduleService;
