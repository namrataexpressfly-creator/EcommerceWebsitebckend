import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { StatusCodes } from "http-status-codes";
import Seller from "../models/Seller.js";
import Customer from "../models/Customer.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import Otp from "../models/Otp.js";
import { sendOtpSms } from "../utils/sms.js";
import { signCustomerToken } from "../utils/token.js";
import { requireCustomerAuth, requireSellerAuth } from "../middleware/auth.js";
import { sendError, check } from "../utils/validation.js";

const router = express.Router();

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;


const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

async function getSellerBySlug(slug) {
  return Seller.findOne({ store_slug: slug, is_active: true });
}

function assertSameStore(req, seller) {
  if (String(req.customer.seller_id) !== String(seller._id)) {
    const err = new Error("Please log in to continue.");
    err.status = StatusCodes.UNAUTHORIZED;
    err.isFriendly = true;
    throw err;
  }
}

// Stable key for a cart line (product + variant). Handles plain id strings,
// ObjectIds, and populated product objects so lookups always match.
const cartKeyOf = (productId, combinationId) =>
  `${String(productId?._id || productId)}:${combinationId ? String(combinationId) : ""}`;


router.post("/store/:slug/customer/otp/send", otpLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    check.phone(phone, "a valid 10-digit phone number");

    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link and try again." });

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otp_hash = await bcrypt.hash(otp, 10);
    const expires_at = new Date(Date.now() + OTP_TTL_MS);

    await Otp.findOneAndUpdate(
      { phone },
      { otp_hash, expires_at, attempts: 0 },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const result = await sendOtpSms(phone, otp);
    res.json({ ok: true, message: "We've sent a one-time code to your phone.", dev_mode: Boolean(result.dev) });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/store/:slug/customer/login", otpLimiter, async (req, res) => {
  try {
    const { phone, otp, name } = req.body;
    check.phone(phone, "a valid 10-digit phone number");
    check.required(otp, "the OTP code sent to your phone");

    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link and try again." });

    const entry = await Otp.findOne({ phone });
    if (!entry || entry.expires_at < new Date()) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "That code has expired. Please request a new OTP." });
    }
    if (entry.attempts >= MAX_OTP_ATTEMPTS) {
      await Otp.deleteOne({ _id: entry._id });
      return res.status(StatusCodes.TOO_MANY_REQUESTS).json({ error: "Too many incorrect attempts. Please request a new OTP." });
    }
    const isMatch = await bcrypt.compare(otp, entry.otp_hash);
    if (!isMatch) {
      entry.attempts += 1;
      await entry.save();
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "That code doesn't match. Please double-check and try again." });
    }
    await Otp.deleteOne({ _id: entry._id });


    let customer = await Customer.findOne({ seller_id: seller._id, phone });
    if (!customer) {
      customer = await Customer.create({ seller_id: seller._id, phone, name: name || "Guest", last_login_at: new Date() });
    } else {
      customer.last_login_at = new Date();
      await customer.save();
    }

    const token = signCustomerToken(customer);
    res.json({
      token,
      customer: {
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        addresses: customer.addresses,
        wishlist: customer.wishlist,
        cart: customer.cart,
      },
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/store/:slug/customer/me", requireCustomerAuth, async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store." });
    assertSameStore(req, seller);

    const customer = await Customer.findById(req.customer.id);
    if (!customer) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your account." });

    res.json({
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      addresses: customer.addresses,
      wishlist: customer.wishlist,
      cart: customer.cart,
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.put("/store/:slug/customer/me", requireCustomerAuth, async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store." });
    assertSameStore(req, seller);

    const { name, email } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (email !== undefined) update.email = email;

    const customer = await Customer.findByIdAndUpdate(req.customer.id, { $set: update }, { new: true, runValidators: true });
    res.json({ name: customer.name, phone: customer.phone, email: customer.email });
  } catch (err) {
    sendError(res, err);
  }
});


