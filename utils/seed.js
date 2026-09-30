import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { connectDB } from "../db.js";
import Seller from "../models/Seller.js";
import StorefrontConfig from "../models/StorefrontConfig.js";
import Category from "../models/Category.js";
import Product from "../models/Product.js";
import Coupon from "../models/Coupon.js";
import { StorePage } from "../models/Misc.js";
import { buildDefaultPages } from "../routes/pageRoutes.js";
import { getTemplateById, DEFAULT_TEMPLATE_ID } from "./templates.js";

dotenv.config();

async function seed() {
  await connectDB();

  const email = "demo@expressfly.test";
  await Seller.deleteOne({ email });

  const password_hash = await bcrypt.hash("password123", 10);
  const seller = await Seller.create({
    name: "Demo Seller",
    email,
    phone: "9998887777",
    password_hash,
    store_slug: "demo-store",
  });

  const template = getTemplateById(DEFAULT_TEMPLATE_ID);
  await StorefrontConfig.findOneAndUpdate(
    { seller_id: seller._id },
    {
      seller_id: seller._id,
      store_name: "Demo Store",
      slug: "demo-store",
      theme: { template_id: template.id, ...template.theme },
      sections: [
        { type: "hero", order: 0, settings: { heading: "Welcome to Demo Store", cta_text: "Shop Now" } },
        { type: "product_grid", order: 1, settings: { title: "Featured Products" } },
      ],
    },
    { upsert: true }
  );

  await StorePage.findOneAndUpdate(
    { seller_id: seller._id },
    {
      seller_id: seller._id,
      ...buildDefaultPages({ storeName: "Demo Store", sellerEmail: email, sellerPhone: "9998887777" }),
    },
    { upsert: true }
  );

  const category = await Category.create({
    seller_id: seller._id,
    name: "T-Shirts",
    slug: "t-shirts",
    description: "Comfortable everyday t-shirts",
  });

  const products = await Product.insertMany([
    {
      seller_id: seller._id,
      category_id: category._id,
      name: "Classic Cotton Tee",
      slug: "classic-cotton-tee",
      description: "100% cotton, breathable, everyday tee.",
      price: 499,
      stock_qty: 50,
      images: [],
      tags: ["cotton", "casual"],
    },
    {
      seller_id: seller._id,
      category_id: category._id,
      name: "Premium Graphic Tee",
      slug: "premium-graphic-tee",
      description: "Bold graphic print on premium fabric.",
      price: 799,
      stock_qty: 30,
      images: [],
      tags: ["graphic", "premium"],
    },
  ]);

  await Coupon.create({
    seller_id: seller._id,
    code: "WELCOME10",
    discount_type: "percentage",
    discount_value: 10,
    min_order_value: 300,
  });

  console.log("✅ Seed complete.");
  console.log("Seller login: demo@expressfly.test / password123");
  console.log("Store slug: demo-store");
  console.log(
    "Products:",
    products.map((p) => ({ id: p._id.toString(), name: p.name }))
  );
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
