"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/auth/permissions";
import { nameKey } from "@/lib/stock/club-stock-service";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export type ClubFlavourRow = {
  externalKey: string;
  clubAppName: string;
  /** Null until someone pairs it. */
  mappedFlavourId: string | null;
  mappedFlavourName: string | null;
  lastQtyG: number;
  clubCount: number;
  lastSeenAt: string;
  /** An unmapped name that exactly matches one of ours, offered as a suggestion. */
  suggestedFlavourId: string | null;
  suggestedFlavourName: string | null;
};

export type MappingData = {
  rows: ClubFlavourRow[];
  flavours: { id: string; name: string }[];
  canMap: boolean;
  mappedCount: number;
  unmappedCount: number;
  suggestionCount: number;
};

export async function getClubFlavourMapping(): Promise<MappingData> {
  const session = await getSession();
  const empty: MappingData = {
    rows: [],
    flavours: [],
    canMap: false,
    mappedCount: 0,
    unmappedCount: 0,
    suggestionCount: 0,
  };
  if (!session || !can(session.role, "stock:club")) return empty;

  const admin = createAdminClient();
  const [{ data: catalogue }, { data: maps }, { data: flavours }] =
    await Promise.all([
      admin
        .from("club_app_flavours")
        .select("external_key, name, last_qty_g, club_count, last_seen_at")
        .order("name"),
      admin.from("club_flavour_map").select("external_key, flavour_id"),
      admin
        .from("flavours")
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
    ]);

  const flavourById = new Map((flavours ?? []).map((f) => [f.id, f]));
  const mapByKey = new Map(
    (maps ?? []).map((m) => [m.external_key, m.flavour_id]),
  );
  const flavourByName = new Map(
    (flavours ?? []).map((f) => [nameKey(f.name), f]),
  );

  const rows: ClubFlavourRow[] = (catalogue ?? []).map((c) => {
    const mappedId = mapByKey.get(c.external_key) ?? null;
    const mapped = mappedId ? (flavourById.get(mappedId) ?? null) : null;
    // A name that already matches ours is what the sync would pick up
    // anyway — showing it as a suggestion makes that visible rather than
    // implicit, and lets it be confirmed or overridden.
    const suggestion = mapped ? null : (flavourByName.get(nameKey(c.name)) ?? null);
    return {
      externalKey: c.external_key,
      clubAppName: c.name,
      mappedFlavourId: mapped?.id ?? null,
      mappedFlavourName: mapped?.name ?? null,
      lastQtyG: c.last_qty_g,
      clubCount: c.club_count,
      lastSeenAt: c.last_seen_at,
      suggestedFlavourId: suggestion?.id ?? null,
      suggestedFlavourName: suggestion?.name ?? null,
    };
  });

  return {
    rows,
    flavours: (flavours ?? []).map((f) => ({ id: f.id, name: f.name })),
    canMap: session.role === "admin",
    mappedCount: rows.filter((r) => r.mappedFlavourId).length,
    unmappedCount: rows.filter((r) => !r.mappedFlavourId).length,
    suggestionCount: rows.filter(
      (r) => !r.mappedFlavourId && r.suggestedFlavourId,
    ).length,
  };
}

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") return null;
  return session;
}

const setSchema = z.object({
  externalKey: z.string().min(1),
  flavourId: z.uuid(),
});

/**
 * Pairs a Club App flavour with one of ours.
 *
 * Admin-only, deliberately: a wrong pairing attributes one product's
 * stock to another, and unlike a bad quantity there is nothing in the
 * numbers to give it away.
 */
export async function setFlavourMapping(
  input: z.input<typeof setSchema>,
): Promise<ActionResult<null>> {
  const session = await requireAdmin();
  if (!session) {
    return { success: false, error: "Only an admin can map Club App flavours." };
  }
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Pick a flavour first." };
  }

  const admin = createAdminClient();
  const { data: entry } = await admin
    .from("club_app_flavours")
    .select("external_key, club_app_flavour_id, name")
    .eq("external_key", parsed.data.externalKey)
    .maybeSingle();
  if (!entry) {
    return { success: false, error: "That Club App flavour is no longer listed." };
  }

  const { error } = await admin.from("club_flavour_map").upsert(
    {
      external_key: entry.external_key,
      club_app_flavour_id: entry.club_app_flavour_id,
      club_app_flavour_name: entry.name,
      flavour_id: parsed.data.flavourId,
      created_by: session.userId,
    },
    { onConflict: "external_key" },
  );
  if (error) return { success: false, error: "Could not save the mapping." };

  revalidatePath("/stock/club/mapping");
  revalidatePath("/stock/club");
  return { success: true, data: null };
}