router.get("/store/:slug/customer/orders", requireCustomerAuth, async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store." });
    assertSameStore(req, seller);

    const orders = await Order.find({ seller_id: seller._id, customer_id: req.customer.id, is_active: true })
      .sort({ created_at: -1 })
      .select("tracking_token items total_amount status payment_status payment_method created_at");
    res.json(orders);
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/store/:slug/customer/addresses", requireCustomerAuth, async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store." });
    assertSameStore(req, seller);

    const customer = await Customer.findById(req.customer.id);
    res.json(customer?.addresses || []);
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/store/:slug/customer/addresses", requireCustomerAuth, async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store." });
    assertSameStore(req, seller);

    const { label, line1, line2, city, state, pincode, is_default } = req.body;
    check.required(line1, "your address line");
    check.required(city, "your city");
    check.required(state, "your state");
    check.required(pincode, "your PIN code");

    const customer = await Customer.findById(req.customer.id);
    if (!customer) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your account." });

    const makeDefault = is_default || customer.addresses.length === 0;
    if (makeDefault) customer.addresses.forEach((a) => (a.is_default = false));

    customer.addresses.push({ label: label || "Home", line1, line2, city, state, pincode, is_default: makeDefault });
    await customer.save();

    res.status(StatusCodes.CREATED).json(customer.addresses[customer.addresses.length - 1]);
  } catch (err) {
    sendError(res, err);
  }
});

router.put("/store/:slug/customer/addresses/:addressId", requireCustomerAuth, async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store." });
    assertSameStore(req, seller);

    const customer = await Customer.findById(req.customer.id);
    if (!customer) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your account." });

    const address = customer.addresses.id(req.params.addressId);
    if (!address) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that address — it may have already been removed." });

    const { label, line1, line2, city, state, pincode, is_default } = req.body;
    if (label !== undefined) address.label = label;
    if (line1 !== undefined) address.line1 = line1;
    if (line2 !== undefined) address.line2 = line2;
    if (city !== undefined) address.city = city;
    if (state !== undefined) address.state = state;
    if (pincode !== undefined) address.pincode = pincode;
    if (is_default) {
      customer.addresses.forEach((a) => (a.is_default = false));
      address.is_default = true;
    }

    await customer.save();
    res.json(address);
  } catch (err) {
    sendError(res, err);
  }
});

router.delete("/store/:slug/customer/addresses/:addressId", requireCustomerAuth, async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store." });
    assertSameStore(req, seller);

    const customer = await Customer.findById(req.customer.id);
    if (!customer) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your account." });

    const address = customer.addresses.id(req.params.addressId);
    if (!address) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that address — it may have already been removed." });

    const wasDefault = address.is_default;
    address.deleteOne();
    if (wasDefault && customer.addresses.length > 0) customer.addresses[0].is_default = true;

    await customer.save();
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});


router.put("/store/:slug/customer/cart", requireCustomerAuth, async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store." });
    assertSameStore(req, seller);

    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(StatusCodes.BAD_REQUEST).json({ error: "Your cart data looks invalid — please refresh and try again." });

    // Keep the original "added" time for lines that already existed, so the
    // seller-side cart list shows when a product was first added, not the
    // last time this device happened to sync.
    const existing = await Customer.findById(req.customer.id).select("cart").lean();
    const existingByKey = new Map(
      (existing?.cart || []).map((c) => [cartKeyOf(c.product_id, c.combination_id), c.added_at])
    );

    // Merge duplicate lines from the client so one product/variant = one line.
    const merged = new Map();
    for (const i of items) {
      const productId = i.product_id?._id || i.product_id;
      const qty = Number(i.quantity);
      if (!productId || !(qty > 0)) continue;

      const key = cartKeyOf(productId, i.combination_id);
      const prev = merged.get(key);
      if (prev) {
        prev.quantity += qty;
      } else {
        merged.set(key, {
          product_id: productId,
          combination_id: i.combination_id || null,
          quantity: qty,
        });
      }
    }

    const cart = [...merged.entries()].map(([key, line]) => ({
      ...line,
      added_at: existingByKey.get(key) || new Date(),
    }));

    await Customer.findByIdAndUpdate(req.customer.id, { $set: { cart } });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/store/:slug/customer/wishlist", requireCustomerAuth, async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store." });
    assertSameStore(req, seller);

    const { product_id } = req.body;
    check.required(product_id, "a product to add");

    const customer = await Customer.findById(req.customer.id);
    if (!customer.wishlist.map(String).includes(String(product_id))) {
      customer.wishlist.push(product_id);
      await customer.save();
    }
    res.json(customer.wishlist);
  } catch (err) {
    sendError(res, err);
  }
});

