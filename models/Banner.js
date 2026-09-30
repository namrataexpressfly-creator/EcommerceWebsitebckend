import mongoose from "mongoose";

const bannerSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    store_slug: { type: String, required: true, lowercase: true, trim: true },
    image_url: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 70 },
    subtitle: { type: String, default: "", trim: true, maxlength: 120 },
    link_url: { type: String, default: "" },
    order: { type: Number, required: true, default: 0 },
    is_active: { type: Boolean, default: true }, 
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

bannerSchema.index({ seller_id: 1, order: 1 });
bannerSchema.index({ store_slug: 1, is_active: 1, order: 1 });

export default mongoose.model("Banner", bannerSchema);