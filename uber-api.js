const axios = require('axios');

const UBER_API_BASE = 'https://api.uber.com/v1.2';

/**
 * Get ride price estimates and ETAs
 */
async function getRideEstimates(startLat, startLng, endLat, endLng, authToken) {
  try {
    console.log(`[UBER] Getting estimates from (${startLat},${startLng}) to (${endLat},${endLng})`);

    const [priceRes, timeRes] = await Promise.all([
      axios.get(`${UBER_API_BASE}/estimates/price`, {
        params: {
          start_latitude: startLat,
          start_longitude: startLng,
          end_latitude: endLat,
          end_longitude: endLng
        },
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Accept-Language': 'en_US'
        }
      }),
      axios.get(`${UBER_API_BASE}/estimates/time`, {
        params: {
          start_latitude: startLat,
          start_longitude: startLng
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      })
    ]);

    const etaMap = {};
    timeRes.data.times.forEach(t => {
      etaMap[t.product_id] = Math.round(t.estimate / 60);
    });

    const rides = priceRes.data.prices
      .filter(p => p.estimate && p.estimate !== 'Unavailable')
      .map(price => ({
        type: price.product_id,
        name: price.display_name,
        price: price.estimate || 'N/A',
        priceRaw: price.low_estimate || 0,
        eta: etaMap[price.product_id] || price.duration ? Math.round(price.duration / 60) : 5,
        capacity: getCapacity(price.display_name),
        surgeMultiplier: price.surge_multiplier || 1.0,
        currency: price.currency_code || 'USD'
      }));

    console.log(`[UBER] Found ${rides.length} ride options`);
    return { success: true, rides };
  } catch (error) {
    console.error('[UBER] Ride estimates error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || 'Could not get ride estimates'
    };
  }
}

/**
 * Request a ride (actual booking)
 */
async function requestRide(startLat, startLng, endLat, endLng, productId, authToken) {
  try {
    console.log(`[UBER] Requesting ride: product=${productId}`);

    const response = await axios.post(
      `${UBER_API_BASE}/requests`,
      {
        start_latitude: startLat,
        start_longitude: startLng,
        end_latitude: endLat,
        end_longitude: endLng,
        product_id: productId
      },
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const ride = response.data;
    console.log(`[UBER] Ride requested: ${ride.request_id}`);

    return {
      success: true,
      rideId: ride.request_id,
      status: ride.status,
      driverName: ride.driver?.name || 'Matching driver...',
      driverRating: ride.driver?.rating || 'N/A',
      driverPhone: ride.driver?.phone_number || '',
      vehicleType: ride.vehicle?.model || 'Uber',
      licensePlate: ride.vehicle?.license_plate || '---',
      eta: ride.eta || 5,
      surgeMultiplier: ride.surge_multiplier || 1.0
    };
  } catch (error) {
    console.error('[UBER] Request ride error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || 'Could not request ride'
    };
  }
}

/**
 * Get live ride status
 */
async function getRideStatus(rideId, authToken) {
  try {
    const response = await axios.get(`${UBER_API_BASE}/requests/${rideId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    const ride = response.data;
    return {
      success: true,
      status: ride.status,
      driverLat: ride.location?.latitude,
      driverLng: ride.location?.longitude,
      driverName: ride.driver?.name,
      vehiclePlate: ride.vehicle?.license_plate,
      eta: ride.eta,
      currentLocation: ride.location?.bearing
        ? `Heading ${ride.location.bearing}°`
        : 'En route'
    };
  } catch (error) {
    console.error('[UBER] Ride status error:', error.message);
    return { success: false, error: 'Could not fetch ride status' };
  }
}

/**
 * Cancel an active ride
 */
async function cancelRide(rideId, authToken) {
  try {
    await axios.delete(`${UBER_API_BASE}/requests/${rideId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    return { success: true, message: 'Ride cancelled' };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.message || 'Could not cancel ride'
    };
  }
}

/**
 * Get ride receipt after completion
 */
async function getRideReceipt(rideId, authToken) {
  try {
    const response = await axios.get(`${UBER_API_BASE}/requests/${rideId}/receipt`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    return {
      success: true,
      totalFare: response.data.total_charged,
      currency: response.data.currency_code,
      distance: response.data.distance,
      duration: response.data.duration
    };
  } catch (error) {
    return { success: false, error: 'Receipt not available' };
  }
}

function getCapacity(productName) {
  const name = productName.toLowerCase();
  if (name.includes('xl') || name.includes('van')) return '6 seats';
  if (name.includes('premium') || name.includes('black') || name.includes('select')) return '4 seats (luxury)';
  if (name.includes('pool') || name.includes('express')) return 'Shared ride';
  if (name.includes('moto') || name.includes('bike')) return '1 rider';
  return '4 seats';
}

module.exports = {
  getRideEstimates,
  requestRide,
  getRideStatus,
  cancelRide,
  getRideReceipt
};
