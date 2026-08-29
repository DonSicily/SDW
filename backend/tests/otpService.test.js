const { sendOtp, verifyOtp } = require('../src/services/otpService');

describe('otpService', () => {
  it('stores and verifies a valid OTP', async () => {
    const phone = '08099998888';
    const sent = await sendOtp(phone);
    expect(sent.success).toBe(true);
    expect(sent.debugCode).toBeTruthy();

    const ok = await verifyOtp(phone, sent.debugCode);
    expect(ok.valid).toBe(true);

    // One-time use
    const again = await verifyOtp(phone, sent.debugCode);
    expect(again.valid).toBe(false);
  });

  it('rejects wrong code', async () => {
    const phone = '08099997777';
    await sendOtp(phone);
    const bad = await verifyOtp(phone, '111111');
    expect(bad.valid).toBe(false);
  });
});
