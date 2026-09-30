import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Product from "../models/Product.js";
import Warehouse from "../models/Warehouse.js";



const toRad = (d) => (d * Math.PI) / 180;

export function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

let pincodeTable = null;
function loadPincodeTable() {
  if (pincodeTable) return pincodeTable;
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    pincodeTable = JSON.parse(fs.readFileSync(path.join(dir, "../data/in_pincodes.json"), "utf8"));
  } catch {
    pincodeTable = {};
  }
  return pincodeTable;
}

export function coordsForPincode(pincode) {
  const hit = loadPincodeTable()[String(pincode || "").trim()];
  return hit ? { lat: hit[0], lng: hit[1] } : null;
}


function sharedPrefix(a, b) {
  a = String(a || "");
  b = String(b || "");
  let n = 0;
  while (n < 6 && a[n] && a[n] === b[n]) n++;
  return n;
}

export function rankWarehouses(warehouses, dest = {}) {
  const destCoords =
    dest.lat != null && dest.lng != null ? { lat: dest.lat, lng: dest.lng } : coordsForPincode(dest.pincode);
  const useGeo = !!destCoords && warehouses.every((w) => w.location?.lat != null && w.location?.lng != null);

  const scored = warehouses.map((w) => ({
    warehouse: w,
    distance_km: useGeo ? haversineKm(destCoords, w.location) : null,

    score: useGeo ? haversineKm(destCoords, w.location) : -sharedPrefix(dest.pincode, w.address?.pincode),
  }));

  scored.sort(
    (x, y) =>
      x.score - y.score ||
      (x.warehouse.priority || 0) - (y.warehouse.priority || 0) ||
      new Date(x.warehouse.created_at || 0) - new Date(y.warehouse.created_at || 0)
  );
  return scored;
}

const comboOf = (item, product) =>
  item.combination_id
    ? (product?.combinations || []).find((c) => String(c._id) === String(item.combination_id))
    : null;

const rowsOf = (item, product) => {
  if (!product) return [];
  if (item.combination_id) return comboOf(item, product)?.warehouse_stock || [];
  return product.warehouse_stock || [];
};

const isTracked = (item, product) => rowsOf(item, product).length > 0;

const qtyAt = (item, product, wid) =>
  Number(rowsOf(item, product).find((s) => String(s.warehouse_id) === String(wid))?.qty) || 0;

const lineKey = (item) => `${item.product_id}:${item.combination_id || ""}`;


export function planAllocation(items, products, ranked) {
  const allocations = new Map();
  const tracked = items
    .map((item, idx) => ({ item, idx, product: products.get(String(item.product_id)) }))
    .filter((r) => isTracked(r.item, r.product));

  for (const { warehouse } of ranked) {
    const need = new Map();
    tracked.forEach((r) => need.set(lineKey(r.item), (need.get(lineKey(r.item)) || 0) + r.item.quantity));
    const canShipAll = tracked.every((r) => qtyAt(r.item, r.product, warehouse._id) >= need.get(lineKey(r.item)));
    if (canShipAll) {
      tracked.forEach((r) => allocations.set(r.idx, [{ warehouse_id: warehouse._id, qty: r.item.quantity }]));
      return { ok: true, allocations, shortage: null };
    }
  }


  const taken = new Map(); 
  for (const r of tracked) {
    let left = r.item.quantity;
    const parts = [];
    for (const { warehouse } of ranked) {
      if (left <= 0) break;
      const key = `${lineKey(r.item)}:${warehouse._id}`;
      const free = qtyAt(r.item, r.product, warehouse._id) - (taken.get(key) || 0);
      if (free <= 0) continue;
      const take = Math.min(free, left);
      parts.push({ warehouse_id: warehouse._id, qty: take });
      taken.set(key, (taken.get(key) || 0) + take);
      left -= take;
    }
    if (left > 0) return { ok: false, allocations, shortage: { name: r.item.name, missing: left } };
    allocations.set(r.idx, parts);
  }
  return { ok: true, allocations, shortage: null };
}


