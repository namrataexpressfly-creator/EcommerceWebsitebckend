import mongoose from "mongoose";

const warehouseStockSchema = new mongoose.Schema(
  {
    warehouse_id: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", required: true },
    qty: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const combinationSchema = new mongoose.Schema(
  {
    option_values: { type: Map, of: String, required: true }, 
    label: { type: String, default: "" }, 
    sku: { type: String, required: true },
    price: { type: Number, default: null },
    images: { type: [String], default: [] },
    stock: { type: Number, default: 0 },

    warehouse_stock: { type: [warehouseStockSchema], default: [] },
    discount_type: { type: String, enum: ["percentage", "flat"], default: "percentage" },
    discount_percentage: { type: Number, default: 0 },
    tax_type: { type: String, enum: ["percentage", "flat"], default: "percentage" },
    tax_percentage: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
  },
  { _id: true }
);

const selectedVariantSchema = new mongoose.Schema(
  {
    variant_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductVariant", default: null },
    name: { type: String, required: true },
    options: [{ type: String }],
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    category_id: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true }, 
    compare_at_price: { type: Number, default: null }, 
    images: [{ type: String }],
    stock_qty: { type: Number, default: 0 },
    sold_count: { type: Number, default: 0 },

    warehouse_stock: { type: [warehouseStockSchema], default: [] },
    sku: { type: String, default: null },
    tags: [{ type: String }],
    is_active: { type: Boolean, default: true },

    discount_type: { type: String, enum: ["percentage", "flat"], default: "percentage" },
    discount_percentage: { type: Number, default: 0 },
    tax_type: { type: String, enum: ["percentage", "flat"], default: "percentage" },
    tax_percentage: { type: Number, default: 0 },

    length_cm: { type: Number, default: null },
    width_cm: { type: Number, default: null },
    height_cm: { type: Number, default: null },
    weight_kg: { type: Number, default: null },


    product_type: { type: String, enum: ["simple", "variable"], default: "simple" },
    variants: { type: [selectedVariantSchema], default: [] },
    combination_separator: { type: String, default: "-" },
    combinations: { type: [combinationSchema], default: [] },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

productSchema.index({ seller_id: 1, slug: 1 }, { unique: true });

productSchema.index({ name: "text", description: "text", tags: "text" });

export default mongoose.model("Product", productSchema);
