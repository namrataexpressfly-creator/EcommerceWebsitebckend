import mongoose from "mongoose";

const pendingOrderSchema = new mongoose.Schema({
  razorpay_order_id: { type: String, required: true, unique: true },

  seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
  customer_id: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },

  items: { type: Array, required: true },
  subtotal: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  item_discount: { type: Number, default: 0 },
  tax_amount: { type: Number, default: 0 },
  shipping: { type: Number, default: 0 },
  total_amount: { type: Number, required: true },

  coupon_code: { type: String, default: null },
  coupon_id: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", default: null },

  shipping_address: { type: mongoose.Schema.Types.Mixed, required: true },
  shipment_type: { type: String, default: "standard" },
  otp_verified: { type: Boolean, default: false },

  can_split: { type: Boolean, default: false },
  is_mock_account: { type: Boolean, default: false },
  platform_fee: { type: Number, default: 0 },
  seller_payout_amount: { type: Number, default: 0 },

  created_at: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
});

export default mongoose.model("PendingOrder", pendingOrderSchema);