const rowUpdate = (item, wid, delta, extraInc = {}) => {
  if (item.combination_id) {
    return {
      update: { $inc: { "combinations.$[c].warehouse_stock.$[w].qty": delta, ...extraInc } },
      options: { arrayFilters: [{ "c._id": item.combination_id }, { "w.warehouse_id": wid }] },
    };
  }
  return {
    update: { $inc: { "warehouse_stock.$[w].qty": delta, ...extraInc } },
    options: { arrayFilters: [{ "w.warehouse_id": wid }] },
  };
};


const rowHasQty = (item, wid, qty) =>
  item.combination_id
    ? {
        _id: item.product_id,
        combinations: {
          $elemMatch: {
            _id: item.combination_id,
            stock: { $gte: qty },
            warehouse_stock: { $elemMatch: { warehouse_id: wid, qty: { $gte: qty } } },
          },
        },
      }
    : {
        _id: item.product_id,
        stock_qty: { $gte: qty },
        warehouse_stock: { $elemMatch: { warehouse_id: wid, qty: { $gte: qty } } },
      };


const totalsInc = (item, qty, sign) =>
  item.combination_id
    ? { "combinations.$[c].stock": sign * qty, stock_qty: sign * qty, sold_count: -sign * qty }
    : { stock_qty: sign * qty, sold_count: -sign * qty };

async function decWarehouse(item, wid, qty) {
  const { update, options } = rowUpdate(item, wid, -qty, totalsInc(item, qty, -1));
  const r = await Product.updateOne(rowHasQty(item, wid, qty), update, options);
  return r.modifiedCount === 1;
}

async function incWarehouse(item, wid, qty) {
  const { update, options } = rowUpdate(item, wid, qty, totalsInc(item, qty, +1));
  await Product.updateOne({ _id: item.product_id }, update, options);
}

async function decPlain(item) {
  const isVariant = Boolean(item.combination_id);
  const filter = isVariant
    ? { _id: item.product_id, combinations: { $elemMatch: { _id: item.combination_id, stock: { $gte: item.quantity } } } }
    : { _id: item.product_id, stock_qty: { $gte: item.quantity } };
  const ops = isVariant
    ? { $inc: { "combinations.$[elem].stock": -item.quantity, stock_qty: -item.quantity, sold_count: item.quantity } }
    : { $inc: { stock_qty: -item.quantity, sold_count: item.quantity } };
  const options = isVariant ? { arrayFilters: [{ "elem._id": item.combination_id }] } : {};
  return (await Product.updateOne(filter, ops, options)).modifiedCount === 1;
}

async function incPlain(item) {
  const isVariant = Boolean(item.combination_id);
  await Product.updateOne(
    { _id: item.product_id },
    isVariant
      ? { $inc: { "combinations.$[elem].stock": item.quantity, stock_qty: item.quantity, sold_count: -item.quantity } }
      : { $inc: { stock_qty: item.quantity, sold_count: -item.quantity } },
    isVariant ? { arrayFilters: [{ "elem._id": item.combination_id }] } : {}
  );
}


export async function restoreStock(items) {
  for (const item of items || []) {
    if (item.allocations?.length) {
      for (const a of item.allocations) await incWarehouse(item, a.warehouse_id, a.qty);
    } else {
      await incPlain(item);
    }
  }
}


