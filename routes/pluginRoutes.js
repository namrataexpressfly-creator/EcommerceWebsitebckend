import express from "express";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { StatusCodes } from "http-status-codes";
import { requireSellerAuth } from "../middleware/auth.js";
import Plugin from "../models/Plugin.js";
import { SELLER_VISIBLE, isSellerVisible } from "../services/pluginReview.js";
import { ensureWebhookRegistered, trackingWebhookUrl } from "../services/courierWebhook.js";
import StorePlugin from "../models/StorePlugin.js";
import { encrypt, decrypt, maskSecret } from "../utils/pluginCrypto.js";
import { callPluginApi, missingRequired, route } from "../services/pluginEngine.js";

const router = express.Router();
router.use(requireSellerAuth);

const notFound = (res, what = "Plugin") => res.status(StatusCodes.NOT_FOUND).json({ error: `${what} not found.` });

const webhookUrl = trackingWebhookUrl;

function publicStorePlugin(req, plugin, sp) {
  const missing = missingRequired(plugin, sp);
  return {
    id: sp._id,
    status: sp.status,
    environment: sp.environment,
    ready: plugin.status === "active" && sp.status === "active" && missing.length === 0,
    missing,
    webhook_url: webhookUrl(req, sp),
    attributes: (plugin.attributes || []).map((def) => {
      const value = decrypt(sp.attributes.find((a) => a.name === def.name)?.value);
      return {
        name: def.name,
        has_value: Boolean(value),
        value: def.is_secret ? maskSecret(value) : value,
      };
    }),
  };
}


router.get("/", route(async (req, res) => {
  const [plugins, mine] = await Promise.all([
    Plugin.find(SELLER_VISIBLE).sort({ app_name: 1 }),
    StorePlugin.find({ seller_id: req.user.id }),
  ]);
  const byPlugin = new Map(mine.map((sp) => [String(sp.plugin_id), sp]));

  res.json(
    plugins.map((p) => {
      const sp = byPlugin.get(String(p._id));
      return {
        id: p._id,
        app_name: p.app_name,
        slug: p.slug,
        logo: p.logo,
        description: p.description,
        other_detail: p.other_detail,
        attributes: p.attributes,
        setup_steps: p.setup_steps || [],
        docs_url: p.docs_url || "",
        integration: p.integration || "custom",
        environments: [...new Set(p.api_domains.map((d) => d.environment))],
        installed: Boolean(sp),
        store_plugin: sp ? publicStorePlugin(req, p, sp) : null,
      };
    })
  );
}));


router.post("/:pluginId/install", route(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.pluginId)) return notFound(res);
  const plugin = await Plugin.findOne({ _id: req.params.pluginId, ...SELLER_VISIBLE });
  if (!plugin) return notFound(res);

  let sp = await StorePlugin.findOne({ seller_id: req.user.id, plugin_id: plugin._id });
  if (!sp) {
    sp = await StorePlugin.create({
      seller_id: req.user.id,
      plugin_id: plugin._id,
      webhook_secret: nanoid(24),
      attributes: plugin.attributes.map((a) => ({ name: a.name, value: "" })),
    });
  }
  res.status(StatusCodes.CREATED).json(publicStorePlugin(req, plugin, sp));
}));


router.put("/store/:id", route(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return notFound(res, "Plugin setup");
  const sp = await StorePlugin.findOne({ _id: req.params.id, seller_id: req.user.id });
  if (!sp) return notFound(res, "Plugin setup");
  const plugin = await Plugin.findById(sp.plugin_id);
  if (!plugin) return notFound(res);

  const { attributes = {}, environment, status } = req.body;
  const allowed = new Set(plugin.attributes.map((a) => a.name));
  let credentialsChanged = false;

  for (const [name, value] of Object.entries(attributes)) {
    if (!allowed.has(name)) continue;
    if (value === undefined || value === "" ) continue; // blank = keep the saved value (masked fields come back blank)
    const encrypted = value === null ? "" : encrypt(String(value).trim()); // null = clear
    const existing = sp.attributes.find((a) => a.name === name);
    if (existing) existing.value = encrypted;
    else sp.attributes.push({ name, value: encrypted });
    credentialsChanged = true;
  }

  if (environment) {
    if (!["sandbox", "live"].includes(environment)) return res.status(StatusCodes.BAD_REQUEST).json({ error: "Invalid environment." });
    if (environment !== sp.environment) credentialsChanged = true;
    sp.environment = environment;
  }
  if (credentialsChanged) sp.token_cache = { token: "", expires_at: null }; // force a fresh login

  if (status) {
    if (!["active", "inactive"].includes(status)) return res.status(StatusCodes.BAD_REQUEST).json({ error: "Invalid status." });
    sp.status = status;
  }

  if (sp.status === "active") {
    const missing = missingRequired(plugin, sp);
    if (missing.length) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: `Please fill in: ${missing.join(", ")}.`, missing });
    }
  }

  await sp.save();


  if (sp.status === "active" && isSellerVisible(plugin)) {
    await ensureWebhookRegistered({ plugin, storePlugin: sp, url: webhookUrl(req, sp), force: credentialsChanged }).catch((e) =>
      console.error(`Could not register tracking webhook with ${plugin.app_name}:`, e.message)
    );
  }
  res.json(publicStorePlugin(req, plugin, sp));
}));


router.post("/store/:id/test", route(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return notFound(res, "Plugin setup");
  const sp = await StorePlugin.findOne({ _id: req.params.id, seller_id: req.user.id });
  if (!sp) return notFound(res, "Plugin setup");
  const plugin = await Plugin.findById(sp.plugin_id);

  if (!isSellerVisible(plugin)) {
    return res.status(StatusCodes.CONFLICT).json({ error: "This plugin is not available right now. It may be under review." });
  }

  const missing = missingRequired(plugin, sp);
  if (missing.length) return res.status(StatusCodes.BAD_REQUEST).json({ error: `Please fill in: ${missing.join(", ")}.` });

  if (!plugin.adapter_key && !plugin.apis.some((a) => a.api_type === "token_generation")) {
    return res.json({ ok: true, message: "Saved. This courier has no login step to test." });
  }
  await callPluginApi({ plugin, storePlugin: sp, apiType: "token_generation" });


  try {
    const hook = await ensureWebhookRegistered({ plugin, storePlugin: sp, url: webhookUrl(req, sp), force: true });
    return res.json({
      ok: true,
      message: hook.registered ? "Connected successfully. Tracking updates are now switched on." : "Connected successfully.",
      webhook_registered: Boolean(hook.registered),
    });
  } catch (e) {
    return res.json({
      ok: true,
      warning: true,
      message: `Connected, but we couldn't switch on tracking updates: ${e.message}`,
      webhook_registered: false,
    });
  }
}));


router.delete("/store/:id", route(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return notFound(res, "Plugin setup");
  const gone = await StorePlugin.findOneAndDelete({ _id: req.params.id, seller_id: req.user.id });
  if (!gone) return notFound(res, "Plugin setup");
  res.json({ ok: true });
}));

export default router;
