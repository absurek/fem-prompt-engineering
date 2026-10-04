(() => {
  const STORAGE_KEY = "prompt-library.prompts";
  const BACKUP_KEY = "prompt-library.prompts.backup";
  const EXPORT_VERSION = 1;
  const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  const form = document.getElementById("prompt-form");
  const titleInput = document.getElementById("prompt-title");
  const modelInput = document.getElementById("prompt-model");
  const isCodeInput = document.getElementById("prompt-is-code");
  const contentInput = document.getElementById("prompt-content");
  const charCount = document.getElementById("char-count");
  const formError = document.getElementById("form-error");
  const listEl = document.getElementById("prompt-list");
  const countEl = document.getElementById("prompt-count");
  const searchInput = document.getElementById("search-input");
  const sortSelect = document.getElementById("sort-select");
  const toastEl = document.getElementById("toast");
  const dialog = document.getElementById("confirm-dialog");
  const confirmCopy = document.getElementById("confirm-copy");
  const confirmDeleteBtn = document.getElementById("confirm-delete");
  const cancelDeleteBtn = document.getElementById("cancel-delete");
  const exportButton = document.getElementById("export-button");
  const importButton = document.getElementById("import-button");
  const importFileInput = document.getElementById("import-file");
  const importDialog = document.getElementById("import-dialog");
  const importCopy = document.getElementById("import-copy");
  const importStatsEl = document.getElementById("import-stats");
  const importErrorEl = document.getElementById("import-error");
  const cancelImportBtn = document.getElementById("cancel-import");
  const importMergeBtn = document.getElementById("import-merge");
  const importReplaceBtn = document.getElementById("import-replace");
  const conflictDialog = document.getElementById("conflict-dialog");
  const conflictCopy = document.getElementById("conflict-copy");
  const conflictListEl = document.getElementById("conflict-list");
  const cancelConflictBtn = document.getElementById("cancel-conflict");
  const conflictSkipBtn = document.getElementById("conflict-skip");
  const conflictOverwriteBtn = document.getElementById("conflict-overwrite");
  const shortcut = document.querySelector(".shortcut");

  let prompts = loadPrompts();
  let pendingDeleteId = null;
  let toastTimer = null;
  let pendingImport = null;

  if (!navigator.platform.toUpperCase().includes("MAC") && shortcut) {
    shortcut.textContent = "Ctrl+Enter";
  }

  contentInput.addEventListener("input", () => {
    charCount.textContent = String(contentInput.value.length);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    savePrompt();
  });

  form.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      savePrompt();
    }
  });

  searchInput.addEventListener("input", render);
  sortSelect.addEventListener("change", render);

  cancelDeleteBtn.addEventListener("click", () => dialog.close());
  confirmDeleteBtn.addEventListener("click", () => {
    if (!pendingDeleteId) return;
    prompts = prompts.filter((prompt) => prompt.id !== pendingDeleteId);
    persist();
    pendingDeleteId = null;
    dialog.close();
    render();
    showToast("Prompt deleted");
  });

  dialog.addEventListener("close", () => {
    pendingDeleteId = null;
  });

  exportButton.addEventListener("click", exportLibrary);
  importButton.addEventListener("click", () => importFileInput.click());
  importFileInput.addEventListener("change", handleImportFile);

  cancelImportBtn.addEventListener("click", () => importDialog.close());
  importMergeBtn.addEventListener("click", () => startMergeImport());
  importReplaceBtn.addEventListener("click", () => applyImport({ mode: "replace" }));
  importDialog.addEventListener("close", () => {
    if (!pendingImport || pendingImport.stage !== "conflict") {
      pendingImport = null;
      importFileInput.value = "";
    }
  });

  cancelConflictBtn.addEventListener("click", () => conflictDialog.close());
  conflictSkipBtn.addEventListener("click", () => applyImport({ mode: "merge", duplicates: "skip" }));
  conflictOverwriteBtn.addEventListener("click", () => applyImport({ mode: "merge", duplicates: "overwrite" }));
  conflictDialog.addEventListener("close", () => {
    pendingImport = null;
    importFileInput.value = "";
  });

  render();

  function savePrompt() {
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();
    const modelName = modelInput.value.trim();

    if (!title || !content) {
      showFormError("Add both a title and content before saving.");
      return;
    }

    let metadata;
    try {
      metadata = trackModel(modelName, content, isCodeInput.checked);
    } catch (error) {
      showFormError(error instanceof Error ? error.message : "Could not track model metadata.");
      return;
    }

    prompts.unshift({
      id: createId(),
      title,
      content,
      createdAt: Date.parse(metadata.createdAt) || Date.now(),
      rating: 0,
      notes: [],
      metadata,
    });

    if (!persist()) {
      prompts.shift();
      showFormError("Could not save to localStorage. Check browser storage settings.");
      return;
    }

    form.reset();
    charCount.textContent = "0";
    hideFormError();
    render();
    showToast("Prompt saved");
    listEl.querySelector(".prompt-card")?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
    titleInput.focus({ preventScroll: true });
  }

  function render() {
    const query = searchInput.value.trim().toLowerCase();
    let visible = query
      ? prompts.filter(
          (prompt) =>
            prompt.title.toLowerCase().includes(query) ||
            prompt.content.toLowerCase().includes(query)
        )
      : prompts;

    if (sortSelect.value === "rating") {
      visible = visible.slice().sort((a, b) => {
        const ratingDelta = (b.rating || 0) - (a.rating || 0);
        if (ratingDelta !== 0) return ratingDelta;
        return metadataCreatedMs(b) - metadataCreatedMs(a);
      });
    } else {
      visible = visible.slice().sort((a, b) => metadataCreatedMs(b) - metadataCreatedMs(a));
    }

    countEl.textContent = `${prompts.length} saved`;
    listEl.replaceChildren();

    if (prompts.length === 0) {
      listEl.append(emptyState("Your library is empty", "Save a prompt to start building a reusable collection."));
      return;
    }

    if (visible.length === 0) {
      listEl.append(emptyState("No matching prompts", "Try a different search term."));
      return;
    }

    visible.forEach((prompt) => listEl.append(createCard(prompt)));
  }

  function createCard(prompt) {
    const card = el("article", "prompt-card");
    card.dataset.promptId = prompt.id;

    const title = el("h3");
    title.textContent = prompt.title;

    const body = el("p", "prompt-body");
    body.textContent = prompt.content;

    const journalMeta = createJournalMeta(prompt);

    const meta = el("div", "prompt-meta");
    const date = el("time");
    const createdMs = metadataCreatedMs(prompt);
    date.dateTime = new Date(createdMs).toISOString();
    date.textContent = formatDate(createdMs);

    const actions = el("div", "prompt-actions");
    const copyBtn = iconButton("Copy prompt", copyIcon());
    const deleteBtn = iconButton("Delete prompt", trashIcon());
    deleteBtn.classList.add("danger");

    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(prompt.content);
        showToast("Copied to clipboard");
      } catch {
        showToast("Could not copy");
      }
    });

    deleteBtn.addEventListener("click", () => {
      pendingDeleteId = prompt.id;
      confirmCopy.textContent = `“${prompt.title}” will be removed from this device.`;
      dialog.showModal();
    });

    actions.append(copyBtn, deleteBtn);
    meta.append(date, createStarRating(prompt), actions);
    card.append(title, body, journalMeta, createNotesSection(prompt), meta);
    return card;
  }

  function createJournalMeta(prompt) {
    const metadata = prompt.metadata;
    const wrap = el("dl", "journal-meta");

    const modelRow = el("div", "journal-meta-row");
    const modelDt = el("dt");
    modelDt.textContent = "Model";
    const modelDd = el("dd");
    modelDd.textContent = metadata?.model || "Unknown";
    modelRow.append(modelDt, modelDd);

    const timeRow = el("div", "journal-meta-row");
    const createdDt = el("dt");
    createdDt.textContent = "Created";
    const createdDd = el("dd");
    const createdTime = el("time");
    createdTime.dateTime = metadata?.createdAt || new Date(prompt.createdAt).toISOString();
    createdTime.textContent = formatDateTime(createdTime.dateTime);
    createdDd.append(createdTime);

    const updatedDt = el("dt");
    updatedDt.textContent = "Updated";
    const updatedDd = el("dd");
    const updatedTime = el("time");
    updatedTime.dateTime = metadata?.updatedAt || createdTime.dateTime;
    updatedTime.textContent = formatDateTime(updatedTime.dateTime);
    updatedDd.append(updatedTime);
    timeRow.append(createdDt, createdDd, updatedDt, updatedDd);

    const tokenRow = el("div", "journal-meta-row");
    const tokenDt = el("dt");
    tokenDt.textContent = "Tokens";
    const tokenDd = el("dd", "token-estimate");
    const estimate = metadata?.tokenEstimate;
    const range = el("span");
    range.textContent = estimate
      ? `${Math.round(estimate.min)}–${Math.round(estimate.max)}`
      : "n/a";
    const confidence = el("span", `confidence confidence-${estimate?.confidence || "low"}`);
    confidence.textContent = estimate?.confidence || "unknown";
    tokenDd.append(range, confidence);
    tokenRow.append(tokenDt, tokenDd);

    wrap.append(modelRow, timeRow, tokenRow);
    return wrap;
  }

  function touchMetadata(prompt) {
    if (!prompt.metadata) return;
    try {
      prompt.metadata = updateTimestamps(prompt.metadata);
    } catch (error) {
      console.error(error);
    }
  }

  function createNotesSection(prompt) {
    const section = el("section", "notes");
    section.dataset.promptId = prompt.id;

    const heading = el("h4");
    heading.textContent = "Notes";

    const list = el("ul", "notes-list");
    (prompt.notes || []).forEach((note) => {
      list.append(createNoteItem(prompt.id, note));
    });

    const form = el("form", "note-form");
    const textarea = document.createElement("textarea");
    textarea.rows = 3;
    textarea.placeholder = "Add a note…";
    textarea.setAttribute("aria-label", `New note for ${prompt.title}`);

    const saveBtn = el("button", "btn btn-primary btn-compact");
    saveBtn.type = "submit";
    saveBtn.textContent = "Save note";

    form.append(textarea, saveBtn);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      addNote(prompt.id, textarea.value);
    });

    section.append(heading, list, form);
    return section;
  }

  function createNoteItem(promptId, note) {
    const item = el("li", "note");
    item.dataset.noteId = note.id;

    const text = el("p", "note-text");
    text.textContent = note.text;

    const actions = el("div", "note-actions");
    const editBtn = el("button", "btn btn-ghost btn-compact");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => startEditNote(item, promptId, note));

    const deleteBtn = el("button", "btn btn-danger btn-compact");
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deleteNote(promptId, note.id));

    actions.append(editBtn, deleteBtn);
    item.append(text, actions);
    return item;
  }

  function startEditNote(item, promptId, note) {
    const form = el("form", "note-form");
    const textarea = document.createElement("textarea");
    textarea.rows = 3;
    textarea.value = note.text;
    textarea.setAttribute("aria-label", "Edit note");

    const saveBtn = el("button", "btn btn-primary btn-compact");
    saveBtn.type = "submit";
    saveBtn.textContent = "Save";

    form.append(textarea, saveBtn);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      editNote(promptId, note.id, textarea.value);
    });

    item.replaceChildren(form);
    textarea.focus();
  }

  function addNote(promptId, text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const prompt = prompts.find((item) => item.id === promptId);
    if (!prompt) return;

    prompt.notes = prompt.notes || [];
    prompt.notes.push({
      id: createId(),
      text: trimmed,
      updatedAt: Date.now(),
    });
    touchMetadata(prompt);

    if (!persist()) {
      prompt.notes.pop();
      showToast("Could not save note");
      return;
    }

    render();
  }

  function editNote(promptId, noteId, text) {
    const trimmed = text.trim();
    const prompt = prompts.find((item) => item.id === promptId);
    if (!prompt) return;

    const note = (prompt.notes || []).find((item) => item.id === noteId);
    if (!note) return;

    if (!trimmed) {
      render();
      return;
    }

    const previous = { text: note.text, updatedAt: note.updatedAt };
    note.text = trimmed;
    note.updatedAt = Date.now();
    touchMetadata(prompt);

    if (!persist()) {
      note.text = previous.text;
      note.updatedAt = previous.updatedAt;
      showToast("Could not save note");
      return;
    }

    render();
  }

  function deleteNote(promptId, noteId) {
    const prompt = prompts.find((item) => item.id === promptId);
    if (!prompt) return;

    const previous = prompt.notes;
    prompt.notes = (prompt.notes || []).filter((note) => note.id !== noteId);
    touchMetadata(prompt);

    if (!persist()) {
      prompt.notes = previous;
      showToast("Could not delete note");
      return;
    }

    render();
  }

  function createStarRating(prompt) {
    const rating = prompt.rating || 0;
    const widget = el("div", "star-rating");
    widget.setAttribute("role", "radiogroup");
    widget.setAttribute("aria-label", ratingAriaLabel(rating, prompt.title));

    const row = el("div", "star-row");
    for (let value = 1; value <= 5; value += 1) {
      const button = el("button", "star");
      button.type = "button";
      button.dataset.value = String(value);
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(rating === value));
      button.setAttribute("aria-label", `${value} star${value === 1 ? "" : "s"}`);
      button.title = `${value} star${value === 1 ? "" : "s"}`;
      button.tabIndex = rating === value || (rating === 0 && value === 1) ? 0 : -1;
      button.append(starIcon());
      button.addEventListener("click", () => setRating(prompt.id, value, true));
      row.append(button);
    }
    paintStars(row, rating);

    row.addEventListener("pointerover", (event) => {
      const star = event.target.closest(".star");
      if (!star || !row.contains(star)) return;
      paintStars(row, Number(star.dataset.value));
    });
    row.addEventListener("pointerleave", () => paintStars(row, rating));

    widget.addEventListener("keydown", (event) => {
      const next = nextRatingFromKey(event.key, rating);
      if (next == null) return;
      event.preventDefault();
      setRating(prompt.id, next, false);
    });

    const label = el("span", "rating-label");
    label.textContent = rating ? `${rating}/5` : "Not rated";

    widget.append(row, label);
    return widget;
  }

  function nextRatingFromKey(key, rating) {
    if (key === "ArrowRight" || key === "ArrowUp") return Math.min(5, rating === 0 ? 1 : rating + 1);
    if (key === "ArrowLeft" || key === "ArrowDown") return Math.max(1, rating === 0 ? 1 : rating - 1);
    if (key === "Home") return 1;
    if (key === "End") return 5;
    return null;
  }

  function setRating(promptId, stars, toggleSame) {
    const prompt = prompts.find((item) => item.id === promptId);
    if (!prompt) return;

    const next = Number(stars);
    if (!Number.isInteger(next) || next < 1 || next > 5) return;

    const previous = prompt.rating || 0;
    const rating = toggleSame && previous === next ? 0 : next;
    if (rating === previous) return;

    prompt.rating = rating;
    touchMetadata(prompt);
    if (!persist()) {
      prompt.rating = previous;
      showToast("Could not save rating");
      return;
    }

    render();
    focusRatingStar(promptId, rating === 0 ? 1 : rating);
    showToast(rating === 0 ? "Rating cleared" : `Rated ${rating} star${rating === 1 ? "" : "s"}`);
  }

  function focusRatingStar(promptId, value) {
    const card = listEl.querySelector(`[data-prompt-id="${CSS.escape(promptId)}"]`);
    card?.querySelector(`.star[data-value="${value}"]`)?.focus();
  }

  function paintStars(row, rating) {
    row.querySelectorAll(".star").forEach((star) => {
      star.classList.toggle("is-filled", Number(star.dataset.value) <= rating);
    });
  }

  function ratingAriaLabel(rating, title) {
    const summary = rating ? `${rating} out of 5 stars` : "not rated";
    return `Rate “${title}”, ${summary}`;
  }

  function emptyState(heading, detail) {
    const wrap = el("div", "empty-state");
    const strong = el("strong");
    strong.textContent = heading;
    const p = el("p");
    p.textContent = detail;
    wrap.append(strong, p);
    return wrap;
  }

  function loadPrompts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(normalizePrompt) : [];
    } catch {
      return [];
    }
  }

  function normalizePrompt(prompt) {
    if (!prompt || typeof prompt !== "object") {
      return { id: createId(), title: "", content: "", createdAt: Date.now(), rating: 0, notes: [] };
    }
    const rating = Number(prompt.rating);
    return {
      ...prompt,
      rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : 0,
      notes: normalizeNotes(prompt.notes),
      metadata: normalizeMetadata(prompt),
    };
  }

  function normalizeMetadata(prompt) {
    try {
      if (prompt.metadata && typeof prompt.metadata === "object") {
        const model = assertModelName(String(prompt.metadata.model || "unknown"));
        const createdAt =
          typeof prompt.metadata.createdAt === "string" && ISO_8601.test(prompt.metadata.createdAt)
            ? prompt.metadata.createdAt
            : new Date(prompt.createdAt || Date.now()).toISOString();
        const updatedAt =
          typeof prompt.metadata.updatedAt === "string" && ISO_8601.test(prompt.metadata.updatedAt)
            ? prompt.metadata.updatedAt
            : createdAt;
        assertIso8601(createdAt, "createdAt");
        const updatedMs = assertIso8601(updatedAt, "updatedAt");
        const createdMs = Date.parse(createdAt);
        if (updatedMs < createdMs) {
          throw new Error("updatedAt must be greater than or equal to createdAt.");
        }
        const tokenEstimate =
          prompt.metadata.tokenEstimate && typeof prompt.metadata.tokenEstimate === "object"
            ? prompt.metadata.tokenEstimate
            : estimateTokens(prompt.content || "", false);
        return {
          model,
          createdAt,
          updatedAt,
          tokenEstimate: {
            min: Number(tokenEstimate.min) || 0,
            max: Number(tokenEstimate.max) || 0,
            confidence: ["high", "medium", "low"].includes(tokenEstimate.confidence)
              ? tokenEstimate.confidence
              : "high",
          },
        };
      }
      return trackModel("unknown", prompt.content || "", false);
    } catch {
      const now = new Date().toISOString();
      return {
        model: "unknown",
        createdAt: now,
        updatedAt: now,
        tokenEstimate: { min: 0, max: 0, confidence: "high" },
      };
    }
  }

  function metadataCreatedMs(prompt) {
    const iso = prompt?.metadata?.createdAt;
    const parsed = iso ? Date.parse(iso) : NaN;
    if (Number.isFinite(parsed)) return parsed;
    return Number(prompt.createdAt) || 0;
  }

  function assertIso8601(value, fieldName) {
    if (typeof value !== "string" || !ISO_8601.test(value)) {
      throw new Error(`${fieldName} must be a valid ISO 8601 string (YYYY-MM-DDTHH:mm:ss.sssZ).`);
    }
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${fieldName} must be a valid ISO 8601 string (YYYY-MM-DDTHH:mm:ss.sssZ).`);
    }
    return parsed;
  }

  function assertModelName(modelName) {
    if (typeof modelName !== "string") {
      throw new Error("Model name must be a non-empty string.");
    }
    const trimmed = modelName.trim();
    if (!trimmed) {
      throw new Error("Model name must be a non-empty string.");
    }
    if (trimmed.length > 100) {
      throw new Error("Model name must be at most 100 characters.");
    }
    return trimmed;
  }

  function estimateTokens(text, isCode) {
    try {
      if (typeof text !== "string") {
        throw new Error("Text must be a string.");
      }
      const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
      const characterCount = text.length;
      let min = 0.75 * wordCount;
      let max = 0.25 * characterCount;
      if (isCode) {
        min *= 1.3;
        max *= 1.3;
      }
      const midpoint = (min + max) / 2;
      let confidence = "high";
      if (midpoint > 5000) confidence = "low";
      else if (midpoint >= 1000) confidence = "medium";
      return { min, max, confidence };
    } catch (error) {
      throw error instanceof Error ? error : new Error("Could not estimate tokens.");
    }
  }

  function trackModel(modelName, content, isCode) {
    try {
      const model = assertModelName(modelName);
      if (typeof content !== "string") {
        throw new Error("Content must be a string.");
      }
      const createdAt = new Date().toISOString();
      assertIso8601(createdAt, "createdAt");
      return {
        model,
        createdAt,
        updatedAt: createdAt,
        tokenEstimate: estimateTokens(content, Boolean(isCode)),
      };
    } catch (error) {
      throw error instanceof Error ? error : new Error("Could not track model metadata.");
    }
  }

  function updateTimestamps(metadata) {
    try {
      if (!metadata || typeof metadata !== "object") {
        throw new Error("Metadata must be an object.");
      }
      const model = assertModelName(metadata.model);
      const createdMs = assertIso8601(metadata.createdAt, "createdAt");
      const updatedAt = new Date().toISOString();
      const updatedMs = assertIso8601(updatedAt, "updatedAt");
      if (updatedMs < createdMs) {
        throw new Error("updatedAt must be greater than or equal to createdAt.");
      }
      const tokenEstimate = metadata.tokenEstimate;
      if (
        !tokenEstimate ||
        typeof tokenEstimate !== "object" ||
        typeof tokenEstimate.min !== "number" ||
        typeof tokenEstimate.max !== "number" ||
        !["high", "medium", "low"].includes(tokenEstimate.confidence)
      ) {
        throw new Error("tokenEstimate must include min, max, and confidence.");
      }
      return {
        model,
        createdAt: metadata.createdAt,
        updatedAt,
        tokenEstimate: {
          min: tokenEstimate.min,
          max: tokenEstimate.max,
          confidence: tokenEstimate.confidence,
        },
      };
    } catch (error) {
      throw error instanceof Error ? error : new Error("Could not update timestamps.");
    }
  }

  function normalizeNotes(notes) {
    if (!Array.isArray(notes)) return [];
    return notes
      .filter((note) => note && typeof note === "object")
      .map((note) => ({
        id: typeof note.id === "string" && note.id ? note.id : createId(),
        text: typeof note.text === "string" ? note.text : "",
        updatedAt: Number(note.updatedAt) || Date.now(),
      }))
      .filter((note) => note.text.trim());
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
      return true;
    } catch {
      return false;
    }
  }

  function exportLibrary() {
    try {
      const payload = buildExportPayload(prompts);
      validateExportPayload(payload);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `prompt-library-${stamp}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(`Exported ${payload.stats.totalPrompts} prompt${payload.stats.totalPrompts === 1 ? "" : "s"}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not export library");
    }
  }

  function buildExportPayload(source) {
    const items = source.map((prompt) => ({
      id: prompt.id,
      title: prompt.title,
      content: prompt.content,
      createdAt: prompt.createdAt,
      rating: prompt.rating || 0,
      notes: prompt.notes || [],
      metadata: prompt.metadata,
    }));
    return {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      stats: computeStats(items),
      prompts: items,
    };
  }

  function computeStats(items) {
    const totalPrompts = items.length;
    const ratingSum = items.reduce((sum, prompt) => sum + (Number(prompt.rating) || 0), 0);
    const averageRating = totalPrompts === 0 ? 0 : Math.round((ratingSum / totalPrompts) * 100) / 100;
    const counts = new Map();
    items.forEach((prompt) => {
      const model = prompt.metadata?.model || "unknown";
      counts.set(model, (counts.get(model) || 0) + 1);
    });
    let mostUsedModel = null;
    let mostUsedCount = 0;
    counts.forEach((count, model) => {
      if (count > mostUsedCount || (count === mostUsedCount && mostUsedModel && model < mostUsedModel)) {
        mostUsedModel = model;
        mostUsedCount = count;
      } else if (!mostUsedModel) {
        mostUsedModel = model;
        mostUsedCount = count;
      }
    });
    return {
      totalPrompts,
      averageRating,
      mostUsedModel,
    };
  }

  function validateExportPayload(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("Export payload is invalid.");
    }
    if (payload.version !== EXPORT_VERSION) {
      throw new Error(`Unsupported export version: ${payload.version}.`);
    }
    if (typeof payload.exportedAt !== "string" || !Number.isFinite(Date.parse(payload.exportedAt))) {
      throw new Error("Export timestamp is missing or invalid.");
    }
    if (!payload.stats || typeof payload.stats !== "object") {
      throw new Error("Export statistics are missing.");
    }
    if (!Array.isArray(payload.prompts)) {
      throw new Error("Export must include a prompts array.");
    }
    const ids = new Set();
    payload.prompts.forEach((prompt, index) => {
      if (!prompt || typeof prompt !== "object") {
        throw new Error(`Prompt at index ${index} is invalid.`);
      }
      if (typeof prompt.id !== "string" || !prompt.id) {
        throw new Error(`Prompt at index ${index} is missing an id.`);
      }
      if (ids.has(prompt.id)) {
        throw new Error(`Duplicate prompt id in export: ${prompt.id}.`);
      }
      ids.add(prompt.id);
      if (typeof prompt.title !== "string" || typeof prompt.content !== "string") {
        throw new Error(`Prompt ${prompt.id} is missing title or content.`);
      }
    });
    if (payload.stats.totalPrompts !== payload.prompts.length) {
      throw new Error("Export statistics do not match the prompts array.");
    }
  }

  async function handleImportFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("The file is not valid JSON.");
      }

      const payload = normalizeImportPayload(parsed);
      validateExportPayload(payload);
      pendingImport = { payload, stage: "choose" };

      importErrorEl.hidden = true;
      importErrorEl.textContent = "";
      importCopy.textContent = `“${file.name}” contains ${payload.stats.totalPrompts} prompt${
        payload.stats.totalPrompts === 1 ? "" : "s"
      }. Choose merge to keep existing prompts, or replace to overwrite this library.`;
      importStatsEl.replaceChildren(
        statItem(`Version ${payload.version}`),
        statItem(`Exported ${formatDateTime(payload.exportedAt)}`),
        statItem(`${payload.stats.totalPrompts} prompts`),
        statItem(`Average rating ${payload.stats.averageRating}`),
        statItem(`Most used model: ${payload.stats.mostUsedModel || "none"}`)
      );
      importDialog.showModal();
    } catch (error) {
      pendingImport = null;
      importFileInput.value = "";
      showToast(error instanceof Error ? error.message : "Could not read import file");
    }
  }

  function normalizeImportPayload(parsed) {
    if (Array.isArray(parsed)) {
      const prompts = parsed.map(normalizePrompt);
      return {
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        stats: computeStats(prompts),
        prompts,
      };
    }
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Import file must be a JSON object.");
    }
    if (typeof parsed.version !== "number" || parsed.version > EXPORT_VERSION) {
      throw new Error(`Unsupported import version: ${parsed.version}.`);
    }
    if (parsed.version < 1) {
      throw new Error("Import version must be 1 or greater.");
    }
    if (!Array.isArray(parsed.prompts)) {
      throw new Error("Import file is missing a prompts array.");
    }
    const prompts = parsed.prompts.map(normalizePrompt);
    return {
      version: EXPORT_VERSION,
      exportedAt:
        typeof parsed.exportedAt === "string" && Number.isFinite(Date.parse(parsed.exportedAt))
          ? parsed.exportedAt
          : new Date().toISOString(),
      stats: computeStats(prompts),
      prompts,
    };
  }

  function startMergeImport() {
    if (!pendingImport) return;
    const incoming = pendingImport.payload.prompts;
    const existingIds = new Set(prompts.map((prompt) => prompt.id));
    const duplicates = incoming.filter((prompt) => existingIds.has(prompt.id));

    if (duplicates.length === 0) {
      applyImport({ mode: "merge", duplicates: "skip" });
      return;
    }

    pendingImport.stage = "conflict";
    pendingImport.duplicates = duplicates;
    importDialog.close();
    conflictCopy.textContent = `${duplicates.length} imported prompt${
      duplicates.length === 1 ? "" : "s"
    } share an ID with your library. Keep the local copies, or replace them with the imported versions.`;
    conflictListEl.replaceChildren(
      ...duplicates.slice(0, 8).map((prompt) => {
        const local = prompts.find((item) => item.id === prompt.id);
        return statItem(`${local?.title || prompt.title} (${prompt.id.slice(0, 8)}…)`);
      })
    );
    if (duplicates.length > 8) {
      conflictListEl.append(statItem(`and ${duplicates.length - 8} more`));
    }
    conflictDialog.showModal();
  }

  function applyImport({ mode, duplicates = "skip" }) {
    if (!pendingImport) return;

    const incoming = pendingImport.payload.prompts.map(normalizePrompt);
    const previous = prompts;
    const backupOk = backupLibrary();
    if (!backupOk) {
      showImportError("Could not back up the current library before import.");
      return;
    }

    try {
      let next;
      if (mode === "replace") {
        next = incoming;
      } else {
        const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]));
        incoming.forEach((prompt) => {
          if (byId.has(prompt.id)) {
            if (duplicates === "overwrite") byId.set(prompt.id, prompt);
            return;
          }
          byId.set(prompt.id, prompt);
        });
        next = Array.from(byId.values());
      }

      next.forEach((prompt, index) => {
        if (!prompt.id || typeof prompt.title !== "string" || typeof prompt.content !== "string") {
          throw new Error(`Imported prompt at index ${index} is incomplete.`);
        }
      });

      prompts = next;
      if (!persist()) {
        throw new Error("Could not save imported prompts to localStorage.");
      }

      pendingImport = null;
      importFileInput.value = "";
      importDialog.close();
      conflictDialog.close();
      render();
      const verb = mode === "replace" ? "Replaced library with" : "Merged";
      showToast(`${verb} ${incoming.length} prompt${incoming.length === 1 ? "" : "s"}`);
    } catch (error) {
      const restored = restoreLibrary(previous);
      prompts = restored;
      persist();
      render();
      const detail = error instanceof Error ? error.message : "Import failed.";
      showImportError(`${detail}${restored === previous ? " Previous library restored." : ""}`);
    }
  }

  function backupLibrary() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      localStorage.setItem(BACKUP_KEY, raw == null ? JSON.stringify(prompts) : raw);
      return true;
    } catch {
      return false;
    }
  }

  function restoreLibrary(fallback) {
    try {
      const raw = localStorage.getItem(BACKUP_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(normalizePrompt) : fallback;
    } catch {
      return fallback;
    }
  }

  function showImportError(message) {
    if (conflictDialog.open) {
      conflictDialog.close();
      importDialog.showModal();
    }
    importErrorEl.hidden = false;
    importErrorEl.textContent = message;
    showToast(message);
  }

  function statItem(text) {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }

  function showFormError(message) {
    formError.hidden = false;
    formError.textContent = message;
  }

  function hideFormError() {
    formError.hidden = true;
    formError.textContent = "";
  }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  function createId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `p_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function formatDate(timestamp) {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(timestamp));
  }

  function formatDateTime(isoOrMs) {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(isoOrMs));
  }

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function iconButton(label, svg) {
    const button = el("button", "icon-btn");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.append(svg);
    return button;
  }

  function starIcon() {
    const svg = svgEl("0 0 16 16");
    svg.append(
      pathEl("M8 1.4 9.94 5.33l4.36.64-3.15 3.07.74 4.32L8 11.32l-3.89 2.04.74-4.32-3.15-3.07 4.36-.64L8 1.4Z")
    );
    return svg;
  }

  function copyIcon() {
    const svg = svgEl("0 0 16 16");
    svg.append(
      pathEl("M6 3.5h6.5A1.5 1.5 0 0 1 14 5v6.5A1.5 1.5 0 0 1 12.5 13H6A1.5 1.5 0 0 1 4.5 11.5V5A1.5 1.5 0 0 1 6 3.5Z"),
      pathEl("M3.5 10.5H3A1.5 1.5 0 0 1 1.5 9V3A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5")
    );
    return svg;
  }

  function trashIcon() {
    const svg = svgEl("0 0 16 16");
    svg.append(
      pathEl("M3 4.5h10"),
      pathEl("M6.2 4.5V3.4A1.4 1.4 0 0 1 7.6 2h.8a1.4 1.4 0 0 1 1.4 1.4v1.1"),
      pathEl("M5 4.5h6l-.4 8.1A1.5 1.5 0 0 1 9.1 14H6.9A1.5 1.5 0 0 1 5.4 12.6L5 4.5Z")
    );
    return svg;
  }

  function svgEl(viewBox) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    return svg;
  }

  function pathEl(d) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.4");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    return path;
  }
})();
