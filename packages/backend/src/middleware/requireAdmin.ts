import type { NextFunction, Request, Response } from "express";
import { adminUsersCol } from "../lib/collections";
import { ADMIN_COOKIE } from "../lib/cookies";
import { verifyAdminAccess } from "../lib/jwt";
import type { AdminRole } from "../types/domain";

/** Re-checks the account on EVERY request, so deactivation takes effect immediately. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const payload = verifyAdminAccess(req.cookies?.[ADMIN_COOKIE]);
  if (!payload) return res.status(401).json({ error: "Not authenticated" });

  const snap = await adminUsersCol().doc(payload.adminId).get();
  const admin = snap.data();
  if (!admin || admin.isActive === false) return res.status(401).json({ error: "Not authenticated" });

  req.admin = { id: snap.id, role: admin.role, name: admin.name, email: admin.email };
  next();
}

/** Synchronous, no I/O. Must be chained after requireAdmin. */
export function requireRole(role: AdminRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.admin?.role !== role) return res.status(403).json({ error: `Only ${role} can access this.` });
    next();
  };
}
