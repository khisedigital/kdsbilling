require('dotenv').config();

const app = require('./src/app');
const config = require('./src/config');
const { getMasterSequelize } = require('./src/config/masterDatabase');
const { initMasterModels } = require('./src/models/master');

async function start() {
  try {
    const masterSequelize = getMasterSequelize();
    await masterSequelize.authenticate();
    initMasterModels(masterSequelize);
    console.log('Master database connected');

    const server = app.listen(config.port, () => {
      const pub = config.publicBasePath || '';
      console.log(`API running on http://localhost:${config.port}`);
      console.log(`Health: http://localhost:${config.port}/health`);
      console.log(`Admin:  http://localhost:${config.port}/admin`);
      if (pub) {
        console.log(`Public: https://khisedigital.info${pub}/admin`);
      }
      require('./src/services/shopify/worker').start();
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${config.port} is already in use.`);
        console.error('Run: npm run free:port   then try again.');
        process.exit(1);
      }
      throw err;
    });
  } catch (err) {
    const detail = err.message
      || err.parent?.message
      || err.original?.message
      || err.code
      || err.name
      || String(err);
    console.error('Failed to start server:', detail);
    if (err.code === 'ECONNREFUSED' || err.name === 'SequelizeConnectionRefusedError') {
      console.error('MySQL is not running on', process.env.MASTER_DB_HOST || 'localhost', process.env.MASTER_DB_PORT || 3306);
      console.error('Start MySQL (XAMPP → Start MySQL), then run: npm run migrate:master && npm run dev');
    }
    process.exit(1);
  }
}

start();
