# Testing custom domains locally

Real DNS TXT verification needs a domain you actually control. To test the
*routing* (custom domain → storefront rendered at "/") without owning one,
use the dev helper script below. It bypasses the real DNS lookup and marks
a domain "verified" directly in the database — **never run it against a
production database.**

## 1. Seed a demo store (if you haven't already)

```bash
npm run seed
```

Creates seller `demo@expressfly.test` / password `password123`, store slug
`demo-store`.

## 2. Connect + force-verify a test domain

```bash
npm run test:domain -- myteststore.local
```

Optionally target a different seller:

```bash
npm run test:domain -- myteststore.local someone@yourapp.test
```

To remove it again:

```bash
npm run test:domain -- --remove
```

## 3. Point the fake domain at your own machine

Edit your hosts file as Administrator:

- Windows: `C:\Windows\System32\drivers\etc\hosts`
- macOS/Linux: `/etc/hosts`

Add:

```
127.0.0.1  myteststore.local
```

## 4. Start both servers

```bash
# backend
npm run dev

# frontend (separate terminal)
cd ../frontend
npm run dev
```

The frontend's `vite.config.js` already has `allowedHosts: true` for local
dev, so it will accept requests for `myteststore.local`.

## 5. Visit it

Open `http://myteststore.local:5173` (or whatever port Vite prints). The
frontend detects this isn't a platform host (see `VITE_PLATFORM_HOSTS` in
`frontend/.env`), calls `/store/by-domain/myteststore.local`, and renders
the storefront at `/` instead of `/store/:slug`.

## 6. Testing the real DNS verification flow

This part genuinely needs a domain you own:

1. In the seller dashboard → Settings → Custom domain, connect your real
   domain. You'll get back a CNAME and TXT record.
2. Add both records at your registrar's DNS panel.
3. Wait for propagation (can take minutes to a few hours).
4. Click **Verify domain** — this does a real `dns.resolveTxt` lookup
   against `_expressfly-verify.<your-domain>`.
