(() => {
  const STORAGE_KEY = "prompt-library.prompts";

  const form = document.getElementById("prompt-form");
  const titleInput = document.getElementById("prompt-title");
  const contentInput = document.getElementById("prompt-content");
  const charCount = document.getElementById("char-count");
  const formError = document.getElementById("form-error");
  const listEl = document.getElementById("prompt-list");
  const countEl = document.getElementById("prompt-count");
  const searchInput = document.getElementById("search-input");
  const toastEl = document.getElementById("toast");
  const dialog = document.getElementById("confirm-dialog");
  const confirmCopy = document.getElementById("confirm-copy");
  const confirmDeleteBtn = document.getElementById("confirm-delete");
  const cancelDeleteBtn = document.getElementById("cancel-delete");
  const shortcut = document.querySelector(".shortcut");

  let prompts = loadPrompts();
  let pendingDeleteId = null;
  let toastTimer = null;

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

  render();

  function savePrompt() {
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();

    if (!title || !content) {
      showFormError("Add both a title and content before saving.");
      return;
    }

    prompts.unshift({
      id: createId(),
      title,
      content,
      createdAt: Date.now(),
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
    const visible = query
      ? prompts.filter(
          (prompt) =>
            prompt.title.toLowerCase().includes(query) ||
            prompt.content.toLowerCase().includes(query)
        )
      : prompts;

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

    const title = el("h3");
    title.textContent = prompt.title;

    const body = el("p", "prompt-body");
    body.textContent = prompt.content;

    const meta = el("div", "prompt-meta");
    const date = el("time");
    date.dateTime = new Date(prompt.createdAt).toISOString();
    date.textContent = formatDate(prompt.createdAt);

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
    meta.append(date, actions);
    card.append(title, body, meta);
    return card;
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
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
      return true;
    } catch {
      return false;
    }
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
