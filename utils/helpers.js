import { v4 as uuidv4 } from 'uuid';

export const generateId = () => {
  return uuidv4();
};

export const getStartOfDay = (date = new Date()) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
};

export const getEndOfDay = (date = new Date()) => {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
};

export const calculateCost = (energyKwh, rate) => {
  return energyKwh * rate;
};

export const calculateEnergy = (power, duration) => {
  // power in watts, duration in hours
  return (power * duration) / 1000; // returns Wh
};

export const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

export const validateMQTTTopic = (topic) => {
  return typeof topic === 'string' && topic.length > 0;
};

export default {
  generateId,
  getStartOfDay,
  getEndOfDay,
  calculateCost,
  calculateEnergy,
  validateEmail,
  validateMQTTTopic,
};
