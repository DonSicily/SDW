const request = require('supertest');
const { app } = require('../src/server');
const User = require('../src/models/User');
const Ride = require('../src/models/Ride');

async function createUser({ phone, role, password = 'Password1', fullName = 'Test User' }) {
  const sendRes = await request(app).post('/api/auth/send-otp').send({ phone });
  const otpCode = sendRes.body.debugCode;
  const res = await request(app).post('/api/auth/register').send({
    phone,
    password,
    fullName,
    role,
    otpCode
  });
  if (res.status !== 201) {
    throw new Error(`createUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    user: res.body,
    token: res.body.accessToken || res.body.token
  };
}

describe('Rides authorization', () => {
  it('only riders can request a ride', async () => {
    const driver = await createUser({ phone: '08100000001', role: 'driver', fullName: 'Driver One' });
    const res = await request(app)
      .post('/api/rides/request')
      .set('Authorization', `Bearer ${driver.token}`)
      .send({
        pickup: { lat: 6.5, lng: 3.3, address: 'A' },
        dropoff: { lat: 6.6, lng: 3.4, address: 'B' },
        fare: { standard: 1500, minBid: 1200 }
      });
    expect(res.status).toBe(403);
  });

  it('rider can request a ride with server-side fare', async () => {
    const rider = await createUser({ phone: '08100000002', role: 'rider', fullName: 'Rider One' });
    const res = await request(app)
      .post('/api/rides/request')
      .set('Authorization', `Bearer ${rider.token}`)
      .send({
        pickup: { lat: 6.5, lng: 3.3, address: 'A' },
        dropoff: { lat: 6.6, lng: 3.4, address: 'B' },
        // Client-supplied fare must be ignored
        fare: { standard: 1, minBid: 1 }
      });
    // 201 even if no drivers online (ride created then cancelled)
    expect([201, 200]).toContain(res.status);
    expect(res.body.rideId).toBeTruthy();
    // Server must return its own computed fare (not the client value of 1)
    expect(res.body.fare).toBeDefined();
    expect(res.body.fare.standard).toBeGreaterThan(1);
  });

  it('rejects concurrent open rides for the same rider', async () => {
    const rider = await createUser({ phone: '08100000010', role: 'rider', fullName: 'Rider Concurrent' });
    // Seed an open ride
    await Ride.create({
      riderId: rider.user._id,
      pickup: { lat: 6.5, lng: 3.3, address: 'A' },
      dropoff: { lat: 6.6, lng: 3.4, address: 'B' },
      fare: { standard: 1500 },
      status: 'pending'
    });

    const res = await request(app)
      .post('/api/rides/request')
      .set('Authorization', `Bearer ${rider.token}`)
      .send({
        pickup: { lat: 6.5, lng: 3.3, address: 'A' },
        dropoff: { lat: 6.6, lng: 3.4, address: 'B' }
      });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/active ride/i);
  });

  it('only the assigned driver can complete a ride', async () => {
    const rider = await createUser({ phone: '08100000003', role: 'rider', fullName: 'Rider Two' });
    const driverA = await createUser({ phone: '08100000004', role: 'driver', fullName: 'Driver A' });
    const driverB = await createUser({ phone: '08100000005', role: 'driver', fullName: 'Driver B' });

    // Manually create a started ride assigned to driver A
    const ride = await Ride.create({
      riderId: rider.user._id,
      driverId: driverA.user._id,
      pickup: { lat: 6.5, lng: 3.3, address: 'A' },
      dropoff: { lat: 6.6, lng: 3.4, address: 'B' },
      fare: { standard: 2000 },
      status: 'started',
      startTime: new Date()
    });

    // Driver B cannot complete
    const forbidden = await request(app)
      .put(`/api/rides/${ride._id}/complete`)
      .set('Authorization', `Bearer ${driverB.token}`)
      .send({ finalFare: 2000, distanceKm: 5, durationMin: 15 });
    expect(forbidden.status).toBe(403);

    // Driver A can complete
    const ok = await request(app)
      .put(`/api/rides/${ride._id}/complete`)
      .set('Authorization', `Bearer ${driverA.token}`)
      .send({ finalFare: 2000, distanceKm: 5, durationMin: 15 });
    expect(ok.status).toBe(200);
    expect(ok.body.ride.status).toBe('completed');
    expect(Number.isInteger(ok.body.ride.finalFare)).toBe(true);
  });

  it('rejects complete from pending/accepted without start', async () => {
    const rider = await createUser({ phone: '08100000008', role: 'rider', fullName: 'Rider Status' });
    const driver = await createUser({ phone: '08100000009', role: 'driver', fullName: 'Driver Status' });

    const ride = await Ride.create({
      riderId: rider.user._id,
      driverId: driver.user._id,
      pickup: { lat: 6.5, lng: 3.3, address: 'A' },
      dropoff: { lat: 6.6, lng: 3.4, address: 'B' },
      fare: { standard: 2000 },
      status: 'accepted'
    });

    const res = await request(app)
      .put(`/api/rides/${ride._id}/complete`)
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ finalFare: 2000 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/started|arrived/i);
  });

  it('auto-starts then completes when status is arrived', async () => {
    const rider = await createUser({ phone: '08100000011', role: 'rider', fullName: 'Rider Arrived' });
    const driver = await createUser({ phone: '08100000012', role: 'driver', fullName: 'Driver Arrived' });

    const ride = await Ride.create({
      riderId: rider.user._id,
      driverId: driver.user._id,
      pickup: { lat: 6.5, lng: 3.3, address: 'A' },
      dropoff: { lat: 6.6, lng: 3.4, address: 'B' },
      fare: { standard: 2000 },
      status: 'arrived'
    });

    const ok = await request(app)
      .put(`/api/rides/${ride._id}/complete`)
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ finalFare: 2000, distanceKm: 4, durationMin: 12 });
    expect(ok.status).toBe(200);
    expect(ok.body.ride.status).toBe('completed');
    expect(ok.body.ride.startTime).toBeTruthy();
  });

  it('rider can rate their completed ride once', async () => {
    const rider = await createUser({ phone: '08100000006', role: 'rider', fullName: 'Rider Three' });
    const driver = await createUser({ phone: '08100000007', role: 'driver', fullName: 'Driver C' });

    const ride = await Ride.create({
      riderId: rider.user._id,
      driverId: driver.user._id,
      pickup: { lat: 6.5, lng: 3.3, address: 'A' },
      dropoff: { lat: 6.6, lng: 3.4, address: 'B' },
      fare: { standard: 1800 },
      status: 'completed',
      finalFare: 1800
    });

    const rate = await request(app)
      .put(`/api/rides/${ride._id}/rate`)
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ rating: 5, review: 'Great trip' });
    expect(rate.status).toBe(200);

    const again = await request(app)
      .put(`/api/rides/${ride._id}/rate`)
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ rating: 4 });
    expect(again.status).toBe(400);
  });
});
