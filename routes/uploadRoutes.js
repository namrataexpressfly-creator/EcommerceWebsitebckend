import express from "express";
import { StatusCodes } from "http-status-codes";
import { requireSellerAuth } from "../middleware/auth.js";
import { makeUploader, publicUrlFor } from "../middleware/upload.js";
import { sendError } from "../utils/validation.js";

const router = express.Router();

const productImageUpload = makeUploader("products");
const bannerImageUpload = makeUploader("banners");
const pageImageUpload = makeUploader("pages");
const categoryImageUpload = makeUploader("categories");
const logoImageUpload = makeUploader("logos");
const variantOptionImageUpload = makeUploader("variant-options");
const kycDocUpload = makeUploader("kyc");

router.use(requireSellerAuth);

router.post("/product-image", productImageUpload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please choose an image to upload." });
  }
  res.status(StatusCodes.CREATED).json({
    url: publicUrlFor("products", req.file.filename),
    filename: req.file.filename,
  });
});

router.post("/product-images", productImageUpload.array("images", 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please choose at least one image to upload." });
  }
  res.status(StatusCodes.CREATED).json({
    urls: req.files.map((f) => publicUrlFor("products", f.filename)),
  });
});

router.post("/banner-image", bannerImageUpload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please choose an image to upload." });
  }
  res.status(StatusCodes.CREATED).json({
    url: publicUrlFor("banners", req.file.filename),
    filename: req.file.filename,
  });
});

router.post("/page-image", pageImageUpload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please choose an image to upload." });
  }
  res.status(StatusCodes.CREATED).json({
    url: publicUrlFor("pages", req.file.filename),
    filename: req.file.filename,
  });
});

router.post("/category-image", categoryImageUpload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please choose an image to upload." });
  }
  res.status(StatusCodes.CREATED).json({
    url: publicUrlFor("categories", req.file.filename),
    filename: req.file.filename,
  });
});

router.post("/logo-image", logoImageUpload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please choose an image to upload." });
  }
  res.status(StatusCodes.CREATED).json({
    url: publicUrlFor("logos", req.file.filename),
    filename: req.file.filename,
  });
});

router.post("/variant-option-image", variantOptionImageUpload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please choose an image to upload." });
  }
  res.status(StatusCodes.CREATED).json({
    url: publicUrlFor("variant-options", req.file.filename),
    filename: req.file.filename,
  });
});

router.post("/kyc-doc", kycDocUpload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please choose a document image to upload." });
  }
  res.status(StatusCodes.CREATED).json({
    url: publicUrlFor("kyc", req.file.filename),
    filename: req.file.filename,
  });
});

router.use((err, req, res, next) => {
  if (err) {
    return sendError(res, err);
  }
  next();
});

export default router;
