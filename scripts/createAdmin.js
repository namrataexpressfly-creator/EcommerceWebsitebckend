import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDB } from "../db.js";
import Admin from "../models/Admin.js";

async function run() {
  const [, , username, password] = process.argv;

  if (!username || !password) {
    console.error("Usage: node scripts/createAdmin.js <username> <password>");
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("Password should be at least 6 characters.");
    process.exit(1);
  }

  await connectDB();

  const normalized = username.toLowerCase().trim();
  const password_hash = await bcrypt.hash(password, 10);

  const existing = await Admin.findOne({ username: normalized });
  if (existing) {
    existing.password_hash = password_hash;
    await existing.save();
    console.log(`Password updated for existing admin "${normalized}".`);
  } else {
    await Admin.create({ username: normalized, password_hash });
    console.log(`Admin "${normalized}" created.`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed to create admin:", err);
  process.exit(1);
});
