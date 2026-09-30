import mongoose from "mongoose";

const abandonedCheckoutSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    customer_phone: { type: String, default: null },
    customer_email: { type: String, default: null },
    items: [
      {
        product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        name: String,
        price: Number,
        quantity: Number,
      },
    ],
    cart_value: { type: Number, required: true },
    step_reached: {
      type: String,
      enum: ["cart", "address", "otp", "payment"],
      default: "cart",
    },
    recovered: { type: Boolean, default: false }, 
    recovered_order_id: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

abandonedCheckoutSchema.index({ seller_id: 1, created_at: -1 });

export default mongoose.model("AbandonedCheckout", abandonedCheckoutSchema);
