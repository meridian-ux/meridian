// Proto3-JSON is the established SSE wire. Admit inert bounded own data before
// protobuf decoding; never invoke an accessor or a user-defined toJSON method.
import { fromJson, toBinary, type JsonValue } from "@bufbuild/protobuf";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { staticViewText } from "@savvifi/meridian-schemas/uiview";

export function viewText(input: unknown): string {
  try {
    let work = 4 * 1024 * 1024, nodes = 65536;
    const ancestors = new Set<object>();
    const debit = (amount: number) => { work -= amount; if (work < 0) throw new Error("view rejected"); };
    const copy = (value: unknown, depth: number): JsonValue => {
      if (--nodes < 0 || depth > 256) throw new Error("view rejected");
      if (value === null) { debit(4); return null; }
      if (typeof value === "string") { debit(value.length * 3 + 2); return value; }
      if (typeof value === "boolean") { debit(5); return value; }
      if (typeof value === "number" && Number.isFinite(value)) { debit(32); return value; }
      if (!value || typeof value !== "object" || ancestors.has(value)) throw new Error("view rejected");
      const array = Array.isArray(value);
      const length = array ? Object.getOwnPropertyDescriptor(value, "length") : undefined;
      const count: number = length && "value" in length ? length.value : 0;
      if (array && (!length || !("value" in length) || !Number.isSafeInteger(count) || count < 0 || count > nodes)) throw new Error("view rejected");
      if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("view rejected");
      ancestors.add(value); debit(2);
      try {
        if (array) {
          const result: JsonValue[] = [];
          for (let i = 0; i < count; i++) {
            const property = Object.getOwnPropertyDescriptor(value, String(i));
            if (!property || !("value" in property)) throw new Error("view rejected");
            result.push(copy(property.value, depth + 1));
          }
          return result;
        }
        const result: Record<string, JsonValue> = Object.create(null);
        const keys = Reflect.ownKeys(value);
        if (keys.length > nodes) throw new Error("view rejected");
        for (const key of keys) {
          if (typeof key !== "string") throw new Error("view rejected");
          const property = Object.getOwnPropertyDescriptor(value, key);
          if (!property || !("value" in property)) throw new Error("view rejected");
          if (property.value === undefined) continue;
          debit(key.length * 3 + 3);
          result[key] = copy(property.value, depth + 1);
        }
        return result;
      } finally { ancestors.delete(value); }
    };
    const view = fromJson(ViewDescriptorSchema, copy(input, 0), { ignoreUnknownFields: true });
    return staticViewText(toBinary(ViewDescriptorSchema, view));
  } catch {
    return "View content unavailable: malformed or oversized static composition.";
  }
}
