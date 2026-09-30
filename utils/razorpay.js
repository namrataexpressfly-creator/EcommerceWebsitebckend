import Razorpay from "razorpay";
import { decryptSecret } from "./crypto.js";

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

let razorpayInstance = null;

console.log("=================================");
console.log("RAZORPAY CONFIGURATION");
console.log("=================================");

console.log(
  "RAZORPAY_KEY_ID:",
  RAZORPAY_KEY_ID ? "LOADED" : "MISSING"
);

console.log(
  "RAZORPAY_KEY_SECRET:",
  RAZORPAY_KEY_SECRET ? "LOADED" : "MISSING"
);

console.log("=================================");

if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
  razorpayInstance = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
  });

  console.log("✅ Razorpay initialized successfully");
} else {
  console.error(
    "❌ Razorpay is NOT configured."
  );

  console.error(
    "Please check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env"
  );
}

export function isRazorpayConfigured() {
  return Boolean(
    RAZORPAY_KEY_ID &&
    RAZORPAY_KEY_SECRET
  );
}

export function getRazorpay() {
  if (!isRazorpayConfigured()) {
    throw new Error(
      "Razorpay is not configured. Please check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET."
    );
  }

  if (!razorpayInstance) {
    razorpayInstance = new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET,
    });
  }

  return razorpayInstance;
}

export function getRazorpayKeyId() {
  return RAZORPAY_KEY_ID;
}

export function getRazorpayForSeller(storefrontConfig) {
  const settings = storefrontConfig?.payment_settings || {};

  if (settings.razorpay_mode === "own" && settings.own_razorpay_key_id && settings.own_razorpay_key_secret_enc) {
    const key_secret = decryptSecret(settings.own_razorpay_key_secret_enc);
    return {
      client: new Razorpay({ key_id: settings.own_razorpay_key_id, key_secret }),
      key_id: settings.own_razorpay_key_id,
      mode: "own",
    };
  }

  return { client: getRazorpay(), key_id: RAZORPAY_KEY_ID, mode: "platform" };
}


export function getRazorpaySecretForSeller(storefrontConfig) {
  const settings = storefrontConfig?.payment_settings || {};

  if (settings.razorpay_mode === "own" && settings.own_razorpay_key_id && settings.own_razorpay_key_secret_enc) {
    return decryptSecret(settings.own_razorpay_key_secret_enc);
  }

  return RAZORPAY_KEY_SECRET;
}
