import express from "express";
import { StatusCodes } from "http-status-codes";
import StorefrontConfig from "../models/StorefrontConfig.js";
import Seller from "../models/Seller.js";
import VisitLog from "../models/VisitLog.js";
import { requireSellerAuth, requireKycApproved } from "../middleware/auth.js";
import { getTemplateById, STORE_TEMPLATES } from "../utils/templates.js";
import {
  normalizeDomain,
  isValidDomain,
  generateVerificationToken,
  verificationRecordName,
  verifyDomainOwnership,
  checkDomainTarget,
} from "../utils/domain.js";
import { sendError, check } from "../utils/validation.js";
import { encryptSecret, maskSecret, decryptSecret } from "../utils/crypto.js";
import { sanitizeStorefrontConfig } from "../utils/storefrontSanitize.js";
import crypto from "crypto";

const router = express.Router();

router.get("/store/by-domain/:domain", async (req, res) => {
  const domain = normalizeDomain(req.params.domain);
  const config = await StorefrontConfig.findOne({
    custom_domain: domain,
    domain_status: "verified",
    is_active: true,
  }).lean();

  if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "No store is connected to this web address." });

  res.json({ slug: config.slug, store_name: config.store_name });
});

router.get("/store/:slug", async (req, res) => {
  try {
    const config = await StorefrontConfig.findOne({ slug: req.params.slug, is_active: true }).lean();
    if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link." });

    const seller = await Seller.findOne({ store_slug: req.params.slug }).select("_id kyc");
    if (!seller) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link." });

    if (seller.kyc?.status !== "approved") {
      return res.status(StatusCodes.FORBIDDEN).json({
        error: "This store isn't live yet — seller verification is still pending.",
        store_live: false,
      });
    }

    VisitLog.create({
      seller_id: seller._id,
      path: `/store/${req.params.slug}`,
      ip: req.ip,
      user_agent: req.headers["user-agent"] || null,
    }).catch(() => {});

  
    const sections = (config.sections || [])
      .filter((s) => s.is_enabled)
      .sort((a, b) => a.order - b.order);

    res.json(sanitizeStorefrontConfig({ ...config, sections }));
  } catch (err) {
    sendError(res, err);
  }
});


router.get("/seller/storefront", requireSellerAuth, async (req, res) => {
  const config = await StorefrontConfig.findOne({ seller_id: req.user.id });
  if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your store settings." });
  res.json(sanitizeStorefrontConfig(config));
});


router.put("/seller/storefront", requireSellerAuth, async (req, res) => {
  const { store_name, logo_url, theme } = req.body;
  const update = {};
  if (store_name !== undefined) update.store_name = store_name;
  if (logo_url !== undefined) update.logo_url = logo_url;
  if (theme !== undefined) update.theme = theme;

  const config = await StorefrontConfig.findOneAndUpdate(
    { seller_id: req.user.id },
    { $set: update },
    { new: true }
  );
  if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your store settings." });
  res.json(sanitizeStorefrontConfig(config));
});

router.put("/seller/storefront/payment-settings", requireSellerAuth, requireKycApproved, async (req, res) => {
  try {
    const { cod_enabled, online_enabled, cod_extra_charge, cod_min_order_value, cod_max_order_value } = req.body;

    if (cod_enabled === false && online_enabled === false) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "At least one payment method (COD or online) must stay enabled.",
      });
    }

    const update = {};
    if (cod_enabled !== undefined) update["payment_settings.cod_enabled"] = cod_enabled;
    if (online_enabled !== undefined) update["payment_settings.online_enabled"] = online_enabled;
    if (cod_extra_charge !== undefined) update["payment_settings.cod_extra_charge"] = Math.max(0, Number(cod_extra_charge) || 0);
    if (cod_min_order_value !== undefined) update["payment_settings.cod_min_order_value"] = Math.max(0, Number(cod_min_order_value) || 0);
    if (cod_max_order_value !== undefined) update["payment_settings.cod_max_order_value"] = Math.max(0, Number(cod_max_order_value) || 0);

    const config = await StorefrontConfig.findOneAndUpdate(
      { seller_id: req.user.id },
      { $set: update },
      { new: true }
    );
    if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your store settings." });
    res.json(sanitizeStorefrontConfig(config));
  } catch (err) {
    sendError(res, err);
  }
});


