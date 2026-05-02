function generateMainMenu(userName) {
  return (
    `🚕 *Welcome, ${userName}!*\n\n` +
    `Ready to book a ride?\n\n` +
    `📍 Tap "Book a Ride" below\n` +
    `🎙️ Or say: "Book uber to airport"\n` +
    `📌 Or share your GPS location`
  );
}

function generateWelcomeMessage() {
  return (
    `🚕 *Uber Telegram Bot*\n\n` +
    `Book cabs worldwide using text or voice.\n\n` +
    `Use /start to begin.`
  );
}

function generateLocationDisplay(location) {
  return (
    `📍 *Your Location*\n\n` +
    `${location.address}\n` +
    `(${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)})`
  );
}

function generateRideOptions(rides, pickup, destination) {
  let msg =
    `🚕 *Choose Your Ride*\n\n` +
    `📍 From: ${pickup}\n` +
    `📍 To: ${destination}\n\n`;

  rides.forEach(ride => {
    const surge = ride.surgeMultiplier > 1.0 ? ` ⚡${ride.surgeMultiplier}x` : '';
    msg +=
      `*${ride.name}*${surge}\n` +
      `💰 ${ride.price} ${ride.currency || ''}  ⏱️ ${ride.eta} min\n` +
      `👥 ${ride.capacity}\n\n`;
  });

  return msg;
}

function generateRideConfirmation(ride) {
  return (
    `✅ *Ride Confirmed!*\n\n` +
    `🚗 Vehicle: ${ride.vehicleType}\n` +
    `🔢 Plate: ${ride.licensePlate}\n\n` +
    `👤 Driver: ${ride.driverName}\n` +
    `⭐ Rating: ${ride.driverRating}\n` +
    (ride.driverPhone ? `📞 Phone: ${ride.driverPhone}\n` : '') +
    `\n⏱️ ETA: ${ride.eta} minutes\n` +
    (ride.surgeMultiplier > 1.0 ? `⚡ Surge: ${ride.surgeMultiplier}x\n` : '') +
    `\n📍 Tracking your ride...`
  );
}

function generateRideTracking(status) {
  const statusEmoji = {
    processing: '🔄',
    accepted: '✅',
    arriving: '🚗',
    in_progress: '🛣️',
    driver_canceled: '❌',
    rider_canceled: '❌',
    completed: '🏁'
  };

  const emoji = statusEmoji[status.status] || '🔄';

  return (
    `📍 *Live Tracking*\n\n` +
    `${emoji} Status: *${status.status?.toUpperCase().replace('_', ' ')}*\n\n` +
    `📍 Driver: ${status.currentLocation || 'En route'}\n` +
    `⏱️ ETA: ${status.eta ? `${status.eta} min` : 'Calculating...'}\n` +
    `🚗 Plate: ${status.vehiclePlate || '---'}\n\n` +
    `_Updated just now_`
  );
}

function generateRideHistory(rides) {
  if (!rides || rides.length === 0) {
    return `🕐 *No Recent Rides*\n\nBook your first ride to see history here.`;
  }

  let msg = `🕐 *Recent Rides*\n\n`;
  rides.slice(0, 5).forEach((ride, i) => {
    msg +=
      `${i + 1}. ${ride.destination}\n` +
      `   ${ride.date} · ${ride.fare}\n\n`;
  });

  return msg;
}

module.exports = {
  generateMainMenu,
  generateWelcomeMessage,
  generateLocationDisplay,
  generateRideOptions,
  generateRideConfirmation,
  generateRideTracking,
  generateRideHistory
};
