import mongoose from 'mongoose';

const aiSchema = new mongoose.Schema(
  {
    schemaVersion: {
      type: Number,
      index: true,
    },
    state: String,
    family: String,
    type: String,
    subtype: String,
    confidence: Number,
    locked: Boolean,
    lockConfidence: Number,
    cycling: Boolean,
    warmedUp: Boolean,
    pfReliable: Boolean,
    source: String,
    reasons: [String],
    loadType: String,
    loadCat: String,
    loadConf: Number,
    ailType: String,
    ailState: String,
    ailConf: Number,
    typeLocked: Boolean,
    aiPendingType: String,
    aiPendingConf: Number,
    cycleDetected: Boolean,
    features: {
      pAvg: Number,
      pStd: Number,
      pMax: Number,
      pMin: Number,
      pfAvg: Number,
      transitions: Number,
      drops: Number,
      cycleCount: Number,
      avgPeriodMs: Number,
    },
  },
  { _id: false }
);

const readingSchema = new mongoose.Schema(
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
    voltage: Number,
    current: Number,
    power: Number,
    mqttMessageId: {
      type: String,
      index: true,
    },
    readingKey: {
      type: String,
      index: true,
    },
    energy: {
      type: Number,
      required: true,
    },
    // Interval readings are the only values analytics should sum. The ESP32
    // sends a cumulative lifetime counter, so we keep that snapshot separately.
    totalEnergy: {
      type: Number,
      default: 0,
    },
    cumulativeEnergy: {
      type: Number,
      default: 0,
    },
    frequency: Number,
    powerFactor: Number,
    temperature: Number,
    schemaVersion: {
      type: Number,
      default: 1,
      index: true,
    },
    firmwareVersion: String,
    ai: aiSchema,
    cost: {
      type: Number,
      default: 0,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: false }
);

// Composite index for efficient time-based queries per device
readingSchema.index({ deviceId: 1, timestamp: -1 });
// Index for user queries
readingSchema.index({ userId: 1, timestamp: -1 });
// New AI analytics must opt into the versioned AI schema so legacy payloads do
// not mix into appliance charts.
readingSchema.index({ userId: 1, 'ai.schemaVersion': 1, timestamp: -1 });
readingSchema.index({ deviceId: 1, 'ai.schemaVersion': 1, timestamp: -1 });
// Helps duplicate/replay checks fetch the previous cumulative snapshot quickly
readingSchema.index({ deviceId: 1, totalEnergy: -1 });
// Idempotency guard for MQTT retries and duplicate worker jobs
readingSchema.index(
  { readingKey: 1 },
  {
    unique: true,
    sparse: true,
    name: 'unique_reading_key',
  }
);
// TTL index to auto-delete old readings after 90 days
readingSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const Reading = mongoose.model('Reading', readingSchema);

export default Reading;
