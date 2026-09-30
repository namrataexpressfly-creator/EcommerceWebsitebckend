import dotenv from "dotenv";
import { connectDB } from "../db.js";
import mongoose from "mongoose";
import Seller from "../models/Seller.js";
import StorefrontConfig from "../models/StorefrontConfig.js";
import { normalizeDomain, isValidDomain, generateVerificationToken } from "./domain.js";

dotenv.config();

async function main() {
  const rawDomain = process.argv[2];
  const email = process.argv[3] || "demo@expressfly.test";

  if (!rawDomain) {
    console.error("Usage: node utils/testCustomDomain.js <domain> [seller-email]");
    console.error("       node utils/testCustomDomain.js --remove [seller-email]");
    process.exit(1);
  }

  await connectDB();

  if (rawDomain === "--remove") {
    const removeEmail = process.argv[3] || "demo@expressfly.test";
    const seller = await Seller.findOne({ email: removeEmail });
    if (!seller) {
      console.error(`No seller found with email "${removeEmail}".`);
      await mongoose.disconnect();
      process.exit(1);
    }
    await StorefrontConfig.findOneAndUpdate(
      { seller_id: seller._id },
      {
        $set: {
          custom_domain: null,
          domain_status: "none",
          domain_verification_token: null,
          domain_verified_at: null,
          domain_last_checked_at: null,
        },
      }
    );
    console.log(`✅ Test custom domain removed for ${removeEmail}.`);
    await mongoose.disconnect();
    return;
  }

  const domain = normalizeDomain(rawDomain);
  if (!isValidDomain(domain)) {
    console.error(`"${rawDomain}" doesn't look like a usable test domain.`);
    console.error("Tip: use something like myteststore.local and add it to your hosts file.");
    process.exit(1);
  }

  const seller = await Seller.findOne({ email });
  if (!seller) {
    console.error(`No seller found with email "${email}". Run "npm run seed" first, or pass a different email.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const config = await StorefrontConfig.findOneAndUpdate(
    { seller_id: seller._id },
    {
      $set: {
        custom_domain: domain,
        domain_status: "verified",
        domain_verification_token: generateVerificationToken(),
        domain_verified_at: new Date(),
        domain_last_checked_at: new Date(),
        is_active: true,
      },
    },
    { new: true }
  );

  if (!config) {
    console.error(`Seller "${email}" has no storefront config yet — run "npm run seed" first.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log("✅ Test custom domain connected and force-verified.");
  console.log(`   Seller:        ${seller.email} (slug: ${config.slug})`);
  console.log(`   Domain:        ${config.custom_domain}`);
  console.log(`   Status:        ${config.domain_status}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Add to your hosts file:   127.0.0.1  ${domain}`);
  console.log(`  2. Allow it in vite.config.js -> server.allowedHosts`);
  console.log(`  3. Visit http://${domain}:5173 (or whatever port Vite prints)`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
