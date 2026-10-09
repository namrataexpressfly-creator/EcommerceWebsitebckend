import { StatusCodes } from "http-status-codes";
import { verifyToken } from "../utils/token.js";
import Seller from "../models/Seller.js";
import Developer from "../models/Developer.js";

export async function requireSellerAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: "Please log in to continue." });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: "Your session has expired. Please log in again." });
  }

  try {

    const seller = await Seller.findById(payload.id).select("is_active");
    if (!seller) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ error: "We couldn't find your account. Please log in again." });
    }
    if (seller.is_active === false) {
      return res.status(StatusCodes.FORBIDDEN).json({
        error: "Your store has been suspended by the admin. Please contact support for help.",
        code: "STORE_SUSPENDED",
      });
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Something went wrong on our side. Please try again." });
  }
}

export function requireCustomerAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: "Please log in to continue." });
  }

  try {
    const payload = verifyToken(token);
    if (payload.type !== "customer") {
      return res.status(StatusCodes.UNAUTHORIZED).json({ error: "Please log in to continue." });
    }
    req.customer = payload;
    next();
  } catch (err) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: "Your session has expired. Please log in again." });
  }
}


export async function requireKycApproved(req, res, next) {
  try {
    const seller = await Seller.findById(req.user.id).select("kyc");
    if (!seller) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your account." });
    }
    if (seller.kyc?.status !== "approved") {
      return res.status(StatusCodes.FORBIDDEN).json({
        error:
          seller.kyc?.status === "pending"
            ? "Your KYC is still under review. You'll be able to do this once it's approved."
            : seller.kyc?.status === "rejected"
            ? "Your KYC was rejected. Please resubmit it from the KYC page before continuing."
            : "Please complete KYC verification before continuing.",
        kyc_status: seller.kyc?.status || "not_submitted",
      });
    }
    next();
  } catch (err) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "We couldn't check your verification status. Please try again." });
  }
}


export function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: "Please log in to continue." });
  }

  try {
    const payload = verifyToken(token);
    if (payload.type !== "admin") {
      return res.status(StatusCodes.UNAUTHORIZED).json({ error: "Please log in to continue." });
    }
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: "Your session has expired. Please log in again." });
  }
}


export async function requireDeveloperAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: "Please log in to continue." });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: "Your session has expired. Please log in again." });
  }
  if (payload.type !== "developer") {
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: "Please log in to continue." });
  }

  try {
    const developer = await Developer.findById(payload.id).select("is_active");
    if (!developer) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ error: "We couldn't find your account. Please log in again." });
    }
    if (developer.is_active === false) {
      return res.status(StatusCodes.FORBIDDEN).json({ error: "Your developer account has been disabled. Please contact the admin." });
    }
    req.developer = payload;
    next();
  } catch (err) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Something went wrong on our side. Please try again." });
  }
}


export async function requirePluginManagerAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: "Please log in to continue." });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: "Your session has expired. Please log in again." });
  }

  if (payload.type === "admin") {
    req.admin = payload;
    req.staff = { type: "admin", id: payload.id };
    return next();
  }
  if (payload.type === "developer") {
    return requireDeveloperAuth(req, res, () => {
      req.staff = { type: "developer", id: payload.id };
      next();
    });
  }
  return res.status(StatusCodes.UNAUTHORIZED).json({ error: "Please log in to continue." });
}
