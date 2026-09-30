import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { nanoid } from "nanoid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const UPLOAD_ROOT = path.join(__dirname, "..", "public", "uploads");

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const MAX_FILE_SIZE = 5 * 1024 * 1024; 

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function makeUploader(subfolder) {
  const dest = path.join(UPLOAD_ROOT, subfolder);
  ensureDir(dest);

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dest),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || "";
      cb(null, `${nanoid(12)}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        return cb(new Error("Only image files (jpg, png, webp, gif, avif) are allowed."));
      }
      cb(null, true);
    },
  });
}

export function publicUrlFor(subfolder, filename) {
  return `/uploads/${subfolder}/${filename}`;
}
