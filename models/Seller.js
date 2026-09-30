import mongoose from "mongoose";

const sellerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    password_hash: { type: String, required: true },
    store_slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    razorpay_account_id: { type: String, default: null }, 
    razorpay_account_status: {
      type: String,
      enum: ["not_started", "pending", "activated", "rejected"],
      default: "not_started",
    },
    commission_percent: { type: Number, default: 10, min: 0, max: 100 }, 
    is_active: { type: Boolean, default: true }, 

    reset_password_token_hash: { type: String, default: null },
    reset_password_expires: { type: Date, default: null },

    kyc: {
      status: {
        type: String,
        enum: ["not_submitted", "pending", "approved", "rejected"],
        default: "not_submitted",
      },
      full_name: { type: String, default: "" },
      pan_number: { type: String, default: "" },
      aadhaar_number: { type: String, default: "" },
      pan_doc_url: { type: String, default: null },
      aadhaar_front_url: { type: String, default: null },
      aadhaar_back_url: { type: String, default: null },
      bank_proof_url: { type: String, default: null },
      rejection_reason: { type: String, default: "" },
      submitted_at: { type: Date, default: null },
      reviewed_at: { type: Date, default: null },
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export default mongoose.model("Seller", sellerSchema);