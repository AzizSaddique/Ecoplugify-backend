import 'dotenv/config';
import mongoose from 'mongoose';

const MIGRATION_VERSION = 'reading-energy-delta-v1';

const args = new Set(process.argv.slice(2));
const getArgValue = (name, fallback) => {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
};

const DRY_RUN = !args.has('--apply') && !args.has('--rollback');
const APPLY = args.has('--apply');
const ROLLBACK = args.has('--rollback');
const ENSURE_INDEX = args.has('--ensure-index');
const BATCH_SIZE = Number(getArgValue('--batch-size', 500));
const PROGRESS_EVERY = Number(getArgValue('--progress-every', 10000));
const MAX_DELTA_KWH = Number(
  getArgValue('--max-delta-kwh', process.env.MAX_INTERVAL_ENERGY_KWH || 0.02),
);
const DEFAULT_MAX_POWER_WATTS = Number(
  getArgValue('--default-max-power-watts', process.env.DEFAULT_MAX_POWER_WATTS || 3680),
);
const SPIKE_SAFETY_MULTIPLIER = Number(
  getArgValue('--spike-safety-multiplier', process.env.SPIKE_SAFETY_MULTIPLIER || 2),
);
const MIN_TIME_DIFF_SECONDS = Number(getArgValue('--min-time-diff-seconds', 1));
const BATCH_PAUSE_MS = Number(getArgValue('--batch-pause-ms', 100));
const BATCH_ID = getArgValue('--batch-id', process.env.MIGRATION_BATCH_ID || null);
const DEVICE_ID = getArgValue('--device', null);
const FROM_DATE = getArgValue('--from', null);
const TO_DATE = getArgValue('--to', null);

if (APPLY && ROLLBACK) {
  console.error('Use only one mode: --apply or --rollback');
  process.exit(1);
}

if ((APPLY || ROLLBACK) && !BATCH_ID) {
  console.error('Provide --batch-id for apply/rollback, for example --batch-id=2026-05-reading-delta-run-01');
  process.exit(1);
}

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is missing. Load the backend .env before running.');
  process.exit(1);
}

if (!Number.isFinite(BATCH_SIZE) || BATCH_SIZE < 1) {
  console.error('--batch-size must be a positive number');
  process.exit(1);
}

if (!Number.isFinite(MAX_DELTA_KWH) || MAX_DELTA_KWH <= 0) {
  console.error('--max-delta-kwh must be a positive number');
  process.exit(1);
}

if (!Number.isFinite(DEFAULT_MAX_POWER_WATTS) || DEFAULT_MAX_POWER_WATTS <= 0) {
  console.error('--default-max-power-watts must be a positive number');
  process.exit(1);
}

if (!Number.isFinite(SPIKE_SAFETY_MULTIPLIER) || SPIKE_SAFETY_MULTIPLIER <= 0) {
  console.error('--spike-safety-multiplier must be a positive number');
  process.exit(1);
}

if (!Number.isFinite(BATCH_PAUSE_MS) || BATCH_PAUSE_MS < 0) {
  console.error('--batch-pause-ms must be zero or a positive number');
  process.exit(1);
}

const toFiniteNumber = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const getObjectIdTimestamp = id => {
  if (id && typeof id.getTimestamp === 'function') {
    return id.getTimestamp();
  }

  return new Date();
};

const getEffectiveTimestamp = doc => {
  const timestamp = doc.migrationTimestamp || doc.timestamp;
  const parsed = timestamp ? new Date(timestamp) : getObjectIdTimestamp(doc._id);

  return Number.isNaN(parsed.getTime()) ? getObjectIdTimestamp(doc._id) : parsed;
};

const getDeviceMaxPowerWatts = device => {
  const candidates = [
    device?.maxPowerWatts,
    device?.ratedPowerWatts,
    device?.metadata?.maxPowerWatts,
    device?.metadata?.ratedPowerWatts,
    device?.metadata?.maxPower,
    device?.metadata?.powerWatts,
  ];

  for (const candidate of candidates) {
    const parsed = toFiniteNumber(candidate, null);
    if (parsed !== null && parsed > 0) {
      return parsed;
    }
  }

  return DEFAULT_MAX_POWER_WATTS;
};

