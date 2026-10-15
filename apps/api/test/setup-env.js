require('dotenv').config({ quiet: true });
process.env.NODE_ENV = 'test';
// Each Jest worker gets its own Redis keys and upload folder: a running dev API never picks up test jobs,
// a scan job is handled by the worker whose folder holds the file, and files.e2e-spec's "rejected
// uploads leave nothing behind" check is not upset by other suites uploading in parallel.
const worker = process.env.JEST_WORKER_ID ?? '1';
process.env.QUEUE_PREFIX = `bn-test-${worker}`;
// Uploads go to a throwaway folder, never the dev uploads directory.
process.env.UPLOAD_DIR = require('node:path').join(require('node:os').tmpdir(), `bn-test-uploads-${worker}`);
process.env.EMAIL_PROVIDER = 'console';
process.env.FCM_PROVIDER = 'fake';
// Partner keys for the public verify API tests; any other key is refused.
process.env.CERT_VERIFY_API_KEYS = 'bn_live_partner_acme999,bn_test_partner_key';
