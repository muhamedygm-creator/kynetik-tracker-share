/**
 * Button looks, shared by client and server components. Kept out of the "use client" dialog module: a server
 * component importing a plain object from a client module gets a reference, not the strings.
 */
export const btn = {
  primary: "display rounded-md bg-gold px-4 py-2 text-[0.65rem] tracking-[0.16em] text-on-accent disabled:opacity-50",
  ghost: "display rounded-md border border-line2 px-3 py-2 text-[0.65rem] tracking-[0.16em] text-ink hover:border-gold disabled:opacity-50",
  danger: "display rounded-md border border-bad px-3 py-2 text-[0.65rem] tracking-[0.16em] text-bad disabled:opacity-50",
  link: "text-gold underline-offset-2 hover:underline disabled:opacity-50",
};