const loadDevicePowerMap = async db => {
  const deviceMap = new Map();
  const cursor = db.collection('devices')
    .find(
      DEVICE_ID ? { deviceId: DEVICE_ID } : {},
      {
        projection: {
          deviceId: 1,
          maxPowerWatts: 1,
          ratedPowerWatts: 1,
          metadata: 1,
        },
      },
    )
    .batchSize(500);

  for await (const device of cursor) {
    deviceMap.set(device.deviceId, getDeviceMaxPowerWatts(device));
  }

  return deviceMap;
};

const hasUsableSnapshot = doc => {
  const totalEnergy = toFiniteNumber(doc.totalEnergy, null);
  const cumulativeEnergy = toFiniteNumber(doc.cumulativeEnergy, null);
  return (
    (totalEnergy !== null && totalEnergy > 0) ||
    (cumulativeEnergy !== null && cumulativeEnergy > 0)
  );
};

const isApplied = doc => doc.energyMigration?.v1?.applied === true;

const isLegacyReading = doc => {
  if (isApplied(doc)) {
    return false;
  }

  // Legacy documents stored the ESP32 cumulative lifetime counter in `energy`
  // and did not have a reliable cumulative snapshot field. New documents have
  // `totalEnergy`/`cumulativeEnergy`, so they are left untouched.
  return !hasUsableSnapshot(doc);
};

const getSnapshot = doc => {
  if (isApplied(doc)) {
    return toFiniteNumber(
      doc.totalEnergy ?? doc.cumulativeEnergy ?? doc.energyMigration?.v1?.originalEnergy,
      null,
    );
  }

  const totalEnergy = toFiniteNumber(doc.totalEnergy, null);
  if (totalEnergy !== null && totalEnergy > 0) {
    return totalEnergy;
  }

  const cumulativeEnergy = toFiniteNumber(doc.cumulativeEnergy, null);
  if (cumulativeEnergy !== null && cumulativeEnergy > 0) {
    return cumulativeEnergy;
  }

  return toFiniteNumber(doc.energy, null);
};

const getDynamicThresholdKwh = (deviceId, previousTimestamp, currentTimestamp, devicePowerMap) => {
  const maxPowerWatts = devicePowerMap.get(deviceId) || DEFAULT_MAX_POWER_WATTS;
  const rawSeconds = previousTimestamp
    ? (currentTimestamp.getTime() - previousTimestamp.getTime()) / 1000
    : MIN_TIME_DIFF_SECONDS;
  const seconds = Math.max(rawSeconds, MIN_TIME_DIFF_SECONDS);
  const dynamicThreshold = (maxPowerWatts * seconds * SPIKE_SAFETY_MULTIPLIER) / 3600000;

  return Math.max(dynamicThreshold, Number.EPSILON);
};

const getTimeDiffSeconds = (previousTimestamp, currentTimestamp) => {
  if (!previousTimestamp || !currentTimestamp) {
    return null;
  }

  return (currentTimestamp.getTime() - previousTimestamp.getTime()) / 1000;
};

