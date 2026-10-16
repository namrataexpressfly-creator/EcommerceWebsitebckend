export const STANDARD_VERSION = "1";

export const DEFAULT_PATHS = {
  token_generation: "/login",
  create_warehouse: "/admin/users/warehouse/create",
  get_rating: "/get-rates",
  order_create: "/ship-orders",
  set_webhook: "/admin/store-webhooks",
};


export const STANDARD_FIELDS = [
  { name: "username", label: "Username", help: "", placeholder: "", is_required: true, is_secret: false },
  { name: "password", label: "Password", help: "", placeholder: "", is_required: true, is_secret: true },
];


export const STATUS_LABELS = [
  { label: "Created", value: null, effect: "Shipment created. Recorded on the timeline only." },
  { label: "Picked Up", value: "shipped", effect: "Collected from the warehouse. Order becomes Shipped." },
  { label: "In Transit", value: "shipped", effect: "Moving between hubs. Order becomes Shipped." },
  { label: "Out For Delivery", value: "out_for_delivery", effect: "Out with the delivery agent. Order becomes Out for delivery." },
  { label: "Delivered", value: "delivered", effect: "Delivered to the customer. Order becomes Delivered." },
  { label: "Undelivered", value: null, effect: "A delivery attempt failed. Recorded on the timeline only." },
  { label: "RTO Initiated", value: null, effect: "Return to origin started. Recorded on the timeline only." },
  { label: "RTO Delivered", value: "returned", effect: "Parcel is back with the seller. Order becomes Returned." },
  { label: "Cancelled", value: "cancelled", effect: "Shipment cancelled. Order status updated." },
];
export const FINAL_SHIPMENT_STATUSES = ["delivered", "returned", "cancelled"];

export const normaliseLabel = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ALIASES = { "order created": "created", booked: "created", canceled: "cancelled" };
const BY_KEY = new Map(STATUS_LABELS.map((x) => [normaliseLabel(x.label), x]));


export function mapStandardStatus(label) {
  const key = normaliseLabel(label);
  const hit = BY_KEY.get(ALIASES[key] || key);
  return hit ? { known: true, label: hit.label, value: hit.value } : { known: false, label: String(label ?? "").trim(), value: null };
}


const COMMON = { "Content-Type": "application/json", "X-Expressfly-Version": STANDARD_VERSION };
const AUTH = { ...COMMON, Authorization: "Bearer {{token}}" };

const person = (p) => ({
  name: `{{${p}.name}}`,
  phone: `{{${p}.phone}}`,
  line1: `{{${p}.line1}}`,
  line2: `{{${p}.line2}}`,
  city: `{{${p}.city}}`,
  state: `{{${p}.state}}`,
  pincode: `{{${p}.pincode}}`,
});

