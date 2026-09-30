import express from "express";
import { StatusCodes } from "http-status-codes";
import { ProductSEO } from "../models/Misc.js";
import Product from "../models/Product.js";
import Category from "../models/Category.js";
import Seller from "../models/Seller.js";
import { requireSellerAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/product/:id", async (req, res) => {
  const seo = await ProductSEO.findOne({ product_id: req.params.id });
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that product. It may have been removed." });

  const structured_data = seo?.structured_data && Object.keys(seo.structured_data).length
    ? seo.structured_data
    : {
        "@context": "https://schema.org/",
        "@type": "Product",
        name: product.name,
        description: product.description,
        image: product.images,
        offers: { "@type": "Offer", price: product.price, priceCurrency: "INR" },
      };

  res.json({
    meta_title: seo?.meta_title || product.name,
    meta_description: seo?.meta_description || product.description?.slice(0, 160),
    og_image: seo?.og_image || product.images?.[0] || null,
    structured_data,
  });
});

router.get("/category/:id", async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that category. It may have been removed." });
  res.json({
    meta_title: `${category.name} | Shop Online`,
    meta_description: category.description?.slice(0, 160) || `Browse ${category.name} products.`,
  });
});

router.put("/seller/product/:id", requireSellerAuth, async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, seller_id: req.user.id });
  if (!product) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that product. It may have been removed." });

  const seo = await ProductSEO.findOneAndUpdate(
    { product_id: product._id },
    { $set: { seller_id: req.user.id, ...req.body } },
    { new: true, upsert: true }
  );
  res.json(seo);
});

router.get("/:storeSlug/sitemap.xml", async (req, res) => {
  const seller = await Seller.findOne({ store_slug: req.params.storeSlug, is_active: true });
  if (!seller) return res.status(StatusCodes.NOT_FOUND).send("Store not found");

  const [products, categories] = await Promise.all([
    Product.find({ seller_id: seller._id, is_active: true }).select("_id updated_at"),
    Category.find({ seller_id: seller._id, is_active: true }).select("slug updated_at"),
  ]);

  const base = `${req.protocol}://${req.get("host")}/store/${req.params.storeSlug}`;
  const urls = [
    `<url><loc>${base}</loc></url>`,
    ...products.map((p) => `<url><loc>${base}/products/${p._id}</loc><lastmod>${p.updated_at.toISOString()}</lastmod></url>`),
    ...categories.map((c) => `<url><loc>${base}/categories/${c.slug}</loc></url>`),
  ].join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
  res.type("application/xml").send(xml);
});

export default router;
