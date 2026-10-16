import mongoose from "mongoose";

const attributeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, 
    label: { type: String, default: "", trim: true }, 
    help: { type: String, default: "", trim: true }, 
    placeholder: { type: String, default: "", trim: true }, 
    is_required: { type: Boolean, default: true },
    is_secret: { type: Boolean, default: false }, 
  },
  { _id: false }
);


const stepSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const domainSchema = new mongoose.Schema(
  {
    environment: { type: String, enum: ["sandbox", "live"], default: "live" },
    url: { type: String, required: true, trim: true }, 
  },
  { _id: false }
);


export const PLUGIN_REVIEW_STATUSES = ["draft", "pending", "approved", "rejected"];

const API_TYPES = ["token_generation", "get_rating", "order_rate", "order_create", "tracking", "create_warehouse", "set_webhook"];

const apiSchema = new mongoose.Schema(
  {
    api_type: { type: String, enum: API_TYPES, required: true },
    path: { type: String, required: true, trim: true }, 
    method: { type: String, enum: ["GET", "POST", "PUT", "DELETE"], default: "POST" },
    headers: { type: mongoose.Schema.Types.Mixed, default: {} }, 
    parameter: { type: mongoose.Schema.Types.Mixed, default: {} }, 
    webhook_url: { type: String, default: "" },
    response_type: { type: String, enum: ["json", "xml"], default: "json" },

    response_mapping: { type: mongoose.Schema.Types.Mixed, default: {} },
  
    webhook_mapping: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const pluginSchema = new mongoose.Schema(
  {
    app_name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    logo: { type: String, default: "" },
    description: { type: String, default: "" },
  
    setup_steps: { type: [stepSchema], default: [] },
    docs_url: { type: String, default: "", trim: true },
    other_detail: { type: mongoose.Schema.Types.Mixed, default: {} },
    created_by: { type: mongoose.Schema.Types.ObjectId, refPath: "created_by_model", default: null }, // "user_id"
    created_by_model: { type: String, enum: ["Admin", "Developer"], default: "Admin" },
    status: { type: String, enum: ["active", "inactive"], default: "active" },

    review_status: { type: String, enum: PLUGIN_REVIEW_STATUSES, default: "draft" },
    review_note: { type: String, default: "" },
    reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    reviewed_at: { type: Date, default: null },

    integration: { type: String, enum: ["standard", "custom"], default: "custom" },


    adapter_key: { type: String, default: null },

    attributes: { type: [attributeSchema], default: [] },
    api_domains: { type: [domainSchema], default: [] },
    apis: { type: [apiSchema], default: [] },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const PLUGIN_API_TYPES = API_TYPES;
export default mongoose.model("Plugin", pluginSchema);
