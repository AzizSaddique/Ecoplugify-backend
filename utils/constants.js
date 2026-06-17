export const DEVICE_CATEGORIES = {
  LIGHTING: 'lighting',
  APPLIANCE: 'appliance',
  HVAC: 'hvac',
  OTHER: 'other',
};

export const RELAY_STATES = {
  ON: 'ON',
  OFF: 'OFF',
};

export const SCHEDULE_ACTIONS = {
  ON: 'ON',
  OFF: 'OFF',
};

export const SCHEDULE_MODES = {
  ONCE: 'once',
  DAILY: 'daily',
  CUSTOM: 'custom',
};

export const DAYS_OF_WEEK = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

export const MQTT_TOPICS = {
  READINGS: (deviceId) => `ecoplugify/v1/${deviceId}/readings`,
  RELAY: (deviceId) => `ecoplugify/v1/${deviceId}/relay`,
};

export const EVENT_TYPES = {
  ENERGY_UPDATE: 'energy:update',
  DEVICE_UPDATE: 'device:update',
  SCHEDULE_TRIGGER: 'schedule:trigger',
};

export const QUEUE_NAMES = {
  ENERGY_PROCESSING: 'energy-processing',
  SCHEDULE_EXECUTION: 'schedule-execution',
  DAILY_AGGREGATION: 'daily-aggregation',
};

export const REDIS_KEYS = {
  DEVICE_LATEST: (deviceId) => `device:${deviceId}:latest`,
  USER_RATE: (userId) => `user:${userId}:rate`,
  DEVICE_STATE: (deviceId) => `device:${deviceId}:state`,
};

export const ERROR_MESSAGES = {
  DEVICE_NOT_FOUND: 'Device not found',
  DEVICE_ALREADY_LINKED: 'Device already linked to another user',
  UNAUTHORIZED: 'Unauthorized access',
  INVALID_TOKEN: 'Invalid or expired token',
  RATE_LIMIT_EXCEEDED: 'Too many requests',
  MQTT_ERROR: 'MQTT publish failed',
  DATABASE_ERROR: 'Database operation failed',
};

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export const CACHE_TTL = {
  DEVICE_LATEST: 300, // 5 minutes
  USER_RATE: 365 * 24 * 60 * 60, // 1 year
  DEVICE_STATE: 3600, // 1 hour
};

export const DATA_RETENTION = {
  READINGS_DAYS: 90,
  SUMMARIES_DAYS: 365,
};

export default {
  DEVICE_CATEGORIES,
  RELAY_STATES,
  SCHEDULE_ACTIONS,
  SCHEDULE_MODES,
  DAYS_OF_WEEK,
  MQTT_TOPICS,
  EVENT_TYPES,
  QUEUE_NAMES,
  REDIS_KEYS,
  ERROR_MESSAGES,
  HTTP_STATUS,
  CACHE_TTL,
  DATA_RETENTION,
};
