import dns from "dns";
import crypto from "crypto";

const { promises: dnsPromises } = dns;

const DOMAIN_REGEX =
  /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/;

const RESERVED_ROOT_DOMAINS = (
  process.env.PLATFORM_ROOT_DOMAINS || "expressfly.app,expressfly.com,localhost"
)
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

export function normalizeDomain(raw) {
  if (!raw) return "";
  let domain = String(raw).trim().toLowerCase();

  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.split("/")[0];
  domain = domain.split(":")[0];
  domain = domain.replace(/\.$/, "");

  return domain;
}

export function isValidDomain(domain) {
  if (!domain || domain.length > 253) return false;
  if (!DOMAIN_REGEX.test(domain)) return false;

  const isReserved = RESERVED_ROOT_DOMAINS.some(
    (root) => domain === root || domain.endsWith(`.${root}`)
  );
  if (isReserved) return false;

  return true;
}

export function generateVerificationToken() {
  return `expressfly-verify-${crypto.randomBytes(16).toString("hex")}`;
}

export function verificationRecordName(domain) {
  return `_expressfly-verify.${domain}`;
}

export async function verifyDomainOwnership(domain, token) {
  const recordName = verificationRecordName(domain);

  try {
    const chunks = await dnsPromises.resolveTxt(recordName);
    const records = chunks.map((chunk) => chunk.join(""));
    const verified = records.some((value) => value.trim() === token);
    return { verified, records };
  } catch (err) {
    return { verified: false, records: [], error: err.code || err.message };
  }
}

export async function checkDomainTarget(domain) {
  const target = process.env.PLATFORM_CNAME_TARGET || "stores.expressfly.app";

  try {
    const cname = await dnsPromises.resolveCname(domain);
    return { pointsToPlatform: cname.includes(target), records: cname };
  } catch {
    try {
      const a = await dnsPromises.resolve4(domain);
      return { pointsToPlatform: null, records: a };
    } catch (err) {
      return { pointsToPlatform: false, records: [], error: err.code || err.message };
    }
  }
}

export { RESERVED_ROOT_DOMAINS };
