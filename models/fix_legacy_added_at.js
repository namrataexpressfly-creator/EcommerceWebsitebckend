// One-time script: gives old cart lines (saved without added_at) a fixed time,
// so they stop showing "now" on every load.
// Run once:  node fix_legacy_added_at.js
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGO_URI); // same URI your app uses
const col = mongoose.connection.collection("customers");

const customers = await col
  .find({ cart: { $elemMatch: { added_at: { $exists: false } } } })
  .toArray();

let fixed = 0;
for (const c of customers) {
  const fallback = c.updated_at || c.created_at || new Date();
  const cart = c.cart.map((line) => ({ ...line, added_at: line.added_at || fallback }));
  await col.updateOne({ _id: c._id }, { $set: { cart } });
  fixed++;
}
console.log(`Fixed ${fixed} customer(s)`);
await mongoose.disconnect();
