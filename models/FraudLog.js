import mongoose from "mongoose";

const fraudLogSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    phone: { type: String, default: null },
    ip: { type: String, default: null },
    reason: { type: String, required: true }, 
    risk_score: { type: Number, default: 0 }, 
    action_taken: { type: String, enum: ["none", "flagged", "blocked"], default: "none" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

const blacklistSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    phone: { type: String, required: true },
    reason: { type: String, default: "" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);
blacklistSchema.index({ seller_id: 1, phone: 1 }, { unique: true });

export const FraudLog = mongoose.model("FraudLog", fraudLogSchema);
export const Blacklist = mongoose.model("Blacklist", blacklistSchema);
