import { Worker } from 'bullmq';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import { Reading } from '../models/Reading.js';
import { Device } from '../models/Device.js';
import { calculateCost } from '../utils/helpers.js';
import { getSocketIO } from '../sockets/socketServer.js';
import { getRedis } from '../config/redis.js';

const MAX_INTERVAL_ENERGY_KWH = Number(
  process.env.MAX_INTERVAL_ENERGY_KWH || 0.02,
);
const MAX_REASONABLE_POWER_WATTS = Number(
  process.env.MAX_REASONABLE_POWER_WATTS || 3000,
);
const DEVICE_LOCK_TTL_SECONDS = Number(
  process.env.DEVICE_READING_LOCK_TTL_SECONDS || 10,
);
const DEVICE_LOCK_WAIT_ATTEMPTS = Number(
  process.env.DEVICE_READING_LOCK_WAIT_ATTEMPTS || 50,
);
const DEVICE_LOCK_WAIT_MS = Number(
  process.env.DEVICE_READING_LOCK_WAIT_MS || 100,
);
const LAST_ENERGY_TTL_SECONDS = Number(
  process.env.DEVICE_LAST_ENERGY_TTL_SECONDS || 24 * 60 * 60,
);
const RELAY_COMMAND_GRACE_SECONDS = Number(
  process.env.RELAY_COMMAND_GRACE_SECONDS || 8,
);
const MIN_ACTIVE_POWER_WATTS = Number(
  process.env.MIN_ACTIVE_POWER_WATTS || 1,
);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

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

const getTariffRate = async (redisClient, userId) => {
  try {
    const cachedRate = await redisClient?.get(`user:${userId}:rate`);
    const parsed = Number(cachedRate ?? process.env.ELECTRICITY_RATE ?? 22);
    return Number.isFinite(parsed) ? parsed : getDefaultElectricityRate();
  } catch (error) {
    logger.warn(`[Worker] Falling back to default electricity rate: ${error.message}`);
    return getDefaultElectricityRate();
  }
};

const calculateTariffCost = (energyKwh, ratePerKwh) =>
  Number(energyKwh || 0) * Number(ratePerKwh || 0);

const toWh = energyKwh => Number((Number(energyKwh || 0) * 1000).toFixed(4));

