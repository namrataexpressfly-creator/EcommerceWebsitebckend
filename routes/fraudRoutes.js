import express from "express";
import { StatusCodes } from "http-status-codes";
import { FraudLog, Blacklist } from "../models/FraudLog.js";
import { checkCodFraud } from "../utils/fraud.js";
import { requireSellerAuth } from "../middleware/auth.js";
import { sendError, check } from "../utils/validation.js";

const router = express.Router();

router.post("/cod/check", async (req, res) => {
  try {
    const { seller_id, phone, cart_total } = req.body;
    check.required(seller_id, "a store");
    check.phone(phone, "a valid 10-digit phone number");
    if (cart_total !== undefined) check.positiveNumber(cart_total, "Cart total");
    const result = await checkCodFraud({ sellerId: seller_id, phone, ip: req.ip, cartTotal: cart_total });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/seller/fraud/log", requireSellerAuth, async (req, res) => {
  try {
    const logs = await FraudLog.find({ seller_id: req.user.id }).sort({ created_at: -1 }).limit(100);
    res.json(logs);
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/seller/fraud/blacklist", requireSellerAuth, async (req, res) => {
  try {
    const { phone, reason } = req.body;
    check.phone(phone, "a valid 10-digit phone number");
    if (reason !== undefined) check.maxLength(reason, 300, "The reason");
    const entry = await Blacklist.findOneAndUpdate(
      { seller_id: req.user.id, phone },
      { $set: { reason } },
      { upsert: true, new: true }
    );
    res.status(StatusCodes.CREATED).json(entry);
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/seller/fraud/blacklist", requireSellerAuth, async (req, res) => {
  try {
    const list = await Blacklist.find({ seller_id: req.user.id }).sort({ created_at: -1 });
    res.json(list);
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
