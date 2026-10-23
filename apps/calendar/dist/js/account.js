export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[character]);
}

export async function calendarAccount() {
  let response, state;
  try {
    response = await fetch("/memo/api/auth/me", {credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10000)});
    if (response.ok) state = await response.json();
  } catch {
    throw new Error("Tempo est temporairement indisponible. Réessaie dans un instant.");
  }
  if (!response.ok || !state?.enabled || !state.user || state.user.must_change_password) throw new Error("Connecte-toi à HomeLab pour ouvrir Tempo.");
  return state.user;
}
