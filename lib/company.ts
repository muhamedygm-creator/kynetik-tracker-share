/**
 * Company addresses only (Owner, 2026-10-12): the Build Tracker is for @kynetikkoncepts.com accounts.
 * The database enforces the same rule (private.company_email); this copy only gives the app clear messages.
 */
export const COMPANY_DOMAIN = "kynetikkoncepts.com";
export const isCompanyEmail = (email: string) => email.trim().toLowerCase().split("@")[1] === COMPANY_DOMAIN;
