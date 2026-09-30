import express from "express";
import { StatusCodes } from "http-status-codes";
import StorefrontConfig from "../models/StorefrontConfig.js";
import { requireSellerAuth } from "../middleware/auth.js";

const router = express.Router();

router.get(
  "/store/:slug/privacy-policy",
  async (req, res) => {
    try {
      const slug = String(
        req.params.slug || ""
      )
        .toLowerCase()
        .trim();

      if (!slug) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({
            message: "Store slug is required",
          });
      }

      const storefront =
        await StorefrontConfig.findOne({
          slug,
          is_active: true,
        }).lean();

      if (!storefront) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .json({
            message: "Store not found",
          });
      }

      const privacy =
        storefront.privacy_policy || {};

      return res.json({
        store_name:
          storefront.store_name,

        slug:
          storefront.slug,

        privacy_heading:
          privacy.heading ||
          "Privacy Policy",

        privacy_body:
          privacy.body ||
          "We respect your privacy and are committed to protecting your personal information.",
      });
    } catch (error) {
      console.error(
        "Get public privacy policy error:",
        error
      );

      return res
        .status(
          StatusCodes.INTERNAL_SERVER_ERROR
        )
        .json({
          message:
            "Failed to load Privacy Policy",
        });
    }
  }
);

router.get(
  "/seller/privacy-policy",
  requireSellerAuth,
  async (req, res) => {
    try {
      const sellerId = req.user?.id;

      if (!sellerId) {
        return res
          .status(StatusCodes.UNAUTHORIZED)
          .json({
            message:
              "Seller authentication required",
          });
      }

      const storefront =
        await StorefrontConfig.findOne({
          seller_id: sellerId,
        }).lean();

      if (!storefront) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .json({
            message:
              "Storefront not found",
          });
      }

      const privacy =
        storefront.privacy_policy || {};

      return res.json({
        privacy_heading:
          privacy.heading ||
          "Privacy Policy",

        privacy_body:
          privacy.body || "",
      });
    } catch (error) {
      console.error(
        "Get seller privacy policy error:",
        error
      );

      return res
        .status(
          StatusCodes.INTERNAL_SERVER_ERROR
        )
        .json({
          message:
            "Failed to load Privacy Policy",
        });
    }
  }
);

router.put(
  "/seller/privacy-policy",
  requireSellerAuth,
  async (req, res) => {
    try {
      console.log(
        "SAVE PRIVACY POLICY REQUEST"
      );

      console.log(
        "Seller:",
        req.user
      );

      console.log(
        "Request Body:",
        req.body
      );

      if (
        !req.body ||
        typeof req.body !== "object"
      ) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({
            message:
              "Request body is required",
          });
      }

      const privacy_heading =
        String(
          req.body.privacy_heading || ""
        ).trim();

      const privacy_body =
        String(
          req.body.privacy_body || ""
        ).trim();

      if (!privacy_heading) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({
            message:
              "Privacy Policy heading is required",
          });
      }

  
      if (!privacy_body) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({
            message:
              "Privacy Policy content is required",
          });
      }


      const sellerId = req.user?.id;

      if (!sellerId) {
        return res
          .status(StatusCodes.UNAUTHORIZED)
          .json({
            message:
              "Seller authentication required",
          });
      }


      const storefront =
        await StorefrontConfig.findOne({
          seller_id: sellerId,
        });

      if (!storefront) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .json({
            message:
              "Storefront not found",
          });
      }


      storefront.privacy_policy = {
        heading: privacy_heading,
        body: privacy_body,
      };

      await storefront.save();

      return res
        .status(StatusCodes.OK)
        .json({
          message:
            "Privacy Policy saved successfully",

          privacy_heading:
            storefront.privacy_policy
              .heading,

          privacy_body:
            storefront.privacy_policy
              .body,
        });
    } catch (error) {
      console.error(
        "Save seller privacy policy error:",
        error
      );


      if (
        error?.name ===
        "ValidationError"
      ) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({
            message:
              "Invalid Privacy Policy data",
            details: error.message,
          });
      }


      return res
        .status(
          StatusCodes.INTERNAL_SERVER_ERROR
        )
        .json({
          message:
            "Failed to save Privacy Policy",
        });
    }
  }
);


router.post(
  "/seller/privacy-policy/reset",
  requireSellerAuth,
  async (req, res) => {
    try {
      const sellerId = req.user?.id;

      if (!sellerId) {
        return res
          .status(StatusCodes.UNAUTHORIZED)
          .json({
            message:
              "Seller authentication required",
          });
      }

      const storefront =
        await StorefrontConfig.findOne({
          seller_id: sellerId,
        });

      if (!storefront) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .json({
            message:
              "Storefront not found",
          });
      }

      storefront.privacy_policy = {
        heading: "Privacy Policy",

        body: `We respect your privacy and are committed to protecting your personal information.

Information We Collect

We may collect information such as your name, email address, phone number, shipping address, billing information, and order details when you use our store.

How We Use Your Information

Your information may be used to process orders, provide customer support, communicate with you about your orders, and improve our services.

Payment Information

Payment information is processed through our payment providers. We do not unnecessarily store sensitive payment information.

Cookies

We may use cookies or similar technologies to maintain sessions, remember preferences, and improve your shopping experience.

Third-Party Services

We may use third-party services for payments, shipping, analytics, authentication, or other functionality. These services may process information according to their own privacy policies.

Data Security

We take reasonable measures to protect your personal information from unauthorized access, alteration, disclosure, or destruction.

Your Rights

Depending on applicable law, you may have rights to access, correct, update, or request deletion of your personal information.

Contact Us

If you have questions about this Privacy Policy, please contact us through the contact information provided on your Contact Us page.`,
      };

      await storefront.save();

      return res.json({
        message:
          "Privacy Policy reset successfully",

        privacy_heading:
          storefront.privacy_policy
            .heading,

        privacy_body:
          storefront.privacy_policy
            .body,
      });
    } catch (error) {
      console.error(
        "Reset privacy policy error:",
        error
      );

      return res
        .status(
          StatusCodes.INTERNAL_SERVER_ERROR
        )
        .json({
          message:
            "Failed to reset Privacy Policy",
        });
    }
  }
);

export default router;