import mongoose from "mongoose";

const otpSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, trim: true, index: true },
    otp_hash: { type: String, required: true },
    attempts: { type: Number, default: 0 }, 
    expires_at: { type: Date, required: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

otpSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("Otp", otpSchema);
