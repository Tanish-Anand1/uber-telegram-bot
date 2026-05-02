const axios = require('axios');
const crypto = require('crypto');

const UBER_AUTH_BASE = 'https://login.uber.com/oauth/v2';
const REDIRECT_URI = () => process.env.REDIRECT_URI || 'http://localhost:3000/callback';

// state → userId map, expires after 10 minutes
const pendingAuth = new Map();

/**
 * Generate Uber OAuth URL for a given Telegram userId
 */
function generateAuthURL(userId) {
  const state = crypto.randomBytes(16).toString('hex');
  pendingAuth.set(state, userId);
  setTimeout(() => pendingAuth.delete(state), 10 * 60 * 1000);

  const params = new URLSearchParams({
    client_id: process.env.UBER_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI(),
    scope: 'profile history request',
    state
  });

  return `${UBER_AUTH_BASE}/authorize?${params.toString()}`;
}

/**
 * Look up Telegram userId from OAuth state param
 */
function getUserIdFromState(state) {
  return pendingAuth.get(state) || null;
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(code) {
  try {
    const response = await axios.post(
      `${UBER_AUTH_BASE}/token`,
      new URLSearchParams({
        client_id: process.env.UBER_CLIENT_ID,
        client_secret: process.env.UBER_CLIENT_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI(),
        code
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    return {
      success: true,
      token: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in
    };
  } catch (error) {
    console.error('[AUTH] Token exchange error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error_description || 'Token exchange failed'
    };
  }
}

/**
 * Refresh an expired access token
 */
async function refreshAccessToken(refreshToken) {
  try {
    const response = await axios.post(
      `${UBER_AUTH_BASE}/token`,
      new URLSearchParams({
        client_id: process.env.UBER_CLIENT_ID,
        client_secret: process.env.UBER_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    return {
      success: true,
      token: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in
    };
  } catch (error) {
    console.error('[AUTH] Token refresh error:', error.response?.data || error.message);
    return { success: false, error: 'Token refresh failed' };
  }
}

/**
 * Get Uber user profile using access token
 */
async function getUserProfile(authToken) {
  try {
    const response = await axios.get('https://api.uber.com/v1.2/me', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    return {
      name: response.data.first_name || 'User',
      lastName: response.data.last_name || '',
      email: response.data.email || '',
      phone: response.data.mobile_verified || '',
      uuid: response.data.uuid || ''
    };
  } catch (error) {
    console.error('[AUTH] Profile fetch error:', error.message);
    return { name: 'User', email: '', phone: '', uuid: '' };
  }
}

module.exports = {
  generateAuthURL,
  getUserIdFromState,
  exchangeCodeForToken,
  refreshAccessToken,
  getUserProfile
};
