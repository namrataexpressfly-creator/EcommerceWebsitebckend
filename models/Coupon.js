import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    discount_type: { type: String, enum: ["percentage", "flat"], required: true },
    discount_value: { type: Number, required: true },
    min_order_value: { type: Number, default: 0 },
    applies_to: { type: String, enum: ["store", "products", "category"], default: "store" },
    product_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],

    category_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
    usage_limit: { type: Number, default: null }, 
    used_count: { type: Number, default: 0 },
    valid_from: { type: Date, default: Date.now },
    valid_until: { type: Date, default: null },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

couponSchema.index({ seller_id: 1, code: 1 }, { unique: true });

export default mongoose.model("Coupon", couponSchema);