const getInterval = ({
  deviceId,
  snapshot,
  previousSnapshot,
  previousTimestamp,
  currentTimestamp,
  devicePowerMap,
}) => {
  if (snapshot === null || snapshot < 0) {
    return {
      energy: 0,
      reason: 'invalid-snapshot',
      advanceBaseline: false,
      resetEvent: false,
      thresholdKwh: 0,
    };
  }

  if (previousSnapshot === null) {
    return {
      energy: 0,
      reason: 'initial-baseline',
      advanceBaseline: true,
      resetEvent: false,
      thresholdKwh: 0,
    };
  }

  const rawDelta = snapshot - previousSnapshot;
  const timeDiffSeconds = getTimeDiffSeconds(previousTimestamp, currentTimestamp);
  const thresholdKwh = getDynamicThresholdKwh(
    deviceId,
    previousTimestamp,
    currentTimestamp,
    devicePowerMap,
  );

  if (rawDelta === 0) {
    return {
      energy: 0,
      reason: 'duplicate-packet',
      advanceBaseline: true,
      resetEvent: false,
      thresholdKwh,
    };
  }

  if (rawDelta < 0) {
    const resetEvent = Math.abs(rawDelta) > thresholdKwh;

    return {
      energy: 0,
      reason: resetEvent ? 'esp32_reboot' : 'counter-decrease',
      advanceBaseline: true,
      resetEvent,
      thresholdKwh,
    };
  }

  if (timeDiffSeconds !== null && timeDiffSeconds < MIN_TIME_DIFF_SECONDS) {
    return {
      energy: 0,
      reason: 'too-fast-sampling',
      advanceBaseline: false,
      resetEvent: false,
      thresholdKwh,
    };
  }

  if (rawDelta > thresholdKwh || rawDelta > MAX_DELTA_KWH) {
    return {
      energy: 0,
      reason: 'spike-clamped',
      advanceBaseline: false,
      resetEvent: false,
      thresholdKwh,
    };
  }

  return {
    energy: rawDelta,
    reason: 'ok',
    advanceBaseline: true,
    resetEvent: false,
    thresholdKwh,
  };
};

const buildBaseQuery = () => {
  const query = {};

  if (DEVICE_ID) {
    query.deviceId = DEVICE_ID;
  }

  return query;
};

const buildReadingsPipeline = (query, projection = {}) => {
  const pipeline = [
    { $match: query },
    {
      $addFields: {
        migrationTimestamp: {
          $ifNull: ['$timestamp', { $toDate: '$_id' }],
        },
        migrationMissingTimestamp: {
          $not: [{ $ifNull: ['$timestamp', false] }],
        },
      },
    },
  ];

  if (FROM_DATE || TO_DATE) {
    pipeline.push({
      $match: {
        migrationTimestamp: {
          ...(FROM_DATE ? { $gte: new Date(FROM_DATE) } : {}),
          ...(TO_DATE ? { $lte: new Date(TO_DATE) } : {}),
        },
      },
    });
  }

  pipeline.push(
    { $sort: { deviceId: 1, migrationTimestamp: 1, _id: 1, energy: 1 } },
    {
      $project: {
        deviceId: 1,
        timestamp: 1,
        ...projection,
        migrationTimestamp: 1,
        migrationMissingTimestamp: 1,
      },
    },
  );

  return pipeline;
};

const formatNumber = value => Number(value || 0).toFixed(6);

const printHeader = () => {
  console.log('Ecoplugify Reading Energy Delta Migration');
  console.log(`Mode: ${DRY_RUN ? 'dry-run' : APPLY ? 'apply' : 'rollback'}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Global max interval delta: ${MAX_DELTA_KWH} kWh`);
  console.log(`Default max device power: ${DEFAULT_MAX_POWER_WATTS} W`);
  console.log(`Spike safety multiplier: ${SPIKE_SAFETY_MULTIPLIER}`);
  console.log(`Minimum interval seconds: ${MIN_TIME_DIFF_SECONDS}`);
  console.log(`Batch pause: ${BATCH_PAUSE_MS}ms`);
  if (BATCH_ID) console.log(`Batch id: ${BATCH_ID}`);
  if (DEVICE_ID) console.log(`Device filter: ${DEVICE_ID}`);
  if (FROM_DATE) console.log(`From: ${FROM_DATE}`);
  if (TO_DATE) console.log(`To: ${TO_DATE}`);
  console.log('');
};

const flushBulk = async (collection, bulkOps, stats) => {
  if (!bulkOps.length) return;

  if (!DRY_RUN) {
    const result = await collection.bulkWrite(bulkOps, { ordered: false });
    stats.bulkMatched += result.matchedCount || 0;
    stats.bulkModified += result.modifiedCount || 0;
  }

  bulkOps.length = 0;
  if (BATCH_PAUSE_MS > 0) {
    await sleep(BATCH_PAUSE_MS);
  }
};

