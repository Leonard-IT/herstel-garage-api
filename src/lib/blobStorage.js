'use strict';

const { randomUUID } = require('node:crypto');
const { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const { MAX_IMAGE_BYTES, IMAGE_TYPES } = require('./repairValidation');

const CONTAINER = 'damage-images';
const UPLOAD_URL_TTL_MINUTES = 10;

let service;
function getService() {
  if (!service) {
    // Local: IMAGE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true (Azurite).
    // Azure: IMAGE_STORAGE_ACCOUNT_NAME with the Function App's managed identity (needs "Storage Blob Data Contributor"
    // and "Storage Blob Delegator" on the account).
    const connectionString = process.env.IMAGE_STORAGE_CONNECTION_STRING;
    if (connectionString) {
      service = BlobServiceClient.fromConnectionString(connectionString);
    } else if (process.env.IMAGE_STORAGE_ACCOUNT_NAME) {
      service = new BlobServiceClient(`https://${process.env.IMAGE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, new DefaultAzureCredential());
    } else {
      throw new Error('IMAGE_STORAGE_CONNECTION_STRING or IMAGE_STORAGE_ACCOUNT_NAME is not configured');
    }
  }
  return service;
}

const container = () => getService().getContainerClient(CONTAINER);

/**
 * Creates short-lived, write-only SAS URLs so the browser can upload images straight to Blob Storage.
 * The blobs land under "pending/" and are moved to their permanent path when the repair request is submitted.
 */
async function createUploadUrls(files) {
  // Local convenience only: in Azure the container is provisioned with the storage account.
  if (process.env.IMAGE_STORAGE_CONNECTION_STRING) await container().createIfNotExists();
  const startsOn = new Date(Date.now() - 60 * 1000);
  const expiresOn = new Date(Date.now() + UPLOAD_URL_TTL_MINUTES * 60 * 1000);
  const permissions = BlobSASPermissions.parse('cw');
  // Shared key credentials (Azurite / connection string) sign locally; managed identity needs a user delegation key.
  const delegationKey = process.env.IMAGE_STORAGE_CONNECTION_STRING
    ? undefined
    : await getService().getUserDelegationKey(startsOn, expiresOn);

  return Promise.all(files.map(async ({ contentType, extension }) => {
    const blobPath = `pending/${randomUUID()}.${extension}`;
    const blob = container().getBlockBlobClient(blobPath);
    const uploadUrl = delegationKey
      ? `${blob.url}?${generateBlobSASQueryParameters(
        { containerName: CONTAINER, blobName: blobPath, permissions, startsOn, expiresOn },
        delegationKey,
        getService().accountName,
      )}`
      : await blob.generateSasUrl({ permissions, startsOn, expiresOn });
    return {
      blobPath,
      uploadUrl,
      expiresAt: expiresOn.toISOString(),
      // The browser must PUT the file with these headers.
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': contentType },
    };
  }));
}

/**
 * Checks that every path exists, is an allowed image type and is not too large.
 * Returns { images: Map(path -> { contentType, sizeBytes }) } or { errors: Map(path -> message) }.
 */
async function inspectUploads(paths) {
  const images = new Map();
  const errors = new Map();
  await Promise.all(paths.map(async (path) => {
    try {
      const props = await container().getBlobClient(path).getProperties();
      if (!IMAGE_TYPES[props.contentType]) errors.set(path, 'Unsupported image type');
      else if (props.contentLength > MAX_IMAGE_BYTES) errors.set(path, `Image too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`);
      else if (props.contentLength === 0) errors.set(path, 'Image is empty');
      else images.set(path, { contentType: props.contentType, sizeBytes: props.contentLength });
    } catch (err) {
      if (err.statusCode === 404) errors.set(path, 'Image was not uploaded or the upload link expired');
      else throw err;
    }
  }));
  return errors.size ? { errors } : { images };
}

/** Copies a pending upload to its permanent path. The pending blob is removed separately by discard(). */
async function copyBlob(fromPath, toPath) {
  const poller = await container().getBlockBlobClient(toPath).beginCopyFromURL(container().getBlobClient(fromPath).url);
  await poller.pollUntilDone();
}

/** Best-effort delete; leftovers are removed by the storage lifecycle rule. */
async function discard(paths) {
  await Promise.all(paths.map((path) => container().getBlobClient(path).deleteIfExists().catch(() => {})));
}

module.exports = { createUploadUrls, inspectUploads, copyBlob, discard };
