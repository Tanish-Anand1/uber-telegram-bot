require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const credPath = path.join(__dirname, 'google-credentials.json');
  fs.writeFileSync(credPath, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
}

const PORT  = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// ─── SSH tunnel to serveo.net (no packages, no signup) ───────────────────────
function startSSHTunnel(port) {
  return new Promise((resolve, reject) => {
    console.log('🚇 Starting SSH tunnel via serveo.net...');

    const proc = spawn('ssh', [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ConnectTimeout=15',
      '-R', `80:localhost:${port}`,
      'serveo.net'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const onData = (data) => {
      const text = data.toString();
      process.stdout.write(text);
      const match = text.match(/Forwarding HTTP traffic from (https?:\/\/\S+)/);
      if (match) resolve({ url: match[1].trim(), proc });
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('error', (err) => reject(new Error(`SSH error: ${err.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`SSH closed with code ${code}`));
    });

    setTimeout(() => reject(new Error('SSH tunnel timed out after 20s')), 20000);
  });
}

async function start() {
  // Set tunnel mode so index.js uses webhook instead of polling
  process.env.IS_TUNNEL = 'true';

  // Start Express + bot first
  require('./index.js');
  await new Promise(r => setTimeout(r, 1500));

  console.log('🚇 Starting tunnel via localtunnel...');
  
  try {
    const localtunnel = require('localtunnel');
    const tunnel = await localtunnel({ port: PORT });

    const url = tunnel.url;
    process.env.WEBHOOK_URL = url;
    // Do NOT override REDIRECT_URI with the ephemeral tunnel URL — it changes every
    // restart and cannot be registered in Uber portal. Keep the fixed localhost URI
    // from .env (http://localhost:3000/callback) which the browser hits directly.

    // Register webhook with Telegram
    await axios.get(`https://api.telegram.org/bot${TOKEN}/deleteWebhook`).catch(() => {});
    const wh = await axios.post(`https://api.telegram.org/bot${TOKEN}/setWebhook`, {
      url: `${url}/webhook/${TOKEN}`
    });
    const whOk = wh.data?.ok ? '✅' : '⚠️';

    const redirectUri = process.env.REDIRECT_URI || 'http://localhost:3000/callback';
    console.log('');
    console.log('══════════════════════════════════════════════════════');
    console.log('🌍 BOT IS LIVE GLOBALLY!');
    console.log(`🔗 Public URL:   ${url}`);
    console.log(`📎 Redirect URI: ${redirectUri}`);
    console.log(`${whOk} Telegram webhook: ${wh.data?.description || 'set'}`);
    console.log('');
    console.log('✅ Uber Portal → Redirect URIs must include:');
    console.log(`    ${redirectUri}`);
    console.log('══════════════════════════════════════════════════════');

    tunnel.on('close', () => {
      console.log('\n⚠️  Tunnel closed. Restart with npm start.');
    });

  } catch (err) {
    console.log(`\n❌ Tunnel failed: ${err.message}`);
    console.log('⚡ Falling back to LOCAL POLLING mode...');
    
    process.env.IS_TUNNEL = '';

    try {
      const bot = global._uberBot;
      if (bot) {
        await bot.stopPolling().catch(() => {});
        await bot.startPolling();
        console.log('✅ Polling started successfully.');
      }
    } catch (pollErr) {
      console.error('❌ Failed to start polling:', pollErr.message);
    }
  }
}

start();
