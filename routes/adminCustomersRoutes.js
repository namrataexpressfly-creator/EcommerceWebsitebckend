import express from "express";
import Customer from "../models/Customer.js";
import Seller from "../models/Seller.js";
import { requireAdminAuth } from "../middleware/auth.js";
import { sendError } from "../utils/validation.js";

const router = express.Router();
router.use(requireAdminAuth);

router.get("/", async (req, res) => {
  try {
    const customers = await Customer.find({ last_login_at: { $ne: null } })
      .select("name phone email is_active created_at last_login_at seller_id")
      .sort({ last_login_at: -1, created_at: -1 })
      .limit(500)
      .lean();

    const sellers = await Seller.find({ _id: { $in: customers.map((c) => c.seller_id) } })
      .select("store_slug name")
      .lean();
    const sellerById = new Map(sellers.map((s) => [String(s._id), s]));

    res.json({
      customers: customers.map((c) => ({
        ...c,
        store_slug: sellerById.get(String(c.seller_id))?.store_slug || "",
        seller_name: sellerById.get(String(c.seller_id))?.name || "",
      })),
    });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
