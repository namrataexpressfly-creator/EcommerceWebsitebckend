import mongoose from "mongoose";

const warehouseSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: "", trim: true }, 

    address: {
      line1: { type: String, default: "" },
      line2: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      pincode: { type: String, default: "" },
    },


    location: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },


    priority: { type: Number, default: 0 },

    contact_phone: { type: String, required: true, trim: true },

    is_active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

warehouseSchema.index({ seller_id: 1, is_active: 1 });

warehouseSchema.index(
  { seller_id: 1, name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

export default mongoose.model("Warehouse", warehouseSchema);
