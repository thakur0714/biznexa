import { describe, expect, it } from 'vitest';
import { formSchema } from '@biznexa/types';
import {
  addField,
  addStep,
  BLANK_FORM,
  canMoveField,
  compactForm,
  describePath,
  EXAMPLE_FORM,
  locate,
  locateNearest,
  moveField,
  moveStep,
  outlineOf,
  parseFormText,
  removeField,
  serverIssues,
  toJson,
} from './builder';

const two = {
  steps: [
    { title: 'One', fields: [{ type: 'text', name: 'a', label: 'A' }, { type: 'text', name: 'b', label: 'B' }] },
    {
      title: 'Two',
      fields: [{ type: 'repeater', name: 'people', label: 'People', fields: [{ type: 'text', name: 'x', label: 'X' }, { type: 'text', name: 'y', label: 'Y' }] }],
    },
  ],
};
const names = (raw: unknown) => outlineOf(raw)!.map((s) => s.fields.map((f) => (f.fields ? `${f.name}[${f.fields.map((x) => x.name)}]` : f.name)));

describe('starting forms', () => {
  it('the example is a valid 3-step form with a directors repeater', () => {
    const form = formSchema.parse(EXAMPLE_FORM);
    expect(form.steps).toHaveLength(3);
    const directors = form.steps[1].fields[0];
    expect(directors).toMatchObject({ type: 'repeater', name: 'directors', minItems: 2 });
    expect(formSchema.safeParse(BLANK_FORM).success).toBe(true);
  });
});

describe('parseFormText', () => {
  it('reports a syntax error with its line and column', () => {
    const text = '{\n  "steps": [\n    { "title": "A" "fields": [] }\n  ]\n}';
    const p = parseFormText(text);
    expect(p.kind).toBe('syntax');
    if (p.kind !== 'syntax') return;
    expect(p.line).toBe(3);
    expect(p.column).toBeGreaterThan(10);
    expect(p.message).not.toMatch(/position/);
  });

  it('treats empty text and a truncated document as syntax errors', () => {
    expect(parseFormText('  ')).toMatchObject({ kind: 'syntax', message: 'Enter the form as JSON' });
    expect(parseFormText('{"steps": [')).toMatchObject({ kind: 'syntax' });
  });

  it('lists schema problems with where they are and the line of the field', () => {
    const bad = structuredClone(two);
    bad.steps[0].fields[1].name = 'a';
    const text = toJson(bad);
    const p = parseFormText(text);
    expect(p.kind).toBe('invalid');
    if (p.kind !== 'invalid') return;
    expect(p.issues).toHaveLength(1);
    const [issue] = p.issues;
    expect(issue.where).toBe('Step 1 “One” › “B” › name');
    expect(issue.message).toMatch(/already named "a"/);
    expect(text.split('\n')[issue.line - 1]).toContain('"name": "a"');
  });

  it('points a missing key at the object that lacks it', () => {
    const text = toJson({ steps: [{ title: 'One', fields: [{ type: 'text', name: 'a' }] }] });
    const p = parseFormText(text);
    if (p.kind !== 'invalid') throw new Error('expected invalid');
    expect(p.issues[0].path).toEqual(['steps', 0, 'fields', 0, 'label']);
    expect(text.slice(p.issues[0].offset, p.issues[0].offset + 1)).toBe('{');
  });

  it('accepts a valid form', () => {
    expect(parseFormText(toJson(EXAMPLE_FORM)).kind).toBe('valid');
  });
});

