#!/usr/bin/env bun

import { X509Certificate } from "node:crypto";

const maxUrl = process.env.MAX_TLS_PROBE_URL ?? "https://platform-api2.max.ru";
const ordinaryUrl = process.env.ORDINARY_TLS_PROBE_URL ?? "https://example.com";
const invalidUrl = process.env.INVALID_TLS_PROBE_URL ?? "https://self-signed.badssl.com";
const timeoutMs = Number(process.env.TLS_PROBE_TIMEOUT_MS ?? "15000");

const expectedFingerprints = new Map([
  [
    "russian_trusted_root_ca_pem.crt",
    "D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31",
  ],
  [
    "russian_trusted_sub_ca_pem.crt",
    "BB:BD:E2:10:3E:79:0B:99:9E:C6:2B:D0:3C:F6:25:A5:A2:E7:C3:16:E1:0A:FE:6A:49:0E:ED:EA:D8:B3:FD:9B",
  ],
]);

function assertNoInsecureEnvironment() {
  const violations = [];
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    violations.push("NODE_TLS_REJECT_UNAUTHORIZED=0");
  }
  if (process.env.NODE_EXTRA_CA_CERTS) {
    violations.push("NODE_EXTRA_CA_CERTS");
  }
  if (process.env.SSL_CERT_FILE) {
    violations.push("SSL_CERT_FILE");
  }
  if (process.env.BUN_OPTIONS?.match(/rejectUnauthorized|insecure|tls/i)) {
    violations.push("BUN_OPTIONS TLS bypass");
  }
  if (violations.length > 0) {
    throw new Error(`insecure TLS environment: ${violations.join(", ")}`);
  }
}

async function fetchWithTimeout(url) {
  return await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}

async function assertHttpsResponse(label, url) {
  try {
    const response = await fetchWithTimeout(url);
    return { label, status: response.status };
  } catch (error) {
    throw new Error(`${label} TLS request failed: ${String(error?.message ?? error)}`);
  }
}

async function assertInvalidCertificateRejected() {
  try {
    await fetchWithTimeout(invalidUrl);
  } catch (error) {
    return { label: "invalid-certificate", rejected: true, error: String(error?.message ?? error) };
  }
  throw new Error(`invalid certificate was accepted: ${invalidUrl}`);
}

async function assertTrustedCaAssets() {
  const caDir = process.env.TRUSTED_CA_ASSET_DIR;
  if (!caDir) return [];

  const results = [];
  for (const [filename, expectedFingerprint] of expectedFingerprints) {
    const path = `${caDir.replace(/[\\/]$/, "")}/${filename}`;
    const pem = await Bun.file(path).text();
    const certificate = new X509Certificate(pem);
    if (certificate.fingerprint256 !== expectedFingerprint) {
      throw new Error(`${filename} fingerprint mismatch: ${certificate.fingerprint256}`);
    }
    results.push({
      filename,
      subject: certificate.subject,
      issuer: certificate.issuer,
      validFrom: certificate.validFrom,
      validTo: certificate.validTo,
      fingerprint256: certificate.fingerprint256,
    });
  }
  return results;
}

try {
  assertNoInsecureEnvironment();
  const ordinary = await assertHttpsResponse("ordinary", ordinaryUrl);
  const max = await assertHttpsResponse("max", maxUrl);
  const invalid = await assertInvalidCertificateRejected();
  const caAssets = await assertTrustedCaAssets();
  console.log(JSON.stringify({ tlsVerification: "enabled", ordinary, max, invalid, caAssets }));
} catch (error) {
  console.error(JSON.stringify({ tlsVerification: "failed", error: String(error?.message ?? error) }));
  process.exit(1);
}
