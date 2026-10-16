# Expressfly Courier API (v1)

Implement these endpoints on your own domain and a developer can connect your courier to Expressfly by entering only that domain. Everything below is fixed: paths, headers and field names.

## Basics

**Headers sent on every request**

| Header | Value |
|---|---|
| `Content-Type` | application/json |
| `Accept` | application/json |
| `X-Expressfly-Version` | 1 |
| `Authorization` | Bearer <token> (every endpoint except /login) |

- All requests are HTTP POST with a JSON body. Use HTTPS in production.
- Success: HTTP 200 with `"success": true` plus the fields below.
- Failure: any non-2xx status, or HTTP 200 with `"success": false`. Always include a human readable `"message"`; Expressfly shows it to the seller.
- Calls time out after 15 seconds.
- If a call returns 401, Expressfly logs in again once and retries.

**Error example**

```json
{
  "success": false,
  "message": "Pincode 110099 is not serviceable."
}
```

## Endpoints

| # | Endpoint | Method | Default path |
|---|---|---|---|
| 1 | Login | POST | `/login` |
| 2 | Create warehouse | POST | `/create-warehouse` |
| 3 | Rate calculator (get rates) | POST | `/get-rates` |
| 4 | Quick ship (create shipment) | POST | `/ship-orders` |
| 5 | Set tracking webhook URL | POST | `/set-webhook-url` |

The developer can change a path when connecting your courier, but the defaults above are used if they do not.

### 1. Login

`POST {your-domain}/login`

**Called:** When a seller connects the courier, and again automatically shortly before the token expires.

**Request**

```json
{
  "username": "urbanstyle_store",
  "password": "s3cret-pass"
}
```

