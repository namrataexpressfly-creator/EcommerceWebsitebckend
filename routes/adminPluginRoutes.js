import express from "express";
import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import { requirePluginManagerAuth } from "../middleware/auth.js";
import Plugin, { PLUGIN_API_TYPES } from "../models/Plugin.js";
import { SENSITIVE_FIELDS, stable } from "../services/pluginReview.js";
import {
  DEFAULT_PATHS,
  STANDARD_CONTRACT,
  buildStandardApis,
  buildStandardFields,
  pathsFromApis,
  renderContractMarkdown,
  validateStandardPaths,
} from "../services/standardPlugin.js";
import StorePlugin from "../models/StorePlugin.js";
import { route } from "../services/pluginEngine.js";

const router = express.Router();

router.use(requirePluginManagerAuth);


function adminOnly(req, res, next) {
  if (req.staff?.type !== "admin") {
    return res.status(StatusCodes.FORBIDDEN).json({ error: "Only an admin can approve or reject plugins." });
  }
  next();
}

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

function pickBody(body) {
  const out = {};
  for (const k of ["app_name", "logo", "description", "other_detail", "status", "adapter_key", "setup_steps", "docs_url", "attributes", "api_domains", "apis", "integration", "standard_paths"]) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}


function applyStandard(data, existingStandard) {
  const problem = validateStandardPaths(data.standard_paths);
  if (problem) return problem;
  const paths = { ...(existingStandard ? pathsFromApis(existingStandard.apis) : {}), ...(data.standard_paths || {}) };
  data.integration = "standard";
  data.apis = buildStandardApis(paths);
  data.attributes = buildStandardFields(data.attributes ?? existingStandard?.attributes);
  data.adapter_key = null;
  delete data.standard_paths;
  return null;
}

const hasValidDomain = (domains) => Array.isArray(domains) && domains.some((d) => /^https?:\/\/[^\s/]+/i.test(String(d?.url || "").trim()));

function validate(data, { partial = false } = {}) {
  if (!partial && !data.app_name) return "App name is required.";
  if (data.integration && !["standard", "custom"].includes(data.integration)) return 'Integration must be "standard" or "custom".';
  if (data.integration === "standard" && (!partial || data.api_domains) && !hasValidDomain(data.api_domains)) {
    return "Enter the courier's main domain, for example https://api.courier.com";
  }
  if (data.apis) {
    const seen = new Set();
    for (const a of data.apis) {
      if (!PLUGIN_API_TYPES.includes(a.api_type)) return `Unknown api_type "${a.api_type}".`;
      if (seen.has(a.api_type)) return `api_type "${a.api_type}" is listed twice.`;
      seen.add(a.api_type);
    }
  }
  if (data.docs_url && !/^https?:\/\//i.test(String(data.docs_url).trim())) {
    return "The documentation link must start with http:// or https://";
  }
  if (data.setup_steps) {
    if (!Array.isArray(data.setup_steps)) return "Setup steps must be a list.";
    if (data.setup_steps.length > 20) return "Please keep the setup guide to 20 steps or fewer.";
    if (data.setup_steps.some((st) => !String(st?.title || "").trim())) return "Every setup step needs a title.";
  }
  if (data.attributes) {
    const names = data.attributes.map((a) => a.name);
    if (new Set(names).size !== names.length) return "Attribute names must be unique.";
  }
  return null;
}

router.get("/", route(async (req, res) => {
  const plugins = await Plugin.find().sort({ created_at: -1 });
  res.json(plugins);
}));


router.get("/standard-contract", route(async (req, res) => {
  res.json({ contract: STANDARD_CONTRACT, default_paths: DEFAULT_PATHS });
}));

router.get("/standard-contract.md", route(async (req, res) => {
  res.type("text/markdown").send(renderContractMarkdown());
}));

router.get("/:id", route(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(StatusCodes.NOT_FOUND).json({ error: "Plugin not found." });
  const plugin = await Plugin.findById(req.params.id);
  if (!plugin) return res.status(StatusCodes.NOT_FOUND).json({ error: "Plugin not found." });
  res.json(plugin);
}));

