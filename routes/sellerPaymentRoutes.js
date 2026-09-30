import express from "express";
import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import Seller from "../models/Seller.js";
import Order from "../models/Order.js";
import Transaction from "../models/Transaction.js";
import { requireSellerAuth } from "../middleware/auth.js";
import { getRazorpay, isRazorpayConfigured } from "../utils/razorpay.js";
import { check, fail } from "../utils/validation.js";

const router = express.Router();
router.use(requireSellerAuth);

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

function humanizeRazorpayError(err) {
  const code = err?.error?.code;
  const description = err?.error?.description || err?.error?.reason || err?.message || "";

  if (/email/i.test(description)) return "Please enter a valid email address.";
  if (/phone/i.test(description)) return "Please enter a valid phone number.";
  if (/pan/i.test(description)) return "That PAN number doesn't look valid — please double check it.";
  if (/postal.?code|pincode/i.test(description)) return "Please enter a valid 6-digit pincode.";
  if (/already.*(exist|registered)/i.test(description)) {
    return "An account with these details already exists with Razorpay. Please contact support if you believe this is a mistake.";
  }
  if (code === "BAD_REQUEST_ERROR" && /business_type/i.test(description)) {
    return "Please select a valid business type.";
  }


  const cleaned = description.replace(/^[a-z_.]+(\.[a-z_]+)*\s*[:\-]\s*/i, "").trim();
  return cleaned && cleaned.length < 200
    ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
    : "We couldn't set up payouts with the details you entered. Please check them and try again.";
}

router.get("/status", async (req, res) => {
  const seller = await Seller.findById(req.user.id);
  if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that seller account." });

  res.json({
    razorpay_account_id: seller.razorpay_account_id,
    razorpay_account_status: seller.razorpay_account_status,
    commission_percent: seller.commission_percent,
    payout_ready: seller.razorpay_account_status === "activated",
  });
});


router.post("/onboard", async (req, res) => {
  try {
    const seller = await Seller.findById(req.user.id);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that seller account." });

    if (seller.razorpay_account_id) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "Payment account already created for this seller.",
        razorpay_account_id: seller.razorpay_account_id,
        status: seller.razorpay_account_status,
      });
    }

    const {
      business_name,
      email,
      phone,
      business_type = "individual", 
      beneficiary_name,
      address = {}, 
      pan,
    } = req.body;

    check.required(business_name, "your business or your name");
    check.minLength(business_name, 2, "Business / your name");
    check.email(email);
    check.phone(phone);
    check.required(beneficiary_name, "the beneficiary name as per your bank account");
    check.minLength(beneficiary_name, 2, "Beneficiary name");
    check.oneOf(business_type, ["individual", "proprietorship", "partnership", "private_limited", "public_limited", "llp", "ngo", "trust", "society", "not_yet_registered"], "Business type");
    if (pan && !PAN_RE.test(String(pan).toUpperCase())) {
      fail("That PAN number doesn't look valid — it should look like ABCDE1234F.");
    }
    if (address.postal_code && !/^\d{6}$/.test(String(address.postal_code))) {
      fail("Please enter a valid 6-digit pincode.");
    }

    if (process.env.PAYMENTS_MOCK_MODE === "true") {
      const fakeId = `acc_mock_${Math.random().toString(36).slice(2, 12)}`;
      seller.razorpay_account_id = fakeId;
      seller.razorpay_account_status = "activated"; 
      await seller.save();

      console.log(`🧪 PAYMENTS_MOCK_MODE active — fabricated linked account ${fakeId} for seller ${seller._id}`);

      return res.status(StatusCodes.CREATED).json({
        ok: true,
        mock: true,
        razorpay_account_id: fakeId,
        status: seller.razorpay_account_status,
        message: "Mock linked account created (PAYMENTS_MOCK_MODE=true) — no real Razorpay call was made.",
      });
    }

    if (!isRazorpayConfigured()) {
      return res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
        error: "Razorpay is not configured on the platform side yet.",
      });
    }

    const razorpay = getRazorpay();

    const account = await razorpay.accounts.create({
      email,
      phone,
      type: "route",
      legal_business_name: business_name,
      business_type,
      contact_name: beneficiary_name,
      profile: {
        category: "ecommerce",
        subcategory: "ecommerce",
        addresses: {
          registered: {
            street1: address.street1 || "NA",
            city: address.city || "NA",
            state: address.state || "NA",
            postal_code: address.postal_code || "000000",
            country: "IN",
          },
        },
      },
      legal_info: {
        pan: pan || undefined,
      },
    });


    seller.razorpay_account_id = account.id;
    seller.razorpay_account_status = account.status === "activated" ? "activated" : "pending";
    await seller.save();

    res.status(StatusCodes.CREATED).json({
      ok: true,
      razorpay_account_id: account.id,
      status: seller.razorpay_account_status,
      message:
        "Linked account created. Razorpay will verify KYC/bank details before payouts activate.",
    });
  } catch (err) {

    if (err.isFriendly) {
      return res.status(err.status || StatusCodes.BAD_REQUEST).json({ error: err.message });
    }

    console.error("=================================");
    console.error("SELLER RAZORPAY ONBOARDING ERROR");
    console.error("=================================");
    console.error("statusCode:", err?.statusCode);
    console.error("razorpay error object:", JSON.stringify(err?.error, null, 2));
    console.error("raw error:", err);

    res.status(StatusCodes.BAD_REQUEST).json({
      error: humanizeRazorpayError(err),
      razorpay_error_code: err?.error?.code,
    });
  }
});


