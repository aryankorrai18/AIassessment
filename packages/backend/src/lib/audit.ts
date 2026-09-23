import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import { auditLogCol } from "./collections";
import { logger } from "./logger";
import type { AuditAction } from "../types/domain";

export interface AuditActor { id: string; name: string; email: string }

interface AuditEntry {
  action: AuditAction;
  targetType: string;
  targetId: string;
  summary: string;
  detail?: Record<string, unknown>;
}

/**
 * Called AFTER the real operation succeeds. Never throws and never blocks the
 * operation it describes — a lost entry is preferred over a blocked operation,
 * and logging intent first would risk recording actions that never happened.
 */
export async function recordAudit(actor: AuditActor, entry: AuditEntry): Promise<void> {
  try {
    await auditLogCol().add({
      action: entry.action,
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      targetType: entry.targetType,
      targetId: entry.targetId,
      summary: entry.summary,
      detail: entry.detail ?? {},
      createdAt: FieldValue.serverTimestamp() as unknown as Timestamp,
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, "Failed to write audit log entry");
  }
}