router.post("/", route(async (req, res) => {
  const data = pickBody(req.body);
  let problem = validate(data);
  if (!problem && data.integration === "standard") problem = applyStandard(data, null);
  if (problem) return res.status(StatusCodes.BAD_REQUEST).json({ error: problem });
  delete data.standard_paths;

  const slug = slugify(data.app_name);
  if (await Plugin.exists({ slug })) {
    return res.status(StatusCodes.CONFLICT).json({ error: "A plugin with this name already exists." });
  }
  const isAdmin = req.staff.type === "admin";
  const plugin = await Plugin.create({
    ...data,
    slug,
    created_by: req.staff.id || null,
    created_by_model: isAdmin ? "Admin" : "Developer",

    review_status: isAdmin ? "approved" : "draft",
    reviewed_by: isAdmin ? req.staff.id : null,
    reviewed_at: isAdmin ? new Date() : null,
  });
  res.status(StatusCodes.CREATED).json(plugin);
}));

router.put("/:id", route(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(StatusCodes.NOT_FOUND).json({ error: "Plugin not found." });
  const data = pickBody(req.body);
  let problem = validate(data, { partial: true });
  if (problem) return res.status(StatusCodes.BAD_REQUEST).json({ error: problem });

  const plugin = await Plugin.findById(req.params.id);
  if (!plugin) return res.status(StatusCodes.NOT_FOUND).json({ error: "Plugin not found." });
  if ((data.integration ?? plugin.integration) === "standard") {
    problem = applyStandard(data, plugin.integration === "standard" ? plugin : null);
    if (problem) return res.status(StatusCodes.BAD_REQUEST).json({ error: problem });
  }
  delete data.standard_paths;
  const before = plugin.toObject();
  plugin.set(data);

  if (req.staff.type === "developer" && plugin.review_status !== "draft") {
    const after = plugin.toObject();
    const changed = SENSITIVE_FIELDS.some((k) => stable(before[k]) !== stable(after[k]));
    if (changed) {
      if (plugin.review_status !== "rejected") plugin.review_note = "";
      plugin.review_status = "draft";
    }
  }
  await plugin.save();
  res.json(plugin);
}));


router.post("/:id/submit", route(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(StatusCodes.NOT_FOUND).json({ error: "Plugin not found." });
  const plugin = await Plugin.findById(req.params.id);
  if (!plugin) return res.status(StatusCodes.NOT_FOUND).json({ error: "Plugin not found." });

  if (plugin.review_status === "pending") return res.status(StatusCodes.CONFLICT).json({ error: "This plugin is already waiting for review." });
  if (plugin.review_status === "approved") return res.status(StatusCodes.CONFLICT).json({ error: "This plugin is already approved." });
  if (!plugin.adapter_key && plugin.apis.length === 0) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: "Add at least one API (or an adapter key) before submitting for review." });
  }
  if (!plugin.adapter_key && plugin.api_domains.length === 0) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: "Add an API domain before submitting for review." });
  }

  plugin.review_status = "pending";
  await plugin.save();
  res.json(plugin);
}));


router.post("/:id/review", adminOnly, route(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(StatusCodes.NOT_FOUND).json({ error: "Plugin not found." });
  const { decision } = req.body;
  const note = String(req.body.note || "").trim();
  if (!["approved", "rejected"].includes(decision)) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Decision must be "approved" or "rejected".' });
  }
  if (decision === "rejected" && note.length < 3) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please tell the developer why the plugin was rejected." });
  }

  const plugin = await Plugin.findById(req.params.id);
  if (!plugin) return res.status(StatusCodes.NOT_FOUND).json({ error: "Plugin not found." });

  plugin.review_status = decision;
  plugin.review_note = note;
  plugin.reviewed_by = req.staff.id;
  plugin.reviewed_at = new Date();
  await plugin.save();
  res.json(plugin);
}));

router.delete("/:id", route(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(StatusCodes.NOT_FOUND).json({ error: "Plugin not found." });
  const inUse = await StorePlugin.countDocuments({ plugin_id: req.params.id });
  if (inUse > 0) {
    return res.status(StatusCodes.CONFLICT).json({
      error: `${inUse} store(s) use this plugin. Set it to inactive instead of deleting it.`,
    });
  }
  await Plugin.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}));

export default router;
