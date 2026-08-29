process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-long';
process.env.JWT_ACCESS_EXPIRES = '15m';
process.env.REFRESH_TOKEN_DAYS = '7';
process.env.ADMIN_SETUP_KEY = 'test-admin-setup-key';
// Avoid real Redis / Termii in tests
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
delete process.env.TERMII_API_KEY;

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();
  process.env.DB_URL = uri;
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});