router.put("/seller/storefront/payment-settings/own-razorpay", requireSellerAuth, requireKycApproved, async (req, res) => {
  try {
    const { key_id, key_secret } = req.body;

    check.required(key_id, "your Razorpay Key ID");
    check.required(key_secret, "your Razorpay Key Secret");

    if (!/^rzp_(live|test)_[A-Za-z0-9]+$/.test(key_id.trim())) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "That doesn't look like a Razorpay Key ID — it should start with rzp_live_ or rzp_test_.",
      });
    }

    const config = await StorefrontConfig.findOne({ seller_id: req.user.id });
    if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your store settings." });


    const webhookSecret =
      decryptSecret(config.payment_settings.own_razorpay_webhook_secret_enc) ||
      crypto.randomBytes(24).toString("hex");

    config.payment_settings.razorpay_mode = "own";
    config.payment_settings.own_razorpay_key_id = key_id.trim();
    config.payment_settings.own_razorpay_key_secret_enc = encryptSecret(key_secret.trim());
    config.payment_settings.own_razorpay_webhook_secret_enc = encryptSecret(webhookSecret);
    await config.save();

    res.json({
      ...sanitizeStorefrontConfig(config).payment_settings,
      own_razorpay_key_id_masked: maskSecret(key_id.trim()),
   
      webhook_secret: webhookSecret,
      webhook_url: `${process.env.PUBLIC_BASE_URL || "http://localhost:4000"}/api/webhook/razorpay/${config.seller_id}`,
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.put("/seller/storefront/payment-settings/use-platform-razorpay", requireSellerAuth, async (req, res) => {
  const config = await StorefrontConfig.findOneAndUpdate(
    { seller_id: req.user.id },
    { $set: { "payment_settings.razorpay_mode": "platform" } },
    { new: true }
  );
  if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your store settings." });
  res.json(sanitizeStorefrontConfig(config));
});

router.put("/seller/storefront/domain", requireSellerAuth, async (req, res) => {
  const domain = normalizeDomain(req.body.custom_domain);

  if (!domain) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: "custom_domain is required" });
  }
  if (!isValidDomain(domain)) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      error: "That doesn't look like a valid domain (e.g. shop.yourbrand.com), or it's reserved.",
    });
  }

  const taken = await StorefrontConfig.findOne({
    custom_domain: domain,
    seller_id: { $ne: req.user.id },
  }).select("_id");
  if (taken) {
    return res.status(StatusCodes.CONFLICT).json({ error: "That domain is already connected to another store." });
  }

  const config = await StorefrontConfig.findOne({ seller_id: req.user.id });
  if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your store settings." });


  const isSameDomain = config.custom_domain === domain;

  config.custom_domain = domain;
  if (!isSameDomain || !config.domain_verification_token) {
    config.domain_verification_token = generateVerificationToken();
    config.domain_status = "pending";
    config.domain_verified_at = null;
  }

  await config.save();

  res.json({
    custom_domain: config.custom_domain,
    domain_status: config.domain_status,
    dns_instructions: {
      cname: {
        host: config.custom_domain,
        type: "CNAME",
        value: process.env.PLATFORM_CNAME_TARGET || "stores.expressfly.app",
        note: "Points your domain's traffic at Expressfly. Use an ALIAS/ANAME record instead of CNAME if this is an apex/root domain (e.g. yourbrand.com rather than shop.yourbrand.com).",
      },
      txt: {
        host: verificationRecordName(config.custom_domain),
        type: "TXT",
        value: config.domain_verification_token,
        note: "Proves you own this domain. Required once, before we mark the domain as verified.",
      },
    },
  });
});


router.post("/seller/storefront/domain/verify", requireSellerAuth, async (req, res) => {
  const config = await StorefrontConfig.findOne({ seller_id: req.user.id });
  if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your store settings." });
  if (!config.custom_domain) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: "No custom domain has been set yet." });
  }

  const [{ verified, records, error: txtError }, targetCheck] = await Promise.all([
    verifyDomainOwnership(config.custom_domain, config.domain_verification_token),
    checkDomainTarget(config.custom_domain),
  ]);

  config.domain_status = verified ? "verified" : "failed";
  config.domain_last_checked_at = new Date();
  if (verified) config.domain_verified_at = new Date();
  await config.save();

  res.json({
    custom_domain: config.custom_domain,
    domain_status: config.domain_status,
    verified,
    txt_records_found: records,
    txt_lookup_error: txtError || null,
    points_to_platform: targetCheck.pointsToPlatform,
    cname_or_a_records_found: targetCheck.records,
  });
});


