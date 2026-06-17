import mongoose from 'mongoose';

const scheduleSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      enum: ['ON', 'OFF'],
      required: true,
    },
    endAction: {
      type: String,
      enum: ['ON', 'OFF'],
    },
    startTime: {
      type: String,
      required: true,
      // Format: HH:mm
    },
    endTime: {
      type: String,
      required: true,
      // Format: HH:mm
    },
    durationMinutes: {
      type: Number,
      min: 1,
      default: null,
    },
    daysOfWeek: [
      {
        type: Number,
        enum: [0, 1, 2, 3, 4, 5, 6], // 0 = Sunday, 6 = Saturday
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    mode: {
      type: String,
      enum: ['once', 'daily', 'custom'],
      default: 'daily',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    lastStartExecutedAt: {
      type: Date,
      default: null,
    },
    lastEndExecutedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Index for quick device schedule retrieval
scheduleSchema.index({ deviceId: 1, isActive: 1 });

export const Schedule = mongoose.model('Schedule', scheduleSchema);

export default Schedule;
