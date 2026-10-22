#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const baseUrl = (process.env.PERF_API_URL ?? 'http://localhost:4300/api').replace(/\/$/, '');
const requestCount = Number.parseInt(process.env.PERF_REQUESTS ?? '12', 10);
const connections = Number.parseInt(process.env.PERF_CONNECTIONS ?? '4', 10);
const serviceSlug = process.env.PERF_SERVICE_SLUG;
const blogSlug = process.env.PERF_BLOG_SLUG;

if (!Number.isInteger(requestCount) || requestCount < 1 || !Number.isInteger(connections) || connections < 1) {
  throw new Error('PERF_REQUESTS and PERF_CONNECTIONS must be positive integers');
}

async function getJson(path, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`);
  return response.json();
}

const loginResponse = await fetch(`${baseUrl}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: process.env.PERF_CUSTOMER_EMAIL ?? 'customer@biznexa.local',
    password: process.env.PERF_CUSTOMER_PASSWORD ?? 'Customer@12345', // NOSONAR: seed credential
  }),
});
if (!loginResponse.ok) throw new Error(`Seeded customer login failed (${loginResponse.status})`);
const login = await loginResponse.json();
if (typeof login.accessToken !== 'string') throw new Error('Customer login did not return an access token');
const customerHeaders = [`Authorization=Bearer ${login.accessToken}`];

const services = await getJson('/catalogue/services?page=1&limit=1');
const selectedService = serviceSlug ?? services.items?.[0]?.slug;
if (!selectedService) throw new Error('No service is available; set PERF_SERVICE_SLUG to a seeded service slug');
const posts = await getJson('/public/blog/posts?page=1&pageSize=1');
const selectedBlogPost = blogSlug ?? posts.items?.[0]?.slug ?? 'perf-baseline-no-published-post';

const endpoints = [
  { name: 'catalogue list', path: '/catalogue/services?page=1&limit=24' },
  { name: 'service detail', path: `/catalogue/services/${encodeURIComponent(selectedService)}` },
  { name: 'catalogue search', path: '/catalogue/search?q=company' },
  { name: 'blog list', path: '/public/blog/posts?page=1&pageSize=10' },
  { name: `blog post (${selectedBlogPost})`, path: `/public/blog/posts/${encodeURIComponent(selectedBlogPost)}` },
  { name: 'customer applications', path: '/applications', headers: customerHeaders },
  { name: 'dashboard summary', path: '/dashboard/summary', headers: customerHeaders },
  { name: 'notifications', path: '/notifications', headers: customerHeaders },
];

function percentile95(latency) {
  const p90 = latency.p90 ?? latency.p97_5;
  const p97_5 = latency.p97_5 ?? latency.p99;
  return p90 + (p97_5 - p90) * (0.05 / 0.075);
}

const results = [];
for (const endpoint of endpoints) {
  const args = [
    '--yes', 'autocannon', '--json', '--no-progress',
    '--connections', String(connections), '--amount', String(requestCount),
  ];
  for (const header of endpoint.headers ?? []) args.push('--headers', header);
  args.push(`${baseUrl}${endpoint.path}`);

  const run = spawnSync('npx', args, { encoding: 'utf8', timeout: 120_000 }); // NOSONAR: dev tool from PATH
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`autocannon failed for ${endpoint.name}: ${run.stderr || run.stdout}`);
  const summaryLine = run.stdout.trim().split('\n').at(-1);
  let summary;
  try {
    summary = JSON.parse(summaryLine);
  } catch {
    throw new Error(`Could not parse autocannon JSON for ${endpoint.name}: ${run.stdout}`);
  }

  const latency = summary.latency;
  const result = {
    endpoint: endpoint.name,
    requests: summary.requests.total,
    statuses: summary.statusCodeStats,
    errors: summary.errors + summary.timeouts + summary.resets,
    p50Ms: latency.p50,
    p95Ms: Number(percentile95(latency).toFixed(2)),
    p99Ms: latency.p99,
  };
  results.push(result);
  console.log(`${result.endpoint.padEnd(38)} p50 ${result.p50Ms} ms  p95~ ${result.p95Ms} ms  p99 ${result.p99Ms} ms  statuses ${JSON.stringify(result.statuses)}`);
}

console.log('\np95 is interpolated between autocannon p90 and p97.5 histogram buckets.');
console.log(`Requests per endpoint: ${requestCount}; connections: ${connections}; API: ${baseUrl}`);
const failures = results.filter((result) => result.p95Ms >= 300);
if (failures.length) {
  console.error(`\nFAIL: p95 >= 300 ms for ${failures.map((result) => result.endpoint).join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('\nPASS: all measured p95 values are below 300 ms');
}