router.delete("/seller/storefront/domain", requireSellerAuth, async (req, res) => {
  const config = await StorefrontConfig.findOneAndUpdate(
    { seller_id: req.user.id },
    {
      $set: {
        custom_domain: null,
        domain_status: "none",
        domain_verification_token: null,
        domain_verified_at: null,
        domain_last_checked_at: null,
      },
    },
    { new: true }
  );
  if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your store settings." });
  res.json({ custom_domain: null, domain_status: "none" });
});


router.get("/seller/storefront/templates", requireSellerAuth, async (req, res) => {
  const config = await StorefrontConfig.findOne({ seller_id: req.user.id }).select("theme.template_id");
  const activeId = config?.theme?.template_id || null;

  const templates = STORE_TEMPLATES.map((t) => ({
    ...t,
    is_selected: t.id === activeId,
  }));

  res.json({ active_template_id: activeId, templates });
});


router.put("/seller/storefront/theme/template", requireSellerAuth, requireKycApproved, async (req, res) => {
  const { template_id } = req.body;
  if (!template_id) return res.status(StatusCodes.BAD_REQUEST).json({ error: "template_id is required" });

  const template = getTemplateById(template_id);
  const config = await StorefrontConfig.findOneAndUpdate(
    { seller_id: req.user.id },
    { $set: { theme: { template_id: template.id, ...template.theme } } },
    { new: true }
  );
  if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your store settings." });
  res.json(config);
});


router.put("/seller/storefront/theme", requireSellerAuth, requireKycApproved, async (req, res) => {
  const config = await StorefrontConfig.findOne({ seller_id: req.user.id });
  if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your store settings." });

  const allowedFields = [
    "template_id",
    "primary_color",
    "primary_dark",
    "primary_soft",
    "accent_color",
    "background_color",
    "text_color",
    "font_display",
    "font_body",
    "layout_style",
  ];
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) config.theme[field] = req.body[field];
  }
  await config.save();
  res.json(config);
});

router.put("/seller/storefront/social-links", requireSellerAuth, requireKycApproved, async (req, res) => {
  try {
    const config = await StorefrontConfig.findOne({ seller_id: req.user.id });
    if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your storefront settings." });

    const allowed = ["facebook", "instagram", "twitter", "youtube", "whatsapp", "pinterest"];
    if (!config.social_links) config.social_links = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        let value = String(req.body[field] || "").trim();
        if (value) {
          check.url(value, field.charAt(0).toUpperCase() + field.slice(1) + " link");
          
          if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
        }
        config.social_links[field] = value;
      }
    }
    await config.save();
    res.json(config.social_links);
  } catch (err) {
    sendError(res, err);
  }
});


router.put("/seller/storefront/section", requireSellerAuth, requireKycApproved, async (req, res) => {
  const { _id, type, order, is_enabled, settings } = req.body;
  const config = await StorefrontConfig.findOne({ seller_id: req.user.id });
  if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your store settings." });

  if (_id) {
    const section = config.sections.id(_id);
    if (!section) return res.status(StatusCodes.NOT_FOUND).json({ error: "Section not found" });
    if (type !== undefined) section.type = type;
    if (order !== undefined) section.order = order;
    if (is_enabled !== undefined) section.is_enabled = is_enabled;
    if (settings !== undefined) section.settings = settings;
  } else {
    config.sections.push({ type, order: order ?? config.sections.length, is_enabled: is_enabled ?? true, settings: settings || {} });
  }

  await config.save();
  res.json(config);
});


router.delete("/seller/storefront/section/:sectionId", requireSellerAuth, requireKycApproved, async (req, res) => {
  const config = await StorefrontConfig.findOne({ seller_id: req.user.id });
  if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your store settings." });
  config.sections = config.sections.filter((s) => s._id.toString() !== req.params.sectionId);
  await config.save();
  res.json(config);
});

export default router;