export function buildStandardApis(paths = {}) {
  const p = (k) => String(paths[k] || DEFAULT_PATHS[k]).trim();
  return [
    {
      api_type: "token_generation",
      path: p("token_generation"),
      method: "POST",
      response_type: "json",
      headers: { ...COMMON },
      parameter: { username: "{{username}}", password: "{{password}}" },
      response_mapping: { token: "token", expires_in: "expires_in" },
    },
    {
      api_type: "create_warehouse",
      path: p("create_warehouse"),
      method: "POST",
      response_type: "json",
      headers: { ...AUTH },
      parameter: {
        ware_house_name: "{{pickup.name}}",
        contact_person_name: "{{pickup.contact_name}}",
        contact_no: "{{pickup.phone10}}",
        pincode: "{{pickup.pincode}}",
        address_line1: "{{pickup.address_line}}",
        city: "{{pickup.city}}",
        state: "{{pickup.state}}",
      },
  
      response_mapping: { warehouse_id: "_id" },
    },
    {
      api_type: "get_rating",
      path: p("get_rating"),
      method: "POST",
      response_type: "json",
      headers: { ...AUTH },

      parameter: {
        delivery_pincode: "{{delivery.pincode_number}}",
        pickup_pincode: "{{pickup.pincode_number}}",
        dimensions: {
          length: "{{package.dim_length}}",
          width: "{{package.dim_width}}",
          height: "{{package.dim_height}}",
        },
        order_value: "{{order.subtotal}}",
        payment_type: "{{payment.type}}",
        weight: "{{package.chargeable_weight_kg}}",
      },
      response_mapping: { rates: "rates", rate_item: { id: "id", name: "courier_name", charge: "charge", eta: "eta" } },
    },
    {
      api_type: "order_create",
      path: p("order_create"),
      method: "POST",
      response_type: "json",
      headers: { ...AUTH },
 
      parameter: {
        logistic_id: "{{rate.id}}",
        name: "{{delivery.name}}",
        mobile_no: "{{delivery.phone10}}",
        alternate_mobile_no: null,
        email_id: "{{delivery.email}}",
        shipment_type: 0,
        receiver_address: "{{delivery.address_line}}",
        receiver_pincode: "{{delivery.pincode}}",
        receiver_city: "{{delivery.city}}",
        receiver_state: "{{delivery.state}}",
        receiver_landmark: null,
        order_no: "{{order.number}}",
        order_type: "{{payment.order_type}}",
        product_quantity: "{{order.quantity}}",
        cod_amount: "{{payment.cod_amount}}",
        product_discount: "{{order.discount}}",
        order_total_tax_amount: "{{order.tax}}",
        order_total_shipping_amount: "{{order.shipping}}",
        order_value: "{{order.subtotal}}",
        physical_weight: "{{package.weight_kg}}",
        product_length: "{{package.dim_length}}",
        product_width: "{{package.dim_width}}",
        product_height: "{{package.dim_height}}",
        dead_weight: "{{package.weight_kg}}",
        chargeable_weight: "{{package.chargeable_weight_kg}}",
        eway_bill_number: null,
        productdetatis: "{{items_courier}}",
        pickup_address_id: "{{courier_warehouse_id}}",
      },
      response_mapping: {
        awb: "awb",
        courier_name: "courier_name",
        tracking_url: "tracking_url",
        label_url: "label_url",
        estimated_delivery: "estimated_delivery",
      },
    },
    {
      api_type: "set_webhook",
      path: p("set_webhook"),
      method: "POST",
      response_type: "json",
      headers: { ...AUTH },

      parameter: {
        webhook_secret: "{{webhook_secret}}",
        track_order_endpoint: "{{tracking_url}}",
      },
      response_mapping: {},
    },
  ];
}

export function buildStandardFields(input = []) {
  return STANDARD_FIELDS.map((base) => {
    const given = (input || []).find((a) => a?.name === base.name) || {};
    return {
      ...base,
      label: String(given.label || "").trim() || base.label,
      help: String(given.help || "").trim(),
      placeholder: String(given.placeholder || "").trim(),
    };
  });
}

const LEGACY_DEFAULT_PATHS = {
  create_warehouse: "/create-warehouse",
  set_webhook: "/set-webhook-url",
};

export function pathsFromApis(apis = []) {
  const out = {};
  for (const a of apis) {
    if (!DEFAULT_PATHS[a.api_type]) continue;
    out[a.api_type] = LEGACY_DEFAULT_PATHS[a.api_type] === String(a.path || "").trim() ? DEFAULT_PATHS[a.api_type] : a.path;
  }
  return out;
}

