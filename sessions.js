const sessions = new Map();

function getOrCreateSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      userId,
      isAuthenticated: false,
      authStep: null,
      phoneNumber: null,
      authToken: null,
      userProfile: null,
      currentLocation: null,
      selectedPickup: null,
      selectedDestination: null,
      currentRide: null,
      savedLocations: [],
      rideHistory: [],
      createdAt: new Date()
    });
  }
  return sessions.get(userId);
}

function getSession(userId) {
  return sessions.get(userId) || null;
}

function updateSession(userId, data) {
  const existing = sessions.get(userId) || {};
  sessions.set(userId, { ...existing, ...data, updatedAt: new Date() });
}

function deleteSession(userId) {
  sessions.delete(userId);
}

module.exports = {
  getOrCreateSession,
  getSession,
  updateSession,
  deleteSession
};
