import { Storage } from '@google-cloud/storage';
import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { Readable } from 'stream';
import { appConfig, UploadStorageDriver } from './config.ts';
import { isDatabaseConfigured, queryRows } from './db/pool.ts';
import { UserRole } from '../shared/schemas.ts';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from './utils/errors.ts';

export type MediaFolder = 'posts' | 'avatars';
export type MediaVisibility = 'public' | 'community' | 'private';

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const ALLOWED_FOLDERS = new Set<MediaFolder>(['posts', 'avatars']);
const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,160}\.(jpg|png|webp)$/;

const MIME_BY_EXTENSION: Record<'jpg' | 'png' | 'webp', string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const uploadImageMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: appConfig.maxUploadBytes,
    files: 1,
  },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_IMAGE_MIMES.has(file.mimetype.toLowerCase())) {
      cb(new ValidationError('Only JPEG, PNG, and WebP images are supported'));
      return;
    }
    cb(null, true);
  },
});

export function detectImageExtensionFromMagicBytes(buffer: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  // WebP: RIFF....WEBP
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }

  return null;
}

export function assertMimeMatchesDetectedExtension(
  declaredMime: string,
  detectedExt: 'jpg' | 'png' | 'webp',
): void {
  const normalizedDeclared = declaredMime.toLowerCase() === 'image/jpg' ? 'image/jpeg' : declaredMime.toLowerCase();
  const expectedMime = MIME_BY_EXTENSION[detectedExt];
  if (normalizedDeclared !== expectedMime) {
    throw new ValidationError(
      `Uploaded file MIME type (${declaredMime}) does not match actual ${detectedExt.toUpperCase()} file signature.`,
    );
  }
}

export function sanitizeMediaCoordinates(folderRaw: string, filenameRaw: string): {
  folder: MediaFolder;
  filename: string;
  relativeKey: string;
} {
  if (!ALLOWED_FOLDERS.has(folderRaw as MediaFolder)) {
    throw new ValidationError('Invalid media folder');
  }
  if (
    !filenameRaw ||
    filenameRaw.includes('..') ||
    filenameRaw.includes('/') ||
    filenameRaw.includes('\\') ||
    !SAFE_FILENAME_REGEX.test(filenameRaw)
  ) {
    throw new ValidationError('Invalid media filename');
  }
  const folder = folderRaw as MediaFolder;
  return {
    folder,
    filename: filenameRaw,
    relativeKey: `${folder}/${filenameRaw}`,
  };
}

export function buildGcsObjectKey(relativeKey: string, prefix = appConfig.gcsKeyPrefix): string {
  const cleanRelative = relativeKey.replace(/^\/+/, '');
  const cleanPrefix = prefix.trim().replace(/^\/+|\/+$/g, '');
  return cleanPrefix ? `${cleanPrefix}/${cleanRelative}` : cleanRelative;
}

