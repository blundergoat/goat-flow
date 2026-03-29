# File Upload Security

Reference for generating `ai/instructions/security.md` in projects with file upload features.

## File Type Validation

Check file type by magic bytes (file signature), not by extension or client-provided MIME type.

```python
# DO — validate by magic bytes
import magic

def validate_upload(file) -> bool:
    mime = magic.from_buffer(file.read(2048), mime=True)
    file.seek(0)
    allowed = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
    return mime in allowed

# DON'T — trust the extension or client MIME type
def validate_upload(file) -> bool:
    return file.filename.endswith(('.jpg', '.png'))  # attacker controls filename
```

```php
// DO — Laravel: validate MIME by file content
$request->validate([
    'avatar' => ['required', 'file', 'mimetypes:image/jpeg,image/png', 'max:5120'],
]);

// DON'T — validate only by extension
$request->validate([
    'avatar' => ['required', 'file', 'extensions:jpg,png'],  // extension-only, easily spoofed
]);
// Note: Use `mimetypes:` for MIME-type checking by content, `mimes:` for extension+content.
// Avoid `extensions:` alone (extension-only, easily spoofed).
```

- Maintain an explicit allowlist of MIME types. Never use a denylist.

## Size Limits

Enforce size limits at both the web server and application level.

```nginx
# Nginx — enforce at web server
client_max_body_size 10M;
```

```python
# Django — enforce at application level
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024  # 10 MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
```

- Set web server limits slightly above application limits to get friendly error messages instead of connection resets.

## Storage

- Never serve uploads from the application directory. A malicious file could be executed.
- Use object storage (S3, GCS, Azure Blob) with signed URLs for access.
- Store files outside the web root if using local filesystem.

```python
# DO — store in object storage with UUID filename
import uuid
storage_path = f"uploads/{uuid.uuid4()}.{validated_extension}"
s3_client.upload_fileobj(file, bucket, storage_path)

# DON'T — store in the public web directory with original filename
shutil.copy(file, f"/var/www/html/uploads/{file.filename}")
```

## Path Traversal Prevention

- Never use the original filename in the storage path. Generate a UUID.
- Strip or reject filenames containing `..`, `/`, `\`, or null bytes.

```python
# DO — generate safe filename
import uuid
from pathlib import PurePosixPath

def safe_filename(original: str) -> str:
    ext = PurePosixPath(original).suffix.lower()
    if ext not in {".jpg", ".png", ".pdf"}:
        raise ValueError("Disallowed extension")
    return f"{uuid.uuid4()}{ext}"

# DON'T — use original filename
def save_file(original: str, data: bytes):
    with open(f"/uploads/{original}", "wb") as f:  # path traversal: "../../../etc/cron.d/evil"
        f.write(data)
```

## Virus Scanning

- Scan all user uploads with ClamAV or a cloud scanning service before making files accessible.
- Quarantine uploaded files until scan completes. Never serve unscanned files.

```python
# DO — scan before making available
import clamd

def scan_upload(file_path: str) -> bool:
    cd = clamd.ClamdUnixSocket()
    result = cd.scan(file_path)
    return result[file_path][0] == "OK"
```

## Download Headers

- Always set `Content-Disposition: attachment` when serving user-uploaded files for download. Prevents the browser from rendering uploaded HTML/SVG as a page.
- Serve uploads from a separate domain or subdomain (e.g., `uploads.example.com`, not `example.com/uploads/`). This prevents uploaded content from accessing the main domain's cookies via same-origin policy.
- Set `X-Content-Type-Options: nosniff` on all upload responses to prevent MIME-type sniffing.

## Image Processing

- Strip EXIF metadata (may contain GPS coordinates, device info).
- Re-encode images to prevent polyglot files (e.g., a file that is both a valid JPEG and valid HTML).

```python
# DO — strip metadata and re-encode
from PIL import Image

def sanitize_image(input_path: str, output_path: str):
    img = Image.open(input_path)
    img_clean = Image.new(img.mode, img.size)
    img_clean.putdata(list(img.getdata()))
    img_clean.save(output_path, format="PNG")

# DON'T — serve the original upload as-is
shutil.copy(upload_path, public_path)
```

## Archive Upload Safety

- **Zip slip**: crafted archive entries with `../../` paths can write files outside the intended extraction directory. Always resolve and validate the full output path before extracting each entry.
- **Decompression bombs (zip bombs)**: a small archive that expands to gigabytes or terabytes. Check the uncompressed size of each entry before extracting and enforce a total uncompressed size limit.
- **Video/audio processing**: if processing user-uploaded media with FFmpeg, be aware that crafted media headers can trigger SSRF via FFmpeg's protocol handlers (`http://`, `ftp://`). Disable network protocols with `-protocol_whitelist file,pipe`.

```python
# DO — validate extraction path (zip slip prevention)
import zipfile, os

def safe_extract(zip_path: str, dest: str, max_total_bytes: int = 500_000_000):
    total = 0
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            target = os.path.realpath(os.path.join(dest, info.filename))
            if not target.startswith(os.path.realpath(dest)):
                raise ValueError(f"Path traversal detected: {info.filename}")
            total += info.file_size
            if total > max_total_bytes:
                raise ValueError("Archive exceeds maximum uncompressed size")
        zf.extractall(dest)
```

## Common Footguns

- **Extension-only validation**: attacker renames `malware.php` to `malware.php.jpg`. Check magic bytes.
- **Original filenames in storage**: enables path traversal and overwrites. Always generate UUIDs.
- **Uploads in web root**: web server may execute uploaded `.php`, `.jsp`, `.aspx` files. Store outside web root.
- **No size limit at web server**: application limit alone lets the full request body hit your app server, enabling DoS.
- **SVG uploads**: SVG files can contain JavaScript. Either disallow SVG or sanitize server-side (Python: defusedxml + bleach, Node: sanitize-html or @svgr/core, PHP: enshrined/svgSanitize). Do not rely on client-side sanitizers like DOMPurify for upload validation.