export async function reserveStock({ sellerId, items, destPincode }) {
  const plainItems = items.map((i) => (typeof i.toObject === "function" ? i.toObject() : { ...i }));

  const warehouses = await Warehouse.find({ seller_id: sellerId, is_active: true }).lean();

  for (let attempt = 0; attempt < 3; attempt++) {
    const productDocs = await Product.find({ _id: { $in: plainItems.map((i) => i.product_id) } })
      .select("warehouse_stock stock_qty combinations._id combinations.stock combinations.warehouse_stock")
      .lean();
    const products = new Map(productDocs.map((p) => [String(p._id), p]));
    const ranked = rankWarehouses(warehouses, { pincode: destPincode });

    const plan = planAllocation(plainItems, products, ranked);
    if (!plan.ok) return { ok: false, items: plainItems, pickupWarehouseIds: [], failedName: plan.shortage?.name };

    const applied = []; 
    let failed = null;

    for (let idx = 0; idx < plainItems.length && !failed; idx++) {
      const item = plainItems[idx];
      const parts = plan.allocations.get(idx);
      if (parts) {
        for (const p of parts) {
          if (await decWarehouse(item, p.warehouse_id, p.qty)) {
            applied.push({ kind: "wh", item, wid: p.warehouse_id, qty: p.qty });
          } else {
            failed = item;
            break;
          }
        }
      } else if (await decPlain(item)) {
        applied.push({ kind: "plain", item });
      } else {
        failed = item;
      }
    }

    if (!failed) {
      const usedIds = new Set();
      plainItems.forEach((item, idx) => {
        const parts = plan.allocations.get(idx);
        if (parts) {
          item.allocations = parts.map((p) => ({ warehouse_id: p.warehouse_id, qty: p.qty }));
          parts.forEach((p) => usedIds.add(String(p.warehouse_id)));
        }
      });
   
      if (usedIds.size === 0 && ranked.length) usedIds.add(String(ranked[0].warehouse._id));
      return { ok: true, items: plainItems, pickupWarehouseIds: [...usedIds], failedName: null };
    }


    for (const a of applied) {
      if (a.kind === "wh") await incWarehouse(a.item, a.wid, a.qty);
      else await incPlain(a.item);
    }
    if (attempt === 2) return { ok: false, items: plainItems, pickupWarehouseIds: [], failedName: failed.name };
  }
}


export async function moveOrderToWarehouse(order, targetWarehouseId) {
  const moved = []; 

  const shift = async (item, fromWid, toWid, qty) => {
    const take = rowUpdate(item, toWid, -qty);
    const res = await Product.updateOne(rowHasQtyRow(item, toWid, qty), take.update, take.options);
    if (res.modifiedCount !== 1) return false;
    const give = rowUpdate(item, fromWid, qty);
    await Product.updateOne({ _id: item.product_id }, give.update, give.options);
    return true;
  };

  const rollback = async () => {
    for (const m of moved.reverse()) {
      const back = rowUpdate(m.item, m.from, -m.qty); 
      await Product.updateOne({ _id: m.item.product_id }, back.update, back.options);
      const restore = rowUpdate(m.item, targetWarehouseId, m.qty);
      await Product.updateOne({ _id: m.item.product_id }, restore.update, restore.options);
    }
  };

  for (const item of order.items) {
    for (const a of item.allocations || []) {
      if (String(a.warehouse_id) === String(targetWarehouseId)) continue;
      if (!(await shift(item, a.warehouse_id, targetWarehouseId, a.qty))) {
        await rollback();
        return { ok: false, error: `Not enough stock of "${item.name}" in that warehouse.` };
      }
      moved.push({ item, from: a.warehouse_id, qty: a.qty });
    }
  }

  order.items.forEach((item) => {
    if (item.allocations?.length) item.allocations = [{ warehouse_id: targetWarehouseId, qty: item.quantity }];
  });
  order.pickup_warehouse_ids = [targetWarehouseId];
  return { ok: true };
}


function rowHasQtyRow(item, wid, qty) {
  return item.combination_id
    ? {
        _id: item.product_id,
        combinations: {
          $elemMatch: { _id: item.combination_id, warehouse_stock: { $elemMatch: { warehouse_id: wid, qty: { $gte: qty } } } },
        },
      }
    : { _id: item.product_id, warehouse_stock: { $elemMatch: { warehouse_id: wid, qty: { $gte: qty } } } };
}
