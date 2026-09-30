import Order from "../models/Order.js";
import { FraudLog, Blacklist } from "../models/FraudLog.js";

const COD_HIGH_VALUE_THRESHOLD = 3000; 
const REPEATED_CANCEL_WINDOW_DAYS = 30;
const REPEATED_CANCEL_LIMIT = 3;

export async function checkCodFraud({ sellerId, phone, ip, cartTotal }) {
  const reasons = [];
  let riskScore = 0;

  const blacklisted = await Blacklist.findOne({ seller_id: sellerId, phone });
  if (blacklisted) {
    reasons.push("blacklisted_phone");
    riskScore = 100;
  }

  if (cartTotal > COD_HIGH_VALUE_THRESHOLD) {
    reasons.push("cod_high_value");
    riskScore += 20;
  }

  const since = new Date(Date.now() - REPEATED_CANCEL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentCancellations = await Order.countDocuments({
    seller_id: sellerId,
    "shipping_address.phone": phone,
    status: "cancelled",
    created_at: { $gte: since },
  });
  if (recentCancellations >= REPEATED_CANCEL_LIMIT) {
    reasons.push("repeated_cod_cancellations");
    riskScore += 40;
  }

  const allowed = riskScore < 60;

  if (reasons.length > 0) {
    await FraudLog.create({
      seller_id: sellerId,
      phone,
      ip,
      reason: reasons.join(","),
      risk_score: riskScore,
      action_taken: allowed ? "flagged" : "blocked",
    });
  }

  return { allowed, riskScore, reasons };
}
