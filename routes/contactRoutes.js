import express from "express";
import ContactMessage from "../models/ContactMessage.js";
import { toFriendlyError, check } from "../utils/validation.js";

const router = express.Router();


router.post("/store/:slug/contact", async (req, res) => {
  try {
    const { slug } = req.params;

    const {
      name,
      email,
      message,
    } = req.body;

    check.required(name, "your name");
    check.email(email);
    check.required(message, "a message");
    check.minLength(message, 10, "Your message");

    const contactMessage =
      await ContactMessage.create({
        store_slug: slug,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        message: message.trim(),
        status: "new",
      });

    return res.status(201).json({
      success: true,
      message: "Your message has been sent successfully",
      data: contactMessage,
    });
  } catch (error) {
    console.error(
      "CREATE CONTACT MESSAGE ERROR:",
      error
    );

    const { status, message } = toFriendlyError(error);
    return res.status(status).json({
      success: false,
      message,
    });
  }
});


router.get("/store/:slug/contact", async (req, res) => {
  try {
    const { slug } = req.params;

    const messages = await ContactMessage.find({
      store_slug: slug,
    }).sort({
      createdAt: -1,
    });

    return res.status(200).json({
      success: true,
      count: messages.length,
      data: messages,
    });
  } catch (error) {
    console.error(
      "GET CONTACT MESSAGES ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch contact messages",
      error: toFriendlyError(error).message,
    });
  }
});

router.get(
  "/store/:slug/contact/:id",
  async (req, res) => {
    try {
      const { slug, id } = req.params;

      const contactMessage =
        await ContactMessage.findOne({
          _id: id,
          store_slug: slug,
        });

      if (!contactMessage) {
        return res.status(404).json({
          success: false,
          message: "Contact message not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: contactMessage,
      });
    } catch (error) {
      console.error(
        "GET SINGLE CONTACT MESSAGE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to fetch contact message",
        error: toFriendlyError(error).message,
      });
    }
  }
);


router.put(
  "/store/:slug/contact/:id/status",
  async (req, res) => {
    try {
      const { slug, id } = req.params;
      const { status } = req.body;

      const allowedStatuses = [
        "new",
        "read",
        "replied",
        "closed",
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid status. Allowed values: new, read, replied, closed",
        });
      }

      
      const contactMessage =
        await ContactMessage.findOneAndUpdate(
          {
            _id: id,
            store_slug: slug,
          },
          {
            status,
          },
          {
            new: true,
          }
        );

      if (!contactMessage) {
        return res.status(404).json({
          success: false,
          message: "Contact message not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Status updated successfully",
        data: contactMessage,
      });
    } catch (error) {
      console.error(
        "UPDATE CONTACT STATUS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to update contact status",
        error: toFriendlyError(error).message,
      });
    }
  }
);


router.delete(
  "/store/:slug/contact/:id",
  async (req, res) => {
    try {
      const { slug, id } = req.params;

      const contactMessage =
        await ContactMessage.findOneAndDelete({
          _id: id,
          store_slug: slug,
        });

      if (!contactMessage) {
        return res.status(404).json({
          success: false,
          message: "Contact message not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Contact message deleted successfully",
      });
    } catch (error) {
      console.error(
        "DELETE CONTACT MESSAGE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to delete contact message",
        error: toFriendlyError(error).message,
      });
    }
  }
);

export default router;