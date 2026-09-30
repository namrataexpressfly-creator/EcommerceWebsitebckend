import express from "express";
import { StatusCodes } from "http-status-codes";
import Product from "../models/Product.js";
import { requireSellerAuth, requireKycApproved } from "../middleware/auth.js";
import { sendError, check } from "../utils/validation.js";
import {
  checkAmountOrPercent,
  checkProductNumbers,
  checkWarehouses,
  isSet,
  normalizeCombinations,
} from "../utils/productValidation.js";

function sumCombinationsStock(combinations) {
  return (combinations || []).reduce((sum, c) => sum + (Number(c.stock) || 0), 0);
}

const router = express.Router();

router.get("/", requireSellerAuth, async (req, res) => {
  const products = await Product.find({ seller_id: req.user.id, is_active: true }).sort({ created_at: -1 });
  res.json(products);
});

router.get("/:id", requireSellerAuth, async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, seller_id: req.user.id });
  if (!product) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that product. It may have been removed." });
  res.json(product);
});

router.post("/", requireSellerAuth, requireKycApproved, async (req, res) => {
  try {
    const {
      name,
      slug,
      description,
      price,
      compare_at_price,
      images,
      stock_qty,
      warehouse_stock,
      category_id,
      sku,
      tags,
      length_cm,
      width_cm,
      height_cm,
      weight_kg,
      discount_type,
      discount_percentage,
      tax_type,
      tax_percentage,
      product_type,
      variants,
      combination_separator,
      combinations,
    } = req.body;

    const isVariable = product_type === "variable";
    const usesWarehouses = Array.isArray(warehouse_stock) && warehouse_stock.length > 0;
    const warehouseTotal = usesWarehouses
      ? warehouse_stock.reduce((sum, w) => sum + (Number(w.qty) || 0), 0)
      : null;

    check.required(name, "a product name");
    if (!isVariable) {
      check.positiveNumber(price, "Price");
      if (!usesWarehouses) check.positiveNumber(stock_qty ?? 0, "Stock quantity");
    }
    if (compare_at_price !== undefined && compare_at_price !== null && compare_at_price !== "") {
      check.positiveNumber(compare_at_price, "Compare-at price");
    }
    checkAmountOrPercent(discount_type, discount_percentage, "Discount", isVariable ? null : price);
    checkAmountOrPercent(tax_type, tax_percentage, "Tax");
    checkProductNumbers(req.body, price);
    await checkWarehouses(req.user.id, req.body);
    check.maxCount(images, 10, "images");
    const cleanCombinations = isVariable ? normalizeCombinations(combinations) : [];

    const product = await Product.create({
      seller_id: req.user.id,
      category_id: category_id || null,
      name,
      slug,
      description,
      price: isVariable ? (price ?? 0) : price,
      compare_at_price,
      images,
      stock_qty: isVariable ? sumCombinationsStock(cleanCombinations) : usesWarehouses ? warehouseTotal : stock_qty,
      warehouse_stock: isVariable ? [] : usesWarehouses ? warehouse_stock : [],
      sku,
      tags,
      length_cm: length_cm ?? null,
      width_cm: width_cm ?? null,
      height_cm: height_cm ?? null,
      weight_kg: weight_kg ?? null,
      discount_type: discount_type || "percentage",
      discount_percentage: discount_percentage || 0,
      tax_type: tax_type || "percentage",
      tax_percentage: tax_percentage || 0,
      product_type: isVariable ? "variable" : "simple",
      variants: isVariable ? variants || [] : [],
      combination_separator: combination_separator || "-",
      combinations: cleanCombinations,
    });
    res.status(StatusCodes.CREATED).json(product);
  } catch (err) {
    sendError(res, err);
  }
});

router.put("/:id", requireSellerAuth, requireKycApproved, async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.product_type === "variable") {

      if (body.combinations !== undefined) {
        body.combinations = normalizeCombinations(body.combinations);
        body.stock_qty = sumCombinationsStock(body.combinations);
      } else {
        delete body.stock_qty;
      }
      body.warehouse_stock = [];
    } else if (body.product_type === "simple") {
      body.variants = [];
      body.combinations = [];
    }


    if (body.product_type !== "variable" && Array.isArray(body.warehouse_stock)) {
      if (body.warehouse_stock.length > 0) {
        body.stock_qty = body.warehouse_stock.reduce((sum, w) => sum + (Number(w.qty) || 0), 0);
      }
    }

    if (body.name !== undefined) check.required(body.name, "a product name");
    if (body.price !== undefined && body.product_type !== "variable") check.positiveNumber(body.price, "Price");
    if (
      body.stock_qty !== undefined &&
      body.product_type !== "variable" &&
      !(Array.isArray(body.warehouse_stock) && body.warehouse_stock.length > 0)
    ) {
      check.positiveNumber(body.stock_qty, "Stock quantity");
    }
    if (body.compare_at_price !== undefined && body.compare_at_price !== null && body.compare_at_price !== "") {
      check.positiveNumber(body.compare_at_price, "Compare-at price");
    }

    let basePrice = isSet(body.price) ? Number(body.price) : null;
    const needsStoredPrice =
      basePrice === null &&
      (body.discount_type === "flat" || (body.combinations || []).some((c) => c.discount_type === "flat" && !isSet(c.price)));
    if (needsStoredPrice) {
      const existing = await Product.findOne({ _id: req.params.id, seller_id: req.user.id }).select("price").lean();
      basePrice = existing?.price ?? null;
    }
    checkAmountOrPercent(body.discount_type, body.discount_percentage, "Discount", body.product_type === "variable" ? null : basePrice);
    checkAmountOrPercent(body.tax_type, body.tax_percentage, "Tax");
    checkProductNumbers(body, basePrice);
    await checkWarehouses(req.user.id, body);
    if (body.images !== undefined) check.maxCount(body.images, 10, "images");

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, seller_id: req.user.id },
      { $set: body },
      { new: true, runValidators: true }
    );
    if (!product) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that product — it may have already been removed." });
    res.json(product);
  } catch (err) {
    sendError(res, err);
  }
});

router.delete("/:id", requireSellerAuth, async (req, res) => {
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, seller_id: req.user.id },
    { $set: { is_active: false } },
    { new: true }
  );
  if (!product) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that product. It may have been removed." });
  res.json({ ok: true });
});

export default router;
