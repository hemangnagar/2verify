import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as s3SignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * File storage for evidence screenshots, uploaded certificates, and reports.
 * Keys follow {entity_id}/{table}/{row_id}/{timestamp}-{filename}.
 * The bucket is private; readers get a signed URL that expires (default 10 min).
 *
 * Drivers: "s3" (MinIO locally, S3/R2 in prod) or "local" (dev only, files under LOCAL_STORAGE_DIR,
 * served by /api/files with an HMAC-signed, expiring URL so the app behaves the same way).
 */

export interface PutOptions {
  contentType: string;
  /** Stamped onto the object (verifier, timestamp, board URL…). Values must be ASCII for S3. */
  metadata?: Record<string, string>;
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
  metadata: Record<string, string>;
}

export interface Storage {
  put(key: string, body: Buffer | Uint8Array | string, opts: PutOptions): Promise<void>;
  get(key: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<number>;
  /** URL a browser can open for the next SIGNED_URL_TTL_SECONDS. */
  signedUrl(key: string): Promise<string>;
}

const TTL = Number(process.env.SIGNED_URL_TTL_SECONDS ?? 600);

/** Build a storage key: {org_id}/{entity_id}/{table}/{row_id}/{timestamp}-{filename}. Filenames are sanitised; the timestamp keeps versions distinct. */
export function fileKey(orgId: string, entityId: string, table: string, rowId: string, filename: string, at: Date = new Date()): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-100);
  const ts = at.toISOString().replace(/[:.]/g, "-");
  return `${orgId}/${entityId}/${table}/${rowId}/${ts}-${safe}`;
}

/** The org a key belongs to (first path segment). */
export function keyOrg(key: string): string {
  return key.split("/")[0] ?? "";
}

/** Metadata values must be ASCII and short for S3 headers. */
export function asciiMeta(meta: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) out[k.toLowerCase()] = v.replace(/[^\x20-\x7e]/g, "?").slice(0, 1000);
  return out;
}

// ---------------------------------------------------------------------------

class S3Storage implements Storage {
  private client: S3Client;
  private bucket: string;
  constructor() {
    this.bucket = process.env.S3_BUCKET ?? "compliance-evidence";
    this.client = new S3Client({
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: process.env.S3_ACCESS_KEY_ID
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" }
        : undefined,
    });
  }
  async put(key: string, body: Buffer | Uint8Array | string, opts: PutOptions) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: opts.contentType, Metadata: opts.metadata && asciiMeta(opts.metadata) })
    );
  }
  async get(key: string): Promise<StoredObject> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return { body: Buffer.from(bytes), contentType: res.ContentType ?? "application/octet-stream", metadata: res.Metadata ?? {} };
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async deletePrefix(prefix: string) {
    let n = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const obj of page.Contents ?? []) {
        if (obj.Key) {
          await this.delete(obj.Key);
          n++;
        }
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return n;
  }
  signedUrl(key: string) {
    return s3SignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: TTL });
  }
}

// ---------------------------------------------------------------------------

class LocalStorage implements Storage {
  private root: string;
  constructor() {
    this.root = path.resolve(process.env.LOCAL_STORAGE_DIR ?? "./data/files");
  }
  private pathFor(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("invalid key");
    return p;
  }
  async put(key: string, body: Buffer | Uint8Array | string, opts: PutOptions) {
    const p = this.pathFor(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
    await writeFile(p + ".meta.json", JSON.stringify({ contentType: opts.contentType, metadata: opts.metadata ? asciiMeta(opts.metadata) : {} }));
  }
  async get(key: string): Promise<StoredObject> {
    const p = this.pathFor(key);
    const body = await readFile(p);
    const meta = JSON.parse(await readFile(p + ".meta.json", "utf8").catch(() => '{"contentType":"application/octet-stream","metadata":{}}'));
    return { body, contentType: meta.contentType, metadata: meta.metadata };
  }
  async delete(key: string) {
    const p = this.pathFor(key);
    await rm(p, { force: true });
    await rm(p + ".meta.json", { force: true });
  }
  async deletePrefix(prefix: string) {
    const dir = this.pathFor(prefix);
    let n = 0;
    const walk = async (d: string) => {
      for (const e of await readdir(d).catch(() => [] as string[])) {
        const full = path.join(d, e);
        if ((await stat(full)).isDirectory()) await walk(full);
        else if (!e.endsWith(".meta.json")) n++;
      }
    };
    await walk(dir);
    await rm(dir, { recursive: true, force: true });
    return n;
  }
  async signedUrl(key: string) {
    const exp = Math.floor(Date.now() / 1000) + TTL;
    const sig = signLocal(key, exp);
    const base = process.env.APP_URL ?? "";
    return `${base}/api/files/${key.split("/").map(encodeURIComponent).join("/")}?exp=${exp}&sig=${sig}`;
  }
}

export function signLocal(key: string, exp: number): string {
  return createHmac("sha256", process.env.SESSION_SECRET ?? "dev").update(`${key}\n${exp}`).digest("base64url");
}

export function verifyLocalSignature(key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const expected = Buffer.from(signLocal(key, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ---------------------------------------------------------------------------

let instance: Storage | undefined;
export function storage(): Storage {
  if (!instance) instance = (process.env.STORAGE_DRIVER ?? "s3") === "local" ? new LocalStorage() : new S3Storage();
  return instance;
}
