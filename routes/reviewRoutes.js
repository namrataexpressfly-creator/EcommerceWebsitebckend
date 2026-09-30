import express from "express";
import { StatusCodes } from "http-status-codes";
import Seller from "../models/Seller.js";
import Product from "../models/Product.js";
import Review from "../models/Review.js";
import Customer from "../models/Customer.js";
import { requireCustomerAuth } from "../middleware/auth.js";
import { sendError } from "../utils/validation.js";

const router = express.Router();

async function getSellerBySlug(slug) {
  return Seller.findOne({ store_slug: slug, is_active: true }).select("_id");
}

function summarize(reviews) {
  const count = reviews.length;
  const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let sum = 0;

  for (const r of reviews) {
    sum += r.rating;
    breakdown[r.rating] = (breakdown[r.rating] || 0) + 1;
  }

  return {
    average_rating: count ? Number((sum / count).toFixed(1)) : 0,
    count,
    breakdown,
  };
}


router.get("/store/:slug/products/:productId/reviews", async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link." });

    const reviews = await Review.find({ seller_id: seller._id, product_id: req.params.productId })
      .sort({ created_at: -1 })
      .lean();

    res.json({ reviews, ...summarize(reviews) });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/store/:slug/products/:productId/reviews", requireCustomerAuth, async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link." });

    if (String(req.customer.seller_id) !== String(seller._id)) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ error: "Please log in to continue." });
    }

    const { rating, title, comment } = req.body;
    const numericRating = Number(rating);
    if (!numericRating || numericRating < 1 || numericRating > 5) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please choose a rating from 1 to 5 stars." });
    }
    if (title && String(title).length > 120) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Review title is too long (max 120 characters)." });
    }
    if (comment && String(comment).length > 2000) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Review comment is too long (max 2000 characters)." });
    }

    const product = await Product.findOne({ _id: req.params.productId, seller_id: seller._id });
    if (!product) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that product. It may have been removed." });

    const customer = await Customer.findById(req.customer.id).select("name");

    const review = await Review.findOneAndUpdate(
      { product_id: product._id, customer_id: req.customer.id },
      {
        $set: {
          seller_id: seller._id,
          product_id: product._id,
          customer_id: req.customer.id,
          customer_name: customer?.name || "Customer",
          rating: numericRating,
          title: (title || "").trim(),
          comment: (comment || "").trim(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(StatusCodes.CREATED).json(review);
  } catch (err) {
    sendError(res, err);
  }
});


router.get("/store/:slug/reviews", async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link." });

    const showAll = String(req.query.all) === "true";
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || (showAll ? 12 : 6)));
    const page = Math.max(1, Number(req.query.page) || 1);

    const filter = { seller_id: seller._id };
    if (!showAll) filter.rating = { $gte: 4 };

    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .sort({ created_at: -1 })
        .skip(showAll ? (page - 1) * limit : 0)
        .limit(limit)
        .populate("product_id", "name images slug")
        .lean(),
      showAll ? Review.countDocuments(filter) : Promise.resolve(undefined),
    ]);

    res.json({ reviews, total, page, limit });
  } catch (err) {
    sendError(res, err);
  }
});


router.get("/store/:slug/products/best-sellers", async (req, res) => {
  try {
    const seller = await getSellerBySlug(req.params.slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link." });

    const limit = Math.max(1, Math.min(20, Number(req.query.limit) || 8));

    const products = await Product.find({ seller_id: seller._id, is_active: true, sold_count: { $gt: 0 } })
      .sort({ sold_count: -1 })
      .limit(limit)
      .lean();

    res.json({ products });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