**Response**

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "expires_in": 3600
}
```

- `expires_in` is in seconds. Expressfly stores the token and logs in again about 60 seconds before it expires.

### 2. Create warehouse

`POST {your-domain}/create-warehouse`

**Called:** Before the first rate check or shipment from a pickup warehouse, and again if the seller edits that warehouse.

**Request**

```json
{
  "warehouse_ref": "65f1c0a2b4e8d91234567890",
  "name": "Main Warehouse",
  "code": "MUM01",
  "phone": "9876543210",
  "address": {
    "line1": "Plot 12, MIDC",
    "line2": "Andheri East",
    "city": "Mumbai",
    "state": "Maharashtra",
    "pincode": "400093",
    "country": "IN"
  }
}
```

**Response**

```json
{
  "success": true,
  "warehouse_id": "CW-10045"
}
```

- `warehouse_ref` is Expressfly's own id. Calling this again with the same `warehouse_ref` must update the warehouse and return the same `warehouse_id`.
- Expressfly sends your `warehouse_id` back in /get-rates and /ship-orders.

### 3. Rate calculator (get rates)

`POST {your-domain}/get-rates`

**Called:** When a seller clicks Ship on an order and picks this courier.

**Request**

```json
{
  "warehouse_id": "CW-10045",
  "pickup_pincode": "400093",
  "delivery_pincode": "110001",
  "payment_mode": "cod",
  "cod_amount": 1499,
  "declared_value": 1499,
  "weight_kg": 0.75,
  "length_cm": 25,
  "width_cm": 18,
  "height_cm": 6
}
```

**Response**

```json
{
  "success": true,
  "rates": [
    {
      "id": "RATE-7f3a91",
      "courier_name": "Mock Express",
      "charge": 96.5,
      "currency": "INR",
      "eta": "2 days"
    },
    {
      "id": "RATE-7f3a92",
      "courier_name": "Mock Standard",
      "charge": 61,
      "currency": "INR",
      "eta": "5 days"
    }
  ]
}
```

- `payment_mode` is `prepaid` or `cod`. `cod_amount` is 0 for prepaid orders.
- Return one entry per service you offer. Each `id` must be unique and is sent back in /ship-orders as `rate_id`.
- Return `"rates": []` (still `success: true`) if you cannot deliver to the pincode.

### 4. Quick ship (create shipment)

`POST {your-domain}/ship-orders`

**Called:** When the seller confirms a rate.

**Request**

```json
{
  "rate_id": "RATE-7f3a91",
  "order_id": "TRK-9X2KQ7",
  "warehouse_id": "CW-10045",
  "payment_mode": "cod",
  "cod_amount": 1499,
  "declared_value": 1499,
  "package": {
    "weight_kg": 0.75,
    "length_cm": 25,
    "width_cm": 18,
    "height_cm": 6
  },
  "pickup": {
    "name": "Main Warehouse",
    "phone": "9876543210",
    "line1": "Plot 12, MIDC",
    "line2": "Andheri East",
    "city": "Mumbai",
    "state": "Maharashtra",
    "pincode": "400093"
  },
  "delivery": {
    "name": "Asha Verma",
    "phone": "9123456780",
    "line1": "14 Park Street",
    "line2": "",
    "city": "New Delhi",
    "state": "Delhi",
    "pincode": "110001"
  },
  "items": [
    {
      "name": "Cotton Kurta",
      "sku": "KUR-001",
      "quantity": 1,
      "price": 1499
    }
  ]
}
```

**Response**

```json
{
  "success": true,
  "awb": "77052358062",
  "courier_name": "Mock Express",
  "tracking_url": "https://courier.example/track/77052358062",
  "label_url": "https://courier.example/labels/77052358062.pdf",
  "estimated_delivery": "2026-10-10T00:00:00Z"
}
```

- `rate_id` is the `id` you returned from /get-rates.
- `awb` is required. `tracking_url`, `label_url` and `estimated_delivery` (ISO 8601) are optional but recommended.
- `order_id` is Expressfly's tracking id for the order. Treat a repeated `order_id` as a duplicate and return the existing shipment.

### 5. Set tracking webhook URL

`POST {your-domain}/set-webhook-url`

**Called:** When the seller connects the courier (and whenever they save their credentials again).

**Request**

```json
{
  "webhook_secret": "Xk29...",
  "track_order_endpoint": "https://api.expressfly.example/api/webhook/plugin/65f1c0a2b4e8d9123456aaaa/Xk29..."
}
```

**Response**

```json
{
  "success": true
}
```

- Store `webhook_secret` and `track_order_endpoint` against this seller's account and call it every time a shipment's status changes (see below).
- The URL contains a secret. Keep it private and use it exactly as given. Calling this endpoint again replaces the URL.

## Tracking webhook (you call Expressfly)

Send an HTTP POST with a JSON body to the `track_order_endpoint` you received from /set-webhook-url every time a shipment gets a new scan. Expressfly finds the shipment by `awb`.

**Request**

```json
{
  "_id": "6a4606a8b73ec8dabf214189",
  "order_no": "#EXP258876314",
  "awb": 77052358062,
  "last_tracking_status": "Created",
  "tracking_logs": [
    {
      "scan_date_time": "2026-07-02T06:43:45.031Z",
      "scan": "Order Created",
      "order_status_id": 1,
      "location": "System",
      "remark": "Order Created Successfully",
      "longitude": "",
      "latitude": "",
      "_id": "6a4608a1b73ec8dabf21452c"
    }
  ],
  "event_type": "TRACKING_UPDATED"
}
```

| Field | | Meaning |
|---|---|---|
| `event_type` | optional | `TRACKING_UPDATED`. Any other value is acknowledged and ignored. |
| `awb` | required | The AWB you returned from /ship-orders (text or number). This is how Expressfly finds the shipment. |
| `last_tracking_status` | required* | The shipment's current status. Use one of the labels in the table below. *Optional if `tracking_logs` has at least one entry. |
| `tracking_logs` | required* | List of scans, newest or oldest first. Send the new scan(s), or the whole history: scans Expressfly already has are ignored. *Optional if `last_tracking_status` is sent. |
| `tracking_logs[].scan` | recommended | Label of the scan, shown on the shipment timeline (for example `Out For Delivery`). |
| `tracking_logs[].scan_date_time` | recommended | ISO 8601 time of the scan. Defaults to the time Expressfly receives it. |
| `tracking_logs[].remark` | optional | Free text shown on the timeline. |
| `tracking_logs[].location` | optional | Free text, added to the timeline. |
| `tracking_logs[]._id` | recommended | Your unique id for the scan. Lets Expressfly ignore a scan you send twice. |
| `tracking_logs[].order_status_id` | optional | Your numeric status code. Accepted for reference: Expressfly decides the status from `last_tracking_status`. |
| `tracking_logs[].latitude / longitude` | optional | Accepted and ignored. |
| `_id, order_no` | optional | Your own references. Accepted and ignored: Expressfly does not use them to find the shipment. |

**Status labels** (`last_tracking_status`)

| Label | Effect |
|---|---|
| `Created` | Shipment created. Recorded on the timeline only. |
| `Picked Up` | Collected from the warehouse. Order becomes Shipped. |
| `In Transit` | Moving between hubs. Order becomes Shipped. |
| `Out For Delivery` | Out with the delivery agent. Order becomes Out for delivery. |
| `Delivered` | Delivered to the customer. Order becomes Delivered. |
| `Undelivered` | A delivery attempt failed. Recorded on the timeline only. |
| `RTO Initiated` | Return to origin started. Recorded on the timeline only. |
| `RTO Delivered` | Parcel is back with the seller. Order becomes Returned. |
| `Cancelled` | Shipment cancelled. Order status updated. |

**What Expressfly answers**

- **200** — Update received

```json
{
  "success": true,
  "message": "Tracking updated."
}
```

- **200** — Nothing to do: a scan we already have, an AWB we do not know, or an unsupported event_type. Do not retry.

```json
{
  "success": true,
  "ignored": "unknown awb"
}
```

- **400** — Bad payload (unreadable JSON, missing awb, or neither last_tracking_status nor tracking_logs). Fix it, do not retry.

```json
{
  "success": false,
  "message": "awb is required."
}
```

- **401** — The URL or its secret is wrong.

```json
{
  "success": false,
  "message": "Invalid webhook URL."
}
```

- Retry only on timeouts and 5xx responses.
- Matching ignores case and punctuation, so `In Transit`, `IN_TRANSIT` and `in-transit` are the same status.
- A label that is not in the table is still recorded on the shipment timeline, but it does not change the order status.
- Once a shipment is Delivered, RTO Delivered or Cancelled, later scans are recorded on the timeline but do not change its status.
