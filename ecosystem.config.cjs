// ecosystem.config.cjs - for PM2 production deployment
module.exports = {
    apps: [{
        name: 'nimegami',
        script: 'backend/server.js',
        cwd: process.cwd(),
        instances: 1, // karena SQLite tidak support multi-process write
        exec_mode: 'fork',
        watch: false,
        env: {
            NODE_ENV: 'production',
            PORT: 3000
        },
        error_file: './logs/pm2-error.log',
        out_file: './logs/pm2-out.log',
        log_file: './logs/pm2-combined.log',
        time: true,
        max_memory_restart: '512M',
        node_args: '--max-old-space-size=512'
    }]
};