const axios = require('axios');

/**
 * Routing providers (P2 — do not rely on the public demo OSRM server in production).
 *
 * Priority:
 *   1. ROUTING_PROVIDER=mapbox  + MAPBOX_ACCESS_TOKEN (or MAP_API_KEY)
 *   2. ROUTING_PROVIDER=google  + GOOGLE_MAPS_API_KEY (or MAP_API_KEY)
 *   3. ROUTING_PROVIDER=osrm    + OSRM_BASE_URL (self-hosted, e.g. http://osrm:5000)
 *   4. Haversine fallback (always available)
 *
 * Public router.project-osrm.org is ONLY used when NODE_ENV is not production
 * and no other provider is configured (local dev convenience).
 */

const toRad = (deg) => (deg * Math.PI) / 180;

const calculateHaversine = (p1, p2) => {
  const R = 6371; // km
  const dLat = toRad(p2.lat - p1.lat);
  const dLng = toRad(p2.lng - p1.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = R * c;
  // Assume average speed 30 km/h in Nigerian cities
  const durationMin = (distanceKm / 30) * 60;
  return { distanceKm, durationMin, source: 'haversine' };
};

async function routeViaMapbox(pickup, dropoff, token) {
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}` +
    `?overview=false&access_token=${encodeURIComponent(token)}`;
  const { data } = await axios.get(url, { timeout: 10000 });
  const route = data?.routes?.[0];
  if (!route) throw new Error('Mapbox returned no route');
  return {
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
    source: 'mapbox'
  };
}

async function routeViaGoogle(pickup, dropoff, key) {
  const url = 'https://maps.googleapis.com/maps/api/directions/json';
  const { data } = await axios.get(url, {
    timeout: 10000,
    params: {
      origin: `${pickup.lat},${pickup.lng}`,
      destination: `${dropoff.lat},${dropoff.lng}`,
      mode: 'driving',
      key
    }
  });
  if (data.status !== 'OK' || !data.routes?.[0]?.legs?.[0]) {
    throw new Error(`Google Directions status: ${data.status}`);
  }
  const leg = data.routes[0].legs[0];
  return {
    distanceKm: leg.distance.value / 1000,
    durationMin: leg.duration.value / 60,
    source: 'google'
  };
}

async function routeViaOsrm(pickup, dropoff, baseUrl) {
  const base = baseUrl.replace(/\/$/, '');
  const url =
    `${base}/route/v1/driving/` +
    `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}` +
    `?overview=false`;
  const { data } = await axios.get(url, { timeout: 10000 });
  if (data.code !== 'Ok' || !data.routes?.[0]) {
    throw new Error(`OSRM code: ${data.code}`);
  }
  const route = data.routes[0];
  return {
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
    source: 'osrm'
  };
}

function resolveProvider() {
  const explicit = (process.env.ROUTING_PROVIDER || '').toLowerCase().trim();
  const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.MAP_API_KEY;
  const googleKey = process.env.GOOGLE_MAPS_API_KEY ||
    (explicit === 'google' ? process.env.MAP_API_KEY : null);
  const osrmBase = process.env.OSRM_BASE_URL;

  if (explicit === 'mapbox' && mapboxToken) return { name: 'mapbox', token: mapboxToken };
  if (explicit === 'google' && (googleKey || process.env.MAP_API_KEY)) {
    return { name: 'google', token: googleKey || process.env.MAP_API_KEY };
  }
  if (explicit === 'osrm' && osrmBase) return { name: 'osrm', base: osrmBase };
  if (explicit === 'haversine') return { name: 'haversine' };

  // Auto-detect when provider not set
  if (mapboxToken && !explicit) return { name: 'mapbox', token: mapboxToken };
  if (process.env.GOOGLE_MAPS_API_KEY) return { name: 'google', token: process.env.GOOGLE_MAPS_API_KEY };
  if (osrmBase) return { name: 'osrm', base: osrmBase };

  // Dev-only public OSRM — never in production
  if (process.env.NODE_ENV !== 'production') {
    return { name: 'osrm', base: 'https://router.project-osrm.org' };
  }

  return { name: 'haversine' };
}

const getRouteInfo = async (pickup, dropoff) => {
  const provider = resolveProvider();

  try {
    if (provider.name === 'mapbox') {
      return await routeViaMapbox(pickup, dropoff, provider.token);
    }
    if (provider.name === 'google') {
      return await routeViaGoogle(pickup, dropoff, provider.token);
    }
    if (provider.name === 'osrm') {
      return await routeViaOsrm(pickup, dropoff, provider.base);
    }
  } catch (error) {
    console.error(`Routing (${provider.name}) failed, using Haversine:`, error.message);
  }

  return calculateHaversine(pickup, dropoff);
};

// Traffic simulation (replace with live traffic API when available)
const getTrafficSpeed = async () => {
  const randomFactor = Math.random() * 10 + 10; // 10–20 km/h
  return randomFactor;
};

const calculateFare = async (pickup, dropoff, driverUtilization) => {
  const { distanceKm, durationMin, source } = await getRouteInfo(pickup, dropoff);

  // Base cost: ₦150/km + ₦20/min
  const baseCost = distanceKm * 150 + durationMin * 20;

  const speed = await getTrafficSpeed(pickup, dropoff);
  let trafficFactor = 1.0;
  if (speed < 15) trafficFactor = 1.05;
  else if (speed < 10) trafficFactor = 1.1;
  else if (speed < 5) trafficFactor = 1.15;

  const driverBonus = driverUtilization > 80 ? 500 : 0;

  const predictedBoltPrice = baseCost * 1.3 + 200;
  let finalFare = baseCost * trafficFactor + driverBonus;
  if (finalFare > predictedBoltPrice) {
    finalFare = predictedBoltPrice - 50;
  }

  const minBid = finalFare * 0.85;

  return {
    standard: Math.round(finalFare),
    minBid: Math.round(minBid),
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMin: Math.round(durationMin),
    routeSource: source || 'haversine'
  };
};

module.exports = { calculateFare, getRouteInfo, calculateHaversine, resolveProvider };
