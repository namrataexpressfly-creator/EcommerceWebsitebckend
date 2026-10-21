
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { connectDB } from "../db.js";
import Seller from "../models/Seller.js";
import StorefrontConfig from "../models/StorefrontConfig.js";
import Category from "../models/Category.js";
import Product from "../models/Product.js";
import Banner from "../models/Banner.js";
import Coupon from "../models/Coupon.js";
import { StorePage } from "../models/Misc.js";
import { buildDefaultPages } from "../routes/pageRoutes.js";
import { getTemplateById } from "./templates.js";

dotenv.config();

const EMAIL = "glow@expressfly.test";
const PASSWORD = "password123";
const SLUG = "glow-cosmetics";
const STORE_NAME = "Glow Cosmetics";

async function seed() {
  await connectDB();


  await Seller.deleteOne({ email: EMAIL });
  const password_hash = await bcrypt.hash(PASSWORD, 10);
  const seller = await Seller.create({
    name: "Ananya Sharma",
    email: EMAIL,
    phone: "9876543210",
    password_hash,
    store_slug: SLUG,
  });


  const template = getTemplateById("boutique");
  await StorefrontConfig.findOneAndUpdate(
    { seller_id: seller._id },
    {
      seller_id: seller._id,
      store_name: STORE_NAME,
      slug: SLUG,
      theme: { template_id: template.id, ...template.theme },
      sections: [
        { type: "hero", order: 0, settings: { heading: "Skincare & Beauty, Simplified", subheading: "Clean formulas, real results.", cta_text: "Shop Bestsellers" } },
        { type: "banner", order: 1, settings: {} },
        { type: "category_grid", order: 2, settings: { title: "Shop by Category" } },
        { type: "product_grid", order: 3, settings: { title: "New Arrivals" } },
        { type: "testimonials", order: 4, settings: { title: "Loved by our customers" } },
        { type: "newsletter", order: 5, settings: { heading: "Get 10% off your first order", subtext: "Skincare tips + early access to new drops." } },
      ],
    },
    { upsert: true }
  );

  await StorePage.findOneAndUpdate(
    { seller_id: seller._id },
    {
      seller_id: seller._id,
      ...buildDefaultPages({ storeName: STORE_NAME, sellerEmail: EMAIL, sellerPhone: "9876543210" }),
    },
    { upsert: true }
  );


  const categoryDefs = [
    { name: "Skincare", description: "Cleansers, moisturizers, serums, and sunscreen for every skin type." },
    { name: "Makeup", description: "Face, eye, lip, and cheek color to build your everyday look." },
    { name: "Haircare", description: "Shampoo, conditioner, oils, and styling essentials." },
    { name: "Fragrance", description: "Eau de parfum, body mist, and attar." },
    { name: "Bath & Body", description: "Body wash, lotion, scrubs, and bath soaks." },
    { name: "Nail Care", description: "Polish, treatments, and manicure tools." },
    { name: "Tools & Brushes", description: "Makeup brushes, sponges, and applicators." },
    { name: "Men's Grooming", description: "Face wash, beard care, and grooming kits for men." },
    { name: "Organic & Natural", description: "Clean-label, cruelty-free, and natural-ingredient products." },
    { name: "Gift Sets", description: "Curated beauty bundles and gifting sets." },
  ];

  const categories = await Category.insertMany(
    categoryDefs.map((c) => ({
      seller_id: seller._id,
      name: c.name,
      slug: c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      description: c.description,
    }))
  );
  const catId = (name) => categories.find((c) => c.name === name)._id;

  const productDefs = [
    {
      name: "Hydra-Glow Vitamin C Serum",
      category: "Skincare",
      description: "A lightweight, fast-absorbing serum with 15% Vitamin C and hyaluronic acid that brightens dull skin, fades dark spots, and locks in moisture. Dermatologically tested, suitable for daily use under sunscreen.",
      price: 899, compare_at_price: 1199, stock_qty: 120, sku: "GLW-SER-001",
      tags: ["vitamin-c", "brightening", "serum", "bestseller"],
      discount_percentage: 25, tax_percentage: 18,
    },
    {
      name: "Aqua Boost Gel Moisturizer",
      category: "Skincare",
      description: "An oil-free, non-greasy gel moisturizer with hyaluronic acid and aloe vera that hydrates for 24 hours without clogging pores. Ideal for oily and combination skin.",
      price: 649, compare_at_price: 799, stock_qty: 150, sku: "GLW-SKN-002",
      tags: ["moisturizer", "hydration", "oil-free"],
      discount_percentage: 18, tax_percentage: 18,
    },
    {
      name: "Matte Finish Liquid Foundation",
      category: "Makeup",
      description: "Full-coverage, long-wear liquid foundation with a natural matte finish. Sweat-proof and transfer-resistant for up to 12 hours, available across 20 shades.",
      price: 1099, compare_at_price: 1299, stock_qty: 80, sku: "GLW-MKP-003",
      tags: ["foundation", "matte", "long-wear"],
      discount_percentage: 15, tax_percentage: 18,
    },
    {
      name: "Velvet Matte Lipstick",
      category: "Makeup",
      description: "Creamy, transfer-proof matte lipstick that glides on smoothly and doesn't dry out lips. Highly pigmented, one swipe opacity.",
      price: 449, compare_at_price: 549, stock_qty: 200, sku: "GLW-MKP-004",
      tags: ["lipstick", "matte", "bestseller"],
      discount_percentage: 18, tax_percentage: 18,
    },
    {
      name: "Argan Oil Repair Shampoo",
      category: "Haircare",
      description: "Sulfate-free shampoo infused with argan oil and keratin that repairs damaged, frizzy hair and restores shine without weighing it down.",
      price: 549, compare_at_price: 649, stock_qty: 140, sku: "GLW-HAI-005",
      tags: ["shampoo", "argan-oil", "sulfate-free"],
      discount_percentage: 15, tax_percentage: 18,
    },
    {
      name: "Rose & Oud Eau de Parfum",
      category: "Fragrance",
      description: "A rich, long-lasting unisex fragrance blending Bulgarian rose, oud, and warm amber. 50ml, 8+ hour wear.",
      price: 1899, compare_at_price: 2499, stock_qty: 60, sku: "GLW-FRA-006",
      tags: ["perfume", "oud", "long-lasting"],
      discount_percentage: 24, tax_percentage: 18,
    },
    {
      name: "Coconut Milk Body Wash",
      category: "Bath & Body",
      description: "A creamy, sulfate-free body wash with coconut milk and shea butter that cleanses without stripping natural moisture. Tropical coconut scent.",
      price: 399, compare_at_price: 479, stock_qty: 180, sku: "GLW-BTH-007",
      tags: ["body-wash", "coconut", "moisturizing"],
      discount_percentage: 17, tax_percentage: 18,
    },
    {
      name: "Gel Nail Polish – Ruby Red",
      category: "Nail Care",
      description: "Chip-resistant, high-shine gel-effect nail polish that lasts up to 10 days without a UV lamp. Quick-dry formula.",
      price: 249, compare_at_price: 299, stock_qty: 220, sku: "GLW-NAI-008",
      tags: ["nail-polish", "gel-effect", "quick-dry"],
      discount_percentage: 17, tax_percentage: 18,
    },
    {
      name: "Professional Makeup Brush Set (12-Piece)",
      category: "Tools & Brushes",
      description: "A 12-piece synthetic bristle brush set covering face, eye, and lip application, with a travel-friendly case. Cruelty-free and vegan.",
      price: 799, compare_at_price: 999, stock_qty: 90, sku: "GLW-TLS-009",
      tags: ["brushes", "makeup-tools", "vegan"],
      discount_percentage: 20, tax_percentage: 18,
    },
    {
      name: "Radiance Gift Box – Skincare Starter Kit",
      category: "Gift Sets",
      description: "A curated 4-piece skincare starter kit — cleanser, toner, serum, and moisturizer — in premium gift packaging. Perfect for birthdays and festive gifting.",
      price: 1499, compare_at_price: 1999, stock_qty: 50, sku: "GLW-GFT-010",
      tags: ["gift-set", "skincare-kit", "bestseller"],
      discount_percentage: 25, tax_percentage: 18,
    },
  ];

  const products = await Product.insertMany(
    productDefs.map((p) => ({
      seller_id: seller._id,
      category_id: catId(p.category),
      name: p.name,
      slug: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      description: p.description,
      price: p.price,
      compare_at_price: p.compare_at_price,
      images: [],
      stock_qty: p.stock_qty,
      sku: p.sku,
      tags: p.tags,
      discount_type: "percentage",
      discount_percentage: p.discount_percentage,
      tax_type: "percentage",
      tax_percentage: p.tax_percentage,
      product_type: p.product_type || "simple",
    }))
  );

  const bannerDefs = [
    { title: "New Season, New Glow", subtitle: "Up to 25% off Vitamin C skincare", link_url: "" },
    { title: "Matte Lips, All Day", subtitle: "Velvet Matte Lipstick — buy 2 get 10% off", link_url: "" },
    { title: "Gift Sets for Every Occasion", subtitle: "Curated beauty boxes, ready to ship", link_url: "" },
    { title: "Clean Beauty, Real Results", subtitle: "Explore our Organic & Natural range", link_url: "" },
    { title: "Flat ₹49 Shipping", subtitle: "On every order across India", link_url: "" },
  ];

  await Banner.insertMany(
    bannerDefs.map((b, i) => ({
      seller_id: seller._id,
      store_slug: SLUG,
      image_url: "/uploads/banners/placeholder.jpg", 
      title: b.title,
      subtitle: b.subtitle,
      link_url: b.link_url,
      order: i,
      is_active: true,
    }))
  );


  await Coupon.create({
    seller_id: seller._id,
    code: "GLOW10",
    discount_type: "percentage",
    discount_value: 10,
    min_order_value: 500,
  });

  console.log("✅ Cosmetics demo store seeded.");
  console.log("--------------------------------------------------");
  console.log("Seller login:", EMAIL, "/", PASSWORD);
  console.log("Store slug:  ", SLUG);
  console.log("Storefront:   http://localhost:5173/store/" + SLUG);
  console.log("Dashboard:    http://localhost:5173/seller/login");
  console.log("Categories:  ", categories.length);
  console.log("Products:    ", products.length);
  console.log("Banners:     ", bannerDefs.length, "(placeholder images — upload real ones in Banners page)");
  console.log("Coupon:       GLOW10 (10% off orders ≥ ₹500)");
  console.log("--------------------------------------------------");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