export function generateSafeMediaUrl(options: {
  folder: MediaFolder;
  filename: string;
  visibility?: MediaVisibility;
  driver?: UploadStorageDriver;
  gcsPublicBaseUrl?: string;
}): string {
  const { folder, filename } = sanitizeMediaCoordinates(options.folder, options.filename);
  const visibility = options.visibility ?? 'community';
  const driver = options.driver ?? appConfig.uploadStorageDriver;
  const publicBase = (options.gcsPublicBaseUrl ?? appConfig.gcsPublicBaseUrl).trim().replace(/\/+$/, '');

  // Public CDN URLs are only emitted for explicitly public assets when a valid https base URL is configured.
  // All private/community/moderated assets route through permission-checked /api/v1/media/:folder/:filename.
  if (driver === 'gcs' && visibility === 'public' && publicBase) {
    try {
      const parsed = new URL(publicBase);
      if (parsed.protocol === 'https:') {
        const objectKey = buildGcsObjectKey(`${folder}/${filename}`);
        return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}/${objectKey}`;
      }
    } catch {
      // Fall back to canonical app-managed permission-aware URL
    }
  }

  return `/api/v1/media/${folder}/${filename}`;
}

export interface StoredMediaObject {
  stream: Readable;
  contentType: string;
}

export interface UploadStorageProvider {
  readonly driver: UploadStorageDriver;
  saveObject(params: {
    relativeKey: string;
    buffer: Buffer;
    contentType: string;
    visibility: MediaVisibility;
  }): Promise<void>;
  openReadStream(relativeKey: string): Promise<StoredMediaObject | null>;
  getSignedReadUrl?(relativeKey: string, ttlSeconds: number): Promise<string>;
}

class LocalDiskStorageProvider implements UploadStorageProvider {
  public readonly driver: UploadStorageDriver = 'local';

  constructor(private readonly baseDir: string) {}

  private resolveSafeLocalPath(relativeKey: string): string {
    const [folder, filename] = relativeKey.split('/');
    const sanitized = sanitizeMediaCoordinates(folder, filename);
    const resolvedBase = path.resolve(this.baseDir);
    const resolvedTarget = path.resolve(resolvedBase, sanitized.folder, sanitized.filename);
    if (!resolvedTarget.startsWith(`${resolvedBase}${path.sep}`)) {
      throw new ValidationError('Invalid upload path');
    }
    return resolvedTarget;
  }

  async saveObject(params: {
    relativeKey: string;
    buffer: Buffer;
  }): Promise<void> {
    const fullPath = this.resolveSafeLocalPath(params.relativeKey);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, params.buffer);
  }

  async openReadStream(relativeKey: string): Promise<StoredMediaObject | null> {
    const fullPath = this.resolveSafeLocalPath(relativeKey);
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    const ext = path.extname(fullPath).slice(1).toLowerCase() as 'jpg' | 'png' | 'webp';
    const contentType = MIME_BY_EXTENSION[ext] || 'application/octet-stream';
    return {
      stream: fs.createReadStream(fullPath),
      contentType,
    };
  }
}

class GcsStorageProvider implements UploadStorageProvider {
  public readonly driver: UploadStorageDriver = 'gcs';
  private storageClient: Storage | null = null;

  constructor(
    private readonly bucketName: string,
    private readonly keyPrefix: string,
  ) {}

  private getBucket() {
    if (!this.bucketName) {
      throw new ValidationError('GCS_BUCKET_NAME is not configured for GCS upload storage.');
    }
    if (!this.storageClient) {
      this.storageClient = new Storage();
    }
    return this.storageClient.bucket(this.bucketName);
  }

  async saveObject(params: {
    relativeKey: string;
    buffer: Buffer;
    contentType: string;
    visibility: MediaVisibility;
  }): Promise<void> {
    const objectKey = buildGcsObjectKey(params.relativeKey, this.keyPrefix);
    const file = this.getBucket().file(objectKey);
    // Objects remain private in GCS by default (uniform bucket-level access).
    // Access is governed by permission checks in /api/v1/media/* or short-lived V4 Signed URLs.
    await file.save(params.buffer, {
      resumable: false,
      contentType: params.contentType,
      metadata: {
        contentType: params.contentType,
        contentDisposition: 'inline',
        cacheControl:
          params.visibility === 'public' ? 'public, max-age=86400' : 'private, max-age=300',
      },
    });
  }

  async openReadStream(relativeKey: string): Promise<StoredMediaObject | null> {
    const objectKey = buildGcsObjectKey(relativeKey, this.keyPrefix);
    const file = this.getBucket().file(objectKey);
    const [exists] = await file.exists();
    if (!exists) {
      return null;
    }
    const [meta] = await file.getMetadata();
    const ext = path.extname(relativeKey).slice(1).toLowerCase() as 'jpg' | 'png' | 'webp';
    const contentType = meta.contentType || MIME_BY_EXTENSION[ext] || 'application/octet-stream';
    return {
      stream: file.createReadStream(),
      contentType,
    };
  }

  async getSignedReadUrl(relativeKey: string, ttlSeconds: number): Promise<string> {
    const objectKey = buildGcsObjectKey(relativeKey, this.keyPrefix);
    const file = this.getBucket().file(objectKey);
    const [exists] = await file.exists();
    if (!exists) {
      throw new NotFoundError('Media object not found');
    }
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlSeconds * 1000,
      responseDisposition: 'inline',
    });
    return signedUrl;
  }
}

export function createUploadStorageProvider(config = appConfig): UploadStorageProvider {
  if (config.uploadStorageDriver === 'gcs') {
    return new GcsStorageProvider(config.gcsBucketName, config.gcsKeyPrefix);
  }
  return new LocalDiskStorageProvider(config.uploadDir);
}

export async function saveValidatedUploadedImage(
  file: Express.Multer.File,
  subFolder: MediaFolder,
  visibility: MediaVisibility = 'community',
  provider: UploadStorageProvider = createUploadStorageProvider(),
): Promise<{ url: string; mime: string; storageKey: string; driver: UploadStorageDriver }> {
  const detectedExt = detectImageExtensionFromMagicBytes(file.buffer);
  if (!detectedExt) {
    throw new ValidationError('Invalid image file signature. Upload a genuine JPEG, PNG, or WebP.');
  }

  assertMimeMatchesDetectedExtension(file.mimetype, detectedExt);

  const safeName = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.${detectedExt}`;
  const relativeKey = `${subFolder}/${safeName}`;
  const mime = MIME_BY_EXTENSION[detectedExt];

  await provider.saveObject({
    relativeKey,
    buffer: file.buffer,
    contentType: mime,
    visibility,
  });

  const url = generateSafeMediaUrl({
    folder: subFolder,
    filename: safeName,
    visibility,
    driver: provider.driver,
  });

  return {
    url,
    mime,
    storageKey: relativeKey,
    driver: provider.driver,
  };
}

export async function authorizeMediaAccess(input: {
  folder: MediaFolder;
  filename: string;
  viewerUserId?: number;
  viewerRole?: UserRole;
}): Promise<{ visibility: MediaVisibility }> {
  if (!isDatabaseConfigured()) {
    return { visibility: 'public' };
  }

  const canonicalUrl = `/api/v1/media/${input.folder}/${input.filename}`;
  const legacyUrl = `/uploads/${input.folder}/${input.filename}`;
  const isStaff =
    input.viewerRole === 'moderator' ||
    input.viewerRole === 'admin' ||
    input.viewerRole === 'super_admin';

  if (input.folder === 'posts') {
    const rows = await queryRows<any[]>(
      `SELECT p.user_id, p.moderation_status, p.group_id, g.is_private
         FROM creative_posts p
         LEFT JOIN community_groups g ON g.id = p.group_id
        WHERE p.media_url = ? OR p.media_url = ?
        LIMIT 1`,
      [canonicalUrl, legacyUrl],
    );

    if (rows.length === 0) {
      throw new NotFoundError('Media attachment not found');
    }

    const row = rows[0];
    const isOwner = Boolean(input.viewerUserId && Number(row.user_id) === input.viewerUserId);

    if (row.moderation_status !== 'approved' && !isOwner && !isStaff) {
      throw new ForbiddenError('This post image is not publicly available.');
    }

    if (Boolean(row.is_private) && !isOwner && !isStaff) {
      if (!input.viewerUserId) {
        throw new UnauthorizedError('Authentication required to view private group media.');
      }
      const memberRows = await queryRows<any[]>(
        'SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ? LIMIT 1',
        [row.group_id, input.viewerUserId],
      );
      if (memberRows.length === 0) {
        throw new ForbiddenError('Only members of this private group can view this media.');
      }
      return { visibility: 'private' };
    }

    return { visibility: row.moderation_status === 'approved' ? 'public' : 'private' };
  }

  // Avatars: honor profile_visibility ('public' | 'community' | 'private')
  const profileRows = await queryRows<any[]>(
    `SELECT user_id, profile_visibility
       FROM user_profiles
      WHERE avatar_url = ? OR avatar_url = ?
      LIMIT 1`,
    [canonicalUrl, legacyUrl],
  );

  if (profileRows.length === 0) {
    throw new NotFoundError('Avatar not found');
  }

  const profile = profileRows[0];
  const isOwner = Boolean(input.viewerUserId && Number(profile.user_id) === input.viewerUserId);
  const visibility = String(profile.profile_visibility) as MediaVisibility;

  if (visibility === 'private' && !isOwner && !isStaff) {
    throw new ForbiddenError('This profile avatar is private.');
  }
  if (visibility === 'community' && !input.viewerUserId && !isStaff) {
    throw new UnauthorizedError('Sign in to view community-only member avatars.');
  }

  return { visibility };
}
