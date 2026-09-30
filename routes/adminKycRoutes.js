import express from "express";
import { StatusCodes } from "http-status-codes";
import Seller from "../models/Seller.js";
import { requireAdminAuth } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAdminAuth);

router.get("/pending", async (req, res) => {
  const sellers = await Seller.find({ "kyc.status": "pending" }).select(
    "name email phone store_slug kyc"
  );
  res.json({ sellers });
});

router.post("/:sellerId/approve", async (req, res) => {
  const seller = await Seller.findById(req.params.sellerId);
  if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that seller account." });
  seller.kyc.status = "approved";
  seller.kyc.rejection_reason = "";
  seller.kyc.reviewed_at = new Date();
  await seller.save();
  res.json({ kyc: seller.kyc });
});

router.post("/:sellerId/reject", async (req, res) => {
  const seller = await Seller.findById(req.params.sellerId);
  if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that seller account." });
  seller.kyc.status = "rejected";
  seller.kyc.rejection_reason = req.body.reason || "Documents could not be verified.";
  seller.kyc.reviewed_at = new Date();
  await seller.save();
  res.json({ kyc: seller.kyc });
});

export default router;
