import mongoose from "mongoose";

const newsletterSubscriberSchema = new mongoose.Schema(
  {
    store_slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    status: {
      type: String,
      enum: ["subscribed", "unsubscribed"],
      default: "subscribed",
    },
  },
  {
    timestamps: true,
  }
);


newsletterSubscriberSchema.index(
  { store_slug: 1, email: 1 },
  { unique: true }
);

const NewsletterSubscriber = mongoose.model(
  "NewsletterSubscriber",
  newsletterSubscriberSchema
);

export default NewsletterSubscriber;