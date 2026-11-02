#!/usr/bin/env node
require('dotenv').config();

const { Sequelize } = require('sequelize');
const config = require('../src/config');

async function main() {
  const { host, port, username, password, database } = config.masterDb;

  const sequelize = new Sequelize('', username, password, {
    host,
    port,
    dialect: 'mysql',
    logging: false,
  });

  await sequelize.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
  );

  console.log(`Database "${database}" is ready.`);
  await sequelize.close();
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
