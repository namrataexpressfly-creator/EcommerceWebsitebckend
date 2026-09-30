import express from "express";
import bcrypt from "bcryptjs";
import { StatusCodes } from "http-status-codes";
import Admin from "../models/Admin.js";
import { signAdminToken } from "../utils/token.js";
import { requireAdminAuth } from "../middleware/auth.js";
import { sendError, check } from "../utils/validation.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    check.required(username, "a username");
    check.required(password, "a password");

    const admin = await Admin.findOne({ username: String(username).toLowerCase().trim() });
    if (!admin) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ error: "The username or password is incorrect. Please try again." });
    }

    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ error: "The username or password is incorrect. Please try again." });
    }

    const token = signAdminToken(admin);
    res.json({ token, admin: { id: admin._id, username: admin.username } });
  } catch (err) {
    sendError(res, err);
  }
});


router.get("/me", requireAdminAuth, async (req, res) => {
  const admin = await Admin.findById(req.admin.id).select("username");
  if (!admin) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that admin account." });
  res.json({ admin: { id: admin._id, username: admin.username } });
});

export default router;
