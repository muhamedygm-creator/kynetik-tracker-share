import "server-only";
import { createHash, randomBytes } from "node:crypto";

/** Display links carry a random secret; only its SHA-256 is stored, so a DB read can't recreate a link. */
export const newDisplayToken = () => randomBytes(24).toString("base64url");
export const hashDisplayToken = (token: string) => createHash("sha256").update(token).digest("hex");
