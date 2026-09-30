import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { StatusCodes } from "http-status-codes";
import Seller from "../models/Seller.js";
import StorefrontConfig from "../models/StorefrontConfig.js";
import { StorePage } from "../models/Misc.js";
import { signSellerToken } from "../utils/token.js";
import { requireSellerAuth } from "../middleware/auth.js";
import { buildDefaultPages } from "./pageRoutes.js";
import { getTemplateById, DEFAULT_TEMPLATE_ID } from "../utils/templates.js";
import { sendError, check, fail } from "../utils/validation.js";
import { sendPasswordResetEmail } from "../utils/mailer.js";

const router = express.Router();

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; 

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}


router.post("/register", async (req, res) => {
  try {
    const { name, email, phone, password, store_name, store_slug } = req.body;

    check.required(name, "your name");
    check.required(email, "your email address");
    check.email(email);
    check.required(password, "a password");
    check.minLength(password, 6, "Your password");
    check.required(store_slug, "a store address (e.g. my-shop)");
    if (!/^[a-z0-9-]+$/.test(store_slug)) {
      fail("Your store address can only use lowercase letters, numbers, and dashes (e.g. my-shop).");
    }
    if (phone) check.phone(phone);

    const existing = await Seller.findOne({ $or: [{ email }, { store_slug }] });
    if (existing) {
      const takenField = existing.email === email ? "email address" : "store address";
      return res.status(StatusCodes.CONFLICT).json({ error: `That ${takenField} is already taken — please use a different one.` });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const seller = await Seller.create({ name, email, phone, password_hash, store_slug });

    const defaultTemplate = getTemplateById(DEFAULT_TEMPLATE_ID);
    const resolvedStoreName = store_name || name;
    await StorefrontConfig.create({
      seller_id: seller._id,
      store_name: resolvedStoreName,
      slug: store_slug,
      theme: { template_id: defaultTemplate.id, ...defaultTemplate.theme },
      sections: [
        { type: "hero", order: 0, settings: { heading: `Welcome to ${resolvedStoreName}`, cta_text: "Shop Now" } },
        { type: "product_grid", order: 1, settings: { title: "Featured Products", limit: 8 } },
        { type: "newsletter", order: 2, settings: {} },
      ],
    });

    
    await StorePage.create({
      seller_id: seller._id,
      ...buildDefaultPages({ storeName: resolvedStoreName, sellerEmail: email, sellerPhone: phone }),
    });

    const token = signSellerToken(seller);
    const fullSeller = await Seller.findById(seller._id).select("-password_hash");
    res.status(StatusCodes.CREATED).json({
      token,
      seller: fullSeller,
    });
  } catch (err) {
    sendError(res, err);
  }
});


router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    check.required(email, "your email address");
    check.required(password, "your password");

    const seller = await Seller.findOne({ email });
    if (!seller) return res.status(StatusCodes.UNAUTHORIZED).json({ error: "We couldn't find an account with that email address." });
    if (seller.is_active === false) {
      return res.status(StatusCodes.FORBIDDEN).json({
        error: "Your store has been suspended by the admin. Please contact support for help.",
        code: "STORE_SUSPENDED",
      });
    }

    const match = await bcrypt.compare(password, seller.password_hash);
    if (!match) return res.status(StatusCodes.UNAUTHORIZED).json({ error: "That password doesn't match. Please try again." });

    const token = signSellerToken(seller);
    const fullSeller = await Seller.findById(seller._id).select("-password_hash");
    res.json({ token, seller: fullSeller });
  } catch (err) {
    sendError(res, err);
  }
});


router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    check.required(email, "your email address");
    check.email(email);

    const seller = await Seller.findOne({ email: String(email).toLowerCase().trim(), is_active: true });

    let devMode = false;
    if (seller) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      seller.reset_password_token_hash = hashToken(rawToken);
      seller.reset_password_expires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await seller.save();

      const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
      const resetUrl = `${frontendUrl}/seller/reset-password?token=${rawToken}&email=${encodeURIComponent(seller.email)}`;

      const result = await sendPasswordResetEmail(seller.email, resetUrl);
      devMode = Boolean(result?.dev);
    }

       res.json({
      message: "If an account exists for that email, we've sent a password reset link.",
      dev_mode: devMode,
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { email, token, password } = req.body;
    check.required(email, "your email address");
    check.required(token, "the reset link from your email");
    check.required(password, "a new password");
    check.minLength(password, 6, "Your new password");

    const seller = await Seller.findOne({
      email: String(email).toLowerCase().trim(),
      reset_password_token_hash: hashToken(token),
      reset_password_expires: { $gt: new Date() },
    });

    if (!seller) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "That reset link is invalid or has expired — please request a new one.",
      });
    }

    seller.password_hash = await bcrypt.hash(password, 10);
    seller.reset_password_token_hash = null;
    seller.reset_password_expires = null;
    await seller.save();

    res.json({ message: "Your password has been reset — you can now log in." });
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/me", requireSellerAuth, async (req, res) => {
  const seller = await Seller.findById(req.user.id).select("-password_hash");
  if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that seller account." });
  res.json(seller);
});

export default router;