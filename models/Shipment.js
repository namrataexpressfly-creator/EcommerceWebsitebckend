import mongoose from "mongoose";

// One courier tracking status (its numeric id, name and meaning), as the courier reports it.
const courierStatusSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, default: "" },
    at: { type: Date, default: Date.now },
    ref: { type: String, default: "" }, 
  },
  { _id: false }
);


const shipmentSchema = new mongoose.Schema(
  {
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    store_plugin_id: { type: mongoose.Schema.Types.ObjectId, ref: "StorePlugin", required: true },
    plugin_id: { type: mongoose.Schema.Types.ObjectId, ref: "Plugin", required: true },
    warehouse_id: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", default: null },

    courier_name: { type: String, default: "" },
    awb_number: { type: String, default: null },
    tracking_url: { type: String, default: null },
    label_url: { type: String, default: null },
    rate_charged: { type: Number, default: 0 },
    estimated_delivery: { type: Date, default: null },

    status: {
      type: String,
      enum: ["created", "shipped", "out_for_delivery", "delivered", "returned", "cancelled"],
      default: "created",
    },
    // Latest courier status (id + name) and every status change in order, shown in tracking.
    courier_status: { type: courierStatusSchema, default: null },
    status_history: [courierStatusSchema],
    events: [eventSchema],
    raw_response: { type: mongoose.Schema.Types.Mixed, default: null },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

shipmentSchema.index({ order_id: 1, warehouse_id: 1 });
shipmentSchema.index({ store_plugin_id: 1, awb_number: 1 });

export default mongoose.model("Shipment", shipmentSchema);
