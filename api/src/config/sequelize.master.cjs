const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const config = require('./index');

const shared = {
  username: config.masterDb.username,
  password: config.masterDb.password,
  database: config.masterDb.database,
  host: config.masterDb.host,
  port: config.masterDb.port,
  dialect: 'mysql',
  logging: console.log,
};

// sequelize-cli picks the key matching NODE_ENV
module.exports = {
  development: shared,
  production: { ...shared, logging: false },
  test: shared,
};
