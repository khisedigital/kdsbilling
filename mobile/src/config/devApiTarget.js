/**
 * Shared by the app (src/config/env.ts) and the webpack dev-server proxy.
 * true  = debug builds talk to the live server
 * false = debug builds talk to the local API on port 3000
 */
const USE_PRODUCTION_API_IN_DEV = true;
const PRODUCTION_API_ORIGIN = 'https://khisedigital.info/kdspozr';

module.exports = {
  USE_PRODUCTION_API_IN_DEV,
  PRODUCTION_API_ORIGIN,
  devServerProxyTarget: USE_PRODUCTION_API_IN_DEV
    ? PRODUCTION_API_ORIGIN
    : 'http://127.0.0.1:3000',
};
