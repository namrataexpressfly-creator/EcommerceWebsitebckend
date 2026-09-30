import mongoose from "mongoose";

const visitLogSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    path: { type: String, required: true }, 
    ip: { type: String, default: null },
    user_agent: { type: String, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

visitLogSchema.index({ seller_id: 1, created_at: -1 });

export default mongoose.model("VisitLog", visitLogSchema);
