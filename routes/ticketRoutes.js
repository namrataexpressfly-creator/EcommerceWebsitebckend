import express from "express";
import { StatusCodes } from "http-status-codes";
import SupportTicket, { TICKET_REASONS } from "../models/SupportTicket.js";
import Order from "../models/Order.js";
import Customer from "../models/Customer.js";
import { requireSellerAuth, requireCustomerAuth } from "../middleware/auth.js";
import { verifyToken } from "../utils/token.js";
import { sendError, check } from "../utils/validation.js";

const router = express.Router();

router.get("/reasons", (req, res) => {
  res.json(TICKET_REASONS);
});


function readOptionalCustomer(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    return payload.type === "customer" ? payload : null;
  } catch {
    return null;
  }
}


router.post("/", async (req, res) => {
  try {
    const { tracking_token, reason, message } = req.body;
    check.required(tracking_token, "your order's tracking token");
    check.required(reason, "a reason for the issue");

    if (!TICKET_REASONS.includes(reason)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please choose a valid reason." });
    }
    if (reason === "Other") {
      check.required(message, "a description of the issue");
    }

    const order = await Order.findOne({ tracking_token });
    if (!order) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that order. Please check and try again." });

    const trimmedMessage = String(message || "").trim();
    const firstMessage = trimmedMessage || reason;

    const customerPayload = readOptionalCustomer(req);
    let customer_id = null;
    let customer_name = "";
    if (customerPayload && String(customerPayload.seller_id) === String(order.seller_id)) {
      customer_id = customerPayload.id;
      const customer = await Customer.findById(customer_id).select("name");
      customer_name = customer?.name || "";
    }

    const ticket = await SupportTicket.create({
      seller_id: order.seller_id,
      order_id: order._id,
      tracking_token,
      customer_id,
      customer_name,
      reason,
      message: trimmedMessage,
      messages: [{ sender: "customer", text: firstMessage }],
    });
    res.status(StatusCodes.CREATED).json(ticket);
  } catch (err) {
    sendError(res, err);
  }
});


router.get("/customer/mine", requireCustomerAuth, async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ customer_id: req.customer.id })
      .sort({ created_at: -1 })
      .populate("order_id", "tracking_token status total_amount items created_at");
    res.json(tickets);
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/customer/:id/reply", requireCustomerAuth, async (req, res) => {
  try {
    const { text } = req.body;
    check.required(text, "a message");

    const ticket = await SupportTicket.findOneAndUpdate(
      { _id: req.params.id, customer_id: req.customer.id },
      {
        $push: { messages: { sender: "customer", text: String(text).trim() } },
        $set: { status: "open" },
      },
      { new: true }
    ).populate("order_id", "tracking_token status total_amount items created_at");

    if (!ticket) return res.status(StatusCodes.NOT_FOUND).json({ error: "Ticket not found" });
    res.status(StatusCodes.CREATED).json(ticket);
  } catch (err) {
    sendError(res, err);
  }
});


router.use("/seller", requireSellerAuth);

router.get("/seller", async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { seller_id: req.user.id };
    if (status) filter.status = status;
    const tickets = await SupportTicket.find(filter)
      .sort({ created_at: -1 })
      .populate("order_id", "tracking_token status shipping_address total_amount items created_at");
    res.json(tickets);
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/seller/:id/reply", async (req, res) => {
  try {
    const { text } = req.body;
    check.required(text, "a message");

    const ticket = await SupportTicket.findOneAndUpdate(
      { _id: req.params.id, seller_id: req.user.id },
      {
        $push: { messages: { sender: "seller", text: String(text).trim() } },
        $set: { status: "in_progress" },
      },
      { new: true }
    ).populate("order_id", "tracking_token status shipping_address total_amount items created_at");

    if (!ticket) return res.status(StatusCodes.NOT_FOUND).json({ error: "Ticket not found" });
    res.status(StatusCodes.CREATED).json(ticket);
  } catch (err) {
    sendError(res, err);
  }
});

router.put("/seller/:id/status", async (req, res) => {
  try {
    const { status, seller_note } = req.body;
    if (!["open", "in_progress", "resolved", "closed"].includes(status)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Invalid status" });
    }
    const update = { status };
    if (seller_note !== undefined) update.seller_note = seller_note;

    const ticket = await SupportTicket.findOneAndUpdate(
      { _id: req.params.id, seller_id: req.user.id },
      { $set: update },
      { new: true }
    ).populate("order_id", "tracking_token status shipping_address total_amount items created_at");
    if (!ticket) return res.status(StatusCodes.NOT_FOUND).json({ error: "Ticket not found" });
    res.json(ticket);
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
