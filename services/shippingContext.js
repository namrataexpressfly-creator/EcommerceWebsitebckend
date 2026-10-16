import Product from "../models/Product.js";
import Seller from "../models/Seller.js";

const VOLUMETRIC_DIVISOR = 5000;

const MIN_PARCEL_CM = Number(process.env.MIN_PARCEL_CM) || 14;
const atLeastMin = (v) => Math.max(Number(v) || 0, MIN_PARCEL_CM);
const r2 = (n) => Math.round(n * 100) / 100;
const last10 = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
};
const joinLines = (...p) => p.map((x) => String(x ?? "").trim()).filter(Boolean).join(", ");
const asNumber = (v) => (/^\d+$/.test(String(v ?? "").trim()) ? Number(String(v).trim()) : v);

function qtyForWarehouse(item, warehouseId) {
  if (!item.allocations?.length) return item.quantity;
  return item.allocations
    .filter((a) => String(a.warehouse_id) === String(warehouseId))
    .reduce((sum, a) => sum + a.qty, 0);
}


export async function buildShipmentContext(order, warehouse) {
  const products = await Product.find({ _id: { $in: order.items.map((i) => i.product_id) } }).select(
    "name sku length_cm width_cm height_cm weight_kg"
  );
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const seller = await Seller.findById(order.seller_id).select("name").lean();

  let physical = 0;
  let volumetric = 0;
  let L = 0;
  let W = 0;
  let H = 0;
  let value = 0;
  const items = [];
  const itemsCourier = [];
  const missingWeight = [];

  for (const it of order.items) {
    const qty = qtyForWarehouse(it, warehouse._id);
    if (!qty) continue;
    const p = byId.get(String(it.product_id));
    if (!p?.weight_kg) missingWeight.push(it.name);

    physical += (p?.weight_kg || 0) * qty;
    if (p?.length_cm && p?.width_cm && p?.height_cm) {
      volumetric += (p.length_cm * p.width_cm * p.height_cm * qty) / VOLUMETRIC_DIVISOR;
      L = Math.max(L, p.length_cm);
      W = Math.max(W, p.width_cm);
      H += p.height_cm * qty;
    }
    value += it.price * qty;
    items.push({ name: it.name, sku: p?.sku || "", quantity: qty, price: it.price });
    itemsCourier.push({
      product_sku: p?.sku || String(it.product_id),
      product_name: it.name,
      product_quantity: qty,
      product_value: it.price,
      actual_value: 0,
      gst_tax: 0,
    });
  }

  if (!items.length) {
    const err = new Error("No items in this order ship from the selected warehouse.");
    err.status = 400;
    throw err;
  }
  if (missingWeight.length) {
    const err = new Error(`Add a weight in Products before shipping: ${missingWeight.join(", ")}.`);
    err.status = 400;
    throw err;
  }

  const isCod = order.payment_method === "cod";
  const a = order.shipping_address || {};
  const wa = warehouse.address || {};

  return {
    order: {
      id: order.tracking_token,
      date: order.created_at,
      number: order.tracking_token,
      subtotal: r2(value),
      total: order.total_amount,
      quantity: items.reduce((s, i) => s + i.quantity, 0),
      discount: order.discount || 0,
      tax: order.tax_amount || 0,
      shipping: order.shipping || 0,
    },
    payment: { mode: isCod ? "COD" : "Prepaid", type: isCod ? "cod" : "prepaid", order_type: isCod ? 1 : 0, is_cod: isCod, cod_amount: isCod ? order.total_amount : 0 },
    pickup: {
      id: String(warehouse._id),
      name: warehouse.name,
      code: warehouse.code,
      phone: warehouse.contact_phone,
      phone10: last10(warehouse.contact_phone),
      contact_name: seller?.name || warehouse.name,
      address_line: joinLines(wa.line1, wa.line2),
      line1: wa.line1,
      line2: wa.line2,
      city: wa.city,
      state: wa.state,
      pincode: wa.pincode,
      pincode_number: asNumber(wa.pincode),
      lat: warehouse.location?.lat,
      lng: warehouse.location?.lng,
    },
    delivery: {
      name: a.name,
      phone: a.phone,
      phone10: last10(a.phone),
      email: a.email || null,
      address_line: joinLines(a.line1, a.line2),
      line1: a.line1,
      line2: a.line2,
      city: a.city,
      state: a.state,
      pincode: a.pincode,
      pincode_number: asNumber(a.pincode),
    },
    package: {
      weight_kg: r2(physical),
      volumetric_weight_kg: r2(volumetric),
      chargeable_weight_kg: r2(Math.max(physical, volumetric)),
      length_cm: L,
      width_cm: W,
      height_cm: H,
      dim_length: atLeastMin(L),
      dim_width: atLeastMin(W),
      dim_height: atLeastMin(H),
    },
    items,
    items_courier: itemsCourier,
  };
}