import crypto from "crypto";


function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is missing in .env");
  return crypto.createHash("sha256").update(raw).digest();
}

export function encrypt(plain) {
  if (plain === null || plain === undefined || plain === "") return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decrypt(payload) {
  if (!payload) return "";
  const [v, iv, tag, data] = String(payload).split(":");
  if (v !== "v1" || !iv || !tag || !data) return "";
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export function maskSecret(value) {
  if (!value) return "";
  return "••••••" + String(value).slice(-3);
}
