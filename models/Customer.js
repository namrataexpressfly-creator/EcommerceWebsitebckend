import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, default: "Home" }, 
    line1: { type: String, required: true },
    line2: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    is_default: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

const customerSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    name: { type: String, required: true },
    email: { type: String, default: null, lowercase: true },
    phone: { type: String, required: true },
    addresses: [addressSchema],

    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    cart: [
      {
        product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        combination_id: { type: String, default: null },
        quantity: { type: Number, default: 1 },
      },
    ],
    is_active: { type: Boolean, default: true },

    last_login_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

customerSchema.index({ seller_id: 1, phone: 1 }, { unique: true });

export default mongoose.model("Customer", customerSchema);
