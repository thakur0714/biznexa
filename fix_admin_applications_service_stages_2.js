const fs = require('fs');

// In `admin-applications.service.ts`:
// `service: { select: { id: true, name: true, stages: { select: { id: true, name: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } } } }`
// The `app.service` does not have `stages` correctly inferred because `ApplicationSelect` might not have picked it up if I used `as any` or maybe `stages` is not the correct relation name?
// Let's check `Service` model in `schema.prisma`.

const schema = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');
const serviceModel = schema.split('\n').filter(l => l.includes('model Service') || l.includes('Stage')).join('\n');
console.log(serviceModel);

// Ah! Wait! `app.service.stages` error. `app` is `Prisma.ApplicationGetPayload<{ select: S }>`.
// Since I wrote `{ select: { id: true, name: true, stages: { ... } } }`, the type of `app.service` should have `stages`.
// But wait, `findVisibleApplication` has an explicit parameter `select: S`. I am defining the `select` argument inline!
