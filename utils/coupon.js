import Coupon from "../models/Coupon.js";
import Product from "../models/Product.js";

export async function applyCoupon({ sellerId, code, subtotal, items = [] }) {
  if (!code || !String(code).trim()) throw new Error("Please enter a coupon code.");
  const coupon = await Coupon.findOne({ seller_id: sellerId, code: code.toUpperCase(), is_active: true });
  if (!coupon) throw new Error("That coupon code isn't valid. Please check it and try again.");

  const now = new Date();
  if (coupon.valid_from && now < coupon.valid_from) throw new Error("This coupon isn't active yet.");
  if (coupon.valid_until && now > coupon.valid_until) throw new Error("This coupon has expired.");
  if (coupon.usage_limit != null && coupon.used_count >= coupon.usage_limit) throw new Error("This coupon has reached its usage limit and can no longer be used.");
  if (subtotal < coupon.min_order_value) {
    throw new Error(`This coupon needs a minimum order of ₹${coupon.min_order_value}. Add a bit more to your cart to use it.`);
  }

  let eligibleSubtotal = subtotal;

  if (coupon.applies_to === "products" || coupon.applies_to === "category") {
    const productIds = items.map((i) => i.product_id).filter(Boolean);
    const products = await Product.find({ _id: { $in: productIds } }).select("price category_id");
    const productMap = new Map(products.map((p) => [String(p._id), p]));

    const productIdSet = new Set((coupon.product_ids || []).map(String));
    const categoryIdSet = new Set((coupon.category_ids || []).map(String));

    eligibleSubtotal = items.reduce((sum, item) => {
      const product = productMap.get(String(item.product_id));
      if (!product) return sum;

      const isEligible =
        coupon.applies_to === "products"
          ? productIdSet.has(String(product._id))
          : categoryIdSet.has(String(product.category_id));

      return isEligible ? sum + product.price * (item.quantity || 1) : sum;
    }, 0);

    if (eligibleSubtotal <= 0) {
      throw new Error(
        coupon.applies_to === "category"
          ? "This coupon only applies to specific categories, and nothing in your cart is in them."
          : "This coupon doesn't apply to any of the items currently in your cart."
      );
    }
  }

  const rawDiscount =
    coupon.discount_type === "percentage"
      ? Math.round((eligibleSubtotal * coupon.discount_value) / 100)
      : coupon.discount_value;

  const discount = Math.min(rawDiscount, eligibleSubtotal, subtotal);

  return { coupon, discount };
}
