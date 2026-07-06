import generalPack from './general.json';
import softwareDeliveryPack from './software-delivery.json';

/**
 * Built-in static domain packs (§4.2 / §6.4).
 *
 * v1 ships exactly two read-only packs: `general` and `software-delivery`.
 * They are versioned JSON manifests loaded once at module import; the
 * `listDomainPacks` and `getDomainPackVersion` routes serve projections of
 * these records. Creation/composition/runtime schema extension is out of scope
 * for v1, so no DB writes are involved.
 */

export interface DomainPackManifest {
  entity_types: string[];
  custom_fields: Array<{ name: string; type: string; entity: string }>;
  gates: string[];
  slots: string[];
}

export interface StaticDomainPack {
  id: string;
  version: string;
  name: string;
  status: 'released' | 'deprecated';
  compatible_core_schema: string;
  manifest: DomainPackManifest;
  manifest_hash: string;
  released_at: string;
  deprecated_at: string | null;
  prompts?: Record<string, string>;
}

export const STATIC_DOMAIN_PACKS: readonly StaticDomainPack[] = [
  generalPack as StaticDomainPack,
  softwareDeliveryPack as StaticDomainPack,
];

/** Find a pack by id, returning the latest released version. */
export function findPackById(id: string): StaticDomainPack | null {
  return STATIC_DOMAIN_PACKS.find((p) => p.id === id) ?? null;
}

/** Find a specific pack version, or null when the (id, version) pair is unknown. */
export function findPackVersion(id: string, version: string): StaticDomainPack | null {
  return STATIC_DOMAIN_PACKS.find((p) => p.id === id && p.version === version) ?? null;
}
