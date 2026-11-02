module.exports = {
  apps: [
    {
      name: 'billing-api',
      script: 'server.js',
      cwd: './api',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      error_file: '../logs/api-error.log',
      out_file: '../logs/api-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