describe('locate', () => {
  const text = toJson({ steps: [{ title: String.raw`a "quoted" \ title`, fields: [{ name: 'x' }, { name: 'y', list: [1, [2, 3], { z: null }] }] }] });

  it('finds object keys and array items', () => {
    expect(text.slice(locate(text, ['steps', 0, 'fields', 1, 'name'])!)).toMatch(/^"name": "y"/);
    expect(text.slice(locate(text, ['steps', 0, 'fields', 1, 'list', 2])!)).toMatch(/^\{\s+"z"/);
    expect(locate(text, [])).toBe(0);
  });

  it('returns null for paths that do not exist; locateNearest falls back to the parent', () => {
    expect(locate(text, ['steps', 3])).toBeNull();
    expect(locate(text, ['steps', 0, 'fields', 0, 'label'])).toBeNull();
    expect(locateNearest(text, ['steps', 0, 'fields', 0, 'label'])).toBe(locate(text, ['steps', 0, 'fields', 0]));
  });
});

describe('describePath', () => {
  it('names steps by title and fields by label, falling back to numbers', () => {
    expect(describePath(two, ['steps', 1, 'fields', 0, 'fields', 1, 'label'])).toBe('Step 2 “Two” › “People” › “Y” › label');
    expect(describePath({ steps: [{ fields: [{}] }] }, ['steps', 0, 'fields', 0])).toBe('Step 1 › Field 1');
    expect(describePath(two, ['steps'])).toBe('steps');
    expect(describePath(two, [])).toBe('Form');
  });
});

describe('serverIssues', () => {
  it('maps API field paths onto the text', () => {
    const text = toJson(two);
    const [i] = serverIssues(text, two, [{ field: 'schema.steps.1.fields.0.fields.0.name', message: 'Bad name' }]);
    expect(i.path).toEqual(['steps', 1, 'fields', 0, 'fields', 0, 'name']);
    expect(text.split('\n')[i.line - 1]).toContain('"name": "x"');
    expect(i.message).toBe('Bad name');
  });
});

describe('outline edits', () => {
  it('builds an outline only for form-shaped JSON', () => {
    expect(outlineOf({ steps: [{ fields: [] }] })).toHaveLength(1);
    expect(outlineOf({ steps: [{ title: 'x' }] })).toBeNull();
    expect(outlineOf([])).toBeNull();
    const o = outlineOf({ steps: [{ fields: [{ type: 'text', name: 'n', label: 'N', required: true, showIf: { field: 'm', oneOf: ['a', 1] } }] }] })!;
    expect(o[0].fields[0]).toMatchObject({ required: true, showIf: 'm is one of "a", 1' });
  });

  it('moves fields within a step and across step edges, without changing the input', () => {
    const before = toJson(two);
    expect(names(moveField(two, 0, 0, 1))).toEqual([['b', 'a'], ['people[x,y]']]);
    expect(names(moveField(two, 0, 1, 1))).toEqual([['a'], ['b', 'people[x,y]']]);
    expect(names(moveField(two, 1, 0, -1))).toEqual([['a', 'b', 'people[x,y]'], []]);
    expect(toJson(two)).toBe(before);
  });

  it('keeps repeater sub-fields inside their repeater', () => {
    expect(names(moveField(two, 1, 1, -1, 0))).toEqual([['a', 'b'], ['people[y,x]']]);
    expect(names(moveField(two, 1, 0, -1, 0))).toEqual(names(two));
    const steps = outlineOf(two)!;
    expect(canMoveField(steps, 1, 0, -1, 0)).toBe(false);
    expect(canMoveField(steps, 1, 0, -1)).toBe(true);
    expect(canMoveField(steps, 0, 0, -1)).toBe(false);
    expect(canMoveField(steps, 1, 0, 1)).toBe(false);
  });

  it('adds fields with unique names and valid templates, and adds/moves/removes steps', () => {
    let raw = addField(two, 0, 'select');
    raw = addField(raw, 0, 'select');
    raw = addField(raw, 1, 'text', 0);
    expect(names(raw)).toEqual([['a', 'b', 'choice', 'choice2'], ['people[x,y,text]']]);
    raw = addStep(raw);
    expect(names(raw)[2]).toEqual(['text2']);
    expect(formSchema.safeParse(raw).success).toBe(true);
    expect(names(moveStep(raw, 2, 1))[1]).toEqual(['text2']);
    expect(names(removeField(raw, 1, 0))[1]).toEqual([]);
    for (const t of ['textarea', 'email', 'tel', 'number', 'date', 'multi-select', 'file', 'address', 'repeater'] as const) {
      expect(formSchema.safeParse(addField(BLANK_FORM, 0, t)).success, t).toBe(true);
    }
  });
});

describe('compactForm', () => {
  it('drops the defaults the API fills in and round-trips', () => {
    const saved = formSchema.parse(EXAMPLE_FORM);
    const compact = compactForm(saved);
    expect(formSchema.parse(compact)).toEqual(saved);
    const json = toJson(compact);
    expect(json).not.toMatch(/"required": false/);
    expect(json).not.toMatch(/"integer": false/);
    expect(json).not.toMatch(/"maxFiles": 1\b/);
    expect(json).toContain('"Manufacturing"'); // option shorthand back
    expect(compact.steps[1].fields[0]).toMatchObject({ itemLabel: 'Director' });
    // Non-default file settings are kept.
    expect(json).toContain('"maxSizeMb": 2');
  });
});