const toValidCumulativeEnergy = payload => {
  const value =
    payload?.measurements?.energy_kwh ??
    payload?.energy_kwh ??
    payload?.totalEnergy ??
    payload?.energy;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const clampPercent = value => {
  const parsed = toFiniteNumber(value, 0);
  return Math.max(0, Math.min(100, Math.round(parsed)));
};

const normalizeAiPayload = payload => {
  const ai = payload?.ai;

  if (
    payload?.load_type ||
    payload?.ail_type ||
    payload?.ail_state ||
    payload?.ai_pending_type
  ) {
    const reasons = Array.isArray(payload.reasons)
      ? payload.reasons
        .filter(reason => typeof reason === 'string' && reason.trim())
        .slice(0, 4)
        .map(reason => reason.trim().slice(0, 48))
      : [];

    return {
      schemaVersion: 2,
      state: String(payload.ail_state || 'OFF').toUpperCase(),
      family: String(payload.load_cat || 'unknown').toLowerCase(),
      type: String(payload.ail_type || 'UNKNOWN').toUpperCase(),
      subtype: String(payload.load_type || 'unknown').toLowerCase(),
      confidence: clampPercent(payload.ail_conf ?? payload.load_conf),
      locked: Boolean(payload.type_locked),
      lockConfidence: clampPercent(payload.ai_pending_conf ?? payload.ail_conf),
      cycling: Boolean(payload.cycle_detected),
      warmedUp: Boolean(payload.stable),
      pfReliable: payload.pf_valid !== false,
      source: 'firmware',
      reasons,
      loadType: String(payload.load_type || 'unknown').toLowerCase(),
      loadCat: String(payload.load_cat || 'unknown').toLowerCase(),
      loadConf: clampPercent(payload.load_conf),
      ailType: String(payload.ail_type || 'UNKNOWN').toUpperCase(),
      ailState: String(payload.ail_state || 'OFF').toUpperCase(),
      ailConf: clampPercent(payload.ail_conf),
      typeLocked: Boolean(payload.type_locked),
      aiPendingType: payload.ai_pending_type
        ? String(payload.ai_pending_type).toUpperCase()
        : undefined,
      aiPendingConf: clampPercent(payload.ai_pending_conf),
      cycleDetected: Boolean(payload.cycle_detected),
    };
  }

  if (!ai || Number(ai.schema_version ?? ai.schemaVersion) !== 2) {
    return null;
  }

  const features = ai.features || {};
  const reasons = Array.isArray(ai.reasons)
    ? ai.reasons
      .filter(reason => typeof reason === 'string' && reason.trim())
      .slice(0, 4)
      .map(reason => reason.trim().slice(0, 48))
    : [];

  return {
    schemaVersion: 2,
    state: String(ai.state || 'unknown').toLowerCase(),
    family: String(ai.family || 'unknown').toLowerCase(),
    type: String(ai.type || 'unknown').toLowerCase(),
    subtype: String(ai.subtype || 'unknown').toLowerCase(),
    confidence: clampPercent(ai.confidence),
    locked: Boolean(ai.locked),
    lockConfidence: clampPercent(ai.lock_confidence ?? ai.lockConfidence),
    cycling: Boolean(ai.cycling),
    warmedUp: Boolean(ai.warmed_up ?? ai.warmedUp),
    pfReliable: Boolean(ai.pf_reliable ?? ai.pfReliable),
    source: String(ai.source || 'firmware').toLowerCase(),
    reasons,
    features: {
      pAvg: toFiniteNumber(features.p_avg ?? features.pAvg),
      pStd: toFiniteNumber(features.p_std ?? features.pStd),
      pMax: toFiniteNumber(features.p_max ?? features.pMax),
      pMin: toFiniteNumber(features.p_min ?? features.pMin),
      pfAvg: toFiniteNumber(features.pf_avg ?? features.pfAvg),
      transitions: toFiniteNumber(features.transitions),
      drops: toFiniteNumber(features.drops),
      cycleCount: toFiniteNumber(features.cycle_count ?? features.cycleCount),
      avgPeriodMs: toFiniteNumber(features.avg_period_ms ?? features.avgPeriodMs),
    },
  };
};

const flattenAiForClient = (normalizedAi, payload = {}) => {
  if (!normalizedAi) {
    return {};
  }

  return {
    load_type: normalizedAi.loadType || normalizedAi.subtype || 'unknown',
    load_cat: normalizedAi.loadCat || normalizedAi.family || 'unknown',
    load_conf: normalizedAi.loadConf ?? normalizedAi.confidence ?? 0,
    ail_type: normalizedAi.ailType || normalizedAi.type || 'UNKNOWN',
    ail_state: normalizedAi.ailState || normalizedAi.state || 'OFF',
    ail_conf: normalizedAi.ailConf ?? normalizedAi.confidence ?? 0,
    type_locked: Boolean(normalizedAi.typeLocked ?? normalizedAi.locked),
    cycle_detected: Boolean(normalizedAi.cycleDetected ?? normalizedAi.cycling),
    ai_pending_type: normalizedAi.aiPendingType || payload.ai_pending_type,
    ai_pending_conf: normalizedAi.aiPendingConf ?? payload.ai_pending_conf ?? 0,
    reasons: normalizedAi.reasons || [],
    stable: payload.stable,
    frames: payload.frames,
    uptime: payload.uptime,
    drift_alert: Boolean(payload.drift_alert),
    cal_warning: payload.cal_warning,
    consist_warn: Boolean(payload.consist_warn),
    pf_valid: payload.pf_valid,
    apparent_va: payload.apparent_va,
    live_power: payload.live_power,
  };
};

const normalizeRelay = relay => {
  const normalized = String(relay || 'OFF').toUpperCase();
  return ['ON', 'OFF', 'OFFLINE'].includes(normalized) ? normalized : 'OFF';
};

const getReadingTimestamp = timestamp => {
  const parsed = timestamp ? new Date(timestamp) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const getMqttMessageId = payload => {
  const value =
    payload?.mqttMessageId ??
    payload?.messageId ??
    payload?.packetId ??
    payload?.sequence ??
    payload?.seq ??
    null;

  return value === null || value === undefined ? null : String(value);
};

const toFixedNumber = (value, digits) => Number(value || 0).toFixed(digits);

const getReadingKey = ({ deviceId, payload, totalEnergy, power, relay }) => {
  const mqttMessageId = getMqttMessageId(payload);

  if (mqttMessageId) {
    return {
      mqttMessageId,
      readingKey: `mqtt:${deviceId}:${mqttMessageId}`,
    };
  }

  // ESP32 currently sends a cumulative counter, not a durable packet id.
  // This fallback prevents MQTT retry duplicates for the same device snapshot
  // while still allowing future readings after the cumulative counter changes.
  const source = [
    deviceId,
    toFixedNumber(totalEnergy, 6),
    toFixedNumber(power, 3),
    relay,
  ].join('|');

  return {
    mqttMessageId: null,
    readingKey: `snapshot:${crypto.createHash('sha1').update(source).digest('hex')}`,
  };
};

const getPreviousTotalEnergy = previousReading => {
  if (previousReading?.energy != null) {
    return toFiniteNumber(
      previousReading.totalEnergy ?? previousReading.cumulativeEnergy,
      null,
    );
  }

  return null;
};

const getUserRangeTotals = async (userId, start, end, rate) => {
  const [result] = await Reading.aggregate([
    {
      $match: {
        userId,
        timestamp: {
          $gte: start,
          $lte: end,
        },
      },
    },
    {
      $group: {
        _id: null,
        totalEnergy: getActiveEnergySum('$energy'),
      },
    },
  ]);

  const energy = Number(result?.totalEnergy || 0);

  return {
    energy,
    cost: calculateTariffCost(energy, rate),
  };
};

const buildUserEnergySnapshot = async (userId, rate, now) => {
  const minuteStart = new Date(now.getTime() - 60 * 1000);
  const hourStart = getCurrentHourStart(now);
  const { start: todayStart, end: todayEnd } = getTodayRange(now);
  const monthStart = getMonthStart(now);

  const [devices, minuteTotals, hourTotals, todayTotals, monthTotals] =
    await Promise.all([
      Device.find({ userId, active: true }).lean(),
      getUserRangeTotals(userId, minuteStart, now, rate),
      getUserRangeTotals(userId, hourStart, now, rate),
      getUserRangeTotals(userId, todayStart, todayEnd, rate),
      getUserRangeTotals(userId, monthStart, now, rate),
    ]);

  const power = devices.reduce(
    (sum, device) =>
      sum + Number(device.relayState === 'ON' ? device.power || 0 : 0),
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
};

const getPreviousEnergySnapshot = (previousReading, cachedLastEnergy) => {
  const mongoTotalEnergy = getPreviousTotalEnergy(previousReading);

  if (!cachedLastEnergy?.totalEnergy && cachedLastEnergy?.totalEnergy !== 0) {
    return {
      totalEnergy: mongoTotalEnergy,
      timestamp: previousReading?.timestamp || null,
      source: 'mongo',
    };
  }

  if (!previousReading?.timestamp || !cachedLastEnergy.timestamp) {
    return {
      totalEnergy: cachedLastEnergy.totalEnergy,
      timestamp: cachedLastEnergy.timestamp || previousReading?.timestamp || null,
      source: 'redis',
    };
  }

  const cachedTime = new Date(cachedLastEnergy.timestamp).getTime();
  const mongoTime = new Date(previousReading.timestamp).getTime();

  if (Number.isFinite(cachedTime) && cachedTime >= mongoTime) {
    return {
      totalEnergy: cachedLastEnergy.totalEnergy,
      timestamp: cachedLastEnergy.timestamp,
      source: 'redis',
    };
  }

  return {
    totalEnergy: mongoTotalEnergy,
    timestamp: previousReading.timestamp,
    source: 'mongo',
  };
};

const parseCachedLastEnergy = cached => {
  if (!cached) {
    return null;
  }

  try {
    const parsed = JSON.parse(cached);
    const totalEnergy = toFiniteNumber(parsed?.totalEnergy, null);
    return totalEnergy === null
      ? null
      : {
          totalEnergy,
          timestamp: parsed?.timestamp || null,
        };
  } catch (error) {
    logger.warn(`[Worker] Ignoring invalid cached energy snapshot: ${error.message}`);
    return null;
  }
};

const getCachedLastEnergy = async (redisClient, deviceId) => {
  if (!redisClient) {
    return null;
  }

  try {
    return parseCachedLastEnergy(
      await redisClient.get(`device:${deviceId}:lastEnergy`),
    );
  } catch (error) {
    logger.warn(`[Worker] Failed to read cached baseline for ${deviceId}: ${error.message}`);
    return null;
  }
};

const cacheLastEnergy = async (redisClient, deviceId, totalEnergy, timestamp) => {
  if (!redisClient) {
    return;
  }

  try {
    await redisClient.setEx(
      `device:${deviceId}:lastEnergy`,
      LAST_ENERGY_TTL_SECONDS,
      JSON.stringify({
        totalEnergy,
        timestamp,
      }),
    );
  } catch (error) {
    logger.warn(`[Worker] Failed to cache baseline for ${deviceId}: ${error.message}`);
  }
};

const getDesiredRelay = async (redisClient, deviceId) => {
  if (!redisClient) {
    return null;
  }

  try {
    const cached = await redisClient.get(`device:${deviceId}:desiredRelay`);
    if (!cached) {
      return null;
    }

    const parsed = JSON.parse(cached);
    const relayState = normalizeRelay(parsed?.relayState);
    const commandTime = new Date(parsed?.timestamp).getTime();
    const ageSeconds = Number.isFinite(commandTime)
      ? (Date.now() - commandTime) / 1000
      : RELAY_COMMAND_GRACE_SECONDS + 1;

    if (ageSeconds > RELAY_COMMAND_GRACE_SECONDS) {
      await redisClient.del(`device:${deviceId}:desiredRelay`);
      return null;
    }

    return relayState;
  } catch (error) {
    logger.warn(`[Worker] Failed to read desired relay for ${deviceId}: ${error.message}`);
    return null;
  }
};

const clearDesiredRelayIfMatched = async (
  redisClient,
  deviceId,
  desiredRelay,
  payloadRelay,
) => {
  if (!redisClient || !desiredRelay || !payloadRelay) {
    return;
  }

  if (desiredRelay !== payloadRelay) {
    return;
  }

  try {
    await redisClient.del(`device:${deviceId}:desiredRelay`);
  } catch (error) {
    logger.warn(`[Worker] Failed to clear desired relay for ${deviceId}: ${error.message}`);
  }
};

const warmEnergyBaselines = async () => {
  const redisClient = getRedis();
  if (!redisClient) {
    return;
  }

  try {
    const deviceIds = await Device.distinct('deviceId', { active: true });

    await Promise.all(
      deviceIds.map(async deviceId => {
        await redisClient.del(`device:${deviceId}:reading-lock`);

        const latestReading = await Reading.findOne({
          deviceId,
          energy: { $gte: 0 },
        })
          .sort({ timestamp: -1, _id: -1 })
          .lean();

        const totalEnergy = toFiniteNumber(
          latestReading?.totalEnergy ?? latestReading?.cumulativeEnergy,
          null,
        );

        if (totalEnergy !== null) {
          await cacheLastEnergy(
            redisClient,
            deviceId,
            totalEnergy,
            latestReading.timestamp,
          );
        }
      }),
    );

    logger.info(`[Worker] Warmed energy baselines for ${deviceIds.length} devices`);
  } catch (error) {
    logger.warn(`[Worker] Failed to warm energy baselines: ${error.message}`);
  }
};

const calculateIntervalEnergy = (
  deviceId,
  totalEnergy,
  previousTotalEnergy,
  previousTimestamp,
  currentTimestamp,
) => {
  if (previousTotalEnergy === null) {
    return {
      intervalEnergy: 0,
      reason: 'initial-baseline',
    };
  }

  const rawDelta = totalEnergy - previousTotalEnergy;

  if (rawDelta === 0) {
    return {
      intervalEnergy: 0,
      reason: 'duplicate-packet',
    };
  }

  if (rawDelta < 0) {
    logger.warn(
      `[Worker] ESP32 energy reset/reboot detected for ${deviceId} ` +
        `(prev=${previousTotalEnergy} current=${totalEnergy})`,
    );
    return {
      intervalEnergy: 0,
      reason: 'counter-reset',
    };
  }

  const elapsedSeconds =
    previousTimestamp && currentTimestamp
      ? Math.max(
          (new Date(currentTimestamp).getTime() -
            new Date(previousTimestamp).getTime()) /
            1000,
          0,
        )
      : 0;
  const elapsedEnergyLimit =
    elapsedSeconds > 0
      ? (MAX_REASONABLE_POWER_WATTS * elapsedSeconds) / (1000 * 60 * 60)
      : 0;
  const maxAllowedDelta = Math.max(
    MAX_INTERVAL_ENERGY_KWH,
    elapsedEnergyLimit * 1.25,
  );

  if (rawDelta > maxAllowedDelta) {
    logger.warn(
      `[Worker] Ignored impossible energy spike for ${deviceId} ` +
        `(prev=${previousTotalEnergy} current=${totalEnergy} delta=${rawDelta} limit=${maxAllowedDelta})`,
    );
    return {
      intervalEnergy: 0,
      reason: 'spike-clamped',
    };
  }

  return {
    intervalEnergy: rawDelta,
    reason: 'ok',
  };
};

const calculateUptimeDelta = (device, uptime) => {
  if (uptime === null || uptime < 0) {
    return 0;
  }

  const previousUptime = toFiniteNumber(device?.lastUptime, null);
  if (previousUptime === null || uptime < previousUptime) {
    return 0;
  }

  return uptime - previousUptime;
};

const acquireDeviceLock = async (redisClient, deviceId) => {
  if (!redisClient) {
    return async () => {};
  }

  const lockKey = `device:${deviceId}:reading-lock`;
  const token = `${process.pid}:${Date.now()}:${Math.random()}`;

  for (let attempt = 0; attempt < DEVICE_LOCK_WAIT_ATTEMPTS; attempt += 1) {
    const acquired = await redisClient.set(lockKey, token, {
      NX: true,
      EX: DEVICE_LOCK_TTL_SECONDS,
    });

    if (acquired) {
      return async () => {
        try {
          const currentToken = await redisClient.get(lockKey);
          if (currentToken === token) {
            await redisClient.del(lockKey);
          }
        } catch (error) {
          logger.warn(`[Worker] Failed to release device lock ${deviceId}: ${error.message}`);
        }
      };
    }

    await sleep(DEVICE_LOCK_WAIT_MS);
  }

  logger.warn(`[Worker] Skipping reading because lock is busy: ${deviceId}`);
  return null;
};

const getTodayRange = (date = new Date()) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

const getActiveEnergySum = field => ({
  $sum: {
    $cond: [{ $gte: ['$power', MIN_ACTIVE_POWER_WATTS] }, field, 0],
  },
});

export const startEnergyWorker = () => {
  const worker = new Worker(
    'energy-processing',
    async job => {
      let releaseLock = async () => {};

      try {
        if (job.name === 'process-reading') {
          const { deviceId, payload, timestamp } = job.data || {};

          if (!deviceId || !payload || typeof payload !== 'object') {
            logger.warn('[Worker] Corrupted reading job skipped');
            return { success: false, skipped: 'corrupted-job' };
          }

          const redisClient = getRedis();
          releaseLock = await acquireDeviceLock(redisClient, deviceId);
          if (!releaseLock) {
            return { success: false, skipped: 'reading-lock-busy' };
          }

          const totalEnergy = toValidCumulativeEnergy(payload);
          if (totalEnergy === null) {
            logger.warn(`[Worker] Invalid cumulative energy for ${deviceId} - skipping`);
            return { success: false, skipped: 'invalid-energy' };
          }

          const measurements = payload.measurements || {};
          const voltage = toFiniteNumber(payload.voltage ?? measurements.voltage);
          const sensorCurrent = toFiniteNumber(payload.current ?? measurements.current);
          const sensorPower = toFiniteNumber(payload.power ?? measurements.power);
          const uptime = payload.uptime === undefined
            ? null
            : toFiniteNumber(payload.uptime, null);
          const readingTimestamp = getReadingTimestamp(timestamp);
          const payloadSchemaVersion = Number(payload.schema_version ?? payload.schemaVersion ?? 1);
          const normalizedAi = normalizeAiPayload(payload);

          const device = await Device.findOne({ deviceId, active: true });
          if (!device) {
            const pendingAi = normalizeAiPayload(payload);
            if (redisClient) {
              await redisClient.setEx(
                `device:${deviceId}:latest_raw`,
                300,
                JSON.stringify({
                  deviceId,
                  device: deviceId,
                  voltage,
                  current: sensorCurrent,
                  power: sensorPower,
                  energy_kwh: totalEnergy,
                  totalEnergy,
                  relay: payload.relay,
                  relayState: payload.relay,
                  ai: pendingAi,
                  ...flattenAiForClient(pendingAi, payload),
                  timestamp: readingTimestamp,
                  pendingLink: true,
                }),
              );
            }
            logger.debug(`[Worker] Reading for inactive or unlinked device skipped: ${deviceId}`);
            return { success: false, skipped: 'unknown-device' };
          }

          const payloadRelay = payload.relay === undefined
            ? null
            : normalizeRelay(payload.relay);
          const desiredRelay = await getDesiredRelay(redisClient, deviceId);
          const relay = desiredRelay ||
            (payloadRelay === null
            ? normalizeRelay(device.relayState)
            : payloadRelay);
          await clearDesiredRelayIfMatched(
            redisClient,
            deviceId,
            desiredRelay,
            payloadRelay,
          );
          const power = relay === 'ON' ? sensorPower : 0;
          const current = relay === 'ON' ? sensorCurrent : 0;
          const dedup = getReadingKey({
            deviceId,
            payload,
            totalEnergy,
            power,
            relay,
          });

          const exists = await Reading.exists({ readingKey: dedup.readingKey });
          if (exists) {
            logger.debug(`Duplicate reading hard-stopped for ${deviceId}`);
            return { success: true, skipped: 'duplicate-reading' };
          }

          const userId = device.userId;
          const rate = await getTariffRate(redisClient, userId);

          let previousReading = null;
          let mongoBaselineFailed = false;

          try {
            previousReading = await Reading.findOne({
              deviceId,
              energy: { $gte: 0 },
            })
              .sort({ timestamp: -1, _id: -1 })
              .lean();
          } catch (error) {
            mongoBaselineFailed = true;
            logger.warn(
              `[Worker] Mongo baseline lookup failed for ${deviceId}, trying Redis fallback: ${error.message}`,
            );
          }

          const cachedLastEnergy = await getCachedLastEnergy(redisClient, deviceId);
          const previousSnapshot = getPreviousEnergySnapshot(
            previousReading,
            cachedLastEnergy,
          );
          let previousTotalEnergy = previousSnapshot.totalEnergy;
          let previousEnergyTimestamp = previousSnapshot.timestamp;

          if (mongoBaselineFailed && previousTotalEnergy === null) {
            previousTotalEnergy = cachedLastEnergy?.totalEnergy ?? null;
            previousEnergyTimestamp = cachedLastEnergy?.timestamp ?? null;
          }

          // Old architecture summed ESP32 lifetime totals and inflated analytics.
          // Correct architecture stores only interval delta in `energy`, while
          // `totalEnergy` preserves the ESP32 cumulative snapshot for baselines.
          const { intervalEnergy, reason } = calculateIntervalEnergy(
            deviceId,
            totalEnergy,
            previousTotalEnergy,
            previousEnergyTimestamp,
            readingTimestamp,
          );
          const cost = calculateCost(intervalEnergy, rate);
          let persistedIntervalEnergy = 0;
          let persistedCost = 0;
          let readingPersisted = false;

          const shouldPersistBaseline = [
            'initial-baseline',
            'spike-clamped',
            'counter-reset',
          ].includes(reason);

          if (intervalEnergy > 0 || shouldPersistBaseline) {
            const reading = new Reading({
              deviceId,
              userId,
              voltage,
              current,
              power,
              mqttMessageId: dedup.mqttMessageId,
              readingKey: dedup.readingKey,
              energy: intervalEnergy,
              totalEnergy,
              cumulativeEnergy: totalEnergy,
              powerFactor: toFiniteNumber(payload.pf ?? payload.powerFactor ?? measurements.pf),
              frequency: toFiniteNumber(payload.frequency ?? measurements.frequency),
              schemaVersion: Number.isFinite(payloadSchemaVersion) ? payloadSchemaVersion : 1,
              firmwareVersion: payload.fw_version || payload.firmwareVersion || undefined,
              ai: normalizedAi || undefined,
              cost,
              timestamp: readingTimestamp,
            });

            try {
              const result = await reading.save();
              readingPersisted = Boolean(result?._id);
              if (readingPersisted) {
                persistedIntervalEnergy = intervalEnergy;
                persistedCost = cost;
                logger.debug(`Reading saved for ${deviceId}`);
              }
            } catch (error) {
              if (error.code === 11000) {
                logger.debug(`Duplicate reading ignored for ${deviceId}`);
              } else {
                throw error;
              }
            }
          } else {
            logger.debug(`Reading skipped for ${deviceId}: ${reason}`);
          }

          const uptimeDelta = calculateUptimeDelta(device, uptime);
          const deviceUpdate = {
            power,
            voltage,
            current,
            energy: totalEnergy,
            relayState: relay,
            isOnline: relay !== 'OFFLINE',
            lastSeen: readingTimestamp,
            metadata: {
              ...(device.metadata || {}),
              lastAi: normalizedAi || device.metadata?.lastAi,
              lastMqttPayload: {
                load_type: payload.load_type,
                load_cat: payload.load_cat,
                load_conf: payload.load_conf,
                ail_type: payload.ail_type,
                ail_state: payload.ail_state,
                ail_conf: payload.ail_conf,
                type_locked: payload.type_locked,
                ai_pending_type: payload.ai_pending_type,
                ai_pending_conf: payload.ai_pending_conf,
                reasons: payload.reasons,
                stable: payload.stable,
                frames: payload.frames,
                uptime: payload.uptime,
              },
            },
          };

          if (uptime !== null) {
            deviceUpdate.lastUptime = uptime;
          }

          const updateOperation = uptimeDelta > 0
            ? { $set: deviceUpdate, $inc: { totalUptime: uptimeDelta } }
            : { $set: deviceUpdate };

          await Device.findOneAndUpdate({ deviceId, active: true }, updateOperation);
          if (readingPersisted) {
            await cacheLastEnergy(redisClient, deviceId, totalEnergy, readingTimestamp);
          }

          const { start, end } = getTodayRange(readingTimestamp);
          const deviceTotals = await Reading.aggregate([
            {
              $match: {
                deviceId,
                timestamp: {
                  $gte: start,
                  $lte: end,
                },
              },
            },
            {
              $group: {
                _id: null,
                totalEnergy: getActiveEnergySum('$energy'),
              },
            },
          ]);

          const todayEnergy = Number(deviceTotals[0]?.totalEnergy || 0);
          const todayCost = calculateTariffCost(todayEnergy, rate);
          const userSnapshot = await buildUserEnergySnapshot(
            userId,
            rate,
            readingTimestamp,
          );
          const socketPayload = {
            deviceId,
            device: deviceId,
            voltage,
            current,
            power,
            totalPower: userSnapshot.power,
            energy_kwh: totalEnergy,
            totalEnergy,
            energy_delta_kwh: persistedIntervalEnergy,
            deltaWh: toWh(persistedIntervalEnergy),
            relayState: relay,
            relay,
            cost: persistedCost,
            todayCost: userSnapshot.todayCost,
            todayEnergy: userSnapshot.energy.today,
            deviceTodayCost: todayCost,
            deviceTodayEnergy: todayEnergy,
            todayWh: userSnapshot.todayWh,
            monthlyWh: userSnapshot.monthlyWh,
            hourlyWh: userSnapshot.hourlyWh,
            hourlyCost: userSnapshot.hourlyCost,
            monthlyCost: userSnapshot.monthlyCost,
            overview: userSnapshot,
            energyWh: userSnapshot.energyWh,
            totalsCost: userSnapshot.cost,
            tariffPerKwh: rate,
            tariffPerWh: rate / 1000,
            schemaVersion: Number.isFinite(payloadSchemaVersion) ? payloadSchemaVersion : 1,
            ai: normalizedAi,
            ...flattenAiForClient(normalizedAi, payload),
            timestamp: readingTimestamp,
          };

          if (redisClient) {
            await redisClient.setEx(
              `device:${deviceId}:latest`,
              300,
              JSON.stringify(socketPayload),
            );
          }

          const io = getSocketIO();
          if (io) {
            io.to(`user:${userId}`).emit('energy:update', socketPayload);
          }
        }

        if (job.name === 'update-status') {
          const { deviceId, isOnline, relay } = job.data;
          const device = await Device.findOne({ deviceId, active: true });

          if (!device) {
            logger.debug(`[Worker] Status for inactive or unlinked device skipped: ${deviceId}`);
            return { success: false, skipped: 'unknown-device' };
          }

          const payloadRelay = relay === undefined ? null : normalizeRelay(relay);
          const desiredRelay = await getDesiredRelay(getRedis(), deviceId);
          const relayState = desiredRelay ||
            (payloadRelay === null ? normalizeRelay(device.relayState) : payloadRelay);
          await clearDesiredRelayIfMatched(
            getRedis(),
            deviceId,
            desiredRelay,
            payloadRelay,
          );

          await Device.findOneAndUpdate(
            { deviceId, active: true },
            { isOnline, relayState, lastSeen: new Date() },
          );

          const io = getSocketIO();
          if (io) {
            io.to(`user:${device.userId}`).emit('device:status', {
              deviceId,
              isOnline,
              relay: relayState,
              relayState,
            });
          }

          logger.info(`[Worker] Status - ${deviceId} online=${isOnline} relay=${relayState}`);
        }

        return { success: true };
      } catch (error) {
        logger.error(`[Worker] Error: ${error.message}`);
        throw error;
      } finally {
        await releaseLock();
      }
    },
    {
      skipVersionCheck: true,
      connection: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
        password: process.env.REDIS_PASSWORD,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
      // ESP32 sends cumulative counters, so readings must be processed in order.
      concurrency: Number(process.env.ENERGY_WORKER_CONCURRENCY || 1),
    },
  );

  worker.on('failed', (job, err) =>
    logger.error(`[Worker] Failed ${job.id}: ${err.message}`),
  );
  worker.on('completed', job => logger.debug(`[Worker] Done ${job.id}`));

  logger.info('Energy worker started');
  warmEnergyBaselines();
  return worker;
};

export default startEnergyWorker;
