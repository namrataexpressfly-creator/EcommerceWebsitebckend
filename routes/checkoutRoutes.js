import express from "express";
import bcrypt from "bcryptjs";
import { StatusCodes } from "http-status-codes";
import Seller from "../models/Seller.js";
import StorefrontConfig from "../models/StorefrontConfig.js";
import Product from "../models/Product.js";
import Customer from "../models/Customer.js";
import Order from "../models/Order.js";
import PendingOrder from "../models/PendingOrder.js";
import AbandonedCheckout from "../models/AbandonedCheckout.js";
import Otp from "../models/Otp.js";
import { isRazorpayConfigured, getRazorpayForSeller } from "../utils/razorpay.js";
import { applyCoupon } from "../utils/coupon.js";
import { resolveLineItem, priceLine, round2 } from "../utils/cartPricing.js";
import { checkCodFraud } from "../utils/fraud.js";
import { reserveStock, restoreStock } from "../utils/warehouseAllocator.js";
import { sendOtpSms } from "../utils/sms.js";
import { sendError, check, fail } from "../utils/validation.js";

const SHIPPING_CHARGE = 49; // flat shipping charge per order, in rupees

const router = express.Router();

const OTP_TTL_MS = 5 * 60 * 1000; 
const MAX_OTP_ATTEMPTS = 5; 

async function getSellerBySlug(slug) {
  return Seller.findOne({ store_slug: slug, is_active: true });
}


