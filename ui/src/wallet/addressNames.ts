// User-given names for deposit addresses. Local for now; will sync to Supabase
// per-account once LW-SSO auth is wired (the shape here is what gets pushed).
const KEY = "dd69.addressNames";

export function loadNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

// Stores the name as typed (so spaces work while editing); callers trim on
// commit (blur / Enter). Empty (after trim) removes the name.
export function setName(address: string, name: string): Record<string, string> {
  const m = loadNames();
  if (name.trim()) m[address] = name;
  else delete m[address];
  localStorage.setItem(KEY, JSON.stringify(m));
  return m;
}
