export type TenantIdPrefix =
  | "ten"
  | "ws"
  | "usr"
  | "wf"
  | "prj"
  | "run"
  | "node"
  | "evt"
  | "trg"
  | "agt"
  | "pol"
  | "cst"
  | "aud"
  | "doc"
  | "art"
  | "dep"
  | "env"
  | "apr"
  | "cnv"
  | "mem";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function toPrefixedId(prefix: TenantIdPrefix, id: string): string {
  if (!uuidPattern.test(id)) {
    throw new Error(`Invalid UUID for ${prefix} id`);
  }

  return `${prefix}_${id}`;
}

export function fromPrefixedId(prefix: TenantIdPrefix, value: string): string {
  const expectedPrefix = `${prefix}_`;

  if (!value.startsWith(expectedPrefix)) {
    throw new Error(`Expected ${expectedPrefix} id`);
  }

  const id = value.slice(expectedPrefix.length);
  if (!uuidPattern.test(id)) {
    throw new Error(`Invalid UUID for ${prefix} id`);
  }

  return id;
}
