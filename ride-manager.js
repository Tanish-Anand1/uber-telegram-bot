const { getRideEstimates, requestRide, getRideStatus, cancelRide, getRideReceipt } = require('./uber-api');
const { searchDestination } = require('./location-manager');
const { updateSession } = require('./sessions');

/**
 * Full ride booking flow: resolve destination → get estimates → present options
 */
async function startRideBooking(session, destinationQuery, bot, chatId, userId) {
  const pickup = session.currentLocation || {
    latitude: 28.7041,
    longitude: 77.1025,
    address: 'Current Location (default)'
  };

  const destinationResult = await searchDestination(
    destinationQuery,
    pickup.latitude,
    pickup.longitude
  );

  if (!destinationResult.success) {
    return {
      success: false,
      error: `Destination not found: "${destinationQuery}". Try adding city name.`
    };
  }

  const estimates = await getRideEstimates(
    pickup.latitude,
    pickup.longitude,
    destinationResult.latitude,
    destinationResult.longitude,
    session.authToken
  );

  if (!estimates.success) {
    return { success: false, error: estimates.error };
  }

  session.selectedPickup = pickup;
  session.selectedDestination = destinationResult;
  updateSession(userId, session);

  return {
    success: true,
    pickup,
    destination: destinationResult,
    rides: estimates.rides
  };
}

/**
 * Confirm and book the selected ride type
 */
async function confirmRide(session, productId, endLat, endLng, userId) {
  const pickup = session.selectedPickup;

  if (!pickup) {
    return { success: false, error: 'No pickup location set' };
  }

  const result = await requestRide(
    pickup.latitude,
    pickup.longitude,
    endLat,
    endLng,
    productId,
    session.authToken
  );

  if (result.success) {
    session.currentRide = {
      rideId: result.rideId,
      productId,
      status: result.status,
      startedAt: new Date(),
      pickup,
      destination: session.selectedDestination
    };
    updateSession(userId, session);
  }

  return result;
}

/**
 * Poll ride status and return formatted update
 */
async function trackRide(session) {
  if (!session.currentRide) {
    return { success: false, error: 'No active ride' };
  }

  return getRideStatus(session.currentRide.rideId, session.authToken);
}

/**
 * Cancel active ride and clear from session
 */
async function cancelActiveRide(session, userId) {
  if (!session.currentRide) {
    return { success: false, error: 'No active ride' };
  }

  const result = await cancelRide(session.currentRide.rideId, session.authToken);

  if (result.success) {
    const history = session.rideHistory || [];
    history.unshift({
      ...session.currentRide,
      status: 'cancelled',
      endedAt: new Date()
    });
    session.rideHistory = history.slice(0, 20);
    session.currentRide = null;
    updateSession(userId, session);
  }

  return result;
}

/**
 * Fetch and store receipt after ride completion
 */
async function fetchAndStoreReceipt(session, userId) {
  if (!session.currentRide) return null;

  const receipt = await getRideReceipt(session.currentRide.rideId, session.authToken);

  if (receipt.success) {
    const history = session.rideHistory || [];
    history.unshift({
      ...session.currentRide,
      status: 'completed',
      fare: `${receipt.totalFare} ${receipt.currency}`,
      distance: receipt.distance,
      duration: receipt.duration,
      endedAt: new Date()
    });
    session.rideHistory = history.slice(0, 20);
    session.currentRide = null;
    updateSession(userId, session);
  }

  return receipt;
}

module.exports = {
  startRideBooking,
  confirmRide,
  trackRide,
  cancelActiveRide,
  fetchAndStoreReceipt
};
