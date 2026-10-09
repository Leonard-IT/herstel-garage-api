'use strict';

const { createReadUrls } = require('./blobStorage');

/**
 * The list response for requests from listOpenRequests: the card photo as a short-lived read link (the container stays private),
 * and without the internal fields (damage report id, blob path).
 */
async function presentRequestList(requests) {
  const urls = await createReadUrls(requests.map((r) => r.thumbnailPath).filter(Boolean));
  return {
    repairRequests: requests.map(({ thumbnailPath, damageReportId, ...rest }) => ({
      ...rest,
      thumbnailUrl: thumbnailPath ? urls.get(thumbnailPath) : null,
    })),
  };
}

module.exports = { presentRequestList };
