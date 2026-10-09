import mongoose from "mongoose";
import { nanoid } from "nanoid";

const orderItemSchema = new mongoose.Schema(
  {
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    discount_amount: { type: Number, default: 0 },
    tax_amount: { type: Number, default: 0 },

    combination_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    variant_label: { type: String, default: "" },

    allocations: [
      {
        warehouse_id: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse" },
        qty: { type: Number, min: 1 },
        _id: false,
      },
    ],
  },
  { _id: false }
);

const statusEventSchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },

    tracking_token: { type: String, required: true, unique: true, default: () => nanoid(12) },

    items: [orderItemSchema],

    pickup_warehouse_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "Warehouse" }],
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    item_discount: { type: Number, default: 0 },
    tax_amount: { type: Number, default: 0 },
    shipping: { type: Number, default: 0 },
    cod_charge: { type: Number, default: 0 },
    total_amount: { type: Number, required: true },

    coupon_code: { type: String, default: null },

    payment_method: { type: String, enum: ["online", "cod"], default: "online" },
    payment_status: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded", "cod_pending"],
      default: "pending",
    },
    razorpay_order_id: { type: String, default: null },
    razorpay_payment_id: { type: String, default: null },
    paid_at: { type: Date, default: null },

    platform_fee: { type: Number, default: 0 },
    seller_payout_amount: { type: Number, default: 0 },
    transfer_id: { type: String, default: null },
    transfer_status: {
      type: String,
      enum: ["not_applicable", "pending", "processed", "failed"],
      default: "not_applicable",
    },

    shipping_address: {
      name: String,
      phone: String,
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String,
    },

    status: {
      type: String,
      enum: ["pending", "confirmed", "packed", "shipped", "out_for_delivery", "delivered", "cancelled", "returned"],
      default: "pending",
    },
    status_history: [statusEventSchema],

    shipment: {
      type: {
        type: String,
        enum: ["standard", "express", "self_pickup"],
        default: "standard",
      },

      courier_partner: { type: String, default: null },
      plugin_id: { type: mongoose.Schema.Types.ObjectId, ref: "Plugin", default: null },
      awb_number: { type: String, default: null },
      tracking_url: { type: String, default: null },
      estimated_delivery: { type: Date, default: null },
    },

    otp_verified: { type: Boolean, default: false },
    is_flagged: { type: Boolean, default: false },

    is_active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

orderSchema.index({ seller_id: 1, status: 1 });
orderSchema.index({ seller_id: 1, created_at: -1 });

export default mongoose.model("Order", orderSchema);
