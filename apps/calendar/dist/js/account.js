export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[character]);
}

export async function calendarAccount() {
  const response = await fetch("/memo/api/auth/me", {credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error("Connecte-toi à HomeLab pour ouvrir ton calendrier.");
  const state = await response.json();
  if (!state.enabled || !state.user || state.user.must_change_password) throw new Error("Connecte-toi à HomeLab pour ouvrir ton calendrier.");
  return state.user;
}
