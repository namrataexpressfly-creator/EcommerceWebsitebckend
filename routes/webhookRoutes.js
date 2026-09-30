import express from "express";
import crypto from "crypto";
import Order from "../models/Order.js";
import PendingOrder from "../models/PendingOrder.js";
import Transaction from "../models/Transaction.js";
import StorefrontConfig from "../models/StorefrontConfig.js";
import { decryptSecret } from "../utils/crypto.js";
import { finalizeOnlineOrder } from "../utils/finalizeOnlineOrder.js";

const router = express.Router();

router.post("/razorpay", async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers["x-razorpay-signature"];

  if (webhookSecret) {
    const expected = crypto.createHmac("sha256", webhookSecret).update(req.body).digest("hex");
    if (expected !== signature) {
      return res.status(400).json({ error: "The payment notification couldn't be verified." });
    }
  } else {
    console.warn("RAZORPAY_WEBHOOK_SECRET not set — skipping signature check (dev only).");
  }

  const payload = JSON.parse(req.body.toString());
  const event = payload.event;
  console.log("📩 Webhook:", event);

  try {
    if (event === "payment.captured") {
      const payment = payload.payload.payment.entity;

      const order = await finalizeOnlineOrder({
        razorpay_order_id: payment.order_id,
        razorpay_payment_id: payment.id,
        paid_at: payment.created_at ? new Date(payment.created_at * 1000) : new Date(),
      });
      if (order) console.log(`✅ Order ${order._id} marked paid`);
    } else if (event === "payment.failed") {
      const payment = payload.payload.payment.entity;

      await PendingOrder.deleteOne({ razorpay_order_id: payment.order_id });
    } else if (event === "transfer.processed") {

      const transfer = payload.payload.transfer.entity;
      const order = await Order.findOneAndUpdate(
        { razorpay_order_id: transfer.source },
        {
          $set: { transfer_id: transfer.id, transfer_status: "processed" },
          $push: { status_history: { status: "payout_processed", note: `Seller payout settled: ${transfer.id}` } },
        },
        { new: true }
      );
      if (order) {
        console.log(`✅ Seller payout processed for order ${order._id}`);
        await Transaction.create({
          seller_id: order.seller_id,
          order_id: order._id,
          type: "settled",
          order_total: order.total_amount,
          platform_fee: order.platform_fee,
          seller_amount: order.seller_payout_amount,
          razorpay_order_id: order.razorpay_order_id,
          razorpay_payment_id: order.razorpay_payment_id,
          transfer_id: transfer.id,
          note: "Payout settled to seller's linked bank account",
        });
      }
    } else if (event === "transfer.failed") {
      const transfer = payload.payload.transfer.entity;
      const order = await Order.findOneAndUpdate(
        { razorpay_order_id: transfer.source },
        {
          $set: { transfer_id: transfer.id, transfer_status: "failed" },
          $push: { status_history: { status: "payout_failed", note: `Seller payout failed: ${transfer.id}` } },
        },
        { new: true }
      );
      if (order) {
        await Transaction.create({
          seller_id: order.seller_id,
          order_id: order._id,
          type: "failed",
          order_total: order.total_amount,
          platform_fee: order.platform_fee,
          seller_amount: order.seller_payout_amount,
          razorpay_order_id: order.razorpay_order_id,
          transfer_id: transfer.id,
          note: "Payout transfer failed — needs manual review",
        });
      }
    } else if (event === "refund.processed") {
      const refund = payload.payload.refund.entity;
      const order = await Order.findOneAndUpdate(
        { razorpay_payment_id: refund.payment_id },
        {
          $set: { payment_status: "refunded" },
          $push: { status_history: { status: "refunded", note: `Refund confirmed by Razorpay: ${refund.id}` } },
        },
        { new: true }
      );
      if (order) console.log(`✅ Refund confirmed for order ${order._id}`);
    } else if (event === "refund.failed") {
      const refund = payload.payload.refund.entity;
      const order = await Order.findOneAndUpdate(
        { razorpay_payment_id: refund.payment_id },
        {
          $push: { status_history: { status: "refund_failed", note: `Refund ${refund.id} failed — needs manual review` } },
        },
        { new: true }
      );
      if (order) console.error(`⚠️ Refund failed for order ${order._id} — needs manual review`);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook handling error:", err.message);
    res.status(500).json({ error: "We couldn't process the payment notification. It will be retried." });
  }
});


router.post("/razorpay/:sellerId", async (req, res) => {
  try {
    const config = await StorefrontConfig.findOne({ seller_id: req.params.sellerId }).select(
      "payment_settings"
    );
    const encSecret = config?.payment_settings?.own_razorpay_webhook_secret_enc;
    if (!encSecret) {
      return res.status(404).json({ error: "Payment notifications aren't set up for this store yet." });
    }
    const webhookSecret = decryptSecret(encSecret);

    const signature = req.headers["x-razorpay-signature"];
    const expected = crypto.createHmac("sha256", webhookSecret).update(req.body).digest("hex");
    if (expected !== signature) {
      return res.status(400).json({ error: "The payment notification couldn't be verified." });
    }

    const payload = JSON.parse(req.body.toString());
    const event = payload.event;
    console.log(`📩 Seller ${req.params.sellerId} webhook:`, event);

    if (event === "payment.captured") {
      const payment = payload.payload.payment.entity;

      const order = await finalizeOnlineOrder({
        razorpay_order_id: payment.order_id,
        razorpay_payment_id: payment.id,
        paid_at: payment.created_at ? new Date(payment.created_at * 1000) : new Date(),
      });
      if (order) console.log(`✅ Order ${order._id} marked paid (seller's own Razorpay account)`);
    } else if (event === "payment.failed") {
      const payment = payload.payload.payment.entity;
      await PendingOrder.deleteOne({ razorpay_order_id: payment.order_id, seller_id: req.params.sellerId });
    } else if (event === "refund.processed") {
      const refund = payload.payload.refund.entity;
      await Order.findOneAndUpdate(
        { razorpay_payment_id: refund.payment_id, seller_id: req.params.sellerId },
        {
          $set: { payment_status: "refunded" },
          $push: { status_history: { status: "refunded", note: `Refund confirmed by Razorpay: ${refund.id}` } },
        }
      );
    } else if (event === "refund.failed") {
      const refund = payload.payload.refund.entity;
      await Order.findOneAndUpdate(
        { razorpay_payment_id: refund.payment_id, seller_id: req.params.sellerId },
        { $push: { status_history: { status: "refund_failed", note: `Refund ${refund.id} failed — needs manual review` } } }
      );
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Seller webhook handling error:", err.message);
    res.status(500).json({ error: "We couldn't process the payment notification. It will be retried." });
  }
});

export default router;
