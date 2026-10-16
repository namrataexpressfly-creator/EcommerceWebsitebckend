import mongoose from "mongoose";


const storePluginSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    plugin_id: { type: mongoose.Schema.Types.ObjectId, ref: "Plugin", required: true },
    environment: { type: String, enum: ["sandbox", "live"], default: "live" },
    status: { type: String, enum: ["active", "inactive"], default: "inactive" },

 
    attributes: [
      {
        name: { type: String, required: true },
        value: { type: String, default: "" },
        _id: false,
      },
    ],

    token_cache: {
      token: { type: String, default: "" }, 
      expires_at: { type: Date, default: null },
    },


    auth_scheme: { type: String, enum: ["bearer", "raw"], default: "bearer" },

    webhook_secret: { type: String, required: true },


    webhook: {
      registered_url: { type: String, default: "" },
      registered_at: { type: Date, default: null },
    },

  
    courier_warehouses: [
      {
        warehouse_id: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", required: true },
        courier_warehouse_id: { type: String, required: true },
        signature: { type: String, default: "" }, 
        registered_at: { type: Date, default: Date.now },
        _id: false,
      },
    ],
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

storePluginSchema.index({ seller_id: 1, plugin_id: 1 }, { unique: true });

export default mongoose.model("StorePlugin", storePluginSchema);