router.post("/init", async (req, res) => {
  try {
    const { slug, items } = req.body;
    const seller = await getSellerBySlug(slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link and try again." });
    if (!items || !items.length) return res.status(StatusCodes.BAD_REQUEST).json({ error: "Your cart is empty — please add an item before checking out." });

    const productIds = items.map((i) => i.product_id);
    const products = await Product.find({ _id: { $in: productIds }, seller_id: seller._id, is_active: true });

    const priced = items.map((item) => {
      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty < 1) fail("Quantity has to be a whole number of 1 or more.");
      const product = products.find((p) => p._id.toString() === item.product_id);
      if (!product) fail(`One of the items in your cart is no longer available. Please remove it and try again.`);
      const resolved = resolveLineItem(product, item);
      if (resolved.stock < item.quantity) {
        const forName = resolved.label ? `${product.name} (${resolved.label})` : product.name;
        fail(`Sorry, "${forName}" doesn't have enough stock — only ${resolved.stock} left. Please adjust the quantity.`);
      }
      const { discount_amount, tax_amount } = priceLine(resolved.price, item.quantity, resolved);
      return {
        product_id: product._id,
        combination_id: resolved.combination_id,
        name: resolved.label ? `${product.name} (${resolved.label})` : product.name,
        price: resolved.price,
        quantity: item.quantity,
        discount_amount,
        tax_amount,
      };
    });

    const subtotal = priced.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const item_discount = round2(priced.reduce((sum, i) => sum + i.discount_amount, 0));
    const tax = round2(priced.reduce((sum, i) => sum + i.tax_amount, 0));

    const storefrontConfig = await StorefrontConfig.findOne({ seller_id: seller._id }).select("payment_settings").lean();
    const payment_settings = storefrontConfig?.payment_settings || {
      cod_enabled: true,
      online_enabled: true,
      cod_extra_charge: 0,
      cod_min_order_value: 0,
      cod_max_order_value: 0,
    };

 
    const {
      own_razorpay_key_secret_enc,
      own_razorpay_webhook_secret_enc,
      ...publicPaymentSettings
    } = payment_settings;

    const razorpayReady =
      publicPaymentSettings.razorpay_mode === "own"
        ? Boolean(publicPaymentSettings.own_razorpay_key_id && own_razorpay_key_secret_enc)
        : isRazorpayConfigured();

    res.json({ seller_id: seller._id, items: priced, subtotal, item_discount, tax, razorpay_enabled: razorpayReady, payment_settings: publicPaymentSettings });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/otp/send", async (req, res) => {
  try {
    const { phone } = req.body;
    check.phone(phone, "a valid 10-digit phone number");

    const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
    const otp_hash = await bcrypt.hash(otp, 10);
    const expires_at = new Date(Date.now() + OTP_TTL_MS);

    await Otp.findOneAndUpdate(
      { phone },
      { otp_hash, expires_at, attempts: 0 },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const result = await sendOtpSms(phone, otp);

    res.json({ ok: true, message: "OTP sent", dev_mode: Boolean(result.dev) });
  } catch (err) {
    sendError(res, err);
  }
});


router.post("/otp/verify", async (req, res) => {
  try {
    const { phone, otp } = req.body;
    check.phone(phone, "a valid 10-digit phone number");
    check.required(otp, "the OTP code sent to your phone");

    const entry = await Otp.findOne({ phone });
    if (!entry || entry.expires_at < new Date()) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "That code has expired. Please request a new OTP." });
    }

    if (entry.attempts >= MAX_OTP_ATTEMPTS) {
      await Otp.deleteOne({ _id: entry._id });
      return res
        .status(StatusCodes.TOO_MANY_REQUESTS)
        .json({ error: "Too many incorrect attempts. Please request a new OTP." });
    }

    const isMatch = await bcrypt.compare(otp, entry.otp_hash);
    if (!isMatch) {
      entry.attempts += 1;
      await entry.save();
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "That code doesn't match. Please double-check and try again." });
    }

    await Otp.deleteOne({ _id: entry._id }); 
    res.json({ verified: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/coupon/apply", async (req, res) => {
  try {
    const { slug, code, subtotal, items } = req.body;
    const seller = await getSellerBySlug(slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link and try again." });

    const { discount } = await applyCoupon({
      sellerId: seller._id,
      code,
      subtotal,
      items: (items || []).map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
    });

    res.json({ discount, total: subtotal - discount });
  } catch (err) {
    sendError(res, err);
  }
});


router.post("/order", async (req, res) => {
  let createdOrder = null;
  let stockUpdated = false;
  let pricedItems = [];
  let reservedItems = [];

  try {
    console.log("========== CREATE ORDER ==========");
    console.log("Request body:", JSON.stringify(req.body, null, 2));

    const {
      slug,
      items,
      address,
      phone,
      name,
      email,
      payment_method = "online",
      coupon_code,
      otp_verified,
      shipment_type = "standard",
    } = req.body;

    if (!["standard", "express", "self_pickup"].includes(shipment_type)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'shipment_type must be "standard", "express" or "self_pickup"',
      });
    }

    if (!slug) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "We couldn't tell which store this order is for. Please reload the page.",
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Your cart is empty. Add a product before checking out.",
      });
    }

    if (!phone) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Please enter your phone number.",
      });
    }

    if (!address || typeof address !== "object") {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Please add your shipping address.",
      });
    }

  
    if (!["online", "cod"].includes(payment_method)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'payment_method must be either "online" or "cod"',
      });
    }

    const seller = await getSellerBySlug(slug);

    if (!seller) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: "We couldn't find this store. Please check the link and try again.",
      });
    }

    if (seller.kyc?.status !== "approved") {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        error: "This store isn't accepting orders yet — seller verification is still pending.",
      });
    }

    for (const item of items) {
      if (!item.product_id) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: "One of the items in your cart is invalid. Please remove it and add it again.",
        });
      }

      if (
        !Number.isInteger(Number(item.quantity)) ||
        Number(item.quantity) <= 0
      ) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: `Invalid quantity for product ${item.product_id}`,
        });
      }
    }

   
    const productIds = items.map((item) => item.product_id);

    const products = await Product.find({
      _id: { $in: productIds },
      seller_id: seller._id,
      is_active: true,
    });

    if (products.length !== productIds.length) {
      const foundIds = products.map((product) => product._id.toString());

      const missingProduct = productIds.find(
        (id) => !foundIds.includes(id.toString())
      );

      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: `Product ${missingProduct} not found or inactive`,
      });
    }

    pricedItems = items.map((item) => {
      const product = products.find(
        (product) =>
          product._id.toString() === item.product_id.toString()
      );

      if (!product) {
        throw new Error(`Product ${item.product_id} not found`);
      }

      const quantity = Number(item.quantity);
      const resolved = resolveLineItem(product, item);

      if (resolved.stock < quantity) {
        const forName = resolved.label ? `${product.name} (${resolved.label})` : product.name;
        throw new Error(
          `${forName} is out of stock. Available stock: ${resolved.stock}`
        );
      }

      const { discount_amount, tax_amount } = priceLine(resolved.price, quantity, resolved);

      return {
        product_id: product._id,
        combination_id: resolved.combination_id,
        variant_label: resolved.label,
        name: resolved.label ? `${product.name} (${resolved.label})` : product.name,
        price: Number(resolved.price),
        quantity,
        discount_amount,
        tax_amount,
      };
    });

    const subtotal = pricedItems.reduce((sum, item) => {
      return sum + item.price * item.quantity;
    }, 0);

    const itemDiscount = round2(pricedItems.reduce((sum, item) => sum + item.discount_amount, 0));
    const taxAmount = round2(pricedItems.reduce((sum, item) => sum + item.tax_amount, 0));
    const discountedSubtotal = subtotal - itemDiscount;

    let discount = 0;
    let coupon = null;

    if (coupon_code) {
      const couponResult = await applyCoupon({
        sellerId: seller._id,
        code: coupon_code,
        subtotal: discountedSubtotal,
        items: pricedItems,
      });

      discount = Number(couponResult.discount || 0);
      coupon = couponResult.coupon;

      if (discount > discountedSubtotal) {
        discount = discountedSubtotal;
      }
    }

    // Flat shipping on every order (there is no free-shipping option).
    const shipping = SHIPPING_CHARGE;

    const storefrontConfig = await StorefrontConfig.findOne({ seller_id: seller._id }).lean();
    const paymentSettings = storefrontConfig?.payment_settings || {
      cod_enabled: true,
      online_enabled: true,
      cod_extra_charge: 0,
      cod_min_order_value: 0,
      cod_max_order_value: 0,
    };

    if (payment_method === "cod" && paymentSettings.cod_enabled === false) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Cash on Delivery isn't available for this store. Please pay online.",
      });
    }
    if (payment_method === "online" && paymentSettings.online_enabled === false) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: "Online payment isn't available for this store. Please choose Cash on Delivery.",
      });
    }
    if (payment_method === "cod") {
      if (paymentSettings.cod_min_order_value > 0 && subtotal < paymentSettings.cod_min_order_value) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: `Cash on Delivery is only available on orders above ₹${paymentSettings.cod_min_order_value}.`,
        });
      }
      if (paymentSettings.cod_max_order_value > 0 && subtotal > paymentSettings.cod_max_order_value) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: `Cash on Delivery is only available on orders up to ₹${paymentSettings.cod_max_order_value}. Please pay online.`,
        });
      }
    }

    const codCharge = payment_method === "cod" ? Number(paymentSettings.cod_extra_charge || 0) : 0;

    const total_amount = round2(
      Math.max(0, discountedSubtotal - discount + taxAmount + shipping + codCharge)
    );

   
    let customer = await Customer.findOne({
      seller_id: seller._id,
      phone,
    });

    if (!customer) {
      customer = await Customer.create({
        seller_id: seller._id,
        name: name || "Guest",
        email: email || null,
        phone,
      });
    } else {
     
      let customerChanged = false;

      if (name && customer.name !== name) {
        customer.name = name;
        customerChanged = true;
      }

      if (email && customer.email !== email) {
        customer.email = email;
        customerChanged = true;
      }

      if (customerChanged) {
        await customer.save();
      }
    }


    if (address && address.line1 && address.city && address.state && address.pincode) {
      const alreadySaved = customer.addresses.some(
        (a) =>
          a.line1 === address.line1 &&
          a.city === address.city &&
          a.pincode === String(address.pincode)
      );
      if (!alreadySaved) {
        const makeDefault = customer.addresses.length === 0;
        if (makeDefault) customer.addresses.forEach((a) => (a.is_default = false));
        customer.addresses.push({
          label: address.label || "Home",
          line1: address.line1,
          line2: address.line2 || "",
          city: address.city,
          state: address.state,
          pincode: String(address.pincode),
          is_default: makeDefault,
        });
        await customer.save();
      }
    }

    if (payment_method === "cod") {
      const fraudResult = await checkCodFraud({
        sellerId: seller._id,
        phone,
        ip: req.ip,
        cartTotal: total_amount,
      });

      if (!fraudResult.allowed) {
        return res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          error:
            "COD unavailable for this order. Please pay online.",
          reasons: fraudResult.reasons,
        });
      }
    }

    if (payment_method === "cod") {
      createdOrder = await Order.create({
        seller_id: seller._id,
        customer_id: customer._id,
        items: pricedItems,
        subtotal,
        discount,
        item_discount: itemDiscount,
        tax_amount: taxAmount,
        shipping,
        cod_charge: codCharge,
        total_amount,
        coupon_code: coupon_code || null,
        payment_method,
        payment_status: "cod_pending",
        shipping_address: {
          name: name || customer.name || "Guest",
          phone,
          ...address,
        },
        status: "pending",
        status_history: [{ status: "pending", note: "Order created" }],
        shipment: { type: shipment_type },
        otp_verified: Boolean(otp_verified),
        is_flagged: false,
      });

      console.log("Order created:", createdOrder._id.toString());

      const reservation = await reserveStock({
        sellerId: seller._id,
        items: pricedItems,
        destPincode: address?.pincode,
      });
      if (!reservation.ok) {
        throw new Error(`Unable to reserve stock for product ${reservation.failedName || "in your cart"}`);
      }
      reservedItems = reservation.items;
      createdOrder.items = reservation.items;
      createdOrder.pickup_warehouse_ids = reservation.pickupWarehouseIds;

      stockUpdated = true;

      createdOrder.status = "confirmed";
      createdOrder.payment_status = "cod_pending";
      createdOrder.status_history.push({
        status: "confirmed",
        note: "COD order confirmed",
      });
      await createdOrder.save();

      if (coupon) {
        coupon.used_count = Number(coupon.used_count || 0) + 1;
        await coupon.save();
      }

      console.log("COD order confirmed");

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "COD order created successfully",
        order_id: createdOrder._id,
        tracking_token: createdOrder.tracking_token,
        payment_method: "cod",
        payment_status: createdOrder.payment_status,
        total_amount,
        subtotal,
        discount,
        shipping,
      });
    }

   
    if (payment_method === "online") {

      const { client: razorpay, key_id: razorpayKeyId, mode: razorpayMode } = getRazorpayForSeller(storefrontConfig);

      if (!razorpay) {
        throw new Error("Unable to initialize Razorpay");
      }

      const razorpayAmount = Math.round(total_amount * 100);

      if (razorpayAmount <= 0) {
        throw new Error("Invalid Razorpay amount. Order total must be greater than 0.");
      }

      console.log("Creating Razorpay order...");
      console.log("Amount:", razorpayAmount);
      console.log("Currency: INR");

      const canSplit =
        razorpayMode === "platform" &&
        seller.razorpay_account_id &&
        seller.razorpay_account_status === "activated";

      const isMockAccount = Boolean(
        seller.razorpay_account_id && seller.razorpay_account_id.startsWith("acc_mock_")
      );

      let platformFee = 0;
      let sellerPayout = total_amount;

      if (canSplit) {
        const commissionPercent = Number(seller.commission_percent ?? 10);
        platformFee = Math.round((total_amount * commissionPercent) / 100 * 100) / 100;
        sellerPayout = Math.max(0, total_amount - platformFee);

        if (isMockAccount) {
          console.log(
            `🧪 Mock account (${seller.razorpay_account_id}) — simulating split locally, ` +
              `no real Razorpay transfers call made.`
          );
        }

      } else if (razorpayMode === "platform") {
        console.warn(
          `Seller ${seller._id} has no activated Razorpay linked account — ` +
            `payment will settle to the platform account only (manual payout required).`
        );
      }


      const receipt = `${customer._id.toString()}-${Date.now()}`;

      const razorpayOrder = await razorpay.orders.create({
        amount: razorpayAmount,
        currency: "INR",
        receipt,
        notes: {
          store_slug: slug,
          customer_phone: String(phone),
        },
      });

      if (!razorpayOrder || !razorpayOrder.id) {
        throw new Error("Razorpay did not return an order ID");
      }

      await PendingOrder.create({
        razorpay_order_id: razorpayOrder.id,
        seller_id: seller._id,
        customer_id: customer._id,
        items: pricedItems,
        subtotal,
        discount,
        item_discount: itemDiscount,
        tax_amount: taxAmount,
        shipping,
        total_amount,
        coupon_code: coupon_code || null,
        coupon_id: coupon ? coupon._id : null,
        shipping_address: {
          name: name || customer.name || "Guest",
          phone,
          ...address,
        },
        shipment_type,
        otp_verified: Boolean(otp_verified),
        can_split: canSplit,
        is_mock_account: isMockAccount,
        platform_fee: platformFee,
        seller_payout_amount: sellerPayout,
      });

      console.log("Razorpay order created (order not created yet — awaiting payment):", razorpayOrder.id);

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Razorpay order initialized — order will be created once payment is confirmed",
        razorpay_order_id: razorpayOrder.id,
        razorpay_key_id: razorpayKeyId,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        payment_method: "online",
        payment_status: "pending",
        subtotal,
        discount,
        shipping,
        total_amount,
        split_payment: canSplit,
      });
    }


    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      error: "Please choose a valid payment method.",
    });
 
  } catch (err) {
  console.error("=================================");
  console.error("CREATE ORDER ERROR");
  console.error("=================================");

  console.error("RAW ERROR:", err);

  console.error(
    "ERROR JSON:",
    JSON.stringify(err, null, 2)
  );

  console.error("Error name:", err?.name);
  console.error("Error message:", err?.message);
  console.error("Error status:", err?.statusCode);
  console.error("Error description:", err?.error?.description);
  console.error("Error reason:", err?.error?.reason);

  const errorMessage =
    err?.error?.description ||
    err?.error?.reason ||
    err?.message ||
    "Unable to create order";

  console.error("FINAL ERROR MESSAGE:", errorMessage);

  if (stockUpdated && reservedItems.length > 0) {
    try {
      console.log("Restoring product stock...");
      await restoreStock(reservedItems);
      console.log("Stock restored successfully");
    } catch (stockError) {
      console.error("STOCK RESTORE ERROR:", stockError);
    }
  }

  if (createdOrder) {
    try {
      await Order.deleteOne({
        _id: createdOrder._id,
      });

      console.log(
        "Failed order removed:",
        createdOrder._id
      );
    } catch (deleteError) {
      console.error(
        "ORDER DELETE ERROR:",
        deleteError
      );
    }
  }

  if (
    err?.name === "ValidationError" ||
    err?.name === "CastError"
  ) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      error: "We couldn't place your order — some details look incorrect. Please check your address and items, then try again.",
    });
  }

  return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    success: false,
    error: "We couldn't complete your order right now. Please try again in a moment, or contact us if the problem continues.",
  });
}
});


router.post("/abandoned", async (req, res) => {
  try {
    const { slug, phone, email, items, cart_value, step_reached } = req.body;
    const seller = await getSellerBySlug(slug);
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link and try again." });

    const entry = await AbandonedCheckout.create({
      seller_id: seller._id,
      customer_phone: phone || null,
      customer_email: email || null,
      items,
      cart_value,
      step_reached,
    });
    res.status(StatusCodes.CREATED).json(entry);
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