const migrate = async (collection, devicePowerMap) => {
  const stats = {
    scanned: 0,
    legacy: 0,
    skippedModern: 0,
    missingTimestampFallbacks: 0,
    updated: 0,
    ok: 0,
    initialBaseline: 0,
    duplicates: 0,
    resets: 0,
    reboots: 0,
    counterDecreases: 0,
    tooFastSampling: 0,
    spikes: 0,
    invalid: 0,
    originalEnergyTotal: 0,
    migratedEnergyTotal: 0,
    bulkMatched: 0,
    bulkModified: 0,
  };

  let currentDeviceId = null;
  let previousSnapshot = null;
  let previousTimestamp = null;
  const bulkOps = [];

  const cursor = collection
    .aggregate(buildReadingsPipeline(buildBaseQuery(), {
        deviceId: 1,
        userId: 1,
        timestamp: 1,
        energy: 1,
        power: 1,
        totalEnergy: 1,
        cumulativeEnergy: 1,
        energyMigration: 1,
      }), { allowDiskUse: true })
    .batchSize(BATCH_SIZE);

  for await (const doc of cursor) {
    stats.scanned += 1;
    const effectiveTimestamp = getEffectiveTimestamp(doc);
    if (doc.migrationMissingTimestamp) {
      stats.missingTimestampFallbacks += 1;
    }

    if (doc.deviceId !== currentDeviceId) {
      currentDeviceId = doc.deviceId;
      previousSnapshot = null;
      previousTimestamp = null;
    }

    const snapshot = getSnapshot(doc);
    const legacy = isLegacyReading(doc);

    if (!legacy) {
      stats.skippedModern += 1;
      if (snapshot !== null) {
        previousSnapshot = snapshot;
        previousTimestamp = effectiveTimestamp;
      }
    } else {
      stats.legacy += 1;
      const originalEnergy = toFiniteNumber(doc.energy, 0);
      const interval = getInterval({
        deviceId: doc.deviceId,
        snapshot,
        previousSnapshot,
        previousTimestamp,
        currentTimestamp: effectiveTimestamp,
        devicePowerMap,
      });
      stats.originalEnergyTotal += originalEnergy;
      stats.migratedEnergyTotal += interval.energy;

      if (interval.reason === 'ok') stats.ok += 1;
      if (interval.reason === 'initial-baseline') stats.initialBaseline += 1;
      if (interval.reason === 'duplicate-packet') stats.duplicates += 1;
      if (interval.reason === 'esp32_reboot') stats.reboots += 1;
      if (interval.reason === 'counter-decrease') stats.counterDecreases += 1;
      if (interval.reason === 'too-fast-sampling') stats.tooFastSampling += 1;
      if (interval.resetEvent) stats.resets += 1;
      if (interval.reason === 'spike-clamped') stats.spikes += 1;
      if (interval.reason === 'invalid-snapshot') stats.invalid += 1;

      stats.updated += 1;

      bulkOps.push({
        updateOne: {
          filter: {
            _id: doc._id,
            'energyMigration.v1.applied': { $ne: true },
          },
          update: {
            $set: {
              energy: interval.energy,
              totalEnergy: snapshot || 0,
              cumulativeEnergy: snapshot || 0,
              'energyMigration.v1': {
                version: MIGRATION_VERSION,
                batchId: BATCH_ID || 'dry-run',
                applied: true,
                appliedAt: new Date(),
                originalEnergy,
                originalTotalEnergy: hasOwn(doc, 'totalEnergy') ? doc.totalEnergy : null,
                originalCumulativeEnergy: hasOwn(doc, 'cumulativeEnergy')
                  ? doc.cumulativeEnergy
                  : null,
                hadTotalEnergy: hasOwn(doc, 'totalEnergy'),
                hadCumulativeEnergy: hasOwn(doc, 'cumulativeEnergy'),
                previousTotalEnergy: previousSnapshot,
                previousTimestamp,
                effectiveTimestamp,
                missingTimestampFallback: Boolean(doc.migrationMissingTimestamp),
                thresholdKwh: interval.thresholdKwh,
                resetEvent: interval.resetEvent,
                reason: interval.reason,
              },
            },
          },
        },
      });

      if (interval.advanceBaseline && snapshot !== null) {
        previousSnapshot = snapshot;
        previousTimestamp = effectiveTimestamp;
      }
    }

    if (bulkOps.length >= BATCH_SIZE) {
      await flushBulk(collection, bulkOps, stats);
    }

    if (stats.scanned % PROGRESS_EVERY === 0) {
      console.log(
        `Progress scanned=${stats.scanned} legacy=${stats.legacy} ` +
          `updated=${stats.updated} duplicates=${stats.duplicates} ` +
          `resets=${stats.resets} spikes=${stats.spikes}`,
      );
    }
  }

  await flushBulk(collection, bulkOps, stats);
  return stats;
};

