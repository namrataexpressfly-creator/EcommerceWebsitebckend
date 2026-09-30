import express from "express";
import { StatusCodes } from "http-status-codes";
import { sendError } from "../utils/validation.js";
import Seller from "../models/Seller.js";
import Product from "../models/Product.js";
import Category from "../models/Category.js";

const router = express.Router();

async function getSellerBySlug(slug) {
  return Seller.findOne({ store_slug: slug, is_active: true }).select("_id");
}

router.get("/store/:slug/products", async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);

    if (!seller) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "We couldn't find this store. Please check the link." });
    }

    const {
      q,
      category,
      min_price,
      max_price,
      sort,
      availability,
      page = 1,
      limit = 12,
    } = req.query;

    const currentPage = Math.max(1, Number(page));
    const perPage = Math.max(1, Math.min(100, Number(limit)));

    const filter = {
      seller_id: seller._id,
      is_active: true,
    };

    const variantConditions = [];
    for (const [key, value] of Object.entries(req.query)) {
      if (!key.startsWith("variant_") || !value) continue;
      const variantName = key.slice("variant_".length);
      const values = String(value)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      if (!variantName || values.length === 0) continue;
      variantConditions.push({
        variants: {
          $elemMatch: {
            name: { $regex: `^${variantName}$`, $options: "i" },
            options: { $in: values },
          },
        },
      });
    }
    if (variantConditions.length > 0) {
      filter.$and = [...(filter.$and || []), ...variantConditions];
    }

    if (availability === "in_stock") {
      filter.stock_qty = { $gt: 0 };
    } else if (availability === "out_of_stock") {
      filter.stock_qty = { $lte: 0 };
    }

    if (q && q.trim().length >= 3) {
      const search = q.trim();

      filter.$or = [
        {
          name: {
            $regex: search,
            $options: "i",
          },
        },
        {
          description: {
            $regex: search,
            $options: "i",
          },
        },
        {
          slug: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    if (category) {
      const cat = await Category.findOne({
        seller_id: seller._id,
        slug: category,
        is_active: true,
      }).select("_id");

      if (!cat) {
        return res.json({
          products: [],
          total: 0,
          page: currentPage,
          limit: perPage,
        });
      }

      filter.category_id = cat._id;
    }

    if (min_price || max_price) {
      filter.price = {};

      if (min_price !== undefined && min_price !== "") {
        filter.price.$gte = Number(min_price);
      }

      if (max_price !== undefined && max_price !== "") {
        filter.price.$lte = Number(max_price);
      }
    }

    let sortSpec = { created_at: -1 };

    if (sort === "price_asc") {
      sortSpec = { price: 1 };
    }

    if (sort === "price_desc") {
      sortSpec = { price: -1 };
    }

    const skip = (currentPage - 1) * perPage;

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort(sortSpec)
        .skip(skip)
        .limit(perPage)
        .populate("category_id", "name slug"),

      Product.countDocuments(filter),
    ]);

    return res.json({
      products,
      total,
      page: currentPage,
      limit: perPage,
      totalPages: Math.ceil(total / perPage),
    });
  } catch (err) {
    console.error("Store products error:", err);

    return sendError(res, err);
  }
});



router.get("/store/:slug/products/:productId", async (req, res) => {
  const seller = await getSellerBySlug(req.params.slug);
  if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link." });

  const product = await Product.findOne({ _id: req.params.productId, seller_id: seller._id, is_active: true })
    .populate("category_id", "name slug");
  if (!product) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that product. It may have been removed." });
  res.json(product);
});

router.get("/store/:slug/categories", async (req, res) => {
  const seller = await getSellerBySlug(req.params.slug);
  if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link." });

  const categories = await Category.find({ seller_id: seller._id, is_active: true }).sort({ name: 1 });
  res.json(categories);
});

router.get("/store/:slug/filters", async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link." });

    const [categories, categoryStats, priceStats, inStockCount, outOfStockCount, variantStats] = await Promise.all([
      Category.find({ seller_id: seller._id, is_active: true }).sort({ name: 1 }).lean(),

      Product.aggregate([
        { $match: { seller_id: seller._id, is_active: true } },
        { $sort: { sold_count: -1, created_at: -1 } },
        {
          $group: {
            _id: "$category_id",
            count: { $sum: 1 },
            image: { $first: { $arrayElemAt: ["$images", 0] } },
          },
        },
      ]),

      Product.aggregate([
        { $match: { seller_id: seller._id, is_active: true } },
        { $group: { _id: null, min: { $min: "$price" }, max: { $max: "$price" } } },
      ]),

      Product.countDocuments({ seller_id: seller._id, is_active: true, stock_qty: { $gt: 0 } }),
      Product.countDocuments({ seller_id: seller._id, is_active: true, stock_qty: { $lte: 0 } }),

      Product.aggregate([
        { $match: { seller_id: seller._id, is_active: true } },
        { $unwind: "$variants" },
        { $unwind: "$variants.options" },
        { $group: { _id: { name: "$variants.name", value: "$variants.options" }, count: { $sum: 1 } } },
        { $group: { _id: "$_id.name", options: { $push: { value: "$_id.value", count: "$count" } } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const statsByCategory = new Map(categoryStats.map((s) => [String(s._id), s]));

    res.json({
      categories: categories.map((c) => {
        const stat = statsByCategory.get(String(c._id));
        return {
          ...c,
          product_count: stat?.count || 0,
          image: stat?.image || null,
        };
      }),
      price: {
        min: priceStats[0]?.min ?? 0,
        max: priceStats[0]?.max ?? 0,
      },
      availability: {
        in_stock: inStockCount,
        out_of_stock: outOfStockCount,
      },
      variants: variantStats
        .map((v) => ({
          name: v._id,
          options: v.options.sort((a, b) => a.value.localeCompare(b.value)),
        }))
        .filter((v) => v.name && v.options.length > 0),
    });
  } catch (err) {
    console.error("Store filters error:", err);
    sendError(res, err);
  }
});

export default router;
