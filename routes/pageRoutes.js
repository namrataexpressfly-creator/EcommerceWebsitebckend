import express from "express";
import { StatusCodes } from "http-status-codes";
import { StorePage } from "../models/Misc.js";
import Seller from "../models/Seller.js";
import StorefrontConfig from "../models/StorefrontConfig.js";
import { requireSellerAuth } from "../middleware/auth.js";
import { STORE_TEMPLATES } from "../utils/templates.js";
import { sendError } from "../utils/validation.js";

const router = express.Router();

export function buildDefaultPages({ storeName, sellerEmail, sellerPhone }) {
  return {
    about_heading: `About ${storeName}`,
    about_body: `Welcome to ${storeName}! We're a growing store dedicated to bringing you quality products with fast, reliable delivery. Every order is packed with care, and our team is always here to help if something isn't right. Thanks for shopping with us — we're glad you're here.`,
    contact_heading: `Contact ${storeName}`,
    contact_intro: `Have a question about an order, a product, or anything else? Reach out — we usually reply within one business day.`,
    contact_email: sellerEmail || "",
    contact_phone: sellerPhone || "",
    contact_address: "",
  };
}

router.get("/templates", (req, res) => {
  res.json(STORE_TEMPLATES);
});

router.post("/seller/pages/generate", requireSellerAuth, async (req, res) => {
  try {
    const [seller, config] = await Promise.all([
      Seller.findById(req.user.id),
      StorefrontConfig.findOne({ seller_id: req.user.id }),
    ]);
    if (!seller || !config) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store's settings." });
    }

    const generated = buildDefaultPages({
      storeName: config.store_name,
      sellerEmail: seller.email,
      sellerPhone: seller.phone,
    });

    const page = await StorePage.findOneAndUpdate(
      { seller_id: req.user.id },
      { $set: { ...generated, generated_at: new Date() } },
      { new: true, upsert: true }
    );
    res.json(page);
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/seller/pages", requireSellerAuth, async (req, res) => {
  const page = await StorePage.findOne({ seller_id: req.user.id });
  if (!page) return res.status(StatusCodes.NOT_FOUND).json({ error: "This page isn't ready yet. Please check back soon." });
  res.json(page);
});

router.put("/seller/pages", requireSellerAuth, async (req, res) => {
  try {
    const {
      about_heading,
      about_body,
      about_image_url,
      contact_heading,
      contact_intro,
      contact_email,
      contact_phone,
      contact_address,
      contact_map_url,
    } = req.body;

    const page = await StorePage.findOneAndUpdate(
      { seller_id: req.user.id },
      {
        $set: {
          about_heading,
          about_body,
          about_image_url,
          contact_heading,
          contact_intro,
          contact_email,
          contact_phone,
          contact_address,
          contact_map_url,
        },
      },
      { new: true, upsert: true }
    );
    res.json(page);
  } catch (err) {
    sendError(res, err);
  }
});


router.get("/store/:slug/pages", async (req, res) => {
  try {
    const seller = await Seller.findOne({ store_slug: req.params.slug });
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link." });

    let page = await StorePage.findOne({ seller_id: seller._id });
    if (!page) {

      const config = await StorefrontConfig.findOne({ seller_id: seller._id });
      const generated = buildDefaultPages({
        storeName: config?.store_name || seller.name,
        sellerEmail: seller.email,
        sellerPhone: seller.phone,
      });
      page = await StorePage.create({ seller_id: seller._id, ...generated });
    }
    res.json(page);
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