const rollback = async collection => {
  const stats = {
    scanned: 0,
    restored: 0,
    bulkMatched: 0,
    bulkModified: 0,
  };

  const query = {
    ...buildBaseQuery(),
    'energyMigration.v1.applied': true,
    'energyMigration.v1.version': MIGRATION_VERSION,
    'energyMigration.v1.batchId': BATCH_ID,
  };

  const cursor = collection
    .aggregate(buildReadingsPipeline(query, {
        energyMigration: 1,
      }), { allowDiskUse: true })
    .batchSize(BATCH_SIZE);

  const bulkOps = [];

  for await (const doc of cursor) {
    stats.scanned += 1;
    const migration = doc.energyMigration?.v1;

    if (!migration) continue;

    const $set = {
      energy: toFiniteNumber(migration.originalEnergy, 0),
    };
    const $unset = {
      'energyMigration.v1': '',
    };

    if (migration.hadTotalEnergy) {
      $set.totalEnergy = migration.originalTotalEnergy;
    } else {
      $unset.totalEnergy = '';
    }

    if (migration.hadCumulativeEnergy) {
      $set.cumulativeEnergy = migration.originalCumulativeEnergy;
    } else {
      $unset.cumulativeEnergy = '';
    }

    bulkOps.push({
      updateOne: {
        filter: {
          _id: doc._id,
          'energyMigration.v1.version': MIGRATION_VERSION,
        },
        update: { $set, $unset },
      },
    });
    stats.restored += 1;

    if (bulkOps.length >= BATCH_SIZE) {
      await flushBulk(collection, bulkOps, stats);
    }

    if (stats.scanned % PROGRESS_EVERY === 0) {
      console.log(`Rollback progress scanned=${stats.scanned} restored=${stats.restored}`);
    }
  }

  await flushBulk(collection, bulkOps, stats);
  return stats;
};

const printSummary = stats => {
  console.log('');
  console.log('Summary');
  Object.entries(stats).forEach(([key, value]) => {
    console.log(`${key}: ${typeof value === 'number' ? formatNumber(value) : value}`);
  });

  if (DRY_RUN) {
    console.log('');
    console.log('Dry-run only. No MongoDB documents were modified.');
    console.log('Run again with --apply to write the migration.');
  }
};

const main = async () => {
  printHeader();

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    socketTimeoutMS: 120000,
    serverSelectionTimeoutMS: 10000,
    retryWrites: true,
    w: 'majority',
  });

  const collection = mongoose.connection.collection('readings');
  const devicePowerMap = await loadDevicePowerMap(mongoose.connection.db);

  if (ENSURE_INDEX && !DRY_RUN) {
    console.log('Ensuring migration sort index...');
    await collection.createIndex(
      { deviceId: 1, timestamp: 1, _id: 1 },
      { name: 'device_timestamp_id_migration_idx', background: true },
    );
  }

  const stats = ROLLBACK
    ? await rollback(collection)
    : await migrate(collection, devicePowerMap);

  printSummary(stats);
  await mongoose.disconnect();
};

main().catch(async error => {
  console.error('Migration failed:', error);
  try {
    await mongoose.disconnect();
  } catch {
    // Ignore disconnect failures during process exit.
  }
  process.exit(1);
});
