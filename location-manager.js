const axios = require('axios');

const GMAPS_BASE = 'https://maps.googleapis.com/maps/api';

/**
 * Search destination by name near user's coordinates
 */
async function searchDestination(query, userLat, userLng) {
  try {
    console.log(`[LOCATION] Searching: "${query}" near (${userLat}, ${userLng})`);

    const response = await axios.get(`${GMAPS_BASE}/place/textsearch/json`, {
      params: {
        query,
        location: `${userLat},${userLng}`,
        radius: 50000,
        key: process.env.GOOGLE_MAPS_API_KEY
      }
    });

    if (!response.data.results || response.data.results.length === 0) {
      return { success: false, error: 'Location not found' };
    }

    const result = response.data.results[0];
    const { lat, lng } = result.geometry.location;

    return {
      success: true,
      address: result.formatted_address || result.name,
      name: result.name,
      latitude: lat,
      longitude: lng,
      placeId: result.place_id
    };
  } catch (error) {
    console.error('[LOCATION] Search error:', error.message);
    return { success: false, error: 'Location search failed' };
  }
}

/**
 * Reverse geocode coordinates to human-readable address
 */
async function getAddressFromCoords(latitude, longitude) {
  try {
    const response = await axios.get(`${GMAPS_BASE}/geocode/json`, {
      params: {
        latlng: `${latitude},${longitude}`,
        key: process.env.GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.results && response.data.results.length > 0) {
      return response.data.results[0].formatted_address;
    }

    return null;
  } catch (error) {
    console.error('[LOCATION] Geocode error:', error.message);
    return null;
  }
}

/**
 * Autocomplete address suggestions
 */
async function getAutocompleteSuggestions(input, userLat, userLng) {
  try {
    const response = await axios.get(`${GMAPS_BASE}/place/autocomplete/json`, {
      params: {
        input,
        location: `${userLat},${userLng}`,
        radius: 50000,
        key: process.env.GOOGLE_MAPS_API_KEY
      }
    });

    return (response.data.predictions || []).slice(0, 5).map(p => ({
      description: p.description,
      placeId: p.place_id
    }));
  } catch (error) {
    console.error('[LOCATION] Autocomplete error:', error.message);
    return [];
  }
}

/**
 * Get place details by placeId
 */
async function getPlaceDetails(placeId) {
  try {
    const response = await axios.get(`${GMAPS_BASE}/place/details/json`, {
      params: {
        place_id: placeId,
        fields: 'name,formatted_address,geometry',
        key: process.env.GOOGLE_MAPS_API_KEY
      }
    });

    const place = response.data.result;
    return {
      success: true,
      address: place.formatted_address,
      name: place.name,
      latitude: place.geometry.location.lat,
      longitude: place.geometry.location.lng
    };
  } catch (error) {
    console.error('[LOCATION] Place details error:', error.message);
    return { success: false, error: 'Could not get place details' };
  }
}

/**
 * Haversine distance between two coordinates (km)
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = {
  searchDestination,
  getAddressFromCoords,
  getAutocompleteSuggestions,
  getPlaceDetails,
  calculateDistance
};
