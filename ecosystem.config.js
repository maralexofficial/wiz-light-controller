module.exports = {
  apps: [
    {
      name: 'wiz-light-controller',
      script: './src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '150M',
      time: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};