export async function clearFlavourMapping(
  externalKey: string,
): Promise<ActionResult<null>> {
  const session = await requireAdmin();
  if (!session) {
    return { success: false, error: "Only an admin can change Club App mappings." };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("club_flavour_map")
    .delete()
    .eq("external_key", externalKey);
  if (error) return { success: false, error: "Could not clear the mapping." };

  revalidatePath("/stock/club/mapping");
  revalidatePath("/stock/club");
  return { success: true, data: null };
}

/**
 * Creates one of our flavours from a Club App name and maps to it, for
 * club-only products we do not otherwise stock. The flavour is created
 * through the normal table so it gets its own FL- code and behaves like
 * any other; nothing about it is club-specific afterwards.
 */
export async function createAndMapFlavour(
  externalKey: string,
): Promise<ActionResult<{ flavourId: string; name: string }>> {
  const session = await requireAdmin();
  if (!session) {
    return { success: false, error: "Only an admin can create flavours here." };
  }

  const admin = createAdminClient();
  const { data: entry } = await admin
    .from("club_app_flavours")
    .select("external_key, club_app_flavour_id, name")
    .eq("external_key", externalKey)
    .maybeSingle();
  if (!entry) {
    return { success: false, error: "That Club App flavour is no longer listed." };
  }

  // If a flavour of that name already exists, map to it rather than
  // creating a near-duplicate that would split the same product's stock.
  const { data: existing } = await admin
    .from("flavours")
    .select("id, name")
    .ilike("name", entry.name.trim())
    .maybeSingle();

  let flavourId = existing?.id ?? null;
  let flavourName = existing?.name ?? entry.name.trim();

  if (!flavourId) {
    const { data: created, error } = await admin
      .from("flavours")
      .insert({ name: entry.name.trim(), created_by: session.userId })
      .select("id, name")
      .single();
    if (error || !created) {
      return { success: false, error: "Could not create the flavour." };
    }
    flavourId = created.id;
    flavourName = created.name;
  }

  const { error: mapError } = await admin.from("club_flavour_map").upsert(
    {
      external_key: entry.external_key,
      club_app_flavour_id: entry.club_app_flavour_id,
      club_app_flavour_name: entry.name,
      flavour_id: flavourId,
      created_by: session.userId,
    },
    { onConflict: "external_key" },
  );
  if (mapError) {
    return { success: false, error: "Flavour created but the mapping failed." };
  }

  revalidatePath("/stock/club/mapping");
  revalidatePath("/stock/club");
  return { success: true, data: { flavourId, name: flavourName } };
}

/** Confirms every exact-name suggestion at once. */
export async function acceptAllSuggestions(): Promise<
  ActionResult<{ applied: number }>
> {
  const session = await requireAdmin();
  if (!session) {
    return { success: false, error: "Only an admin can map Club App flavours." };
  }

  const data = await getClubFlavourMapping();
  const pending = data.rows.filter(
    (r) => !r.mappedFlavourId && r.suggestedFlavourId,
  );
  if (pending.length === 0) {
    return { success: true, data: { applied: 0 } };
  }

  const admin = createAdminClient();
  const { data: catalogue } = await admin
    .from("club_app_flavours")
    .select("external_key, club_app_flavour_id, name")
    .in(
      "external_key",
      pending.map((p) => p.externalKey),
    );
  const byKey = new Map((catalogue ?? []).map((c) => [c.external_key, c]));

  const { error } = await admin.from("club_flavour_map").upsert(
    pending.map((p) => ({
      external_key: p.externalKey,
      club_app_flavour_id: byKey.get(p.externalKey)?.club_app_flavour_id ?? null,
      club_app_flavour_name: byKey.get(p.externalKey)?.name ?? p.clubAppName,
      flavour_id: p.suggestedFlavourId as string,
      created_by: session.userId,
    })),
    { onConflict: "external_key" },
  );
  if (error) {
    return { success: false, error: "Could not apply the suggestions." };
  }

  revalidatePath("/stock/club/mapping");
  revalidatePath("/stock/club");
  return { success: true, data: { applied: pending.length } };
}
