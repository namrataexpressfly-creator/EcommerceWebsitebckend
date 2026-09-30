import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },

    type: {
      type: String,
      enum: ["split_created", "settled", "failed", "cod_collected", "refunded"],
      required: true,
    },

    order_total: { type: Number, required: true },
    platform_fee: { type: Number, default: 0 },
    seller_amount: { type: Number, required: true }, 

    razorpay_order_id: { type: String, default: null },
    razorpay_payment_id: { type: String, default: null },
    transfer_id: { type: String, default: null },

    note: { type: String, default: "" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

transactionSchema.index({ seller_id: 1, created_at: -1 });
transactionSchema.index({ transfer_id: 1 });

export default mongoose.model("Transaction", transactionSchema);
