const { getSession, updateSession } = require('./sessions');
const { confirmRide, trackRide, cancelActiveRide } = require('./ride-manager');
const { generateRideConfirmation, generateRideTracking, generateRideHistory } = require('./ui-generator');

const TRACKING_INTERVALS = new Map();

module.exports = function setupCallbackHandlers(bot) {
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    const msgId = query.message.message_id;

    try {
      const session = getSession(userId);

      // --- BOOK RIDE (main menu) ---
      if (data === 'book_ride') {
        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(
          chatId,
          `📍 *Where do you want to go?*\n\n` +
          `Type your destination or say it as a voice message.\n\n` +
          `Examples:\n` +
          `• "Delhi Airport"\n` +
          `• "Central Railway Station"\n` +
          `• "Connaught Place, New Delhi"`,
          { parse_mode: 'Markdown' }
        );
      }

      // --- SELECT RIDE TYPE ---
      if (data.startsWith('select_ride_')) {
        const parts = data.split('_');
        const rideType = parts[2];
        const endLat = parseFloat(parts[3]);
        const endLng = parseFloat(parts[4]);

        bot.answerCallbackQuery(query.id, 'Booking your ride...');
        bot.sendChatAction(chatId, 'typing');

        const result = await confirmRide(session, rideType, endLat, endLng, userId);

        if (result.success) {
          const message = generateRideConfirmation(result);

          bot.editMessageText(message, {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📍 Track Live', callback_data: 'track_ride' }],
                [{ text: '❌ Cancel Ride', callback_data: 'cancel_ride' }]
              ]
            }
          });

          startAutoTracking(bot, chatId, msgId, session.currentRide.rideId, session.authToken, userId);
        } else {
          bot.answerCallbackQuery(query.id, `❌ ${result.error}`, true);
        }
      }

      // --- TRACK RIDE ---
      if (data === 'track_ride') {
        bot.answerCallbackQuery(query.id);
        if (!session?.currentRide) {
          return bot.answerCallbackQuery(query.id, 'No active ride', true);
        }

        bot.sendChatAction(chatId, 'typing');
        const status = await trackRide(session);

        if (status.success) {
          bot.editMessageText(generateRideTracking(status), {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 Refresh', callback_data: 'track_ride' }],
                [{ text: '❌ Cancel Ride', callback_data: 'cancel_ride' }]
              ]
            }
          });
        }
      }

      // --- CANCEL RIDE ---
      if (data === 'cancel_ride') {
        bot.answerCallbackQuery(query.id);
        if (!session?.currentRide) {
          return bot.answerCallbackQuery(query.id, 'No active ride', true);
        }

        const result = await cancelActiveRide(session, userId);
        stopAutoTracking(session.currentRide?.rideId);

        if (result.success) {
          bot.editMessageText(
            `✅ *Ride Cancelled*\n\nRide has been cancelled successfully.`,
            {
              chat_id: chatId,
              message_id: msgId,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🚕 Book New Ride', callback_data: 'book_ride' }]
                ]
              }
            }
          );
        } else {
          bot.answerCallbackQuery(query.id, `❌ ${result.error}`, true);
        }
      }

      // --- RECENT RIDES ---
      if (data === 'recent_rides') {
        bot.answerCallbackQuery(query.id);
        const msg = generateRideHistory(session?.rideHistory || []);

        bot.editMessageText(msg, {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '« Back', callback_data: 'main_menu' }]]
          }
        });
      }

      // --- SAVED LOCATIONS ---
      if (data === 'saved_locations') {
        bot.answerCallbackQuery(query.id);
        const locs = session?.savedLocations || [];
        let msg = `📍 *Saved Locations*\n\n`;

        if (locs.length === 0) {
          msg += 'No saved locations yet.\n\nShare your location to save Home or Office.';
        } else {
          locs.forEach((loc, i) => {
            msg += `${i + 1}. *${loc.label}*\n   ${loc.address}\n\n`;
          });
        }

        bot.editMessageText(msg, {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '« Back', callback_data: 'main_menu' }]]
          }
        });
      }

      // --- LOGOUT ---
      if (data === 'logout') {
        bot.answerCallbackQuery(query.id);
        const { deleteSession } = require('./sessions');
        deleteSession(userId);

        bot.editMessageText(
          `👋 *Logged Out*\n\nYou have been logged out.\nUse /start to login again.`,
          {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'Markdown'
          }
        );
      }

      // --- MAIN MENU ---
      if (data === 'main_menu') {
        bot.answerCallbackQuery(query.id);
        const userName = session?.userProfile?.name || 'User';

        bot.editMessageText(
          `🚕 *Welcome, ${userName}!*\n\nWhat would you like to do?`,
          {
            chat_id: chatId,
            message_id: msgId,
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
      }

    } catch (error) {
      console.error('[CALLBACK] Error:', error);
      bot.answerCallbackQuery(query.id, '❌ Something went wrong', true);
    }
  });
};

function startAutoTracking(bot, chatId, msgId, rideId, authToken, userId) {
  stopAutoTracking(rideId);

  const interval = setInterval(async () => {
    try {
      const { getRideStatus } = require('./uber-api');
      const status = await getRideStatus(rideId, authToken);

      if (!status.success) return;

      if (status.status === 'completed' || status.status === 'driver_canceled') {
        stopAutoTracking(rideId);

        const session = require('./sessions').getSession(userId);
        if (session?.currentRide) {
          const { fetchAndStoreReceipt } = require('./ride-manager');
          await fetchAndStoreReceipt(session, userId);
        }

        bot.editMessageText(
          status.status === 'completed'
            ? `🏁 *Ride Completed!*\n\nThank you for riding with Uber.\nUse /start to book again.`
            : `❌ *Driver Cancelled*\n\nSorry! Use /start to book a new ride.`,
          {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[{ text: '🚕 Book New Ride', callback_data: 'book_ride' }]]
            }
          }
        ).catch(() => {});
        return;
      }

      bot.editMessageText(generateRideTracking(status), {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Refresh', callback_data: 'track_ride' }],
            [{ text: '❌ Cancel Ride', callback_data: 'cancel_ride' }]
          ]
        }
      }).catch(() => {});
    } catch (err) {
      console.error('[AUTOTRACK] Error:', err.message);
    }
  }, 10000);

  TRACKING_INTERVALS.set(rideId, interval);
}

function stopAutoTracking(rideId) {
  if (TRACKING_INTERVALS.has(rideId)) {
    clearInterval(TRACKING_INTERVALS.get(rideId));
    TRACKING_INTERVALS.delete(rideId);
  }
}
