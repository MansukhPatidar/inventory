/**
 * PM2 process definitions for this repo.
 *
 * fetch-parts: downloads the `parts` table from Supabase into data/part.json
 * every day at 03:00 local time, overwriting the previous file.
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save                       # persist across reboots
 */
const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "inventory-fetch-parts",
      script: "scripts/fetch-parts.mjs",
      interpreter: "node",
      cwd: __dirname,
      cron_restart: "0 3 * * *",
      autorestart: false,
      out_file: path.join(__dirname, "logs/fetch-parts.out.log"),
      error_file: path.join(__dirname, "logs/fetch-parts.err.log"),
      time: true,
    },
  ],
};
