import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../db.js";
import StorefrontConfig from "../models/StorefrontConfig.js";

async function run() {
  await connectDB();
  const collection = StorefrontConfig.collection;

  const printIndexes = (list) =>
    list.forEach((i) =>
      console.log(
        " -",
        i.name,
        JSON.stringify(i.key),
        i.unique ? "(unique)" : "",
        i.sparse ? "(sparse)" : "",
        i.partialFilterExpression ? `(partial: ${JSON.stringify(i.partialFilterExpression)})` : ""
      )
    );

  const indexes = await collection.indexes();
  console.log("Current indexes on storefrontconfigs:");
  printIndexes(indexes);

  const badIndex = indexes.find(
    (i) =>
      i.key &&
      Object.keys(i.key).length === 1 &&
      i.key.custom_domain === 1 &&
      !i.partialFilterExpression
  );

  if (badIndex) {
    console.log(`\nDropping stale index "${badIndex.name}" ...`);
    await collection.dropIndex(badIndex.name);
    console.log("Dropped.");
  } else {
    console.log("\nNo stale custom_domain index found — nothing to drop.");
  }

  console.log("\nSyncing indexes from the current schema (adds the partial unique index)...");
  await StorefrontConfig.syncIndexes();

  const after = await collection.indexes();
  console.log("\nIndexes after fix:");
  printIndexes(after);

  await mongoose.disconnect();
  console.log("\nDone. You can now register multiple stores without a custom domain.");
}

run().catch((err) => {
  console.error("Failed to fix index:", err);
  process.exit(1);
});
