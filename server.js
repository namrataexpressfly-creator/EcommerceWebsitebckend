import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";

import { connectDB } from "./db.js";
import { toFriendlyError } from "./utils/validation.js";

import authRoutes from "./routes/authRoutes.js";
import storefrontRoutes from "./routes/storefrontRoutes.js";
import bannerRoutes from "./routes/bannerRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import productVariantRoutes from "./routes/productVariantRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";
import checkoutRoutes from "./routes/checkoutRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import trackingRoutes from "./routes/trackingRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import sellerPaymentRoutes from "./routes/sellerPaymentRoutes.js";
import couponRoutes from "./routes/couponRoutes.js";
import fraudRoutes from "./routes/fraudRoutes.js";
import returnsRoutes from "./routes/returnsRoutes.js";
import seoRoutes from "./routes/seoRoutes.js";
import policyRoutes from "./routes/policyRoutes.js";
import pageRoutes from "./routes/pageRoutes.js";
import contactRoutes from "./routes/contactRoutes.js";
import newsletterRoutes from "./routes/newsletterRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import warehouseRoutes from "./routes/warehouseRoutes.js";
import faqRoutes from "./routes/faqRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import ticketRoutes from "./routes/ticketRoutes.js";
import kycRoutes from "./routes/kycRoutes.js";
import adminAuthRoutes from "./routes/adminAuthRoutes.js";
import adminKycRoutes from "./routes/adminKycRoutes.js";
import adminSellersRoutes from "./routes/adminSellersRoutes.js";
import adminCustomersRoutes from "./routes/adminCustomersRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("=================================");
console.log("ENVIRONMENT CONFIGURATION");
console.log("=================================");

console.log(
  "RAZORPAY_KEY_ID:",
  process.env.RAZORPAY_KEY_ID ? "LOADED" : "MISSING"
);

console.log(
  "RAZORPAY_KEY_SECRET:",
  process.env.RAZORPAY_KEY_SECRET ? "LOADED" : "MISSING"
);

console.log(
  "MONGO_URI:",
  process.env.MONGO_URI ? "LOADED" : "MISSING"
);

console.log(
  "PORT:",
  process.env.PORT || "4000"
);

console.log("=================================");

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(
  "/api/webhook",
  express.raw({
    type: "application/json",
  }),
  webhookRoutes
);

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true,
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,

  standardHeaders: true,
  legacyHeaders: false,

  message: {
    success: false,
    message:
      "Too many requests. Please try again later.",
  },
});

app.use(
  "/api/seller/login",
  limiter
);

app.use(
  "/api/checkout",
  limiter
);


app.use(
  "/api/seller",
  authRoutes
);

app.use(
  "/api",
  storefrontRoutes
);

app.use(
  "/api",
  bannerRoutes
);

app.use(
  "/api/seller/categories",
  categoryRoutes
);

app.use(
  "/api/seller/products",
  productRoutes
);

app.use(
  "/api/seller/product-variants",
  productVariantRoutes
);

app.use(
  "/api/seller/uploads",
  uploadRoutes
);

app.use(
  "/api",
  reviewRoutes
);

app.use(
  "/api",
  searchRoutes
);

app.use(
  "/api/checkout",
  checkoutRoutes
);

app.use(
  "/api/checkout",
  paymentRoutes
);

app.use(
  "/api/track",
  trackingRoutes
);

app.use(
  "/api/seller",
  dashboardRoutes
);

app.use(
  "/api/seller/payments",
  sellerPaymentRoutes
);

app.use(
  "/api/seller/coupons",
  couponRoutes
);

app.use(
  "/api/fraud",
  fraudRoutes
);

app.use(
  "/api/returns",
  returnsRoutes
);


app.use(
  "/api/seo",
  seoRoutes
);

app.use(
  "/api",
  policyRoutes
);

app.use(
  "/api",
  pageRoutes
);

app.use(
  "/api",
  contactRoutes
);

app.use(
  "/api",
  newsletterRoutes
);

app.use(
  "/api",
  customerRoutes
);

app.use(
  "/api/seller/warehouses",
  warehouseRoutes
);

app.use(
  "/api",
  faqRoutes
);

app.use(
  "/api/tickets",
  ticketRoutes
);

app.use(
  "/api/seller/kyc",
  kycRoutes
);

app.use(
  "/api/admin",
  adminAuthRoutes
);

app.use(
  "/api/admin/kyc",
  adminKycRoutes
);

app.use(
  "/api/admin/sellers",
  adminSellersRoutes
);

app.use(
  "/api/admin/customers",
  adminCustomersRoutes
);

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,
      time: new Date().toISOString(),
    });
  }
);

app.use(
  (req, res) => {
    res.status(404).json({
      success: false,
      message: "Route not found",
      path: req.originalUrl,
    });
  }
);

app.use(
  (err, req, res, next) => {

    console.error(
      "================================="
    );
    console.error(
      "GLOBAL SERVER ERROR"
    );
    console.error(
      "================================="
    );
    console.error(err);
    console.error(
      "================================="
    );

    const { status, message } = toFriendlyError(err);
    res.status(status).json({
      success: false,
      error: message,
    });
  }
);

const PORT =
  process.env.PORT || 4000;

connectDB()
  .then(() => {
    console.log(
      "MongoDB connected successfully"
    );

    app.listen(PORT, () => {
      console.log(
        `🚀 Expressfly backend running at http://localhost:${PORT}`
      );

      console.log(
        `Health check: http://localhost:${PORT}/api/health`
      );
    });
  })
  .catch((error) => {
    console.error(
      "================================="
    );

    console.error(
      "DATABASE CONNECTION FAILED"
    );

    console.error(
      "================================="
    );

    console.error(error);

    process.exit(1);
  });
