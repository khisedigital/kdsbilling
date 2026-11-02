const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { getMasterSequelize } = require('../config/masterDatabase');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations/tenant');
const SEEDERS_DIR = path.join(__dirname, '../seeders/tenant');

function listJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .sort();
}

function createTenantSequelize(dbName) {
  return new Sequelize(dbName, config.tenantDb.username, config.tenantDb.password, {
    host: config.tenantDb.host,
    port: config.tenantDb.port,
    dialect: 'mysql',
    logging: false,
    define: {
      underscored: true,
      timestamps: true,
    },
  });
}

function privilegeHelp(dbName) {
  const user = config.tenantDb.username;
  const prefix = config.tenantDb.prefix || `${user}_`;
  return [
    `MySQL user "${user}" cannot use database "${dbName}".`,
    'On the server, run as MySQL root/admin:',
    `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${user}'@'localhost';`,
    `GRANT ALL PRIVILEGES ON \`${prefix}%\`.* TO '${user}'@'localhost';`,
    'FLUSH PRIVILEGES;',
    `Also set TENANT_DB_PREFIX=${prefix} in api/.env so new shop DBs use that prefix.`,
  ].join(' ');
}

function wrapPrivilegeError(err, dbName) {
  const msg = err.message || String(err);
  if (/denied|ER_DBACCESS|ER_TABLEACCESS|ER_SPECIFIC_ACCESS/i.test(msg)) {
    return new Error(`${privilegeHelp(dbName)} Original error: ${msg}`);
  }
  return err;
}

async function ensureMasterMigrationTable() {
  const sequelize = getMasterSequelize();
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS tenant_db_migrations (
      id CHAR(36) NOT NULL,
      db_name VARCHAR(100) NOT NULL,
      kind VARCHAR(20) NOT NULL,
      name VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_tenant_db_migration (db_name, kind, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function getAppliedNames(dbName, kind) {
  const sequelize = getMasterSequelize();
  await ensureMasterMigrationTable();
  const [rows] = await sequelize.query(
    'SELECT name FROM tenant_db_migrations WHERE db_name = ? AND kind = ?',
    { replacements: [dbName, kind] }
  );
  return new Set(rows.map((row) => row.name));
}

async function markApplied(dbName, kind, name) {
  const sequelize = getMasterSequelize();
  await sequelize.query(
    `INSERT INTO tenant_db_migrations (id, db_name, kind, name, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE created_at = VALUES(created_at)`,
    { replacements: [uuidv4(), dbName, kind, name, new Date()] }
  );
}

async function assertTenantDbWritable(dbName) {
  const sequelize = createTenantSequelize(dbName);
  try {
    await sequelize.authenticate();
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS _billing_pos_write_check (
        id INT PRIMARY KEY
      ) ENGINE=InnoDB
    `);
    await sequelize.query('DROP TABLE IF EXISTS _billing_pos_write_check');
  } catch (err) {
    throw wrapPrivilegeError(err, dbName);
  } finally {
    await sequelize.close();
  }
}

async function runTenantMigrations(dbName) {
  await assertTenantDbWritable(dbName);
  const sequelize = createTenantSequelize(dbName);
  const queryInterface = sequelize.getQueryInterface();

  try {
    await sequelize.authenticate();
    const applied = await getAppliedNames(dbName, 'migration');

    for (const file of listJsFiles(MIGRATIONS_DIR)) {
      if (applied.has(file)) continue;
      const migration = require(path.join(MIGRATIONS_DIR, file));
      if (typeof migration.up !== 'function') {
        throw new Error(`Migration ${file} has no up()`);
      }
      try {
        await migration.up(queryInterface, Sequelize);
      } catch (err) {
        throw wrapPrivilegeError(err, dbName);
      }
      await markApplied(dbName, 'migration', file);
    }
  } finally {
    await sequelize.close();
  }
}

async function runTenantSeeders(dbName) {
  const sequelize = createTenantSequelize(dbName);
  const queryInterface = sequelize.getQueryInterface();

  try {
    await sequelize.authenticate();
    const applied = await getAppliedNames(dbName, 'seeder');

    for (const file of listJsFiles(SEEDERS_DIR)) {
      if (applied.has(file)) continue;
      const seeder = require(path.join(SEEDERS_DIR, file));
      if (typeof seeder.up !== 'function') {
        throw new Error(`Seeder ${file} has no up()`);
      }
      try {
        await seeder.up(queryInterface, Sequelize);
      } catch (err) {
        throw wrapPrivilegeError(err, dbName);
      }
      await markApplied(dbName, 'seeder', file);
    }
  } finally {
    await sequelize.close();
  }
}

async function setupTenantDatabase(dbName) {
  await runTenantMigrations(dbName);
  await runTenantSeeders(dbName);
}

module.exports = {
  setupTenantDatabase,
  runTenantMigrations,
  runTenantSeeders,
  assertTenantDbWritable,
};
