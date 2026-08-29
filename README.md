# SDW Taxi App — Rider, Driver, Admin & Backend

Ride-hailing MVP (Bolt/Uber-style) for the Nigerian market: live map-based rider app, driver app, a web admin panel, and a Node/Express + MongoDB + Socket.IO backend with a hybrid dynamic pricing engine and Paystack payments.

Branded with the **SDW** logo across the rider app, driver app, and admin panel (app icons, splash screens, auth screens, and sidebar).

## Structure

```
backend/       Express + MongoDB + Socket.IO API (deploy to Railway)
mobile-app/    Rider app (Expo / React Native)
driver-app/    Driver app (Expo / React Native)
admin-panel/   Admin dashboard (React + Vite, web)
```

## Backend setup

```bash
cd backend
cp .env.example .env   # fill in your real DB_URL, JWT_SECRET, MAP_API_KEY, PAYSTACK keys, etc.
npm install
npm run dev
```

Deploys to Railway out of the box (`railway.json` included) — it auto-detects `package.json`.

### Creating the first admin account

Admin accounts can't be self-registered from the app — `POST /api/auth/register` only allows `role: "admin"` when the request includes the correct `adminSetupKey`, matched against `ADMIN_SETUP_KEY` in your `.env`. Registration always requires a prior OTP.

```bash
# 1) Request OTP (in non-production the response includes debugCode)
curl -X POST https://your-backend-url/api/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{ "phone": "0800..." }'

# 2) Register with the OTP code
curl -X POST https://your-backend-url/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "0800...",
    "password": "a-strong-password",
    "fullName": "Ops Admin",
    "role": "admin",
    "otpCode": "123456",
    "adminSetupKey": "the ADMIN_SETUP_KEY value from your .env"
  }'
```

After that, sign in normally from the admin panel with that phone/password.

### Paystack

- Get your keys from the Paystack dashboard and set `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` in `backend/.env`.
- In the Paystack dashboard, point your webhook URL at `https://your-backend-url/api/payments/webhook`. This is the source of truth for marking a ride as paid — the app's in-checkout verification is just for instant UI feedback.
- Flow: rider completes a ride → `RideHistoryScreen` shows "Pay with Paystack" for unpaid completed rides → `POST /api/payments/initialize` creates a Paystack transaction and returns a hosted checkout URL → the app opens it in a WebView (`PaymentScreen.js`) → on return, `GET /api/payments/verify/:reference` confirms status; the webhook confirms it independently and is authoritative.

## Rider / Driver app setup

```bash
cd mobile-app   # or driver-app
npm install
```

Update `extra.apiUrl` in `app.json` to point at your deployed backend URL, then:

```bash
npx expo start
```

The rider app's map screen (`MapScreen.js`) uses a custom desaturated Google Maps style (`utils/mapStyle.js`) and an animated, draggable bottom sheet (`components/BottomSheet.js`) for pickup/dropoff, fare, and ride-status UI. Both `react-native-gesture-handler` and `react-native-reanimated` are required for the bottom sheet — `babel.config.js` already includes the Reanimated Babel plugin, and `App.js` is wrapped in `GestureHandlerRootView`.

## Admin panel setup

```bash
cd admin-panel
cp .env.example .env   # set VITE_API_URL to your backend URL
npm install
npm run dev
```

Sign in with an admin account (see "Creating the first admin account" above). The panel covers:

- **Dashboard** — rider/driver/vehicle counts, online drivers, rides by status, total revenue collected (paid rides only)
- **Riders / Drivers** — list, view driver online status & assigned vehicle, suspend/reactivate accounts
- **Rides** — filterable by status, shows fare and payment status per ride
- **Vehicles** — list fleet, add new vehicles, cycle status (active/maintenance/inactive)

Build for production with `npm run build` (outputs to `admin-panel/dist/`) and deploy as a static site (Railway, Vercel, Netlify, etc.) — just make sure `VITE_API_URL` is set at build time.

## Notes / known gaps

- **Flutterwave** was scoped early on but superseded by Paystack — `FLUTTERWAVE_SECRET_KEY` in `.env.example` is a harmless unused placeholder.
- Pricing logic lives in `backend/src/services/pricingService.js` — hybrid base+distance+time+traffic+bonus model, with an InDrive-style negotiated fare path.
- Real-time driver matching / location / ride lifecycle events are handled in `backend/src/services/socketService.js`.
- Admin `status: 'suspended'` blocks login and is also checked on every authenticated request via `protect` middleware, so an already-logged-in suspended user is cut off immediately, not just on next login.
- Two navigator placeholder-component bugs (duplicate `ProfileScreen`/`EarningsScreen` declarations shadowing the real imported screens) were fixed early on so the apps actually run.
- Fixed a missing `User` import in `rideController.js` (`completeRide` referenced it without requiring the model — would have crashed on every ride completion).

### Rider ratings & reviews

- `PUT /api/rides/:rideId/rate` — rider-only, one rating per ride, rolls into the driver's running average (`driverDetails.rating`) via a weighted mean based on `totalTrips`.
- On ride completion the rider is pushed to `RatingScreen.js` automatically — either via a live `rider:ride-completed` socket event (app foregrounded) or by tapping the completion push notification (app backgrounded). "Skip for now" is always available.

### Push notifications

- Backend: `services/pushService.js` sends via Expo's push API (`https://exp.host/--/api/v2/push/send`) — no extra SDK dependency, just a POST via the existing `axios`. Failures are logged and swallowed; push is always a backup to the primary socket event, never the only delivery path.
- `PUT /api/auth/push-token` registers (or clears, on logout) a device's Expo push token on the `User` doc.
- Triggered for: a driver accepting a ride (to the rider), a ride completing (to the rider), and a new ride request reaching a driver (to the driver).
- Mobile: `utils/pushNotifications.js` handles permission requests and token registration; called automatically once authenticated in `App.js`, and cleared on logout in `ProfileScreen.js`. Requires a physical device — push tokens aren't available on simulators (`expo-device`'s `Device.isDevice` check handles this).
- New deps: `expo-notifications`, `expo-device`.

