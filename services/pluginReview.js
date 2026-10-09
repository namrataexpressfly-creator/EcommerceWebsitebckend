import Plugin from "../models/Plugin.js";

export const SELLER_VISIBLE = { status: "active", review_status: "approved" };

export const isApproved = (plugin) => Boolean(plugin) && plugin.review_status === "approved";
export const isSellerVisible = (plugin) => isApproved(plugin) && plugin.status === "active";


export const SENSITIVE_FIELDS = ["integration", "adapter_key", "api_domains", "apis", "attributes", "docs_url"];


export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    if (value instanceof Date) return JSON.stringify(value);
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}


export async function backfillPluginReview() {
  const res = await Plugin.updateMany(
    { review_status: { $exists: false } },
    { $set: { review_status: "approved", reviewed_at: new Date(), review_note: "Approved automatically (existing plugin)." } }
  );
  const n = res?.modifiedCount ?? res?.nModified ?? 0;
  if (n > 0) console.log(`Plugin review: ${n} existing plugin(s) marked approved.`);
}
