import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDB } from "../db.js";
import Developer from "../models/Developer.js";

// Usage: node scripts/createDeveloper.js <username> <password>
// Creates a developer login (or resets the password of an existing one and re-enables it).
async function run() {
  const [, , username, password] = process.argv;

  if (!username || !password) {
    console.error("Usage: node scripts/createDeveloper.js <username> <password>");
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("Password should be at least 6 characters.");
    process.exit(1);
  }

  await connectDB();

  const normalized = username.toLowerCase().trim();
  const password_hash = await bcrypt.hash(password, 10);

  const existing = await Developer.findOne({ username: normalized });
  if (existing) {
    existing.password_hash = password_hash;
    existing.is_active = true;
    await existing.save();
    console.log(`Password updated for existing developer "${normalized}".`);
  } else {
    await Developer.create({ username: normalized, password_hash });
    console.log(`Developer "${normalized}" created.`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed to create developer:", err);
  process.exit(1);
});
