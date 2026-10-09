import Order from "../models/Order.js";
import Shipment from "../models/Shipment.js";

const RANK = { pending: 0, confirmed: 1, packed: 2, shipped: 3, out_for_delivery: 4, delivered: 5 };


export async function syncOrderFromShipments(orderId) {
  const order = await Order.findById(orderId);
  if (!order) return;
  const shipments = await Shipment.find({ order_id: orderId, is_active: true });
  if (!shipments.length) return;

  let next = null;
  if (shipments.every((s) => s.status === "delivered")) next = "delivered";
  else if (shipments.some((s) => s.status === "out_for_delivery")) next = "out_for_delivery";
  else if (shipments.some((s) => ["shipped", "delivered"].includes(s.status))) next = "shipped";
  else if (shipments.every((s) => s.status === "returned")) next = "returned";

  if (!next || next === order.status) return;
  if (next !== "returned" && (RANK[next] ?? -1) <= (RANK[order.status] ?? -1)) return;

  order.status = next;
  order.status_history.push({ status: next, note: "Updated from courier tracking" });
  await order.save();
}
