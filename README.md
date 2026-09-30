# Expressfly Backend

A working Node.js/Express + MongoDB (Mongoose) backend implementing the Expressfly PRD:
storefront builder, single-page checkout (OTP + COD), public order tracking, seller
dashboard with MongoDB aggregation analytics, coupons, search & filter, fraud/COD
checks, returns & refunds, SEO metadata + sitemap, and an auto-generated policy module.

## OTP verification (checkout)

OTP codes are no longer kept in memory. They're stored in a dedicated `Otp`
collection (`models/Otp.js`) as a **bcrypt hash**, never in plaintext, with a
5-minute expiry. MongoDB's TTL index (`expires_at`, `expireAfterSeconds: 0`)
deletes expired codes automatically — no cron job needed — and the route also
checks the expiry explicitly since the TTL sweep runs on its own ~60s cycle.
A code is invalidated after 5 incorrect verify attempts (`429 Too Many Requests`),
and is deleted immediately on successful verification so it can't be replayed.

Delivery is via **Twilio**. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and
`TWILIO_FROM_NUMBER` in `.env` (get these from https://console.twilio.com) and
real SMS goes out to the shopper's phone (must be in E.164 format, e.g.
`+919876543210`). Leave those three blank for local development and the code
falls back to printing the OTP to the backend terminal instead — nothing else
about the flow changes, so you can develop without a Twilio account and it
works for real the moment credentials are added.

## Razorpay is genuinely optional now

The Razorpay client used to be constructed the moment the server started, and
the SDK throws synchronously if `RAZORPAY_KEY_ID` is missing — so the whole
server crashed on boot for any seller who only wanted Cash on Delivery. It's
now built lazily (`utils/razorpay.js`), only when a shopper actually picks
online payment. If `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` aren't set:
- The server starts and runs normally.
- COD checkout works exactly as before.
- `POST /api/checkout/init` returns `razorpay_enabled: false` so the frontend
  can hide the "Pay Online" option instead of letting a shopper pick it and
  hit a dead end.
- If online payment is attempted anyway, `/checkout/order` returns a clean
  `400` explaining Razorpay isn't configured, instead of crashing the process.

## What's real vs. stubbed

**Fully implemented, working logic:**
- All Mongoose schemas from the PRD (Seller, StorefrontConfig w/ section builder,
  Category, Product, Customer, Order, AbandonedCheckout, VisitLog, Coupon, FraudLog,
  Blacklist, ReturnRequest, ProductSEO, StorePolicy)
- JWT seller auth, ownership-scoped queries on every seller route
- Checkout: server-side re-pricing, coupon validation, COD fraud checks, Razorpay
  order creation, stock decrement
- Razorpay webhook (source of truth) + fast-path `/verify-payment` (same reliable
  pattern used in your earlier Razorpay demo project)
- Public order tracking by token, status timeline
- **MongoDB aggregation pipelines** for revenue-by-day, top products (via `$unwind`
  + `$group` + `$lookup`), and abandoned-checkout funnel — this is the analytics
  engine you asked for
- Coupon CRUD + application logic
- Search/filter using a MongoDB text index (`$text`) plus price/category filters
- Returns workflow (request → approve/reject → refund)
- SEO endpoints (JSON-LD structured data, sitemap.xml)
- Policy auto-generator (Privacy/Terms/Shipping/Return text built from store config)

**Stubbed / needs a real provider wired in for production:**
- Tracking notifications (SMS/WhatsApp/Email): `routes/trackingRoutes.js`
  logs the message instead of sending it
- Drag-and-drop storefront **frontend** UI: the backend fully supports it
  (`/api/seller/storefront/section`), but no React/Vue builder UI is included —
  only the API
- Refund execution: the return-approval flow updates the DB; the actual
  `razorpay.payments.refund(...)` call is noted but commented out (needs a real
  payment_id + your Razorpay Route/Refunds setup)

## Setup

```bash
npm install
cp .env.example .env   # fill in MONGO_URI, JWT_SECRET, Razorpay keys
npm run seed            # creates a demo seller + store + products + coupon
npm run dev
```

