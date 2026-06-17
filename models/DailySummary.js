import mongoose from 'mongoose';

const dailySummarySchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
      // Stored as start of day in UTC
    },
    totalEnergy: {
      type: Number,
      default: 0,
    },
    totalCost: {
      type: Number,
      default: 0,
    },
    averagePower: {
      type: Number,
      default: 0,
    },
    maxPower: {
      type: Number,
      default: 0,
    },
    minPower: {
      type: Number,
      default: 0,
    },
    readingCount: {
      type: Number,
      default: 0,
    },
    onTimeMinutes: {
      type: Number,
      default: 0,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

// Composite index for efficient queries
dailySummarySchema.index({ deviceId: 1, date: -1 });
dailySummarySchema.index({ userId: 1, date: -1 });

export const DailySummary = mongoose.model('DailySummary', dailySummarySchema);

export default DailySummary;
