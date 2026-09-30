import express from "express";
import { StatusCodes } from "http-status-codes";
import Seller from "../models/Seller.js";
import StorefrontConfig from "../models/StorefrontConfig.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import { requireAdminAuth } from "../middleware/auth.js";
import { sanitizeStorefrontConfig } from "../utils/storefrontSanitize.js";
import { sendError } from "../utils/validation.js";

const router = express.Router();
router.use(requireAdminAuth);


const SELLER_LIST_FIELDS =
  "name email phone store_slug kyc.status is_active razorpay_account_status created_at";

router.get("/", async (req, res) => {
  const sellers = await Seller.find().select(SELLER_LIST_FIELDS).sort({ created_at: -1 }).lean();
  const configs = await StorefrontConfig.find({ seller_id: { $in: sellers.map((s) => s._id) } })
    .select("seller_id store_name")
    .lean();
  const storeNameBySeller = new Map(configs.map((c) => [String(c.seller_id), c.store_name]));

  res.json({
    sellers: sellers.map((s) => ({ ...s, store_name: storeNameBySeller.get(String(s._id)) || "" })),
  });
});

router.get("/:id", async (req, res) => {
  const seller = await Seller.findById(req.params.id).select("-password_hash");
  if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that seller account." });

  const [storefrontConfig, productCount, orderCount] = await Promise.all([
    StorefrontConfig.findOne({ seller_id: seller._id }),
    Product.countDocuments({ seller_id: seller._id }),
    Order.countDocuments({ seller_id: seller._id }),
  ]);

  res.json({
    seller,
    storefront: storefrontConfig ? sanitizeStorefrontConfig(storefrontConfig) : null,
    stats: { product_count: productCount, order_count: orderCount },
  });
});


router.put("/:id", async (req, res) => {
  try {
    const { is_active } = req.body;
    if (is_active === undefined) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Nothing to update." });
    }

    const seller = await Seller.findByIdAndUpdate(
      req.params.id,
      { $set: { is_active: Boolean(is_active) } },
      { new: true }
    ).select("-password_hash");
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that seller account." });
    res.json({ seller });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
