import { nanoid } from "nanoid";

/** A durable schedule key stored with the invoice template. Hostinger cron calls the
 * authenticated dispatcher; no third-party scheduler account or platform ticket exists. */
export async function createLocalSchedule() { return { taskUid: `local-${nanoid(24)}`, nextExecutionAt: null as string | null }; }
export async function updateLocalSchedule(_key: string, _patch: { enable: boolean }) { return { nextExecutionAt: null as string | null }; }
export async function removeLocalSchedule(_key: string) { return; }