export function validateStandardPaths(paths = {}) {
  for (const [key, value] of Object.entries(paths || {})) {
    if (!DEFAULT_PATHS[key]) return `Unknown endpoint "${key}".`;
    const v = String(value || "").trim();
    if (!v) continue; // blank = use the default
    if (!v.startsWith("/") || v.startsWith("//") || /[:{}\s]/.test(v.replace(/^\//, ""))) {
      return `The path for ${key} must look like /login (starting with /, no spaces, no http://).`;
    }
  }
  return null;
}


const PICKUP = { name: "Main Warehouse", phone: "9876543210", line1: "Plot 12, MIDC", line2: "Andheri East", city: "Mumbai", state: "Maharashtra", pincode: "400093" };
const DELIVERY = { name: "Asha Verma", phone: "9123456780", line1: "14 Park Street", line2: "", city: "New Delhi", state: "Delhi", pincode: "110001" };

export const STANDARD_CONTRACT = {
  version: STANDARD_VERSION,
  title: "Expressfly Courier API",
  intro:
    "Implement these endpoints on your own domain and a developer can connect your courier to Expressfly by entering only that domain. " +
    "Everything below is fixed: paths, headers and field names.",
  common: {
    headers: [
      ["Content-Type", "application/json"],
      ["Accept", "application/json"],
      ["X-Expressfly-Version", "1"],
      ["Authorization", "Bearer <token> (every endpoint except /login)"],
    ],
    rules: [
      "All requests are HTTP POST with a JSON body. Use HTTPS in production.",
      'Success: HTTP 200 with `"success": true` plus the fields below.',
      'Failure: any non-2xx status, or HTTP 200 with `"success": false`. Always include a human readable `"message"`; Expressfly shows it to the seller.',
      "Calls time out after 15 seconds.",
      "If a call returns 401, Expressfly logs in again once and retries.",
    ],
    error_example: { success: false, message: "Pincode 110099 is not serviceable." },
  },
  endpoints: [
    {
      key: "token_generation",
      title: "Login",
      method: "POST",
      path: DEFAULT_PATHS.token_generation,
      when: "When a seller connects the courier, and again automatically shortly before the token expires.",
      request: { username: "urbanstyle_store", password: "s3cret-pass" },
      response: { success: true, token: "eyJhbGciOiJIUzI1NiJ9...", expires_in: 3600 },
      notes: ["`expires_in` is in seconds. Expressfly stores the token and logs in again about 60 seconds before it expires."],
    },
    {
      key: "create_warehouse",
      title: "Create warehouse",
      method: "POST",
      path: DEFAULT_PATHS.create_warehouse,
      when: "Before the first rate check or shipment from a pickup warehouse, and again if the seller edits that warehouse.",
      request: {
        ware_house_name: PICKUP.name,
        contact_person_name: "Amit",
        contact_no: "9876543210",
        pincode: PICKUP.pincode,
        address_line1: PICKUP.line1,
        city: PICKUP.city,
        state: PICKUP.state,
      },
      response: { status: 1, message: "Warehouse address added successfully.", data: { _id: "6a16e370b6d62034488a493a", warehouse_name: PICKUP.name } },
      notes: [
        "`data._id` is the pickup address id. Expressfly sends it back as `pickup_address_id` when it creates a shipment.",
        "`contact_no` is a 10-digit number. `address_line1` contains the full street address.",
      ],
    },
    {
      key: "get_rating",
      title: "Rate calculator (get rates)",
      method: "POST",
      path: DEFAULT_PATHS.get_rating,
      when: "When a seller clicks Ship on an order and picks this courier.",
      request: {
        delivery_pincode: Number(DELIVERY.pincode),
        pickup_pincode: Number(PICKUP.pincode),
        dimensions: { length: 25, width: 18, height: 6 },
        order_value: 1499,
        payment_type: "cod",
        weight: 0.75,
      },
      response: {
        success: true,
        rates: [
          { id: "RATE-7f3a91", courier_name: "Mock Express", charge: 96.5, currency: "INR", eta: "2 days" },
          { id: "RATE-7f3a92", courier_name: "Mock Standard", charge: 61, currency: "INR", eta: "5 days" },
        ],
      },
      notes: [
        "`payment_mode` is `prepaid` or `cod`. `cod_amount` is 0 for prepaid orders.",
        "Return one entry per service you offer. Each `id` must be unique and is sent back in /ship-orders as `rate_id`.",
        "Return `\"rates\": []` (still `success: true`) if you cannot deliver to the pincode.",
      ],
    },
    {
      key: "order_create",
      title: "Quick ship (create shipment)",
      method: "POST",
      path: DEFAULT_PATHS.order_create,
      when: "When the seller confirms a rate.",
      request: {
        logistic_id: "69afed0f1ded2bbd26ca3265",
        name: DELIVERY.name,
        mobile_no: "9033786187",
        alternate_mobile_no: null,
        email_id: null,
        shipment_type: 0,
        receiver_address: DELIVERY.line1,
        receiver_pincode: DELIVERY.pincode,
        receiver_city: DELIVERY.city,
        receiver_state: DELIVERY.state,
        receiver_landmark: null,
        order_no: "TRK-9X2KQ7",
        order_type: 1,
        product_quantity: 1,
        cod_amount: 1499,
        product_discount: 0,
        order_total_tax_amount: 0,
        order_total_shipping_amount: 0,
        order_value: 1499,
        physical_weight: 0.75,
        product_length: 25,
        product_width: 18,
        product_height: 6,
        dead_weight: 0.75,
        chargeable_weight: 0.75,
        eway_bill_number: null,
        productdetatis: [{ product_sku: "KUR-001", product_name: "Cotton Kurta", product_quantity: 1, product_value: 1499, actual_value: 0, gst_tax: 0 }],
        pickup_address_id: "6a16e370b6d62034488a493a",
      },
      response: {
        status: 1,
        message: "Order created and shipped successfully",
        data: {
          order_id: "6a60b827ca1cbccb0b7fa9d8",
          awb: "77887990250",
          shipping_label_url: "https://courier.example/api/admin/shipping_label/generate/pdf/6a60b827ca1cbccb0b7fa9d8",
          logistic_id: "69afed0f1ded2bbd26ca3265",
        },
      },
      notes: [
        "`logistic_id` is the `logistic_id` of the rate the seller picked in the rate calculator. `pickup_address_id` is the `data._id` returned when the warehouse was created.",
        "`order_type` is 0 for prepaid and 1 for cash on delivery (`cod_amount` is 0 for prepaid). `shipment_type` is always 0 (forward).",
        "`order_no` is Expressfly's tracking id for the order. Treat a repeated `order_no` as a duplicate.",
        "`data.awb` is required. `data.shipping_label_url` is shown to the seller as the label link.",
      ],
    },
    {
      key: "set_webhook",
      title: "Set tracking webhook URL",
      method: "POST",
      path: DEFAULT_PATHS.set_webhook,
      when: "When the seller connects the courier (and whenever they save their credentials again).",
      request: { tracking_url: "https://api.expressfly.example/api/webhook/plugin/65f1c0a2b4e8d9123456aaaa/Xk29..." },
      response: { success: true },
      notes: [
        "Store `tracking_url` against this seller's account and call it every time a shipment's status changes (see below).",
        "The URL contains a secret. Keep it private and use it exactly as given. Calling this endpoint again replaces the URL.",
      ],
    },
  ],
  tracking_webhook: {
    title: "Tracking webhook (you call Expressfly)",
    intro:
      "Send an HTTP POST with a JSON body to the `tracking_url` you received from /set-webhook-url every time a shipment gets a new scan. " +
      "Expressfly finds the shipment by `awb`.",
    request: {
      _id: "6a4606a8b73ec8dabf214189",
      order_no: "#EXP258876314",
      awb: 77052358062,
      last_tracking_status: "Created",
      tracking_logs: [
        {
          scan_date_time: "2026-07-02T06:43:45.031Z",
          scan: "Order Created",
          order_status_id: 1,
          location: "System",
          remark: "Order Created Successfully",
          longitude: "",
          latitude: "",
          _id: "6a4608a1b73ec8dabf21452c",
        },
      ],
      event_type: "TRACKING_UPDATED",
    },
    fields: [
      ["event_type", "optional", "`TRACKING_UPDATED`. Any other value is acknowledged and ignored."],
      ["awb", "required", "The AWB you returned from /ship-orders (text or number). This is how Expressfly finds the shipment."],
      ["last_tracking_status", "required*", "The shipment's current status. Use one of the labels in the table below. *Optional if `tracking_logs` has at least one entry."],
      ["tracking_logs", "required*", "List of scans, newest or oldest first. Send the new scan(s), or the whole history: scans Expressfly already has are ignored. *Optional if `last_tracking_status` is sent."],
      ["tracking_logs[].scan", "recommended", "Label of the scan, shown on the shipment timeline (for example `Out For Delivery`)."],
      ["tracking_logs[].scan_date_time", "recommended", "ISO 8601 time of the scan. Defaults to the time Expressfly receives it."],
      ["tracking_logs[].remark", "optional", "Free text shown on the timeline."],
      ["tracking_logs[].location", "optional", "Free text, added to the timeline."],
      ["tracking_logs[]._id", "recommended", "Your unique id for the scan. Lets Expressfly ignore a scan you send twice."],
      ["tracking_logs[].order_status_id", "optional", "Your numeric status code. Accepted for reference: Expressfly decides the status from `last_tracking_status`."],
      ["tracking_logs[].latitude / longitude", "optional", "Accepted and ignored."],
      ["_id, order_no", "optional", "Your own references. Accepted and ignored: Expressfly does not use them to find the shipment."],
    ],
    statuses: STATUS_LABELS.map((x) => [x.label, x.effect]),
    responses: [
      { status: 200, when: "Update received", body: { success: true, message: "Tracking updated." } },
      {
        status: 200,
        when: "Nothing to do: a scan we already have, an AWB we do not know, or an unsupported event_type. Do not retry.",
        body: { success: true, ignored: "unknown awb" },
      },
      {
        status: 400,
        when: "Bad payload (unreadable JSON, missing awb, or neither last_tracking_status nor tracking_logs). Fix it, do not retry.",
        body: { success: false, message: "awb is required." },
      },
      { status: 401, when: "The URL or its secret is wrong.", body: { success: false, message: "Invalid webhook URL." } },
    ],
    notes: [
      "Retry only on timeouts and 5xx responses.",
      "Matching ignores case and punctuation, so `In Transit`, `IN_TRANSIT` and `in-transit` are the same status.",
      "A label that is not in the table is still recorded on the shipment timeline, but it does not change the order status.",
      "Once a shipment is Delivered, RTO Delivered or Cancelled, later scans are recorded on the timeline but do not change its status.",
    ],
  },
};


const json = (o) => "```json\n" + JSON.stringify(o, null, 2) + "\n```";

export function renderContractMarkdown(c = STANDARD_CONTRACT) {
  const out = [];
  out.push(`# ${c.title} (v${c.version})`, "", c.intro, "");
  out.push("## Basics", "", "**Headers sent on every request**", "", "| Header | Value |", "|---|---|");
  for (const [k, v] of c.common.headers) out.push(`| \`${k}\` | ${v} |`);
  out.push("", ...c.common.rules.map((r) => `- ${r}`), "", "**Error example**", "", json(c.common.error_example), "");
  out.push("## Endpoints", "", "| # | Endpoint | Method | Default path |", "|---|---|---|---|");
  c.endpoints.forEach((e, i) => out.push(`| ${i + 1} | ${e.title} | ${e.method} | \`${e.path}\` |`));
  out.push("", "The developer can change a path when connecting your courier, but the defaults above are used if they do not.", "");
  c.endpoints.forEach((e, i) => {
    out.push(`### ${i + 1}. ${e.title}`, "", `\`${e.method} {your-domain}${e.path}\``, "", `**Called:** ${e.when}`, "", "**Request**", "", json(e.request), "", "**Response**", "", json(e.response), "");
    if (e.notes?.length) out.push(...e.notes.map((n) => `- ${n}`), "");
  });
  const w = c.tracking_webhook;
  out.push(`## ${w.title}`, "", w.intro, "", "**Request**", "", json(w.request), "", "| Field | | Meaning |", "|---|---|---|");
  for (const [f, req, m] of w.fields) out.push(`| \`${f}\` | ${req} | ${m} |`);
  out.push("", "**Status labels** (`last_tracking_status`)", "", "| Label | Effect |", "|---|---|");
  for (const [s, m] of w.statuses) out.push(`| \`${s}\` | ${m} |`);
  out.push("", "**What Expressfly answers**", "");
  for (const r of w.responses) out.push(`- **${r.status}** — ${r.when}`, "", json(r.body), "");
  out.push(...w.notes.map((n) => `- ${n}`), "");
  return out.join("\n");
}
