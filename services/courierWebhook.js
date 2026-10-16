import { callPluginApi } from "./pluginEngine.js";


export function trackingWebhookUrl(req, sp) {
  const origin = process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`;
  return `${origin.replace(/\/+$/, "")}/api/webhook/plugin/${sp._id}/${sp.webhook_secret}`;
}

export const supportsWebhookRegistration = (plugin) => !plugin.adapter_key && plugin.apis.some((a) => a.api_type === "set_webhook");


export async function ensureWebhookRegistered({ plugin, storePlugin, url, force = false }) {
  if (!supportsWebhookRegistration(plugin)) return { skipped: true };
  if (!force && storePlugin.webhook?.registered_url === url) return { skipped: true };


  const body = { webhook_secret: String(storePlugin.webhook_secret || ""), track_order_endpoint: url };
  if (!body.webhook_secret) throw new Error("This connection has no webhook secret yet. Please reinstall the plugin.");
  const send = (extra = {}) =>
    callPluginApi({
      plugin,
      storePlugin,
      apiType: "set_webhook",
      context: { tracking_url: url, webhook_secret: body.webhook_secret },
      parameter: plugin.integration === "standard" ? body : undefined,
      ...extra,
    });

  try {
    try {
      await send();
    } catch (e) {
   
      if (plugin.integration === "standard" && e.upstreamStatus === 409) await send({ method: "PUT" });
      else throw e;
    }
  } catch (e) {

    const sent = `[sent to ${plugin.app_name}: webhook_secret (${body.webhook_secret.length} chars), track_order_endpoint ${url}]`;
    console.error(`Webhook install failed: ${e.message} ${sent}`);
    e.message = `${e.message} ${sent}`;
    throw e;
  }
  storePlugin.webhook = { registered_url: url, registered_at: new Date() };
  await storePlugin.save();
  return { registered: true };
}
