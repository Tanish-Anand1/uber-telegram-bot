require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Write Google credentials from env var (Railway / cloud deployment)
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const credPath = path.join(__dirname, 'google-credentials.json');
  fs.writeFileSync(credPath, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
}

const TelegramBot = require('node-telegram-bot-api');
const { getOrCreateSession, getSession, updateSession } = require('./sessions');
const { generateAuthURL } = require('./auth');
const { convertVoiceToText } = require('./speech-to-text');
const { startRideBooking } = require('./ride-manager');
const { getAddressFromCoords } = require('./location-manager');
const { generateMainMenu, generateRideOptions } = require('./ui-generator');
const setupCallbackHandlers = require('./callback-handlers');
const startCallbackServer = require('./server');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN not set in .env');
  process.exit(1);
}

// Webhook mode on Railway or when WEBHOOK_URL is set; polling otherwise
const IS_WEBHOOK = !!process.env.WEBHOOK_URL ||
                   !!process.env.RAILWAY_PUBLIC_DOMAIN ||
                   process.env.IS_TUNNEL === 'true';
const bot = IS_WEBHOOK
  ? new TelegramBot(TOKEN, { webHook: false })
  : new TelegramBot(TOKEN, { polling: { autoStart: true, params: { timeout: 10 } } });

module.exports = { bot, TOKEN };

// Expose bot globally so start-ngrok.js can switch modes if tunnel fails
global._uberBot = bot;

// Start Express server (OAuth callback + webhook endpoint)
startCallbackServer(bot);

// Setup inline button handlers
setupCallbackHandlers(bot);

// ─── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const { chat: { id: chatId }, from: { id: userId, first_name: firstName } } = msg;
  const userName = firstName || 'User';

  try {
    const session = getSession(userId);

    if (session?.isAuthenticated) {
      return bot.sendMessage(chatId, generateMainMenu(userName), {
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
      });
    }

    // Generate OAuth login URL with this user's state
    const loginUrl = generateAuthURL(userId);

    getOrCreateSession(userId);

    bot.sendMessage(
      chatId,
      `🚕 *Welcome to Uber Telegram Bot!*\n\n` +
      `📱 Book cabs directly from Telegram\n` +
      `🌍 Works worldwide in 50+ countries\n` +
      `🎙️ Text or voice commands supported\n\n` +
      `─────────────────────\n` +
      `🔐 *Step 1: Connect your Uber account*\n\n` +
      `Tap the button below to login with Uber.\n` +
      `You'll be redirected to Uber's login page.\n\n` +
      `_Link expires in 10 minutes._`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔐 Login with Uber', url: loginUrl }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('[START] Error:', error);
    bot.sendMessage(chatId, '❌ Something went wrong. Please try again.');
  }
});

// ─── /help ────────────────────────────────────────────────────────────────────
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `🚕 *Uber Bot Help*\n\n` +
    `*Commands:*\n` +
    `/start — Login or open main menu\n` +
    `/help — Show this help\n\n` +
    `*How to book:*\n` +
    `• Type: "Book uber to airport"\n` +
    `• Type: "I need a cab to office"\n` +
    `• Send a 🎙️ voice message\n` +
    `• Share your 📍 GPS location first\n\n` +
    `*Tip:* Include a city name for better results.\n` +
    `Example: "Book uber to IGI Airport Delhi"`,
    { parse_mode: 'Markdown' }
  );
});

// ─── Text messages ────────────────────────────────────────────────────────────
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();
  console.log(`[MESSAGE] Received from ${userId}: "${text}"`);

  try {
    const session = getSession(userId);

    if (!session?.isAuthenticated) {
      const loginUrl = generateAuthURL(userId);
      return bot.sendMessage(
        chatId,
        `🔐 You need to login first.\n\nTap below to connect your Uber account:`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: '🔐 Login with Uber', url: loginUrl }]]
          }
        }
      );
    }

    // ── Ride booking by text ────────────────────────────────────────────────
    const lower = text.toLowerCase();
    const rideKeywords = ['book', 'uber', 'cab', 'ride', 'taxi', 'need a', 'go to', 'take me', 'drop'];
    const isRideRequest = rideKeywords.some(kw => lower.includes(kw));

    if (isRideRequest) {
      const destination = extractDestination(text);

      if (!destination) {
        return bot.sendMessage(
          chatId,
          `📍 *Where do you want to go?*\n\nExample:\n"Book uber to *airport*"\n"Cab to *Central Station*"`,
          { parse_mode: 'Markdown' }
        );
      }

      bot.sendChatAction(chatId, 'typing');

      const booking = await startRideBooking(session, destination, bot, chatId, userId);

      if (!booking.success) {
        return bot.sendMessage(
          chatId,
          `❌ ${booking.error}\n\nTry adding the city: _"${destination} Delhi"_`,
          { parse_mode: 'Markdown' }
        );
      }

      const rideButtons = booking.rides.map(ride => ([{
        text: `${ride.name} — ${ride.price} (${ride.eta} min)`,
        callback_data: `select_ride_${ride.type}_${booking.destination.latitude}_${booking.destination.longitude}`
      }]));

      bot.sendMessage(
        chatId,
        generateRideOptions(booking.rides, booking.pickup.address, booking.destination.address),
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: rideButtons }
        }
      );

    } else {
      bot.sendMessage(
        chatId,
        `💡 *What would you like to do?*\n\n` +
        `Try:\n` +
        `• "Book uber to *airport*"\n` +
        `• "Cab to *office*"\n` +
        `• "Ride to *Central Station*"\n\n` +
        `Or send a 🎙️ voice message, or use /start for menu`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('[MESSAGE] Error:', error);
    bot.sendMessage(chatId, '❌ Something went wrong. Please try again.');
  }
});

