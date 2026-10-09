import express from "express";
import bcrypt from "bcryptjs";
import { StatusCodes } from "http-status-codes";
import Developer from "../models/Developer.js";
import { signDeveloperToken } from "../utils/token.js";
import { requireDeveloperAuth } from "../middleware/auth.js";
import { sendError, check } from "../utils/validation.js";

const router = express.Router();

const BAD_LOGIN = "The username or password is incorrect. Please try again.";

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    check.required(username, "a username");
    check.required(password, "a password");

    const developer = await Developer.findOne({ username: String(username).toLowerCase().trim() });
    if (!developer) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ error: BAD_LOGIN });
    }

    const match = await bcrypt.compare(String(password), developer.password_hash);
    if (!match) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ error: BAD_LOGIN });
    }

    if (developer.is_active === false) {
      return res
        .status(StatusCodes.FORBIDDEN)
        .json({ error: "Your developer account has been disabled. Please contact the admin." });
    }

    const token = signDeveloperToken(developer);
    res.json({ token, developer: { id: developer._id, username: developer.username } });
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/me", requireDeveloperAuth, async (req, res) => {
  const developer = await Developer.findById(req.developer.id).select("username");
  if (!developer) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that developer account." });
  res.json({ developer: { id: developer._id, username: developer.username } });
});

export default router;
