const request = require('supertest');
const { app } = require('../src/server');
const User = require('../src/models/User');

/** Register via password path: send OTP first, then register with otpCode. */
async function registerWithOtp(payload) {
  const sendRes = await request(app)
    .post('/api/auth/send-otp')
    .send({ phone: payload.phone });
  const otpCode = sendRes.body.debugCode;
  if (!otpCode) {
    throw new Error('Expected debugCode in test env from send-otp');
  }
  return request(app)
    .post('/api/auth/register')
    .send({ ...payload, otpCode });
}

describe('Auth', () => {
  describe('POST /api/auth/register + login', () => {
    it('registers a rider with OTP and returns access + refresh tokens', async () => {
      const res = await registerWithOtp({
        phone: '08011112222',
        password: 'Password1',
        fullName: 'Test Rider'
      });

      expect(res.status).toBe(201);
      expect(res.body.accessToken || res.body.token).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      expect(res.body.role).toBe('rider');
      expect(res.body.phoneVerified).toBe(true);
    });

    it('rejects register without otpCode', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          phone: '08011112223',
          password: 'Password1',
          fullName: 'No OTP'
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/otpCode/i);
    });

    it('rejects weak passwords', async () => {
      const sendRes = await request(app)
        .post('/api/auth/send-otp')
        .send({ phone: '08011113333' });
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          phone: '08011113333',
          password: 'short',
          fullName: 'Weak Pass',
          otpCode: sendRes.body.debugCode
        });
      expect(res.status).toBe(400);
    });

    it('logs in with phone + password', async () => {
      await registerWithOtp({
        phone: '08011114444',
        password: 'Password1',
        fullName: 'Login User'
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: '08011114444', password: 'Password1' });

      expect(res.status).toBe(200);
      expect(res.body.accessToken || res.body.token).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
    });

    it('rejects wrong password', async () => {
      await registerWithOtp({
        phone: '08011115555',
        password: 'Password1',
        fullName: 'Bad Login'
      });
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: '08011115555', password: 'WrongPass1' });
      expect(res.status).toBe(401);
    });
  });

  describe('OTP flow', () => {
    it('sends OTP and verifies to create account', async () => {
      const sendRes = await request(app)
        .post('/api/auth/send-otp')
        .send({ phone: '08022223333' });
      expect(sendRes.status).toBe(200);
      expect(sendRes.body.success).toBe(true);
      const code = sendRes.body.debugCode;
      expect(code).toBeTruthy();

      const verifyRes = await request(app)
        .post('/api/auth/verify-otp')
        .send({
          phone: '08022223333',
          code,
          fullName: 'OTP Rider'
        });

      expect([200, 201]).toContain(verifyRes.status);
      expect(verifyRes.body.accessToken || verifyRes.body.token).toBeTruthy();
      expect(verifyRes.body.phoneVerified).toBe(true);

      const user = await User.findOne({ phone: '2348022223333' });
      // phone may be stored normalized
      const userAlt = user || (await User.findOne({ phone: '08022223333' }));
      expect(userAlt).toBeTruthy();
      expect(userAlt.phoneVerified).toBe(true);
    });

    it('rejects invalid OTP', async () => {
      await request(app).post('/api/auth/send-otp').send({ phone: '08022224444' });
      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ phone: '08022224444', code: '000000', fullName: 'X' });
      expect(res.status).toBe(401);
    });
  });

  describe('Refresh token rotation', () => {
    it('rotates refresh token and rejects reuse', async () => {
      const reg = await registerWithOtp({
        phone: '08033334444',
        password: 'Password1',
        fullName: 'Refresh User'
      });
      const oldRefresh = reg.body.refreshToken;

      const refreshed = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: oldRefresh });

      expect(refreshed.status).toBe(200);
      expect(refreshed.body.accessToken).toBeTruthy();
      expect(refreshed.body.refreshToken).toBeTruthy();
      expect(refreshed.body.refreshToken).not.toBe(oldRefresh);

      const reuse = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: oldRefresh });
      expect(reuse.status).toBe(401);
    });
  });

  describe('Logout', () => {
    it('revokes a single refresh token without Bearer', async () => {
      const reg = await registerWithOtp({
        phone: '08055556666',
        password: 'Password1',
        fullName: 'Logout One'
      });
      const rt = reg.body.refreshToken;

      const out = await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken: rt });
      expect(out.status).toBe(200);
      expect(out.body.revoked).toBe('one');

      const reuse = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: rt });
      expect(reuse.status).toBe(401);
    });

    it('requires auth for all: true and then revokes family', async () => {
      const reg = await registerWithOtp({
        phone: '08055557777',
        password: 'Password1',
        fullName: 'Logout All'
      });
      const access = reg.body.accessToken || reg.body.token;
      const rt = reg.body.refreshToken;

      const denied = await request(app)
        .post('/api/auth/logout')
        .send({ all: true });
      expect(denied.status).toBe(401);

      const out = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${access}`)
        .send({ all: true });
      expect(out.status).toBe(200);
      expect(out.body.revoked).toBe('all');

      const reuse = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: rt });
      expect(reuse.status).toBe(401);
    });
  });

  describe('Protected profile', () => {
    it('requires a valid access token', async () => {
      const bare = await request(app).get('/api/auth/profile');
      expect(bare.status).toBe(401);

      const reg = await registerWithOtp({
        phone: '08044445555',
        password: 'Password1',
        fullName: 'Profile User'
      });
      const token = reg.body.accessToken || reg.body.token;

      const ok = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${token}`);
      expect(ok.status).toBe(200);
      // phone stored normalized as 234…
      expect(ok.body.phone).toMatch(/44445555/);
    });
  });
});
