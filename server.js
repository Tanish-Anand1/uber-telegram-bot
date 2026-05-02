const express = require('express');
const axios = require('axios');
const { getUserIdFromState, exchangeCodeForToken, getUserProfile } = require('./auth');
const { getOrCreateSession, updateSession } = require('./sessions');

function startCallbackServer(bot) {
  const app = express();
  app.use(express.json());

  // ── Telegram webhook endpoint ─────────────────────────────────────────────
  const WEBHOOK_PATH = `/webhook/${process.env.TELEGRAM_BOT_TOKEN}`;

  app.post(WEBHOOK_PATH, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  // ── Uber OAuth callback ───────────────────────────────────────────────────
  app.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      return res.send(htmlPage('Login Cancelled', '❌', 'You cancelled the login. Return to Telegram and use /start to try again.'));
    }

    if (!code || !state) {
      return res.status(400).send(htmlPage('Bad Request', '⚠️', 'Invalid request. Use /start in Telegram to try again.'));
    }

    const userId = getUserIdFromState(state);
    if (!userId) {
      return res.send(htmlPage('Link Expired', '⏱️', 'This login link expired (10 min limit). Use /start to get a new one.'));
    }

    try {
      const tokenResult = await exchangeCodeForToken(code);

      if (!tokenResult.success) {
        return res.send(htmlPage('Login Failed', '❌', `${tokenResult.error}. Please try /start again.`));
      }

      const profile = await getUserProfile(tokenResult.token);

      const session = getOrCreateSession(userId);
      session.isAuthenticated = true;
      session.authToken = tokenResult.token;
      session.refreshToken = tokenResult.refreshToken;
      session.authStep = null;
      session.userProfile = profile;
      updateSession(userId, session);

      console.log(`[CALLBACK] ✅ User ${userId} (${profile.name}) authenticated`);

      bot.sendMessage(
        userId,
        `🎉 *Login Successful!*\n\n` +
        `👤 Welcome, *${profile.name}*!\n` +
        `📧 ${profile.email}\n\n` +
        `✅ Uber account connected.\n` +
        `Ready to book rides worldwide! 🌍\n\n` +
        `👇 Choose an option:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🚕 Book a Ride', callback_data: 'book_ride' },
                { text: '🔄 Recent Rides', callback_data: 'recent_rides' }
              ],
              [
                { text: '📍 Saved Locations', callback_data: 'saved_locations' },
                { text: '📴 Logout', callback_data: 'logout' }
              ]
            ]
          }
        }
      );

      return res.send(htmlPage('Login Successful', '✅', `Welcome, ${profile.name}! You can close this window and return to Telegram.`));

    } catch (err) {
      console.error('[CALLBACK] Error:', err);
      return res.send(htmlPage('Error', '❌', 'Something went wrong. Please try /start again in Telegram.'));
    }
  });

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  app.get('/', (req, res) => res.send(htmlPage('Uber Telegram Bot', '🚕', 'Bot is running. Open Telegram to use it.')));

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, async () => {
    console.log(`🌐 Server running on port ${PORT}`);

    // Determine public base URL (Railway auto-sets RAILWAY_PUBLIC_DOMAIN)
    const baseUrl = process.env.WEBHOOK_URL ||
      (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);

    if (baseUrl) {
      // Ensure REDIRECT_URI is always the Railway URL, not localhost
      if (!process.env.REDIRECT_URI || process.env.REDIRECT_URI.includes('localhost')) {
        process.env.REDIRECT_URI = `${baseUrl}/callback`;
      }

      const webhookUrl = `${baseUrl}/webhook/${process.env.TELEGRAM_BOT_TOKEN}`;
      try {
        // Clear any old webhook first, then set the stable one
        await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/deleteWebhook`, { drop_pending_updates: false });
        const res = await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
          url: webhookUrl,
          allowed_updates: ['message', 'callback_query', 'inline_query']
        });
        if (res.data?.ok) {
          console.log(`✅ Telegram webhook set: ${webhookUrl}`);
        } else {
          console.warn(`⚠️  Webhook response: ${JSON.stringify(res.data)}`);
        }
      } catch (err) {
        console.error(`❌ Webhook registration failed: ${err.message}`);
      }

      console.log(`📎 Redirect URI: ${process.env.REDIRECT_URI}`);
      console.log(`══════════════════════════════════════════════════`);
      console.log(`🌍 BOT IS LIVE GLOBALLY`);
      console.log(`🔗 Public URL:   ${baseUrl}`);
      console.log(`⚠️  Set this in Uber Portal → Redirect URIs:`);
      console.log(`    ${process.env.REDIRECT_URI}`);
      console.log(`══════════════════════════════════════════════════`);
    } else {
      console.log('📡 No public domain set — running in polling mode (local dev)');
      console.log(`📎 Redirect URI: ${process.env.REDIRECT_URI}`);
    }
  });

  return { webhookPath: WEBHOOK_PATH };
}

function htmlPage(title, icon, message) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Uber Bot</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
    .card { background: white; border-radius: 20px; padding: 48px 40px; text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.15); max-width: 420px; width: 90%; }
    .icon { font-size: 64px; margin-bottom: 20px; line-height: 1; }
    h1 { font-size: 26px; color: #1a1a1a; margin: 0 0 14px; font-weight: 700; }
    p { color: #666; line-height: 1.6; margin: 0; font-size: 15px; }
    .brand { margin-top: 28px; font-size: 13px; color: #aaa; }
    .brand strong { color: #000; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="brand">Powered by <strong>Uber Bot</strong> for Telegram 🌍</p>
  </div>
</body>
</html>`;
}

module.exports = startCallbackServer;
