import crypto from "crypto";
import { callPluginApi, PluginApiError } from "./pluginEngine.js";

const hasApi = (plugin, type) => !plugin.adapter_key && plugin.apis.some((a) => a.api_type === type);


function signatureOf(pickup) {
  const { name, code, phone, line1, line2, city, state, pincode } = pickup;
  return crypto.createHash("sha1").update(JSON.stringify([name, code, phone, line1, line2, city, state, pincode])).digest("hex");
}


export async function ensureCourierWarehouse({ plugin, storePlugin, warehouse, context }) {
  if (!hasApi(plugin, "create_warehouse")) return "";

  const signature = signatureOf(context.pickup);
  const known = storePlugin.courier_warehouses.find((w) => String(w.warehouse_id) === String(warehouse._id));
  if (known?.courier_warehouse_id && known.signature === signature) return known.courier_warehouse_id;

  const { raw, mapped } = await callPluginApi({ plugin, storePlugin, apiType: "create_warehouse", context });
  const id = mapped.warehouse_id;
  if (!id) {
    throw new PluginApiError(`${plugin.app_name} did not return a warehouse id.`, { details: JSON.stringify(raw).slice(0, 300) });
  }

  if (known) {
    known.courier_warehouse_id = String(id);
    known.signature = signature;
    known.registered_at = new Date();
  } else {
    storePlugin.courier_warehouses.push({ warehouse_id: warehouse._id, courier_warehouse_id: String(id), signature, registered_at: new Date() });
  }
  await storePlugin.save();
  return String(id);
}
