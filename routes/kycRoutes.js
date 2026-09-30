import express from "express";
import { StatusCodes } from "http-status-codes";
import Seller from "../models/Seller.js";
import { requireSellerAuth } from "../middleware/auth.js";
import { sendError } from "../utils/validation.js";

const router = express.Router();


router.get("/status", requireSellerAuth, async (req, res) => {
  const seller = await Seller.findById(req.user.id).select("kyc");
  if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that seller account." });
  res.json({ kyc: seller.kyc });
});

router.post("/submit", requireSellerAuth, async (req, res) => {
  try {
    const seller = await Seller.findById(req.user.id);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that seller account." });


    const {
      full_name,
      pan_number,
      aadhaar_number,
      pan_doc_url,
      aadhaar_front_url,
      aadhaar_back_url,
      bank_proof_url,
    } = req.body;

    if (!full_name || !pan_number || !aadhaar_number || !pan_doc_url || !aadhaar_front_url) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "full_name, pan_number, aadhaar_number, pan_doc_url and aadhaar_front_url are required.",
      });
    }

    const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
    if (!panPattern.test(pan_number.toUpperCase())) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "That doesn't look like a valid PAN number." });
    }
    if (!/^\d{12}$/.test(aadhaar_number)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Aadhaar number should be 12 digits." });
    }

    seller.kyc = {
      status: "pending",
      full_name,
      pan_number: pan_number.toUpperCase(),
      aadhaar_number,
      pan_doc_url,
      aadhaar_front_url,
      aadhaar_back_url: aadhaar_back_url || null,
      bank_proof_url: bank_proof_url || null,
      rejection_reason: "",
      submitted_at: new Date(),
      reviewed_at: null,
    };
    await seller.save();

    res.status(StatusCodes.CREATED).json({ kyc: seller.kyc });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
