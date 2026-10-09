
import express from "express";
import StorefrontConfig from "../models/StorefrontConfig.js";

const router = express.Router();

router.get("/domains/allowed", async (req, res) => {
  try {
    const domain = String(req.query.domain || "").toLowerCase().trim();
    if (!domain) return res.sendStatus(400);

    const found = await StorefrontConfig.exists({
      custom_domain: domain,
      domain_status: "verified",
    });
    res.sendStatus(found ? 200 : 404);
  } catch {
    res.sendStatus(500);
  }
});

export default router;
