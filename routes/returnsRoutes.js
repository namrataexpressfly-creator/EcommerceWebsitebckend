import express from "express";
import { StatusCodes } from "http-status-codes";
import ReturnRequest from "../models/ReturnRequest.js";
import Order from "../models/Order.js";
import StorefrontConfig from "../models/StorefrontConfig.js";
import Transaction from "../models/Transaction.js";
import { requireSellerAuth } from "../middleware/auth.js";
import { sendError, check } from "../utils/validation.js";
import { getRazorpayForSeller } from "../utils/razorpay.js";

const router = express.Router();


router.post("/request", async (req, res) => {
  try {
    const { tracking_token, reason, items } = req.body;
    const order = await Order.findOne({ tracking_token });
    if (!order) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that order. Please check and try again." });
    if (order.status !== "delivered") {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "A return can only be requested after the order has been delivered." });
    }

    const returnRequest = await ReturnRequest.create({
      seller_id: order.seller_id,
      order_id: order._id,
      reason,
      items,
    });
    res.status(StatusCodes.CREATED).json(returnRequest);
  } catch (err) {
    sendError(res, err);
  }
});

router.use("/seller", requireSellerAuth);

router.get("/seller", async (req, res) => {
  const { status } = req.query;
  const filter = { seller_id: req.user.id };
  if (status) filter.status = status;
  const returns = await ReturnRequest.find(filter).sort({ created_at: -1 });
  res.json(returns);
});

router.put("/seller/:id/approve", async (req, res) => {
  const r = await ReturnRequest.findOneAndUpdate(
    { _id: req.params.id, seller_id: req.user.id },
    { $set: { status: "approved", admin_note: req.body.note || "" } },
    { new: true }
  );
  if (!r) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that return request." });
  res.json(r);
});

router.put("/seller/:id/reject", async (req, res) => {
  const r = await ReturnRequest.findOneAndUpdate(
    { _id: req.params.id, seller_id: req.user.id },
    { $set: { status: "rejected", admin_note: req.body.note || "" } },
    { new: true }
  );
  if (!r) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that return request." });
  res.json(r);
});

router.put("/seller/:id/refund", async (req, res) => {
  try {
    const { refund_amount } = req.body;
    check.positiveNumber(refund_amount, "Refund amount");

    const r = await ReturnRequest.findOne({ _id: req.params.id, seller_id: req.user.id, status: "approved" });
    if (!r) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find an approved return request for this." });

    const order = await Order.findById(r.order_id);
    if (!order) return res.status(StatusCodes.NOT_FOUND).json({ error: "The order for this return could not be found." });

    if (Number(refund_amount) > order.total_amount) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: `Refund amount can't be more than the order total (₹${order.total_amount}).`,
      });
    }

    let razorpay_refund_id = null;

    if (order.payment_method === "online") {
      if (!order.razorpay_payment_id) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: "This order has no recorded Razorpay payment to refund — it may not have completed payment.",
        });
      }

      const storefrontConfig = await StorefrontConfig.findOne({ seller_id: req.user.id }).select("payment_settings");
      const { client: razorpay } = getRazorpayForSeller(storefrontConfig);

      try {
        const refund = await razorpay.payments.refund(order.razorpay_payment_id, {
          amount: Math.round(Number(refund_amount) * 100), 
          speed: "normal",
          notes: { return_request_id: String(r._id), order_id: String(order._id) },
        });
        razorpay_refund_id = refund.id;
      } catch (razorpayErr) {
        console.error("Razorpay refund failed:", razorpayErr?.error || razorpayErr);
        return res.status(StatusCodes.BAD_GATEWAY).json({
          error:
            razorpayErr?.error?.description ||
            "Razorpay couldn't process this refund. Please check the payment status in your Razorpay dashboard and try again.",
        });
      }
    }
 
    r.status = "refunded";
    r.refund_amount = refund_amount;
    r.razorpay_refund_id = razorpay_refund_id;
    await r.save();

    await Order.findByIdAndUpdate(r.order_id, { $set: { payment_status: "refunded", status: "returned" } });

    await Transaction.create({
      seller_id: req.user.id,
      order_id: order._id,
      type: "refunded",
      order_total: order.total_amount,
      platform_fee: 0,
      seller_amount: -Number(refund_amount),
      razorpay_order_id: order.razorpay_order_id,
      razorpay_payment_id: order.razorpay_payment_id,
      note: razorpay_refund_id
        ? `Refunded via Razorpay (refund id: ${razorpay_refund_id})`
        : "COD order — refund handled outside Razorpay",
    });

    res.json(r);
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
