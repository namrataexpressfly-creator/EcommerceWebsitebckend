
import "dotenv/config";
import mongoose from "mongoose";

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI is missing. Run this from the backend folder that has your .env file.");
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI);
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
