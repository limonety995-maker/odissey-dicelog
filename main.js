import OBR from "@owlbear-rodeo/sdk";

// Shared keys with the main Odyssey System extension.
const DEBUG_LOG_KEY = "com.codex.body-hp/debugLog";
const DEBUG_BROADCAST_CHANNEL = "com.codex.body-hp/debug";
const ENTRY_LIMIT = 60;
const POLL_INTERVAL_MS = 2000;

const ui = {
  refreshBtn: document.getElementById("refreshBtn"),
  liveBadge: document.getElementById("liveBadge"),
  entryCount: document.getElementById("entryCount"),
  statusBox: document.getElementById("statusBox"),
  viewerName: document.getElementById("viewerName"),
  viewerRole: document.getElementById("viewerRole"),
  lastSync: document.getElementById("lastSync"),
  emptyState: document.getElementById("emptyState"),
  logEntries: document.getElementById("logEntries"),
};

let debugEntries = [];
let viewerName = "Unknown";
let viewerRole = "PLAYER";
let lastSyncLabel = "Not synced yet";
let roomRefreshTimer = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeDebugEntries(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      id: Number(entry.id) || Date.now(),
      title: String(entry.title ?? "Debug"),
      body: String(entry.body ?? ""),
      kind: String(entry.kind ?? "info"),
      timestamp: String(entry.timestamp ?? ""),
    }))
    .slice(0, ENTRY_LIMIT);
}

function mergeDebugEntries(...entryGroups) {
  const merged = new Map();

  for (const group of entryGroups) {
    for (const entry of sanitizeDebugEntries(group)) {
      merged.set(entry.id, entry);
    }
  }

  return [...merged.values()]
    .sort((left, right) => Number(right.id) - Number(left.id))
    .slice(0, ENTRY_LIMIT);
}

function kindClass(kind) {
  switch (kind) {
    case "success":
      return "kind-success";
    case "error":
      return "kind-error";
    case "warning":
      return "kind-warning";
    default:
      return "kind-info";
  }
}

function formatKind(kind) {
  switch (kind) {
    case "success":
      return "Success";
    case "error":
      return "Error";
    case "warning":
      return "Warning";
    default:
      return "Info";
  }
}

function setStatus(message) {
  ui.statusBox.textContent = message;
}

function setSyncState(label) {
  lastSyncLabel = `${label} at ${new Date().toLocaleTimeString()}`;
  ui.lastSync.textContent = lastSyncLabel;
  ui.liveBadge.textContent = label;
}

function renderHeader() {
  ui.viewerName.textContent = viewerName;
  ui.viewerRole.textContent = viewerRole;
  ui.entryCount.textContent = `${debugEntries.length} ${debugEntries.length === 1 ? "entry" : "entries"}`;
  ui.lastSync.textContent = lastSyncLabel;
}

function renderEntries() {
  renderHeader();

  if (!debugEntries.length) {
    ui.emptyState.hidden = false;
    ui.logEntries.innerHTML = "";
    return;
  }

  ui.emptyState.hidden = true;
  ui.logEntries.innerHTML = debugEntries
    .map(
      (entry) => `
        <article class="entry-card">
          <div class="entry-head">
            <div class="entry-title">${escapeHtml(entry.title)}</div>
            <div class="entry-time">${escapeHtml(entry.timestamp || "Unknown time")}</div>
          </div>
          <div class="kind-pill ${kindClass(entry.kind)}">${escapeHtml(formatKind(entry.kind))}</div>
          <pre class="entry-body">${escapeHtml(entry.body)}</pre>
        </article>`,
    )
    .join("");
}

function haveEntriesChanged(nextEntries) {
  if (debugEntries.length !== nextEntries.length) return true;
  return debugEntries.some((entry, index) => entry.id !== nextEntries[index]?.id);
}

async function refreshFromRoom(label = "Room refresh", options = {}) {
  const { quiet = false } = options;
  const metadata = await OBR.room.getMetadata();
  const nextEntries = mergeDebugEntries(metadata?.[DEBUG_LOG_KEY], debugEntries);
  const changed = haveEntriesChanged(nextEntries);
  debugEntries = nextEntries;

  if (quiet && !changed) return;

  setSyncState(label);
  setStatus("Connected to the shared Odyssey combat log.");
  renderEntries();
}

function bindUiEvents() {
  ui.refreshBtn?.addEventListener("click", () => {
    setStatus("Refreshing combat log...");
    void refreshFromRoom("Manual refresh").catch((error) => {
      console.warn("[Odyssey Combat Log] Unable to refresh log", error);
      setStatus(error?.message ?? "Unable to refresh combat log.");
    });
  });
}

OBR.onReady(async () => {
  try {
    const [name, role] = await Promise.all([
      OBR.player.getName(),
      OBR.player.getRole(),
    ]);
    viewerName = name ?? viewerName;
    viewerRole = role ?? viewerRole;

    bindUiEvents();
    renderEntries();
    await refreshFromRoom("Initial sync");

    OBR.player.onChange((player) => {
      viewerName = player?.name ?? viewerName;
      viewerRole = player?.role ?? viewerRole;
      renderHeader();
    });

    OBR.broadcast.onMessage(DEBUG_BROADCAST_CHANNEL, (event) => {
      const payload = event?.data;
      if (!payload || typeof payload !== "object") return;
      if (payload.type !== "debug-entry") return;

      debugEntries = mergeDebugEntries([payload.entry], debugEntries);
      setSyncState("Live event");
      setStatus("Received a live Odyssey combat event.");
      renderEntries();
    });

    OBR.room.onMetadataChange((metadata) => {
      debugEntries = mergeDebugEntries(metadata?.[DEBUG_LOG_KEY], debugEntries);
      setSyncState("Room update");
      setStatus("Room log updated.");
      renderEntries();
    });

    roomRefreshTimer = window.setInterval(() => {
      void refreshFromRoom("Fallback poll", { quiet: true }).catch((error) => {
        console.warn("[Odyssey Combat Log] Poll refresh failed", error);
      });
    }, POLL_INTERVAL_MS);
  } catch (error) {
    console.error("[Odyssey Combat Log] Initialization failed", error);
    setStatus(error?.message ?? "Combat log extension failed to initialize.");
  }
});