router.delete("/store/:slug/customer/wishlist/:productId", requireCustomerAuth, async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store." });
    assertSameStore(req, seller);

    const customer = await Customer.findById(req.customer.id);
    customer.wishlist = customer.wishlist.filter((id) => String(id) !== req.params.productId);
    await customer.save();
    res.json(customer.wishlist);
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/seller/customers", requireSellerAuth, async (req, res) => {
  try {

    const customers = await Customer.find({ seller_id: req.user.id, last_login_at: { $ne: null } })
      .select("name phone email is_active created_at last_login_at")
      .sort({ last_login_at: -1, created_at: -1 });

    const orderCounts = await Order.aggregate([
      { $match: { seller_id: new mongoose.Types.ObjectId(req.user.id), customer_id: { $ne: null } } },
      { $group: { _id: "$customer_id", count: { $sum: 1 } } },
    ]);
    const orderCountByCustomerId = new Map(orderCounts.map((o) => [String(o._id), o.count]));

    res.json(
      customers.map((c) => ({
        _id: c._id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        is_active: c.is_active,
        created_at: c.created_at,
        last_login_at: c.last_login_at,
        order_count: orderCountByCustomerId.get(String(c._id)) || 0,
      }))
    );
  } catch (err) {
    sendError(res, err);
  }
});

// What's currently sitting in customers' carts for this seller — lets the
// seller see what people are adding (and not yet buying).
router.get("/seller/customers/carts", requireSellerAuth, async (req, res) => {
  try {
    const customers = await Customer.find({
      seller_id: req.user.id,
      "cart.0": { $exists: true },
    })
      .select("name phone cart")
      .lean(); // lean = no schema defaults, so missing added_at is NOT replaced with "now"

    const productIds = new Set();
    for (const c of customers) {
      for (const item of c.cart) {
        if (item.product_id) productIds.add(String(item.product_id));
      }
    }

    const products = await Product.find({ _id: { $in: [...productIds] } }).select(
      "name images price combinations"
    );
    const productById = new Map(products.map((p) => [String(p._id), p]));

    const rows = [];
    for (const c of customers) {
      for (const item of c.cart) {
        const product = productById.get(String(item.product_id));
        if (!product) continue;

        let variantLabel = null;
        let unitPrice = product.price;
        if (item.combination_id) {
          const combo = (product.combinations || []).find(
            (c) => String(c._id) === String(item.combination_id)
          );
          if (combo) {
            variantLabel = combo.label || null;
            if (combo.price != null) unitPrice = combo.price;
          }
        }

        rows.push({
          customer_id: c._id,
          customer_name: c.name,
          customer_phone: c.phone,
          product_id: product._id,
          product_name: product.name,
          product_image: product.images?.[0] || null,
          variant_label: variantLabel,
          quantity: item.quantity,
          unit_price: unitPrice,
          added_at: item.added_at || null,
        });
      }
    }

    // Newest add first, across all customers
    rows.sort((a, b) => (b.added_at ? new Date(b.added_at) : 0) - (a.added_at ? new Date(a.added_at) : 0));
    res.json({ items: rows });
  } catch (err) {
    console.error("carts route error:", err);
    // TEMPORARY: show the real error on the page so it can be fixed. Remove later.
    return res.status(500).json({ error: "DEBUG: " + err.message });
  }
});

export default router;