### Saved / favorite addresses

- Backend: `savedAddresses` array on `User` (`label`, `address`, `lat`, `lng`); `GET/POST/DELETE /api/users/addresses`.
- Mobile: on `MapScreen`, once a dropoff is picked, a "☆ Save" link opens a small modal to label it (e.g. "Home", "Work"). Before a dropoff is picked, saved places show as tappable chips that instantly set the dropoff and fetch a fare estimate. `SavedAddressesScreen.js` (reachable from Profile → "📍 Saved Places") lists and lets you remove them.

### Security & hardening (applied)

- **Helmet** security headers on all responses.
- **Rate limiting**: global (500 / 15 min) + stricter auth limiter (30 / 15 min per IP).
- **CORS / Socket.IO origins** configurable via `CORS_ORIGINS` (comma-separated; `*` only for local dev).
- **Request body size** limited to 100kb (JSON / urlencoded).
- **Input validation** via `express-validator` on auth, rides, payments, addresses, and admin vehicle routes.
- **Password rules**: min 8 chars, must include a letter and a number.
- **JWT**: fails startup if `JWT_SECRET` missing/weak; default expiry `7d` (override with `JWT_EXPIRES_IN`).
- **Socket.IO**: JWT required on connect; role + ownership checks on every sensitive event; users join private `user:<id>` rooms.
- **Ride completion**: only assigned driver; status gate; final fare bounded server-side.
- **Payment verify**: ownership check (rider or admin).
- **Admin vehicle** create/update: whitelist of allowed fields (no mass-assignment).
- **Morgan** request logging (`dev` locally, `combined` in production).
- **Global error handler** + 404 handler; production hides stack details.
- Phone numbers normalized (strip spaces/dashes) on register/login.

After pulling these changes run:

```bash
cd backend && npm install
```

### Redis, OTP, refresh tokens, audit logs & tests

**Redis (optional)**  
Set `REDIS_URL`. When available:
- Driver locations are stored with Redis `GEOADD` / `GEORADIUS` for nearest-driver matching across instances.
- Socket.IO uses `@socket.io/redis-adapter` so events work across multiple backend replicas.
- OTPs are stored in Redis with TTL.  
If Redis is down, the server falls back to in-memory maps and still starts.

**OTP via Termii**  
```
POST /api/auth/send-otp     { phone }
POST /api/auth/verify-otp   { phone, code, fullName? }  → access + refresh tokens
```
Without `TERMII_API_KEY`, the OTP is printed to the server log and returned as `debugCode` in non-production so you can test locally.

**Password register requires OTP** — `POST /api/auth/register` must include a valid `otpCode` from a prior `send-otp`. Tokens are only issued after the phone is verified. Prefer `POST /api/auth/verify-otp` for OTP-only accounts. Login with phone+password still works for existing verified accounts.

**Logout** — `POST /api/auth/logout` with `{ refreshToken }` revokes that session (no auth required). `{ all: true }` requires a Bearer access token and revokes every refresh token for that user.

**Concurrent rides** — a rider cannot request a new ride while they still have one in `pending`/`accepted`/`arrived`/`started` (HTTP 409).

**Complete ride** — only from `started` (or `arrived`, which auto-starts then completes). `finalFare` is always stored as integer Naira for exact Paystack kobo conversion.

**Ride history PII** — `GET /api/rides/history` masks the other party's phone (`***1234`); only your own number is returned in full.

**Admin lists** — `/api/admin/users|rides|vehicles` return `{ items, nextCursor, hasMore, limit }` with cursor pagination (`?limit=50&cursor=<ISO date>`).

**Live utilization** — pricing uses `busyDrivers / onlineDrivers` (Redis GEO count or Mongo fallback) instead of a fixed 50%.

**OTP optional password** — same strength rules as register (8+ chars, letter + number) when a password is supplied on `verify-otp`.

**Mobile / driver API URL** — set `expo.extra.apiUrl` in each app’s `app.json` (or `EXPO_PUBLIC_API_URL` at build time). A placeholder host logs a dev warning; sockets and HTTP share the same resolved URL.

**Admin token refresh** — admin panel stores access + refresh tokens and rotates on 401, same pattern as the mobile apps. Logout revokes the refresh session server-side.

**Audit durability** — critical events (login success/failure, suspend/reactivate) await the write; other events are fire-and-forget with a small in-memory retry buffer and flush on process signals.

**Errors** — production clients always get generic 500 messages; server logs are structured JSON with a `requestId` echoed in the response for support correlation.

**Refresh token rotation**  
- Access token: short-lived (`JWT_ACCESS_EXPIRES`, default `15m`)
- Refresh token: long-lived (`REFRESH_TOKEN_DAYS`, default 30), stored hashed in MongoDB
- `POST /api/auth/refresh` { refreshToken } → new pair; **reuse of an old refresh token revokes the whole session family**
- `POST /api/auth/logout` { refreshToken } or `{ all: true }` (with Bearer) to revoke

**Audit logs**  
Sensitive actions (login, OTP, ride complete, suspend user, etc.) are written to the `AuditLog` collection (90-day TTL). Critical auth/admin actions await the write; others are buffered for retry. Admins can read them at `GET /api/admin/audit-logs`.

**Tests**  
```bash
cd backend && npm install && npm test
```
Uses `mongodb-memory-server` + Jest + Supertest. Covers register/login, OTP, refresh rotation, ride ownership, and rating rules.
