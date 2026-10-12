'use strict';

const discovery = require('./discovery.service');
const wizService = require('./wiz.service');
const logger = require('../utils/logger');

async function discoverDevicesWithDetails() {
  logger.info('[Device Discovery] Starting device discovery...');

  const discoveredDevices = await discovery.discoverDevices();

  const results = await Promise.all(
    discoveredDevices.map(async (device) => {
      try {
        const details = await wizService.getDeviceInfo(device.ip);

        return {
          ...device,
          ...details,
          ip: device.ip,
          mac: device.mac,
          success: details.success === true
        };
      } catch (error) {
        logger.warn(
          `[Device Discovery] Device information request failed | ip=${device.ip} | reason=${error.message}`
        );

        return {
          ...device,
          success: false,
          errors: [error.message]
        };
      }
    })
  );

  const successfulCount = results.filter(
    (device) => device.success
  ).length;

  logger.info(
    `[Device Discovery] Discovery completed | discovered=${results.length} | successful=${successfulCount} | failed=${results.length - successfulCount}`
  );

  return results;
}

module.exports = {
  discoverDevicesWithDetails
};