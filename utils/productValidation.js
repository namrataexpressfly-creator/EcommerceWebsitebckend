import Warehouse from "../models/Warehouse.js";
import { check, fail } from "./validation.js";

const comboName = (c) =>
  c.label || Object.entries(c.option_values || {}).map(([k, v]) => `${k}: ${v}`).join(" / ") || c.sku || "a variant";


export function normalizeCombinations(combinations, basePrice = null) {
  return (Array.isArray(combinations) ? combinations : []).map((c) => {
    const rows = (Array.isArray(c.warehouse_stock) ? c.warehouse_stock : [])
      .filter((w) => w && w.warehouse_id)
      .map((w) => ({ warehouse_id: w.warehouse_id, qty: Number(w.qty) || 0 }));

    const price = isSet(c.price) ? Number(c.price) : Number(basePrice) || 0;
    return {
      ...c,
      price,
      warehouse_stock: rows,
      stock: rows.length ? rows.reduce((sum, w) => sum + w.qty, 0) : Number(c.stock) || 0,
    };
  });
}

export const isSet = (v) => v !== undefined && v !== null && v !== "";



export function checkAmountOrPercent(type, value, label, basePrice = null, priceLabel = "base price") {
  if (!isSet(value)) return;
  if (type === "flat") {
    const n = check.positiveNumber(value, label);
    if (basePrice !== null && n > Number(basePrice || 0)) {
      fail(
        Number(basePrice) > 0
          ? `${label} can't be more than the ${priceLabel} (${Number(basePrice)}).`
          : `Enter the base price before adding a flat ${label.toLowerCase()}.`
      );
    }
  } else check.percentage(value, label);
}


export async function checkWarehouses(sellerId, body) {
  const ids = new Set();
  (Array.isArray(body.warehouse_stock) ? body.warehouse_stock : []).forEach((w) => w?.warehouse_id && ids.add(String(w.warehouse_id)));
  (Array.isArray(body.combinations) ? body.combinations : []).forEach((c) => {
    const seen = new Set();
    (Array.isArray(c.warehouse_stock) ? c.warehouse_stock : []).forEach((w) => {
      if (!w?.warehouse_id) return;
      const id = String(w.warehouse_id);
      if (seen.has(id)) fail(`${comboName(c)} lists the same warehouse more than once.`);
      seen.add(id);
      ids.add(id);
    });
  });
  if (ids.size === 0) return;
  const owned = await Warehouse.countDocuments({ _id: { $in: [...ids] }, seller_id: sellerId });
  if (owned !== ids.size) fail("One of the selected warehouses wasn't found.");
}

export function checkProductNumbers(b, basePrice = null) {
  const measures = { length_cm: "Length", width_cm: "Width", height_cm: "Height", weight_kg: "Weight" };
  Object.entries(measures).forEach(([field, label]) => {
    if (isSet(b[field])) check.positiveNumber(b[field], label);
  });

  (Array.isArray(b.warehouse_stock) ? b.warehouse_stock : []).forEach((w) => {
    if (isSet(w.qty)) check.positiveNumber(w.qty, "Warehouse stock quantity");
  });

  (Array.isArray(b.combinations) ? b.combinations : []).forEach((c) => {
    if (isSet(c.price)) check.positiveNumber(c.price, "Variant price");
    if (isSet(c.stock)) check.positiveNumber(c.stock, "Variant stock");
    (Array.isArray(c.warehouse_stock) ? c.warehouse_stock : []).forEach((w) => {
      if (isSet(w.qty)) check.positiveNumber(w.qty, "Variant warehouse stock quantity");
    });

    checkAmountOrPercent(
      c.discount_type,
      c.discount_percentage,
      "Variant discount",
      isSet(c.price) ? c.price : basePrice,
      isSet(c.price) ? "variant price" : "base price"
    );
    checkAmountOrPercent(c.tax_type, c.tax_percentage, "Variant tax");
  });
}
