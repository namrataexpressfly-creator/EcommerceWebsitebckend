import mongoose from "mongoose";

export const TICKET_REASONS = [
  "Order not received",
  "Item damaged",
  "Wrong item delivered",
  "Item missing from order",
  "Payment / refund issue",
  "Delivery delayed",
  "Other",
];


const messageSchema = new mongoose.Schema(
  {
    sender: { type: String, enum: ["customer", "seller"], required: true },
    text: { type: String, required: true, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ticketSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    tracking_token: { type: String, required: true },


    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
    customer_name: { type: String, default: "" },

    reason: { type: String, required: true },
    message: { type: String, default: "" }, 
    messages: { type: [messageSchema], default: [] },

    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "closed"],
      default: "open",
    },
    seller_note: { type: String, default: "" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

ticketSchema.index({ seller_id: 1, status: 1 });
ticketSchema.index({ seller_id: 1, created_at: -1 });
ticketSchema.index({ customer_id: 1, created_at: -1 });

export default mongoose.model("SupportTicket", ticketSchema);
