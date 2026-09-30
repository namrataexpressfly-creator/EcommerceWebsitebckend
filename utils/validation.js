export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
    this.isFriendly = true;
  }
}

export function fail(message) {
  throw new ValidationError(message);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i;

export const check = {
  required(value, label) {
    if (value === undefined || value === null || String(value).trim() === "") {
      fail(`Please enter ${label}.`);
    }
    return value;
  },
  email(value, label = "a valid email address") {
    if (!EMAIL_RE.test(String(value || "").trim())) {
      fail(`Please enter ${label}.`);
    }
    return value;
  },
  phone(value, label = "a valid 10-digit phone number") {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length < 10) {
      fail(`Please enter ${label}.`);
    }
    return value;
  },
  minLength(value, len, label) {
    if (String(value || "").trim().length < len) {
      fail(`${label} needs to be at least ${len} characters.`);
    }
    return value;
  },
    maxLength(value, len, label) {
    if (String(value || "").trim().length > len) {
      fail(`${label} can't be more than ${len} characters.`);
    }
    return value;
  },
  number(value, label) {
    if (value === undefined || value === null || value === "" || Number.isNaN(Number(value))) {
      fail(`${label} needs to be a number.`);
    }
    return Number(value);
  },
  positiveNumber(value, label) {
    const n = check.number(value, label);
    if (n < 0) fail(`${label} can't be negative.`);
    return n;
  },
  percentage(value, label) {
    const n = check.number(value, label);
    if (n < 0 || n > 100) fail(`${label} needs to be between 0 and 100.`);
    return n;
  },
  url(value, label) {
    if (value && !URL_RE.test(String(value).trim())) {
      fail(`Please enter a valid ${label} (like example.com or https://example.com).`);
    }
    return value;
  },
  oneOf(value, options, label) {
    if (!options.includes(value)) {
      fail(`${label} needs to be one of: ${options.join(", ")}.`);
    }
    return value;
  },
  maxCount(arr, max, label) {
    if (Array.isArray(arr) && arr.length > max) {
      fail(`You can only add up to ${max} ${label}.`);
    }
    return arr;
  },
};


const FIELD_LABELS = {
  name: "Name",
  email: "Email address",
  phone: "Phone number",
  password: "Password",
  price: "Price",
  stock_qty: "Stock quantity",
  category_id: "Category",
  slug: "URL slug",
  code: "Coupon code",
  store_slug: "Store address",
  custom_domain: "Domain",
  image_url: "Image",
  title: "Title",
  sku: "SKU",
};

function friendlyFieldLabel(field) {
  return FIELD_LABELS[field] || field.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}


export function toFriendlyError(err) {

  if (err.isFriendly) {
    return { status: err.status || 400, message: err.message };
  }


  if (err.name === "ValidationError" && err.errors) {
    const firstField = Object.keys(err.errors)[0];
    const fieldErr = err.errors[firstField];
    const label = friendlyFieldLabel(firstField);
    if (fieldErr?.kind === "required") {
      return { status: 400, message: `Please fill in ${label.toLowerCase()}.` };
    }
    if (fieldErr?.kind === "enum") {
      return { status: 400, message: `${label} isn't a valid option.` };
    }
    if (fieldErr?.kind === "min" || fieldErr?.kind === "max") {
      return { status: 400, message: `${label} is outside the allowed range.` };
    }
    return { status: 400, message: `${label} isn't valid — please check and try again.` };
  }


  if (err.code === 11000 || err.name === "MongoServerError") {
    const keys = Object.keys(err.keyPattern || err.keyValue || {});

    const field = keys.find((k) => k !== "_id" && !k.endsWith("_id")) || keys[0];
    const label = field ? friendlyFieldLabel(field) : "value";
    return { status: 409, message: `That ${label.toLowerCase()} is already in use — please choose a different one.` };
  }


  if (err.name === "CastError") {
    return { status: 400, message: "That item couldn't be found — it may have been removed or the link is incorrect." };
  }

  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return { status: 401, message: "Your session has expired — please log in again." };
  }

  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return { status: 400, message: "That file is too large — please upload an image under 5MB." };
    }
    return { status: 400, message: "That file couldn't be uploaded — please try a different image." };
  }


  if (err.status && err.status < 500 && err.message) {
    return { status: err.status, message: err.message };
  }

  return { status: 500, message: "Something went wrong on our end. Please try again in a moment." };
}

export function sendError(res, err, extra = {}) {
  const { status, message } = toFriendlyError(err);
  return res.status(status).json({ error: message, ...extra });
}
