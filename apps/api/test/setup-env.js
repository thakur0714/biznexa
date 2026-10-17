require('dotenv').config({ quiet: true });
process.env.NODE_ENV = 'test';
// Each Jest worker gets its own Redis keys and upload folder: a running dev API never picks up test jobs,
// a scan job is handled by the worker whose folder holds the file, and files.e2e-spec's "rejected
// uploads leave nothing behind" check is not upset by other suites uploading in parallel.
const worker = process.env.JEST_WORKER_ID ?? '1';
// Several checkouts (git worktrees) may run their suites at once against the same Redis: a short hash of this
// checkout's path keeps their queues and upload folders apart.
const checkout = require('node:crypto').createHash('sha1').update(__dirname).digest('hex').slice(0, 6);
process.env.QUEUE_PREFIX = `bn-test-${checkout}-${worker}`;
// Uploads go to a throwaway folder, never the dev uploads directory.
process.env.UPLOAD_DIR = require('node:path').join(require('node:os').tmpdir(), `bn-test-uploads-${checkout}-${worker}`);
process.env.EMAIL_PROVIDER = 'console';
process.env.FCM_PROVIDER = 'fake';
// Partner keys for the public verify API tests; any other key is refused.
process.env.CERT_VERIFY_API_KEYS = 'bn_live_partner_acme999,bn_test_partner_key';
