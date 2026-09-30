import express from "express";
import NewsletterSubscriber from "../models/NewsletterSubscriber.js";

const router = express.Router();

router.post("/store/:slug/newsletter", async (req, res) => {
  try {
    const { slug } = req.params;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const emailRegex =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address",
      });
    }

    const normalizedEmail = email
      .trim()
      .toLowerCase();

    const existingSubscriber =
      await NewsletterSubscriber.findOne({
        store_slug: slug,
        email: normalizedEmail,
      });

    if (existingSubscriber) {

      if (
        existingSubscriber.status ===
        "unsubscribed"
      ) {
        existingSubscriber.status =
          "subscribed";

        await existingSubscriber.save();

        return res.status(200).json({
          success: true,
          message:
            "You have been subscribed again successfully",
          data: existingSubscriber,
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "This email is already subscribed",
        data: existingSubscriber,
      });
    }

    const subscriber =
      await NewsletterSubscriber.create({
        store_slug: slug,
        email: normalizedEmail,
        status: "subscribed",
      });

    return res.status(201).json({
      success: true,
      message:
        "You have been subscribed successfully",
      data: subscriber,
    });
  } catch (error) {
    console.error(
      "NEWSLETTER SUBSCRIBE ERROR:",
      error
    );


    if (error.code === 11000) {
      return res.status(200).json({
        success: true,
        message:
          "This email is already subscribed",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Failed to subscribe. Please try again.",
    });
  }
});

export default router;