Seed creates:
- Seller login: `demo@expressfly.test` / `password123`
- Store slug: `demo-store`
- 2 products, 1 category, 1 coupon (`WELCOME10`, 10% off orders ≥ ₹300)

## Route reference

### Auth (`/api/seller`)
- `POST /register` — { name, email, phone, password, store_name, store_slug }
- `POST /login` — { email, password } → { token }
- `GET /me` — requires Bearer token

### Storefront builder
- `GET /api/store/:slug` — public, returns enabled sections in order
- `GET /api/seller/storefront` — seller, full config
- `PUT /api/seller/storefront` — update name/domain/theme
- `PUT /api/seller/storefront/section` — add/update a section block
- `DELETE /api/seller/storefront/section/:sectionId`

### Catalog (seller-side CRUD)
- `/api/seller/categories` (GET, POST, PUT :id, DELETE :id)
- `/api/seller/products` (GET, POST, PUT :id, DELETE :id)

### Search (public)
- `GET /api/store/:slug/products?q=&category=&min_price=&max_price=&sort=&page=&limit=`
- `GET /api/store/:slug/products/:productId`
- `GET /api/store/:slug/categories`

### Checkout
- `POST /api/checkout/init` — { slug, items } → priced cart
- `POST /api/checkout/otp/send` — { phone }
- `POST /api/checkout/otp/verify` — { phone, otp }
- `POST /api/checkout/coupon/apply` — { slug, code, subtotal, items }
- `POST /api/checkout/order` — creates Order (+ Razorpay order if online)
- `POST /api/checkout/verify-payment` — { razorpay_order_id, razorpay_payment_id, razorpay_signature }
- `POST /api/checkout/abandoned` — log a dropped cart

### Tracking (public)
- `GET /api/track/:token`
- `POST /api/track/notify/:channel` — channel = sms | whatsapp | email

### Dashboard (seller, JWT required)
- `GET /api/seller/orders?status=&page=&limit=`
- `PUT /api/seller/orders/:id/status`
- `GET /api/seller/analytics/revenue?from=&to=` — daily $group aggregation
- `GET /api/seller/analytics/top-products?limit=` — $unwind + $group + $lookup
- `GET /api/seller/analytics/conversion?from=&to=`
- `GET /api/seller/analytics/abandoned` — funnel breakdown by step

### Coupons (seller)
- `/api/seller/coupons` (GET, POST, PUT :id, DELETE :id)

### Fraud
- `POST /api/fraud/cod/check` — public, called before confirming a COD order
- `GET /api/seller/fraud/log`
- `POST /api/seller/fraud/blacklist`
- `GET /api/seller/fraud/blacklist`

### Returns
- `POST /api/returns/request` — public, { tracking_token, reason, items }
- `GET /api/returns/seller?status=`
- `PUT /api/returns/seller/:id/approve`
- `PUT /api/returns/seller/:id/reject`
- `PUT /api/returns/seller/:id/refund`

### SEO
- `GET /api/seo/product/:id` — public, JSON-LD structured data
- `GET /api/seo/category/:id`
- `PUT /api/seo/seller/product/:id` — seller edits meta
- `GET /api/seo/:storeSlug/sitemap.xml`

### Policies
- `POST /api/seller/policies/generate`
- `GET /api/seller/policies`
- `PUT /api/seller/policies`
- `GET /api/store/:slug/policies` — public

### Webhook
- `POST /api/webhook/razorpay` — signature-verified, source of truth for payment status

## Quick test flow

```bash
# 1. Register/login not needed if you ran the seed script — just log in:
curl -X POST http://localhost:4000/api/seller/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@expressfly.test","password":"password123"}'
# copy the returned token

# 2. Browse the public storefront
curl http://localhost:4000/api/store/demo-store/products

# 3. Init checkout with a real product_id from step 2
curl -X POST http://localhost:4000/api/checkout/init \
  -H "Content-Type: application/json" \
  -d '{"slug":"demo-store","items":[{"product_id":"<PRODUCT_ID>","quantity":1}]}'

# 4. Check revenue analytics (use the token from step 1)
curl http://localhost:4000/api/seller/analytics/revenue \
  -H "Authorization: Bearer <TOKEN>"
```
