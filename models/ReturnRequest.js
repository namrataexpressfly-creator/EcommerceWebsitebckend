import mongoose from "mongoose";

const returnRequestSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    reason: { type: String, required: true },
    items: [
      {
        product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        quantity: Number,
      },
    ],
    status: {
      type: String,
      enum: ["requested", "approved", "rejected", "refunded"],
      default: "requested",
    },
    refund_amount: { type: Number, default: 0 },

    razorpay_refund_id: { type: String, default: null },
    admin_note: { type: String, default: "" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

returnRequestSchema.index({ seller_id: 1, status: 1 });

export default mongoose.model("ReturnRequest", returnRequestSchema);
