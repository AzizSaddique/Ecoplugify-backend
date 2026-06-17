// Backward-compatible entrypoint.
// The production energy aggregation logic lives in energyWorker.js so there is
// only one delta-energy implementation to maintain.
export { startEnergyWorker, default } from './energyWorker.js';
