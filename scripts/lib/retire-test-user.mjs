/**
 * Shared teardown for the throwaway users the test scripts sign in as.
 *
 * Deleting one is not always possible, and that is by design rather than a
 * fault: the moment a test user posts a GRN, confirms a batch or triggers
 * any stock movement, immutable rows point at it —
 *
 *   stock_movements.created_by · grns.posted_by · batches.mixed_by
 *   supplier_rates.created_by  · audit_log.actor_id
 *
 * — and none of those tables may be deleted from (CLAUDE.md rule 7), so the
 * foreign keys correctly refuse. GoTrue surfaces that refusal as an opaque
 * 500, which the old callers passed straight to `void`. The account then
 * survived as a signed-in-capable admin on a real project, silently. Seven
 * of them accumulated that way before anyone noticed.
 *
 * So: delete when the database allows it, ban permanently when it doesn't,
 * and never return quietly having done neither.
 */

/** A ban far enough out to be permanent in practice (100 years). */
const PERMANENT_BAN = "876000h";

/**
 * Removes a throwaway test user's ability to sign in, by whichever means
 * the database permits.
 *
 * @returns {Promise<"deleted" | "banned">} what actually happened
 * @throws if the account is left able to sign in — callers must not
 *         continue believing it was cleaned up when it was not.
 */
export async function retireTestUser(admin, userId, label = userId) {
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (!deleteError) return "deleted";

  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: PERMANENT_BAN,
  });
  if (banError) {
    throw new Error(
      `Could not retire test user ${label}: delete failed ` +
        `(${deleteError.message}) and so did the fallback ban ` +
        `(${banError.message}). It can still sign in — remove it by hand.`,
    );
  }

  console.log(
    `  ${label}: referenced by immutable records, so banned instead of deleted`,
  );
  return "banned";
}

/**
 * Retires several users, and does not let one failure strand the rest.
 * Throws at the end if any could not be retired.
 */
export async function retireTestUsers(admin, userIds, labelFor = (id) => id) {
  const problems = [];
  for (const id of userIds) {
    try {
      await retireTestUser(admin, id, labelFor(id));
    } catch (err) {
      problems.push(err.message);
    }
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));
}
