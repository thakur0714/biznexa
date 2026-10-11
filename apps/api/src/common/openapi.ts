import { Body, Query } from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse, type OpenAPIObject } from '@nestjs/swagger';
import type { ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ZodPipe } from './zod';

/**
 * zod → OpenAPI. Request schemas come from the same zod schema that validates the request,
 * so /api/docs and packages/api-client cannot disagree with the real validation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonSchema = Record<string, any>;

// Typed loosely on purpose: zodToJsonSchema's generics exceed tsc's instantiation depth on our schemas.
const zodToJson = zodToJsonSchema as unknown as (schema: ZodType, options: { target: 'openApi3'; $refStrategy: 'none' }) => JsonSchema;

function toSchema(schema: ZodType): JsonSchema {
  const { $schema: _omit, ...json } = zodToJson(schema, { target: 'openApi3', $refStrategy: 'none' });
  return json;
}

/** Merge `allOf` of objects (from `.and()`) into one object schema. */
function flattenObject(json: JsonSchema): { properties: Record<string, JsonSchema>; required: string[] } {
  if (json.allOf) {
    const parts = (json.allOf as JsonSchema[]).map(flattenObject);
    return { properties: Object.assign({}, ...parts.map((p) => p.properties)), required: parts.flatMap((p) => p.required) };
  }
  return { properties: json.properties ?? {}, required: json.required ?? [] };
}

/** Apply a method decorator from inside a parameter decorator. */
function onMethod(decorator: MethodDecorator, target: object, key: string | symbol) {
  decorator(target, key, Object.getOwnPropertyDescriptor(target, key)!);
}

/** `@ZodBody(schema)`: validate the body with ZodPipe and document it. */
export function ZodBody(schema: ZodType): ParameterDecorator {
  return (target, key, index) => {
    Body(new ZodPipe(schema))(target, key, index);
    onMethod(ApiBody({ schema: toSchema(schema) }), target, key!);
  };
}

/** `@ZodQuery(schema)`: validate the query string with ZodPipe and document each parameter. */
export function ZodQuery(schema: ZodType): ParameterDecorator {
  return (target, key, index) => {
    Query(new ZodPipe(schema))(target, key, index);
    const { properties, required } = flattenObject(toSchema(schema));
    for (const [name, s] of Object.entries(properties)) {
      const { description, ...rest } = s;
      onMethod(ApiQuery({ name, required: required.includes(name), schema: rest, description }), target, key!);
    }
  };
}

/** Named response schemas, added to `components.schemas` by addZodComponents(). */
const components = new Map<string, ZodType>();

/** Document a response with a named zod schema (shared with clients via packages/types). */
export function ApiZodResponse(name: string, schema: ZodType, status = 200): MethodDecorator {
  const existing = components.get(name);
  if (existing && existing !== schema) throw new Error(`OpenAPI schema name "${name}" is used for two different schemas`);
  components.set(name, schema);
  return ApiResponse({ status, schema: { $ref: `#/components/schemas/${name}` } });
}

export function addZodComponents(doc: OpenAPIObject): OpenAPIObject {
  doc.components ??= {};
  doc.components.schemas ??= {};
  for (const [name, schema] of components) doc.components.schemas[name] = toSchema(schema);
  return doc;
}