router.get("/wallet", async (req, res) => {
  const sellerId = new mongoose.Types.ObjectId(req.user.id);

  const [totals, recentTransactions] = await Promise.all([
    Transaction.aggregate([
      { $match: { seller_id: sellerId } },
      { $group: { _id: "$type", amount: { $sum: "$seller_amount" }, count: { $sum: 1 } } },
    ]),
    Transaction.find({ seller_id: sellerId })
      .sort({ created_at: -1 })
      .limit(30)
      .populate("order_id", "tracking_token"),
  ]);

  const byType = Object.fromEntries(totals.map((t) => [t._id, t]));

  res.json({
    settled_to_bank: byType.settled?.amount || 0,
    pending_settlement:
      (byType.split_created?.amount || 0) - (byType.settled?.amount || 0) - (byType.failed?.amount || 0),
    failed_transfers: byType.failed?.amount || 0,
    cod_collected_total: byType.cod_collected?.amount || 0,
    recent_transactions: recentTransactions.map((t) => ({
      id: t._id,
      order_id: t.order_id?._id,
      tracking_token: t.order_id?.tracking_token,
      type: t.type,
      order_total: t.order_total,
      platform_fee: t.platform_fee,
      seller_amount: t.seller_amount,
      transfer_id: t.transfer_id,
      note: t.note,
      created_at: t.created_at,
    })),
  });
});


router.post("/wallet/mock-settle/:orderId", async (req, res) => {
  if (process.env.PAYMENTS_MOCK_MODE !== "true") {
    return res.status(StatusCodes.FORBIDDEN).json({
      error: "Only available when PAYMENTS_MOCK_MODE=true",
    });
  }

  const order = await Order.findOne({ _id: req.params.orderId, seller_id: req.user.id });
  if (!order) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that order. Please check and try again." });

  if (order.transfer_status !== "pending") {
    return res.status(StatusCodes.BAD_REQUEST).json({
      error: `Order transfer_status is "${order.transfer_status}", expected "pending"`,
    });
  }

  const fakeTransferId = `trf_mock_${Math.random().toString(36).slice(2, 10)}`;
  order.transfer_id = fakeTransferId;
  order.transfer_status = "processed";
  order.status_history.push({ status: "payout_processed", note: `(mock) Seller payout settled: ${fakeTransferId}` });
  await order.save();

  await Transaction.create({
    seller_id: order.seller_id,
    order_id: order._id,
    type: "settled",
    order_total: order.total_amount,
    platform_fee: order.platform_fee,
    seller_amount: order.seller_payout_amount,
    razorpay_order_id: order.razorpay_order_id,
    transfer_id: fakeTransferId,
    note: "(mock) Simulated settlement — no real Razorpay transfer",
  });

  res.json({ ok: true, order_id: order._id, transfer_id: fakeTransferId, transfer_status: "processed" });
});

export default router;