// ─── Voice messages ───────────────────────────────────────────────────────────
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const session = getSession(userId);

  if (!session?.isAuthenticated) {
    const loginUrl = generateAuthURL(userId);
    return bot.sendMessage(chatId, '🔐 Please login first:', {
      reply_markup: { inline_keyboard: [[{ text: '🔐 Login with Uber', url: loginUrl }]] }
    });
  }

  try {
    bot.sendChatAction(chatId, 'typing');

    const fileLink = await bot.getFileLink(msg.voice.file_id);
    const transcript = await convertVoiceToText(fileLink);

    if (!transcript) {
      return bot.sendMessage(
        chatId,
        `❌ *Could not understand the voice message.*\n\nPlease speak clearly or type your destination.`,
        { parse_mode: 'Markdown' }
      );
    }

    await bot.sendMessage(chatId, `🎙️ *Heard:* "${transcript}"\n\nSearching...`, { parse_mode: 'Markdown' });

    const destination = extractDestination(transcript);

    if (!destination) {
      return bot.sendMessage(
        chatId,
        `🎙️ Couldn't find a destination in: _"${transcript}"_\n\nTry: "Book uber to *airport*"`,
        { parse_mode: 'Markdown' }
      );
    }

    bot.sendChatAction(chatId, 'typing');

    const booking = await startRideBooking(session, destination, bot, chatId, userId);

    if (!booking.success) {
      return bot.sendMessage(
        chatId,
        `❌ ${booking.error}\n\nTry: _"${destination} Delhi"_`,
        { parse_mode: 'Markdown' }
      );
    }

    const rideButtons = booking.rides.map(ride => ([{
      text: `${ride.name} — ${ride.price} (${ride.eta} min)`,
      callback_data: `select_ride_${ride.type}_${booking.destination.latitude}_${booking.destination.longitude}`
    }]));

    bot.sendMessage(
      chatId,
      generateRideOptions(booking.rides, booking.pickup.address, booking.destination.address),
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: rideButtons }
      }
    );

  } catch (error) {
    console.error('[VOICE] Error:', error);
    bot.sendMessage(chatId, '❌ Error processing voice. Please try typing instead.');
  }
});

// ─── Location share ───────────────────────────────────────────────────────────
bot.on('location', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const session = getSession(userId);

  if (!session?.isAuthenticated) {
    const loginUrl = generateAuthURL(userId);
    return bot.sendMessage(chatId, '🔐 Please login first:', {
      reply_markup: { inline_keyboard: [[{ text: '🔐 Login with Uber', url: loginUrl }]] }
    });
  }

  try {
    const { latitude, longitude } = msg.location;
    bot.sendChatAction(chatId, 'typing');

    const address = await getAddressFromCoords(latitude, longitude);

    session.currentLocation = {
      latitude,
      longitude,
      address: address || `(${latitude.toFixed(4)}, ${longitude.toFixed(4)})`
    };
    updateSession(userId, session);

    bot.sendMessage(
      chatId,
      `📍 *Pickup Location Set!*\n\n` +
      `${session.currentLocation.address}\n\n` +
      `Now tell me your destination:\n` +
      `• "Book uber to *airport*"\n` +
      `• "Cab to *my office*"`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('[LOCATION] Error:', error);
    bot.sendMessage(chatId, '❌ Error processing location.');
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractDestination(text) {
  const lower = text.toLowerCase();

  for (const prep of ['to', 'at', 'near', 'towards', 'toward', 'for', 'drop me at', 'drop at']) {
    const regex = new RegExp(`\\b${prep}\\s+(.+)`, 'i');
    const match = lower.match(regex);
    if (match) {
      const dest = match[1]
        .replace(/\b(please|now|quickly|asap|fast|immediately|tonight|today)\b/gi, '')
        .trim();
      if (dest.length > 2) return dest;
    }
  }

  const cleaned = text
    .replace(/\b(book|uber|cab|ride|taxi|need|want|a|an|the|i|me|my|can|you|please|get|take|drop)\b/gi, '')
    .trim();

  return cleaned.length > 2 ? cleaned : null;
}

// Auto-reconnect on network errors
let reconnectDelay = 5000;

bot.on('polling_error', async (err) => {
  const networkErrors = ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EFATAL'];
  const isNetworkError = networkErrors.some(e => err.message.includes(e) || err.code === e);

  if (isNetworkError) {
    console.log(`[POLLING] Network error: ${err.message}`);
    console.log(`[POLLING] Reconnecting in ${reconnectDelay / 1000}s...`);

    try {
      await bot.stopPolling();
    } catch (_) {}

    setTimeout(async () => {
      try {
        await bot.startPolling();
        console.log('[POLLING] ✅ Reconnected!');
        reconnectDelay = 5000; // reset delay on success
      } catch (e) {
        console.log('[POLLING] Still offline, retrying...');
        reconnectDelay = Math.min(reconnectDelay * 2, 60000); // max 60s
      }
    }, reconnectDelay);
  } else {
    console.error('[POLLING]', err.message);
  }
});

// Note: bot is already exported above
