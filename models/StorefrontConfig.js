import mongoose from "mongoose";

const sectionConfigSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        "hero",
        "product_grid",
        "category_grid",
        "banner",
        "testimonials",
        "newsletter",
        "rich_text",
        "instagram_feed",
        "faq",
      ],
    },

    order: {
      type: Number,
      required: true,
      default: 0,
    },

    is_enabled: {
      type: Boolean,
      default: true,
    },

    settings: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    _id: true,
    timestamps: false,
  }
);

const storefrontConfigSchema = new mongoose.Schema(
  {
    seller_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
      unique: true,
    },

    store_name: {
      type: String,
      required: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },


    custom_domain: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
      
    },

    domain_status: {
      type: String,
      enum: ["none", "pending", "verified", "failed"],
      default: "none",
    },

    
    domain_verification_token: {
      type: String,
      default: null,
    },

    domain_verified_at: {
      type: Date,
      default: null,
    },

    domain_last_checked_at: {
      type: Date,
      default: null,
    },

    logo_url: {
      type: String,
      default: null,
    },


    theme: {
      template_id: {
        type: String,
        default: "marketplace",
      },

      primary_color: {
        type: String,
        default: "#141414",
      },

      primary_dark: {
        type: String,
        default: "#000000",
      },

      primary_soft: {
        type: String,
        default: "#ecece8",
      },

      accent_color: {
        type: String,
        default: "#ffb400",
      },

      background_color: {
        type: String,
        default: "#f5f5f3",
      },

      text_color: {
        type: String,
        default: "#141414",
      },

      font_display: {
        type: String,
        default: "Poppins",
      },

      font_body: {
        type: String,
        default: "Inter",
      },

      layout_style: {
        type: String,
        default: "marketplace",
      },
    },


    social_links: {
      facebook: { type: String, default: "" },
      instagram: { type: String, default: "" },
      twitter: { type: String, default: "" },
      youtube: { type: String, default: "" },
      whatsapp: { type: String, default: "" },
      pinterest: { type: String, default: "" },
    },

    privacy_policy: {
      heading: {
        type: String,
        default: "Privacy Policy",
        trim: true,
      },

      body: {
        type: String,
        default:
          "We respect your privacy and are committed to protecting your personal information.",
      },
    },



    faqs: {
      type: [
        {
          question: { type: String, required: true, trim: true },
          answer: { type: String, required: true, trim: true },
        },
      ],
      default: [],
    },


    sections: [sectionConfigSchema],

    payment_settings: {
      cod_enabled: { type: Boolean, default: true },
      online_enabled: { type: Boolean, default: true },
      cod_extra_charge: { type: Number, default: 0, min: 0 },
      cod_min_order_value: { type: Number, default: 0, min: 0 },
      cod_max_order_value: { type: Number, default: 0, min: 0 }, // 0 = no max

      razorpay_mode: { type: String, enum: ["platform", "own"], default: "platform" },
      own_razorpay_key_id: { type: String, default: null },
      own_razorpay_key_secret_enc: { type: String, default: null },

      own_razorpay_webhook_secret_enc: { type: String, default: null },
    },

    is_active: {
      type: Boolean,
      default: true,
    },
  },

  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);

storefrontConfigSchema.index(
  { custom_domain: 1 },
  { unique: true, partialFilterExpression: { custom_domain: { $type: "string" } } }
);

export default mongoose.model(
  "StorefrontConfig",
  storefrontConfigSchema
);
