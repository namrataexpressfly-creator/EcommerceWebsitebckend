import { fail } from "./validation.js";

export const round2 = (n) => Math.round(Number(((Number(n) || 0) * 100).toPrecision(12))) / 100;

export function priceLine(unitPrice, quantity, rules = {}) {
  const price = Number(unitPrice) || 0;
  const qty = Number(quantity) || 0;
  const dValue = Number(rules.discount_value) || 0;
  const tValue = Number(rules.tax_value) || 0;

  const unitDiscount = Math.min(rules.discount_type === "flat" ? dValue : (price * dValue) / 100, price);
  const discount_amount = round2(unitDiscount * qty);

  const netLine = price * qty - discount_amount;
  const tax_amount = round2(rules.tax_type === "flat" ? tValue * qty : (netLine * tValue) / 100);

  return { discount_amount, tax_amount };
}

export function resolveLineItem(product, item) {
  if (product.product_type === "variable") {
    if (!item.combination_id) {
      fail(`Please select an option for "${product.name}" before adding it to your cart.`);
    }
    const combo = (product.combinations || []).find(
      (c) => String(c._id) === String(item.combination_id)
    );
    if (!combo || combo.is_active === false) {
      fail(`That option for "${product.name}" is no longer available. Please choose another.`);
    }
    return {
      price: combo.price != null ? combo.price : product.price,
      stock: combo.stock,
      images: combo.images?.length ? combo.images : product.images,
      label: combo.label || "",
      combination_id: combo._id,
      discount_type: combo.discount_type,
      discount_value: combo.discount_percentage,
      tax_type: combo.tax_type,
      tax_value: combo.tax_percentage,
    };
  }

  return {
    price: product.price,
    stock: product.stock_qty,
    images: product.images,
    label: "",
    combination_id: null,
    discount_type: product.discount_type,
    discount_value: product.discount_percentage,
    tax_type: product.tax_type,
    tax_value: product.tax_percentage,
  };
}
