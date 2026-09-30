import mongoose from "mongoose";

const productSEOSchema = new mongoose.Schema(
  {
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, unique: true },
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    meta_title: { type: String, default: "" },
    meta_description: { type: String, default: "" },
    og_image: { type: String, default: null },
    structured_data: { type: mongoose.Schema.Types.Mixed, default: {} }, 
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

const storePolicySchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, unique: true },
    privacy_policy: { type: String, default: "" },
    terms_and_conditions: { type: String, default: "" },
    shipping_policy: { type: String, default: "" },
    return_policy: { type: String, default: "" },
    generated_at: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);


const storePageSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, unique: true },

    about_heading: { type: String, default: "" },
    about_body: { type: String, default: "" },
    about_image_url: { type: String, default: null },

    contact_heading: { type: String, default: "" },
    contact_intro: { type: String, default: "" },
    contact_email: { type: String, default: "" },
    contact_phone: { type: String, default: "" },
    contact_address: { type: String, default: "" },
    contact_map_url: { type: String, default: null },

    generated_at: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const ProductSEO = mongoose.model("ProductSEO", productSEOSchema);
export const StorePolicy = mongoose.model("StorePolicy", storePolicySchema);
export const StorePage = mongoose.model("StorePage", storePageSchema);
