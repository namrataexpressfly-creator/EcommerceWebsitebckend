
import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, default: "" },
    image_url: { type: String, default: "" },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

categorySchema.index({ seller_id: 1, slug: 1 }, { unique: true });

export default mongoose.model("Category", categorySchema);
