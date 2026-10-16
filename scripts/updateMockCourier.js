import "dotenv/config";
import mongoose from "mongoose";
import { pathToFileURL } from "url";
import { connectDB } from "../db.js";
import Plugin from "../models/Plugin.js";
import { buildStandardApis, buildStandardFields } from "../services/standardPlugin.js";

export function applyStandard(plugin) {
  plugin.integration = "standard";
  plugin.adapter_key = null;
  plugin.attributes = buildStandardFields([
    { name: "username", label: "Username", help: "Mock Courier login. For testing use: test-user", placeholder: "test-user" },
    { name: "password", label: "Password", help: "For testing use: test-pass" },
  ]);
  plugin.api_domains = [{ environment: "live", url: "http://localhost:5005" }];
  plugin.apis = buildStandardApis(); 
  plugin.status = "active";
  plugin.review_status = "approved"; 
  return plugin;
}

async function run() {
  await connectDB();
  const plugin = await Plugin.findOne({ $or: [{ slug: "mock-courier" }, { app_name: /^mock courier$/i }] });
  if (!plugin) {
    console.error('No plugin named "Mock Courier" found. Create it first in /developer/plugins or /admin/plugins.');
    process.exit(1);
  }
  applyStandard(plugin);
  await plugin.save();
  console.log("Done. Mock Courier now uses the Standard Expressfly Courier API.");
  console.log("1) Run the mock courier:  node mockCourier.js");
  console.log("2) Seller: Plugins > Configure, enter test-user / test-pass, click Save & test connection.");
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error("Update failed:", err);
    process.exit(1);
  });
}
