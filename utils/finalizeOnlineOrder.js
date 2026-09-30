import Order from "../models/Order.js";
import PendingOrder from "../models/PendingOrder.js";
import Product from "../models/Product.js";
import Coupon from "../models/Coupon.js";
import Transaction from "../models/Transaction.js";
import { reserveStock } from "./warehouseAllocator.js";

export async function finalizeOnlineOrder({ razorpay_order_id, razorpay_payment_id, paid_at }) {
  const existing = await Order.findOne({ razorpay_order_id });
  if (existing) return existing;

  const pending = await PendingOrder.findOne({ razorpay_order_id });
  if (!pending) return null;

 
  const reservation = await reserveStock({
    sellerId: pending.seller_id,
    items: pending.items,
    destPincode: pending.shipping_address?.pincode,
  });
  const stockOk = reservation.ok;


  const order = await Order.create({
    seller_id: pending.seller_id,
    customer_id: pending.customer_id,
    items: stockOk ? reservation.items : pending.items,
    pickup_warehouse_ids: reservation.pickupWarehouseIds,
    subtotal: pending.subtotal,
    discount: pending.discount,
    item_discount: pending.item_discount,
    tax_amount: pending.tax_amount,
    shipping: pending.shipping,
    cod_charge: 0,
    total_amount: pending.total_amount,
    coupon_code: pending.coupon_code,
    payment_method: "online",
    payment_status: "paid",
    razorpay_order_id,
    razorpay_payment_id,
    paid_at: paid_at || new Date(),
    platform_fee: pending.can_split ? pending.platform_fee : 0,
    seller_payout_amount: pending.can_split ? pending.seller_payout_amount : 0,
    transfer_status: pending.can_split ? "pending" : "not_applicable",
    shipping_address: pending.shipping_address,
    status: "confirmed",
    status_history: [
      { status: "pending", note: "Checkout started" },
      {
        status: "confirmed",
        note: stockOk ? "Payment captured — order created" : "Payment captured — order created, but stock ran out in the meantime",
      },
    ],
    shipment: { type: pending.shipment_type },
    otp_verified: pending.otp_verified,
    is_flagged: !stockOk,
  });

  if (pending.coupon_id) {
    await Coupon.updateOne({ _id: pending.coupon_id }, { $inc: { used_count: 1 } });
  }

  await Transaction.create({
    seller_id: pending.seller_id,
    order_id: order._id,
    type: "split_created",
    order_total: pending.total_amount,
    platform_fee: pending.can_split ? pending.platform_fee : 0,
    seller_amount: pending.can_split ? pending.seller_payout_amount : pending.total_amount,
    razorpay_order_id,
    razorpay_payment_id,
    note: pending.can_split
      ? pending.is_mock_account
        ? "(mock) Simulated split for fake linked account — no real Razorpay transfer made"
        : "Split created for seller's linked account"
      : "No linked account — full amount held on platform, manual payout required",
  });

  await PendingOrder.deleteOne({ _id: pending._id });

  return order;
}
