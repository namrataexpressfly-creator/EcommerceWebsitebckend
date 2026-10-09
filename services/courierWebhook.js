import { callPluginApi } from "./pluginEngine.js";


export function trackingWebhookUrl(req, sp) {
  const origin = process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`;
  return `${origin.replace(/\/+$/, "")}/api/webhook/plugin/${sp._id}/${sp.webhook_secret}`;
}

export const supportsWebhookRegistration = (plugin) => !plugin.adapter_key && plugin.apis.some((a) => a.api_type === "set_webhook");


export async function ensureWebhookRegistered({ plugin, storePlugin, url, force = false }) {
  if (!supportsWebhookRegistration(plugin)) return { skipped: true };
  if (!force && storePlugin.webhook?.registered_url === url) return { skipped: true };

  await callPluginApi({ plugin, storePlugin, apiType: "set_webhook", context: { tracking_url: url } });
  storePlugin.webhook = { registered_url: url, registered_at: new Date() };
  await storePlugin.save();
  return { registered: true };
}
