# Agent007 universal attachments — 10 GB architecture

## Capability

Agent007 now has a direct-to-object-storage attachment path for arbitrary file types up to **10,000,000,000 bytes (10 GB) per file**.

The supported upload categories include images, audio, video, documents, archives, code, data and unknown binary formats. The upload layer does not execute uploaded content.

## Why direct-to-object-storage

10 GB files must not pass through a Next.js/Vercel request body or be stored in PostgreSQL. The browser uploads multipart chunks directly to private S3-compatible object storage using short-lived signed URLs.

The application database stores only metadata and the multipart lifecycle record in the existing durable Memory ledger.

```text
Browser
  ↓
POST /api/attachments/initiate
  ↓
Agent007 metadata ledger
  ↓
private S3-compatible multipart session
  ↓
short-lived part URLs
  ↓
Browser → Object Storage
  ↓
POST /api/attachments/{id}/complete
  ↓
HEAD verification (size/content-type)
  ↓
UPLOADED
```

## Required environment variables

```text
ATTACHMENT_S3_ENDPOINT=https://<s3-compatible-endpoint>
ATTACHMENT_S3_BUCKET=<private-bucket>
ATTACHMENT_S3_REGION=<region>
ATTACHMENT_S3_ACCESS_KEY_ID=<write-scoped-key>
ATTACHMENT_S3_SECRET_ACCESS_KEY=<secret>
ATTACHMENT_S3_FORCE_PATH_STYLE=true
```

Use a **private** bucket. The application never exposes the storage access key to the browser.

The access key should be scoped to the attachment bucket/prefix and should not have unrelated account permissions.

## Bucket CORS

The browser must be allowed to upload directly to the object-storage origin. At minimum, configure CORS for the Agent007 production origin and expose the `ETag` response header.

Required browser methods:

- `PUT`
- `GET`
- `HEAD`

Required exposed response header:

- `ETag`

Do not use `*` origins in production unless the storage provider requires it and the security model explicitly accepts it.

## Multipart behavior

The canonical part size is 32 MiB. A 10 GB file is therefore uploaded in fewer than 10,000 parts.

The UI uploads three parts concurrently, reports progress, and can reuse already uploaded parts returned by the status endpoint after an interrupted request.

## Security boundaries

- Every attachment route requires an authenticated Agent007 user.
- Attachment metadata is owner-scoped.
- Uploads use short-lived presigned URLs.
- Storage keys are private and never exposed to the client as credentials.
- HTML, SVG and script-like content is marked download-only and served as `application/octet-stream`.
- Storage completion verifies the final object byte length against the requested size.
- Unknown binary formats are accepted as data; acceptance does not imply execution or trusted parsing.

## Processing boundary

The attachment layer intentionally separates **storage** from **content processing**. Uploading a video, audio file, image or document does not silently execute or parse the whole object during the upload request.

Future processors can consume the durable attachment ID and produce derived artifacts such as:

- image thumbnails / vision metadata;
- audio transcription;
- video metadata / transcript;
- document text extraction;
- OCR;
- malware/security scan results;
- hashes and integrity evidence.

Those processors should update the canonical attachment record rather than creating a second attachment registry.

## Failure and cleanup

Incomplete multipart sessions should be expired by an object-storage lifecycle rule. The application also provides an authenticated abort endpoint for explicit cleanup.

A production deployment should configure the storage provider to abort incomplete multipart uploads after a short retention window (for example, 1 day) so abandoned 10 GB uploads cannot accumulate indefinitely.
