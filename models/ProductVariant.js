import mongoose from "mongoose";

const variantOptionSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true },

    image_url: { type: String, default: "" },
    is_active: { type: Boolean, default: true },
  },
  { _id: true }
);

const productVariantSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    name: { type: String, required: true, trim: true },
    options: {
      type: [variantOptionSchema],
      validate: {
        validator: (opts) => opts.length > 0,
        message: "A variant needs at least one option.",
      },
    },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

productVariantSchema.index({ seller_id: 1, name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

export default mongoose.model("ProductVariant", productVariantSchema);
