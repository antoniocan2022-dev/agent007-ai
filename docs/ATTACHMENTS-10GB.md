# Agent007 universal attachments — 10 GB architecture

## Capability

Agent007 supports arbitrary file types up to **10,000,000,000 bytes (10 GB) per file**.

Supported categories include images, audio, video, documents, archives, code, data and unknown binary formats. Uploaded content is treated as data and is never executed by the upload service.

## Canonical architecture

**Neon PostgreSQL + Prisma is the metadata/system-of-record layer. Oracle Cloud Infrastructure Object Storage is the large-binary storage layer.** No additional database or third-party file platform is required.

```text
Browser
  ↓
POST /api/attachments/initiate
  ↓
Prisma → Neon PostgreSQL
  (attachment metadata + ownership + lifecycle)
  ↓
Oracle Object Storage S3 Compatibility API
  ↓
private multipart upload
  ↓
short-lived signed part URLs
  ↓
Browser → Oracle Object Storage
  ↓
POST /api/attachments/{id}/complete
  ↓
HEAD verification (size + content-type)
  ↓
UPLOADED
  ↓
Agent007 / Artifact Ledger / future processors
```

Large binaries do **not** pass through a Vercel function body and are never stored inside PostgreSQL. Prisma is used for the existing durable PostgreSQL-backed attachment metadata ledger.

Oracle's S3 Compatibility API supports multipart upload, part listing, completion and abort operations. Oracle documents path-style and virtual-hosted style endpoints; this implementation defaults to path-style for OCI compatibility endpoints. citeturn225104search0turn225104search1turn225104search3

## Required production environment variables

```text
OCI_OBJECT_STORAGE_ENDPOINT=https://<namespace>.compat.objectstorage.<region>.oraclecloud.com
OCI_OBJECT_STORAGE_BUCKET=<private-bucket>
OCI_OBJECT_STORAGE_REGION=<oci-region>
OCI_OBJECT_STORAGE_ACCESS_KEY_ID=<oci-customer-secret-key-access>
OCI_OBJECT_STORAGE_SECRET_ACCESS_KEY=<oci-customer-secret-key-secret>
OCI_OBJECT_STORAGE_FORCE_PATH_STYLE=true
```

The endpoint must be an Oracle Object Storage S3 Compatibility API endpoint. The credentials are an OCI Customer Secret Key access/secret pair. Oracle documents Customer Secret Keys as the credential mechanism for the S3 Compatibility API. citeturn225104search0

Use a **private** bucket and grant only the minimum Object Storage permissions needed for the attachment bucket/prefix. Oracle's access model is policy-based rather than object ACL-based. citeturn225104search0turn225104search7

## Bucket CORS

Allow the Agent007 production origin to perform direct browser `PUT`/`GET`/`HEAD` requests as required by the upload/download path and expose `ETag` to the browser.

Do not use a wildcard production origin unless the storage security model explicitly requires it.

## Multipart behavior

The canonical part size is 32 MiB. Oracle allows multipart parts up to 50 GiB and supports part numbers 1 through 10,000; the Agent007 implementation stays well below that limit for the 10 GB maximum object size. Parts may be uploaded in parallel. citeturn225104search8

The UI uploads three parts concurrently and can reuse parts already present in an interrupted multipart session.

## Security boundaries

- Every attachment route requires an authenticated Agent007 user.
- Metadata is owner-scoped in the Neon/Prisma-backed ledger.
- OCI storage remains private.
- Upload/download URLs are short-lived signatures generated server-side.
- OCI access keys never reach the browser.
- HTML, SVG and script-like content is marked download-only and served as `application/octet-stream`.
- Storage completion verifies final byte length and content type before the asset reaches `UPLOADED`.
- A mismatch is quarantined rather than accepted.
- Unknown binary formats are accepted as data; acceptance never implies execution or trusted parsing.

## Processing boundary

The attachment layer intentionally separates **storage** from **content processing**. Uploading a video, audio file, image or document does not silently parse the entire object during the upload request.

Future processors can consume the durable attachment ID and produce derived artifacts such as:

- image thumbnails / vision metadata;
- audio transcription;
- video metadata / transcript;
- document text extraction;
- OCR;
- malware/security scan results;
- hashes and integrity evidence.

Those processors must update the canonical attachment record / Artifact Ledger instead of creating a second attachment registry.

## Failure and cleanup

Incomplete multipart sessions should be expired with an Oracle Object Storage lifecycle rule. The application also provides an authenticated abort endpoint. Oracle exposes APIs for listing and canceling in-progress multipart uploads. citeturn225104search8

A production bucket should abort incomplete multipart uploads after a short retention window (for example, one day) so abandoned 10 GB uploads do not accumulate indefinitely.
