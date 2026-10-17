import express from "express";
import { StatusCodes } from "http-status-codes";
import Order from "../models/Order.js";
import Shipment from "../models/Shipment.js";
import SupportTicket from "../models/SupportTicket.js";
import { sendError } from "../utils/validation.js";

const router = express.Router();

router.get("/:token", async (req, res) => {
  try {
    const order = await Order.findOne({ tracking_token: req.params.token }).select(
      "items subtotal discount item_discount tax_amount shipping total_amount status status_history payment_status shipping_address created_at"
    );
    if (!order) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "We couldn't find an order with that tracking code. Please check it and try again." });
    }

  
    const tickets = await SupportTicket.find({ order_id: order._id })
      .sort({ created_at: -1 })
      .select("reason message messages status created_at updated_at");

    // What the customer may see of each shipment: courier, AWB, tracking link and the courier's status history.
    const shipments = await Shipment.find({ order_id: order._id, is_active: true })
      .sort({ created_at: 1 })
      .select("courier_name awb_number tracking_url status courier_status status_history estimated_delivery created_at");

    res.json({ ...order.toObject(), tickets, shipments });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/notify/:channel", async (req, res) => {
  const { channel } = req.params;
  const { token } = req.body;
  if (!["sms", "whatsapp", "email"].includes(channel)) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: "That notification option isn't supported." });
  }
  const order = await Order.findOne({ tracking_token: token });
  if (!order) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that order. Please check the tracking code." });

  const trackingUrl = `/trackorder/details/${order.tracking_token}`;
  console.log(`📤 [DEV] Would send ${channel} notification with link: ${trackingUrl}`);

  res.json({ ok: true, channel, tracking_url: trackingUrl });
});

export default router;
