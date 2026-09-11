/* ===================================================================
   NoveCard — app.js
   Decks are persisted to localStorage, so flashcards stay on this
   device (phone, tablet, or desktop browser) across sessions.
=================================================================== */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .catch(err => console.error('Service worker registration failed:', err));
  });
}

(function(){
  "use strict";

  /* ---------------- data ---------------- */
  const COLORS = ["#3E6FA8","#5C8A5A","#B4703E","#8A5FA8","#C1533F","#3F9098"];
  const STORAGE_KEY = "novecard_decks_v1";

  let decks = [];           // {id,name,color,favorite,deletedAt,folderId,cards:[card]}
  let folders = [];         // {id,type:"folder",name,color,favorite,deletedAt}
  let uid = 1;
  const nextId = () => "id" + (uid++);

  function loadDecks(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.decks)){
        decks = parsed.decks.map(d => Object.assign({ folderId: null }, d));
        if (Array.isArray(parsed.folders)) folders = parsed.folders.map(f => Object.assign({ folderId: null }, f));
        if (typeof parsed.uid === "number") uid = parsed.uid;
      }
    } catch(err){
      console.error("Couldn't load saved flashcards:", err);
    }
  }

  function saveDecks(){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ decks, folders, uid }));
    } catch(err){
      console.error("Couldn't save flashcards:", err);
      showToast("Couldn't save — device storage is full");
    }
  }

  function newCard(){
    return { id: nextId(), question: { elements: [] }, answer: { elements: [] } };
  }
  function newDeck(name){
    return {
      id: nextId(),
      name: name || "Untitled",
      color: COLORS[(decks.length + folders.length) % COLORS.length],
      favorite: false,
      deletedAt: null,
      folderId: null,
      cards: [ newCard() ]
    };
  }
  function newFolder(name, parentId){
    return {
      id: nextId(),
      type: "folder",
      name: name || "New Folder",
      color: COLORS[(decks.length + folders.length) % COLORS.length],
      favorite: false,
      deletedAt: null,
      folderId: parentId || null   // parent folder id — folders can nest
    };
  }

  /* ---------------- helpers ---------------- */
  const $ = (sel, ctx) => (ctx||document).querySelector(sel);
  const $all = (sel, ctx) => Array.from((ctx||document).querySelectorAll(sel));
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

  function showToast(msg){
    let t = $("#toast");
    if (!t){ t = el("div","toast"); t.id="toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(()=>t.classList.remove("show"), 1600);
  }

  function closeAllPopovers(){
    $all(".popover").forEach(p=>p.classList.add("hidden"));
    $("#scrim").classList.add("hidden");
  }
  function openPopover(pop, anchorRect){
    closeAllPopovers();
    $("#scrim").classList.remove("hidden");
    pop.classList.remove("hidden");
    // position, keeping inside viewport
    const margin = 10;
    pop.style.visibility = "hidden";
    pop.style.display = "block";
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = anchorRect.left;
    let top = anchorRect.bottom + 8;
    if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
    if (left < margin) left = margin;
    if (top + ph > window.innerHeight - margin) top = anchorRect.top - ph - 8;
    pop.style.left = left + "px";
    pop.style.top = top + "px";
    pop.style.visibility = "visible";
  }
  $("#scrim").addEventListener("click", closeAllPopovers);

  /* ---------------- view routing ---------------- */
  const views = {
    home: $("#view-home"),
    favorites: $("#view-favorites"),
    trash: $("#view-trash"),
    study: $("#view-study"),
    editor: $("#view-editor"),
  };
  let activeViewName = "home";
  function showView(name){
    Object.values(views).forEach(v=>v.classList.add("hidden"));
    views[name].classList.remove("hidden");
    activeViewName = name;
    refreshChrome();
  }
  // Shows/hides the bottom nav + fab based on the current view AND whether
  // multi-select mode is active (the floating selection toolbar takes their place).
  function refreshChrome(){
    const showNav = (activeViewName === "home" || activeViewName === "favorites" || activeViewName === "trash");
    const selecting = selection.active;
    $("#bottom-nav").classList.toggle("hidden", !showNav || selecting);
    $("#fab").classList.toggle("hidden", !showNav || selecting);
    if (showNav){
      // Folders live inside the Home view, so "Home" stays highlighted while inside one.
      $all(".nav-btn").forEach(b=>b.classList.toggle("active", b.dataset.view === activeViewName));
    }
  }

  // Set while a flashcard is mid-drag so the tap-to-open click that
  // follows pointerup on the same card doesn't also fire.
  let suppressNextCardClick = false;

  /* ---------------- home / favorites / trash rendering ---------------- */
  function cardIconSVG(){
    return '<svg class="icon" viewBox="0 0 24 24" fill="none"><path d="M6 9V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M2 9h12v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  }
  function starIconSVG(){
    return '<svg viewBox="0 0 24 24"><path d="M12 4.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 4.5Z"/></svg>';
  }
  function chevronSVG(){
    return '<svg class="icon" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function chevronRightSVG(){
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function checkIconSVG(){
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /* ---------------- multi-select state ----------------
     context is "library" (Home + inside folders) or "trash".
     ids holds item.id values — decks and folders share one id
     counter (nextId), so a bare id is unambiguous. */
  let selection = { active:false, context:null, ids:new Set() };
  function folderFaceSVG(color){
    return '<svg class="folder-shape" viewBox="2 4 20 16" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">'
      + '<path d="M3 8.2C3 7.07989 3 6.51984 3.21799 6.09202C3.40973 5.71569 3.71569 5.40973 4.09202 5.21799C4.51984 5 5.0799 5 6.2 5H9.67452C10.1637 5 10.4083 5 10.6385 5.05526C10.8425 5.10425 11.0376 5.18506 11.2166 5.29472C11.4184 5.4184 11.5914 5.59135 11.9373 5.93726L12.0627 6.06274C12.4086 6.40865 12.5816 6.5816 12.7834 6.70528C12.9624 6.81494 13.1575 6.89575 13.3615 6.94474C13.5917 7 13.8363 7 14.3255 7H17.8C18.9201 7 19.4802 7 19.908 7.21799C20.2843 7.40973 20.5903 7.71569 20.782 8.09202C21 8.51984 21 9.0799 21 10.2V15.8C21 16.9201 21 17.4802 20.782 17.908C20.5903 18.2843 20.2843 18.5903 19.908 18.782C19.4802 19 18.9201 19 17.8 19H6.2C5.07989 19 4.51984 19 4.09202 18.782C3.71569 18.5903 3.40973 18.2843 3.21799 17.908C3 17.4802 3 16.9201 3 15.8V8.2Z"'
      + ' fill="' + color + '"/></svg>';
  }

  function buildDeckCard(item, opts){
    opts = opts || {};
    const isFolder = item.type === "folder";
    const context = opts.trash ? "trash" : "library";
    const inSelectMode = selection.active && selection.context === context;
    const isSelected = inSelectMode && selection.ids.has(item.id);

    const wrap = el("div","deck-card");
    wrap.dataset.id = item.id;
    wrap.dataset.type = isFolder ? "folder" : "deck";
    if (inSelectMode) wrap.classList.add("selectable");
    if (isSelected) wrap.classList.add("selected");

    const face = el("div","deck-card-face" + (isFolder ? " deck-card-face--folder" : ""));
    if (isFolder){
      face.innerHTML = folderFaceSVG(item.color);
    } else {
      face.style.background = item.color;
    }
    if (isFolder){
      const n = decks.filter(d=>!d.deletedAt && d.folderId === item.id).length;
      const count = el("span","deck-card-count");
      count.textContent = n + (n === 1 ? " flashcard" : " flashcards");
      face.appendChild(count);
    } else {
      const count = el("span","deck-card-count");
      count.textContent = item.cards.length + (item.cards.length === 1 ? " card" : " cards");
      face.appendChild(count);
    }
    if (item.favorite){
      const fav = el("div","deck-card-fav");
      fav.innerHTML = starIconSVG();
      face.appendChild(fav);
    }
    if (inSelectMode){
      const check = el("div","select-check");
      check.innerHTML = checkIconSVG();
      face.appendChild(check);
    }
    wrap.appendChild(face);

    const label = el("div","deck-card-label");
    const nameSpan = el("span"); nameSpan.textContent = item.name;
    label.appendChild(nameSpan);
    if (!inSelectMode){
      const chevBtn = el("button");
      chevBtn.type="button";
      chevBtn.style.cssText = "border:none;background:transparent;display:flex;cursor:pointer;padding:2px;color:inherit;";
      chevBtn.innerHTML = chevronSVG();
      chevBtn.title = "Options";
      label.appendChild(chevBtn);
      label.title = "Options";
      label.addEventListener("click", (e)=>{
        e.stopPropagation();
        if (opts.trash) openTrashMenu(item, wrap);
        else if (isFolder) openFolderMenu(item, wrap);
        else openDeckMenu(item, wrap);
      });
    }
    wrap.appendChild(label);

    if (inSelectMode){
      wrap.addEventListener("click", ()=>{
        toggleSelect(item.id);
      });
    } else {
      wrap.addEventListener("click", ()=>{
        if (suppressNextCardClick){ suppressNextCardClick = false; return; }
        if (opts.trash) return;
        if (isFolder) openFolderView(item);
        else openStudy(item);
      });
      // Folders themselves can't be dragged — only flashcards can be
      // dragged onto a folder to move them into it.
      if (!opts.trash && !isFolder) attachDeckDrag(wrap, item);
    }
    return wrap;
  }

  function renderAll(){
    saveDecks();
    renderHome();
    renderFavorites();
    renderTrash();
  }

  // Returns exactly what's on screen in the Home grid right now — either the
  // contents of the open folder (sub-folders + flashcards), or the top-level
  // list — respecting the current search query. Shared by renderHome() and "select all".
  function getVisibleLibraryItems(){
    const q = ($("#search-input").value || "").trim().toLowerCase();
    if (currentFolder){
      const childFolders = folders.filter(f=>!f.deletedAt && f.folderId === currentFolder.id && f.name.toLowerCase().includes(q));
      const childDecks = decks.filter(d=>!d.deletedAt && d.folderId === currentFolder.id && d.name.toLowerCase().includes(q));
      return [...childFolders, ...childDecks];
    }
    const folderList = folders.filter(f=>{
      if (f.deletedAt || !f.name.toLowerCase().includes(q)) return false;
      return q ? true : !f.folderId; // searching also reaches into nested folders
    });
    const deckList = decks.filter(d=>{
      if (d.deletedAt || !d.name.toLowerCase().includes(q)) return false;
      return q ? true : d.folderId === null; // searching also reaches into folders
    });
    return [...folderList, ...deckList];
  }
  function getVisibleTrashItems(){
    // Items trashed automatically because a parent folder was trashed are
    // hidden here — restoring/deleting the top trashed folder handles them.
    return [
      ...folders.filter(f=>f.deletedAt && !f._trashedWithFolder),
      ...decks.filter(d=>d.deletedAt && !d._trashedWithFolder)
    ];
  }

  function renderHome(){
    const grid = $("#deck-grid");
    grid.innerHTML = "";
    const list = getVisibleLibraryItems();
    list.forEach(d=> grid.appendChild(buildDeckCard(d)));
    grid.classList.toggle("has-items", list.length>0);
    $("#home-empty").textContent = currentFolder ? "No flashcards in this folder yet" : "No flashcards yet\u2026";
    $("#home-empty").style.display = list.length ? "none" : "block";
    renderCrumb();
  }
  // Walks a folder's parent chain (via folderId) back up to the root,
  // so nested folders get a full "Home > Parent > Child" trail.
  function folderPath(folder){
    const path = [];
    let f = folder, guard = 0;
    while (f && guard++ < 100){
      path.unshift(f);
      f = f.folderId ? folders.find(x=>x.id === f.folderId) : null;
    }
    return path;
  }
  function goToFolder(folder){
    exitSelectMode();
    currentFolder = folder;
    renderHome();
  }
  function renderCrumb(){
    const wrap = $("#crumb-left");
    wrap.innerHTML = "";
    const path = currentFolder ? folderPath(currentFolder) : [];

    const homeBtn = el("button","crumb-home" + (path.length ? "" : " is-current"));
    homeBtn.type = "button";
    homeBtn.textContent = "Home";
    if (path.length){
      homeBtn.addEventListener("click", ()=> goToFolder(null));
    }
    wrap.appendChild(homeBtn);

    path.forEach((f, i)=>{
      const sep = el("span","crumb-sep");
      sep.innerHTML = chevronRightSVG();
      wrap.appendChild(sep);
      const isLast = i === path.length - 1;
      if (isLast){
        const cur = el("span","crumb-current");
        cur.textContent = f.name;
        wrap.appendChild(cur);
      } else {
        const btn = el("button","crumb-home");
        btn.type = "button";
        btn.textContent = f.name;
        btn.addEventListener("click", ()=> goToFolder(f));
        wrap.appendChild(btn);
      }
    });
  }
  function renderFavorites(){
    const grid = $("#fav-grid");
    grid.innerHTML = "";
    const list = [
      ...folders.filter(f=>!f.deletedAt && f.favorite),
      ...decks.filter(d=>!d.deletedAt && d.favorite)
    ];
    list.forEach(d=> grid.appendChild(buildDeckCard(d)));
    grid.classList.toggle("has-items", list.length>0);
    $("#fav-empty").style.display = list.length ? "none" : "block";
  }
  function renderTrash(){
    const grid = $("#trash-grid");
    grid.innerHTML = "";
    const list = getVisibleTrashItems();
    list.forEach(d=> grid.appendChild(buildDeckCard(d, {trash:true})));
    grid.classList.toggle("has-items", list.length>0);
    $("#trash-empty").style.display = list.length ? "none" : "block";
  }

  /* ---------------- cascading folder trash / restore / delete ----------------
     Folders can nest, so trashing, restoring, or permanently deleting one
     has to walk every folder and flashcard beneath it too. */
  function cascadeTrashFolder(folder, ts){
    folder.deletedAt = ts;
    decks.forEach(d=>{
      if (d.folderId === folder.id && !d.deletedAt){
        d.deletedAt = ts;
        d._trashedWithFolder = folder.id;
      }
    });
    folders.forEach(f=>{
      if (f.folderId === folder.id && !f.deletedAt){
        f._trashedWithFolder = folder.id;
        cascadeTrashFolder(f, ts);
      }
    });
  }
  function cascadeRestoreFolder(folder){
    folder.deletedAt = null;
    decks.forEach(d=>{
      if (d._trashedWithFolder === folder.id){
        d.deletedAt = null;
        delete d._trashedWithFolder;
      }
    });
    folders.forEach(f=>{
      if (f._trashedWithFolder === folder.id){
        delete f._trashedWithFolder;
        cascadeRestoreFolder(f);
      }
    });
  }
  // Every folder id nested (at any depth) under rootId, including rootId itself.
  function collectFolderIds(rootId){
    const ids = [rootId];
    let changed = true;
    while (changed){
      changed = false;
      folders.forEach(f=>{
        if (f.folderId && ids.indexOf(f.folderId) > -1 && ids.indexOf(f.id) === -1){
          ids.push(f.id);
          changed = true;
        }
      });
    }
    return ids;
  }
  function purgeFolderForever(folder){
    const ids = collectFolderIds(folder.id);
    decks = decks.filter(d=> ids.indexOf(d.folderId) === -1);
    folders = folders.filter(f=> ids.indexOf(f.id) === -1);
  }

  /* ---------------- folder view (lives inside Home) ---------------- */
  let currentFolder = null;
  function openFolderView(folder){
    exitSelectMode();
    currentFolder = folder;
    renderHome();
    showView("home");
  }

  /* ---------------- multi-select mode (Home/folders + Trash) ---------------- */
  function enterSelectMode(context){
    selection = { active:true, context, ids:new Set() };
    if (context === "library") renderHome(); else renderTrash();
    updateSelectionToolbar();
  }
  function exitSelectMode(){
    if (!selection.active) return;
    selection = { active:false, context:null, ids:new Set() };
    renderHome();
    renderTrash();
    updateSelectionToolbar();
  }
  function toggleSelect(id){
    if (selection.ids.has(id)) selection.ids.delete(id);
    else selection.ids.add(id);
    if (selection.context === "library") renderHome(); else renderTrash();
    updateSelectionToolbar();
  }
  function selectAllVisible(){
    const items = selection.context === "library" ? getVisibleLibraryItems() : getVisibleTrashItems();
    items.forEach(it=> selection.ids.add(it.id));
    if (selection.context === "library") renderHome(); else renderTrash();
    updateSelectionToolbar();
  }
  function updateSelectionToolbar(){
    const active = selection.active;
    $("#home-selection-toolbar").classList.toggle("hidden", !(active && selection.context === "library"));
    $("#trash-selection-toolbar").classList.toggle("hidden", !(active && selection.context === "trash"));
    $("#home-select-toggle").classList.toggle("active", active && selection.context === "library");
    $("#trash-select-toggle").classList.toggle("active", active && selection.context === "trash");
    refreshChrome();
  }

  $("#home-select-toggle").addEventListener("click", ()=>{
    if (selection.active && selection.context === "library") exitSelectMode();
    else enterSelectMode("library");
  });
  $("#trash-select-toggle").addEventListener("click", ()=>{
    if (selection.active && selection.context === "trash") exitSelectMode();
    else enterSelectMode("trash");
  });

  /* library (home/folder) selection toolbar: Cancel · Move · Select all · Delete */
  let bulkMoveTargets = null;
  $("#home-selection-toolbar").addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "cancel"){
      exitSelectMode();
    } else if (action === "select-all"){
      selectAllVisible();
    } else if (action === "move"){
      if (!selection.ids.size){ showToast("Select something to move first"); return; }
      const selDecks = decks.filter(d=> selection.ids.has(d.id));
      const selFolders = folders.filter(f=> selection.ids.has(f.id));
      if (!selDecks.length){
        showToast(selFolders.length ? "Folders can\u2019t be moved into another folder" : "Select something to move first");
        return;
      }
      openBulkMoveMenu(selDecks, selFolders.length, btn.getBoundingClientRect());
    } else if (action === "delete"){
      if (!selection.ids.size) return;
      const ids = Array.from(selection.ids);
      const ts = Date.now();
      ids.forEach(id=>{
        const folder = folders.find(f=>f.id === id && !f.deletedAt);
        if (folder){ cascadeTrashFolder(folder, ts); return; }
        const deck = decks.find(d=>d.id === id && !d.deletedAt);
        if (deck) deck.deletedAt = ts;
      });
      const count = ids.length;
      exitSelectMode();
      renderAll();
      showToast(count + (count === 1 ? " item moved to trash" : " items moved to trash"));
    }
  });

  function openBulkMoveMenu(deckArr, skippedFolderCount, rect){
    bulkMoveTargets = deckArr;
    const list = $("#move-list");
    list.innerHTML = "";
    list.appendChild(buildBulkMoveItem("Remove from folder", null, null));
    const avail = folders.filter(f=>!f.deletedAt);
    if (!avail.length){
      const empty = el("div","move-empty");
      empty.textContent = "No folders yet \u2014 create one from the + menu";
      list.appendChild(empty);
    } else {
      avail.forEach(f=> list.appendChild(buildBulkMoveItem(f.name, f.id, f.color)));
    }
    if (skippedFolderCount) showToast("Folders in your selection won\u2019t be moved");
    openPopover($("#move-menu"), rect);
  }
  function buildBulkMoveItem(label, folderId, color){
    const btn = el("button","popover-item");
    btn.type = "button";
    const dot = el("span","dot");
    if (color) dot.style.background = color;
    btn.appendChild(dot);
    const span = el("span"); span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener("click", ()=>{
      if (!bulkMoveTargets) return;
      const count = bulkMoveTargets.length;
      bulkMoveTargets.forEach(d=> d.folderId = folderId);
      bulkMoveTargets = null;
      closeAllPopovers();
      exitSelectMode();
      renderAll();
      showToast(folderId ? count + " moved to \u201c" + label + "\u201d" : count + " removed from folder");
    });
    return btn;
  }

  /* trash selection toolbar: Cancel · Restore · Delete forever */
  $("#trash-selection-toolbar").addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "cancel"){
      exitSelectMode();
    } else if (action === "restore"){
      if (!selection.ids.size) return;
      const ids = Array.from(selection.ids);
      ids.forEach(id=>{
        const folder = folders.find(f=>f.id === id);
        if (folder){ cascadeRestoreFolder(folder); return; }
        const deck = decks.find(d=>d.id === id);
        if (deck) deck.deletedAt = null;
      });
      const count = ids.length;
      exitSelectMode();
      renderAll();
      showToast(count + (count === 1 ? " item restored" : " items restored"));
    } else if (action === "delete-forever"){
      if (!selection.ids.size) return;
      const count = selection.ids.size;
      const msg = "Delete " + count + " item" + (count === 1 ? "" : "s") + " forever? This can\u2019t be undone.";
      if (confirm(msg)){
        const ids = Array.from(selection.ids);
        ids.forEach(id=>{
          const folder = folders.find(f=>f.id === id);
          if (folder){ purgeFolderForever(folder); return; }
          decks = decks.filter(d=> d.id !== id);
        });
        exitSelectMode();
        renderAll();
      }
    }
  });

  /* ---------------- drag a flashcard onto a folder to move it ---------------- */
  function attachDeckDrag(wrap, deck){
    wrap.addEventListener("pointerdown", (e)=>{
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const startX = e.clientX, startY = e.clientY;
      const rect = wrap.getBoundingClientRect();
      const offsetX = startX - rect.left, offsetY = startY - rect.top;
      let dragging = false, ghost = null;

      function clearTargets(){
        $all('.deck-card[data-type="folder"]').forEach(f=>f.classList.remove("drop-target"));
      }
      function onMove(ev){
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (!dragging){
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          dragging = true;
          wrap.classList.add("dragging-source");
          ghost = wrap.cloneNode(true);
          ghost.classList.add("deck-card--ghost");
          ghost.style.cssText = "position:fixed;pointer-events:none;z-index:80;opacity:.9;width:"+rect.width+"px;transform:scale(1.05);left:0;top:0;";
          document.body.appendChild(ghost);
        }
        if (dragging) ev.preventDefault();
        if (ghost){
          ghost.style.left = (ev.clientX - offsetX) + "px";
          ghost.style.top = (ev.clientY - offsetY) + "px";
        }
        clearTargets();
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const folderCard = target && target.closest && target.closest('.deck-card[data-type="folder"]');
        if (folderCard) folderCard.classList.add("drop-target");
      }
      function onUp(ev){
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        wrap.classList.remove("dragging-source");
        if (ghost) ghost.remove();
        clearTargets();
        if (dragging){
          suppressNextCardClick = true;
          const target = document.elementFromPoint(ev.clientX, ev.clientY);
          const folderCard = target && target.closest && target.closest('.deck-card[data-type="folder"]');
          if (folderCard){
            const folder = folders.find(f=>f.id === folderCard.dataset.id);
            if (folder && deck.folderId !== folder.id){
              deck.folderId = folder.id;
              renderAll();
              showToast("Moved into \u201c" + folder.name + "\u201d");
            }
          }
        }
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  }

  $("#search-input").addEventListener("input", renderHome);

  /* ---------------- bottom nav ---------------- */
  $all(".nav-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      exitSelectMode();
      currentFolder = null;
      showView(btn.dataset.view);
    });
  });

  /* ---------------- fab menu ---------------- */
  $("#fab").addEventListener("click", ()=>{
    openPopover($("#fab-menu"), $("#fab").getBoundingClientRect());
  });
  $("#menu-new-flashcard").addEventListener("click", ()=>{
    closeAllPopovers();
    openEditor({ mode:"new", folderId: currentFolder ? currentFolder.id : null });
  });
  $("#menu-new-folder").addEventListener("click", ()=>{
    closeAllPopovers();
    const folder = newFolder(null, currentFolder ? currentFolder.id : null);
    folders.push(folder);
    renderAll();
    showView("home");
    requestAnimationFrame(()=>{
      const cardEl = document.querySelector('.deck-card[data-type="folder"][data-id="'+folder.id+'"]');
      if (cardEl) openRenameBox(folder, cardEl.getBoundingClientRect());
    });
  });

  /* ---------------- deck options popover ---------------- */
  let activeDeckForMenu = null;
  let activeDeckCardEl = null;
  function openDeckMenu(deck, cardEl){
    activeDeckForMenu = deck;
    activeDeckCardEl = cardEl;
    const favLabel = $("#deck-menu [data-favorite-label]");
    favLabel.textContent = deck.favorite ? "Unfavorite" : "Favorite";
    openPopover($("#deck-menu"), cardEl.getBoundingClientRect());
  }
  $("#deck-menu").addEventListener("click", (e)=>{
    const btn = e.target.closest(".popover-item");
    if (!btn || btn.disabled || !activeDeckForMenu) return;
    const deck = activeDeckForMenu;
    const action = btn.dataset.action;
    if (action === "color"){
      openColorPicker(deck, activeDeckCardEl.getBoundingClientRect());
    } else if (action === "rename"){
      openRenameBox(deck, activeDeckCardEl.getBoundingClientRect());
    } else if (action === "favorite"){
      deck.favorite = !deck.favorite;
      closeAllPopovers();
      renderAll();
      showToast(deck.favorite ? "Added to favorites" : "Removed from favorites");
    } else if (action === "move"){
      openMoveMenu(deck, activeDeckCardEl.getBoundingClientRect());
    } else if (action === "delete"){
      closeAllPopovers();
      deck.deletedAt = Date.now();
      renderAll();
      showToast("Moved to trash");
    }
  });

  /* ---------------- move-to-folder popover ---------------- */
  let activeDeckForMove = null;
  function openMoveMenu(deck, rect){
    activeDeckForMove = deck;
    const list = $("#move-list");
    list.innerHTML = "";
    if (deck.folderId){
      const cur = folders.find(f=>f.id === deck.folderId);
      list.appendChild(buildMoveItem("Remove from \u201c" + (cur ? cur.name : "folder") + "\u201d", null, null, true));
    }
    const avail = folders.filter(f=>!f.deletedAt && f.id !== deck.folderId);
    if (!avail.length){
      const empty = el("div","move-empty");
      empty.textContent = "No folders yet — create one from the + menu";
      list.appendChild(empty);
    } else {
      avail.forEach(f=> list.appendChild(buildMoveItem(f.name, f.id, f.color)));
    }
    openPopover($("#move-menu"), rect);
  }
  function buildMoveItem(label, folderId, color, danger){
    const btn = el("button","popover-item" + (danger ? " danger" : ""));
    btn.type = "button";
    const dot = el("span","dot");
    if (color) dot.style.background = color;
    btn.appendChild(dot);
    const span = el("span"); span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener("click", ()=>{
      if (!activeDeckForMove) return;
      activeDeckForMove.folderId = folderId;
      closeAllPopovers();
      renderAll();
      showToast(folderId ? "Moved to \u201c" + label + "\u201d" : "Removed from folder");
    });
    return btn;
  }

  /* ---------------- folder options popover ---------------- */
  let activeFolderForMenu = null;
  let activeFolderCardEl = null;
  function openFolderMenu(folder, cardEl){
    activeFolderForMenu = folder;
    activeFolderCardEl = cardEl;
    const favLabel = $("#folder-menu [data-favorite-label]");
    favLabel.textContent = folder.favorite ? "Unfavorite" : "Favorite";
    openPopover($("#folder-menu"), cardEl.getBoundingClientRect());
  }
  $("#folder-menu").addEventListener("click", (e)=>{
    const btn = e.target.closest(".popover-item");
    if (!btn || !activeFolderForMenu) return;
    const folder = activeFolderForMenu;
    const action = btn.dataset.action;
    if (action === "color"){
      openColorPicker(folder, activeFolderCardEl.getBoundingClientRect());
    } else if (action === "rename"){
      openRenameBox(folder, activeFolderCardEl.getBoundingClientRect());
    } else if (action === "favorite"){
      folder.favorite = !folder.favorite;
      closeAllPopovers();
      renderAll();
      showToast(folder.favorite ? "Added to favorites" : "Removed from favorites");
    } else if (action === "delete"){
      closeAllPopovers();
      cascadeTrashFolder(folder, Date.now());
      if (currentFolder && folderPath(currentFolder).some(f=>f.id === folder.id)){
        currentFolder = null;
      }
      renderAll();
      showToast("Moved to trash");
    }
  });

  /* ---------------- trash options popover ---------------- */
  let activeTrashDeck = null;
  function openTrashMenu(item, cardEl){
    activeTrashDeck = item;
    openPopover($("#trash-menu"), cardEl.getBoundingClientRect());
  }
  $("#trash-menu").addEventListener("click", (e)=>{
    const btn = e.target.closest(".popover-item");
    if (!btn || !activeTrashDeck) return;
    const item = activeTrashDeck;
    const isFolder = item.type === "folder";
    const action = btn.dataset.action;
    if (action === "restore"){
      closeAllPopovers();
      if (isFolder) cascadeRestoreFolder(item);
      else item.deletedAt = null;
      renderAll();
      showToast("Restored");
    } else if (action === "delete-forever"){
      closeAllPopovers();
      const msg = isFolder
        ? "Delete \u201c" + item.name + "\u201d forever, along with everything inside it? This can't be undone."
        : "Delete \u201c" + item.name + "\u201d forever? This can't be undone.";
      if (confirm(msg)){
        if (isFolder) purgeFolderForever(item);
        else decks = decks.filter(d=> d.id !== item.id);
        renderAll();
      }
    }
  });

  function openColorPicker(deck, rect){
    const row = $("#swatch-row");
    row.innerHTML = "";
    COLORS.forEach(c=>{
      const sw = el("div","swatch" + (c===deck.color ? " selected" : ""));
      sw.style.background = c;
      sw.addEventListener("click", ()=>{
        deck.color = c;
        closeAllPopovers();
        renderAll();
      });
      row.appendChild(sw);
    });
    openPopover($("#color-picker"), rect);
  }

  function openRenameBox(deck, rect){
    const input = $("#rename-input");
    input.value = deck.name;
    openPopover($("#rename-box"), rect);
    input.focus();
    input.select();
    function commit(){
      deck.name = input.value.trim() || deck.name;
      closeAllPopovers();
      renderAll();
    }
    input.onkeydown = (e)=>{
      if (e.key === "Enter") commit();
      else if (e.key === "Escape") closeAllPopovers();
    };
    $("#rename-confirm").onclick = commit;
    $("#rename-cancel").onclick = ()=> closeAllPopovers();
  }

  /* ---------------- study view ---------------- */
  let study = { deck:null, cardIndex:0, revealed:false };

  function openStudy(deck){
    study.deck = deck;
    study.cardIndex = 0;
    study.revealed = false;
    renderStudy({instant:true});
    showView("study");
  }

  function renderElementsInto(container, elements){
    container.innerHTML = "";
    if (!elements.length) return;
    const textEls = elements.filter(e=>e.type==="text");
    const imgEls = elements.filter(e=>e.type==="image");
    imgEls.forEach(e=>{
      const img = document.createElement("img");
      img.src = e.content;
      container.appendChild(img);
    });
    textEls.forEach(e=>{
      const p = el("p","txt");
      p.textContent = e.content;
      container.appendChild(p);
    });
  }

  function renderStudy(opts){
    const instant = opts && opts.instant;
    const deck = study.deck;
    if (!deck) return;
    $("#study-deck-name").textContent = deck.name;
    const card = deck.cards[study.cardIndex];
    renderElementsInto($("#study-question-side"), card.question.elements);
    renderElementsInto($("#study-answer-side"), card.answer.elements);
    const inner = $("#study-card-inner");
    if (instant) inner.classList.add("no-anim");
    inner.classList.toggle("flipped", study.revealed);
    if (instant){
      // force the flip-reset to apply with no transition, then restore animation for next tap
      void inner.offsetHeight;
      inner.classList.remove("no-anim");
    }
    $("#study-counter").textContent = "Q" + (study.cardIndex+1) + " / " + deck.cards.length;
    $("#study-prev").disabled = study.cardIndex === 0;
    $("#study-next").disabled = study.cardIndex === deck.cards.length - 1;
  }

  $("#study-card").addEventListener("click", ()=>{
    study.revealed = !study.revealed;
    renderStudy();
  });
  $("#study-prev").addEventListener("click", ()=>{
    if (study.cardIndex > 0){ study.cardIndex--; study.revealed=false; renderStudy({instant:true}); }
  });
  $("#study-next").addEventListener("click", ()=>{
    if (study.cardIndex < study.deck.cards.length - 1){ study.cardIndex++; study.revealed=false; renderStudy({instant:true}); }
  });
  $("#study-back").addEventListener("click", ()=>{
    renderHome();
    showView("home");
  });
  $("#study-edit").addEventListener("click", (e)=>{
    openEditor({ mode:"edit", deck: study.deck, cardIndex: study.cardIndex, lockedSide: null });
  });

  /* ================================================================
     EDITOR
  ================================================================ */
  let ed = null; // editor state

  function cloneCards(cards){ return JSON.parse(JSON.stringify(cards)); }

  function openEditor(opts){
    let deck, cards, cardIndex;
    if (opts.mode === "new"){
      deck = { id:null, name:"Untitled", color: COLORS[(decks.length+folders.length) % COLORS.length], favorite:false, folderId: opts.folderId || null };
      cards = [ newCard() ];
      cardIndex = 0;
    } else {
      deck = opts.deck;
      cards = cloneCards(deck.cards);
      cardIndex = opts.cardIndex || 0;
    }
    ed = {
      mode: opts.mode,
      deckRef: opts.mode === "edit" ? opts.deck : null,
      deckMeta: { name: deck.name, color: deck.color, favorite: !!deck.favorite, folderId: deck.folderId || null },
      cards: cards,
      cardIndex: cardIndex,
      tool: "text",
      selectedId: null,
      lockedSide: opts.lockedSide || null,
      history: [],
      historyIndex: -1,
    };
    pushHistory();
    renderEditor();
    showView("editor");
  }

  function pushHistory(){
    ed.history = ed.history.slice(0, ed.historyIndex+1);
    ed.history.push(cloneCards(ed.cards));
    ed.historyIndex++;
    if (ed.history.length > 40){ ed.history.shift(); ed.historyIndex--; }
    updateUndoRedoButtons();
  }
  function undo(){
    if (ed.historyIndex <= 0) return;
    ed.historyIndex--;
    ed.cards = cloneCards(ed.history[ed.historyIndex]);
    if (ed.cardIndex >= ed.cards.length) ed.cardIndex = ed.cards.length - 1;
    ed.selectedId = null;
    renderEditor();
  }
  function redo(){
    if (ed.historyIndex >= ed.history.length - 1) return;
    ed.historyIndex++;
    ed.cards = cloneCards(ed.history[ed.historyIndex]);
    if (ed.cardIndex >= ed.cards.length) ed.cardIndex = ed.cards.length - 1;
    ed.selectedId = null;
    renderEditor();
  }
  function updateUndoRedoButtons(){
    $('.tool-btn[data-tool="undo"]').disabled = ed.historyIndex <= 0;
    $('.tool-btn[data-tool="redo"]').disabled = ed.historyIndex >= ed.history.length - 1;
  }

  function currentCard(){ return ed.cards[ed.cardIndex]; }

  function selectTool(tool){
    if (tool === "undo"){ undo(); return; }
    if (tool === "redo"){ redo(); return; }
    ed.tool = tool;
    ed.selectedId = null;
    $all(".tool-btn[data-tool]").forEach(b=>{
      if (b.dataset.tool === "undo" || b.dataset.tool === "redo") return;
      b.classList.toggle("active", b.dataset.tool === tool);
    });
    renderEditorPanes();
  }
  $all(".tool-btn[data-tool]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      if (btn.disabled) return;
      selectTool(btn.dataset.tool);
    });
  });

  function renderEditor(){
    $("#q-counter").textContent = "Q" + (ed.cardIndex + 1);
    $("#editor-prev").disabled = ed.cardIndex === 0;
    selectTool(ed.tool);
    renderEditorPanes();
    updateUndoRedoButtons();
  }

  function laneLocked(side){
    return ed.lockedSide === side;
  }

  function renderEditorPanes(){
    ["question","answer"].forEach(side=>{
      const pane = $("#pane-" + side);
      const card = currentCard();
      const data = card[side];
      // clear (keep placeholder node)
      pane.innerHTML = "";
      const ph = el("div","pane-placeholder");
      ph.textContent = side === "question" ? "Question\u2026" : "Answer\u2026";
      pane.appendChild(ph);
      pane.classList.toggle("has-elements", data.elements.length > 0);
      pane.classList.toggle("hidden-locked", false);
      pane.style.opacity = laneLocked(side) ? "0.45" : "1";
      pane.style.pointerEvents = laneLocked(side) ? "none" : "auto";

      data.elements.forEach(elem=> pane.appendChild(buildElementNode(elem, side)));
    });
  }

  function buildElementNode(elem, side){
    const wrap = el("div","el");
    wrap.dataset.id = elem.id;
    wrap.dataset.type = elem.type;
    wrap.style.left = elem.x + "px";
    wrap.style.top = elem.y + "px";
    wrap.style.transform = "rotate(" + (elem.rotation||0) + "deg)";
    if (elem.id === ed.selectedId) wrap.classList.add("selected");

    let contentNode;
    if (elem.type === "text"){
      contentNode = el("div","el-text");
      contentNode.contentEditable = "false";
      contentNode.textContent = elem.content || "";
      contentNode.addEventListener("input", ()=>{ elem.content = contentNode.textContent; });
      contentNode.addEventListener("blur", ()=>{
        contentNode.contentEditable = "false";
        contentNode.classList.remove("editing");
        if (!contentNode.textContent.trim()){
          // nothing was typed — discard the empty box instead of leaving it behind
          const arr = currentCard()[side].elements;
          const i = arr.findIndex(x=>x.id===elem.id);
          if (i>-1) arr.splice(i,1);
          if (ed.selectedId === elem.id) ed.selectedId = null;
          suppressNextPaneClick = true;
          pushHistory();
          renderEditorPanes();
          return;
        }
        pushHistory();
      });
      contentNode.addEventListener("dblclick", (e)=>{
        if (laneLocked(side)) return;
        e.stopPropagation();
        contentNode.contentEditable = "true";
        contentNode.classList.add("editing");
        contentNode.focus();
        placeCaretAtEnd(contentNode);
      });
      wrap.appendChild(contentNode);
    } else {
      wrap.style.width = elem.w + "px";
      wrap.style.height = elem.h + "px";
      contentNode = document.createElement("img");
      contentNode.src = elem.content;
      wrap.appendChild(contentNode);
    }

    wrap.addEventListener("mousedown", (e)=> startDrag(e, elem, side, wrap, contentNode));
    wrap.addEventListener("touchstart", (e)=> startDrag(e, elem, side, wrap, contentNode), {passive:false});
    wrap.addEventListener("click", (e)=>{ e.stopPropagation(); suppressNextPaneClick = false; selectElement(elem.id, side); });

    if (elem.id === ed.selectedId){
      wrap.appendChild(buildElementToolbar(elem, side));
      if (elem.type === "image"){
        ["nw","ne","sw","se"].forEach(corner=>{
          const h = el("div","resize-handle " + corner);
          h.addEventListener("mousedown", (e)=> startResize(e, elem, side, corner));
          h.addEventListener("touchstart", (e)=> startResize(e, elem, side, corner), {passive:false});
          wrap.appendChild(h);
        });
      }
    }
    return wrap;
  }

  function buildElementToolbar(elem, side){
    const bar = el("div","el-toolbar" + (elem.y < 50 ? " below" : ""));
    if (elem.type === "image"){
      const angleBtn = el("button","angle-badge");
      angleBtn.textContent = (elem.rotation||0) + "\u00B0";
      angleBtn.title = "Rotate 15\u00B0";
      angleBtn.addEventListener("click",(e)=>{
        e.stopPropagation();
        elem.rotation = ((elem.rotation||0) + 15) % 360;
        pushHistory();
        renderEditorPanes();
      });
      bar.appendChild(angleBtn);
    }
    const dupBtn = el("button");
    dupBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M9 20h9a2 2 0 0 0 2-2V9" stroke="currentColor" stroke-width="2"/></svg>';
    dupBtn.title = "Duplicate";
    dupBtn.addEventListener("click",(e)=>{
      e.stopPropagation();
      const copy = JSON.parse(JSON.stringify(elem));
      copy.id = nextId();
      copy.x += 16; copy.y += 16;
      currentCard()[side].elements.push(copy);
      ed.selectedId = copy.id;
      pushHistory();
      renderEditorPanes();
    });
    bar.appendChild(dupBtn);

    const delBtn = el("button","danger");
    delBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none"><path d="M4 7h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    delBtn.title = "Delete";
    delBtn.addEventListener("click",(e)=>{
      e.stopPropagation();
      const arr = currentCard()[side].elements;
      const i = arr.findIndex(x=>x.id===elem.id);
      if (i>-1) arr.splice(i,1);
      ed.selectedId = null;
      pushHistory();
      renderEditorPanes();
    });
    bar.appendChild(delBtn);
    return bar;
  }

  function placeCaretAtEnd(node){
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function selectElement(id, side){
    if (laneLocked(side)) return;
    if (ed.selectedId === id) return; // already selected — avoid re-render (would drop focus/editing state)
    ed.selectedId = id;
    renderEditorPanes();
  }

  /* dragging */
  let dragCtx = null;
  let suppressNextPaneClick = false;
  function startDrag(e, elem, side, wrap, contentNode){
    if (laneLocked(side)) return;
    if (e.target.closest(".el-toolbar") || e.target.closest(".resize-handle")) return; // taps on the floating toolbar/handles must not start a drag
    if (elem.type === "text" && contentNode.isContentEditable) return; // let native caret/selection work while editing
    e.preventDefault();
    const point = e.touches ? e.touches[0] : e;
    dragCtx = { elem, side, startX: point.clientX, startY: point.clientY, origX: elem.x, origY: elem.y, moved:false };
    selectElement(elem.id, side);
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    window.addEventListener("touchmove", onDragMove, {passive:false});
    window.addEventListener("touchend", onDragEnd);
  }
  function onDragMove(e){
    if (!dragCtx) return;
    e.preventDefault();
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - dragCtx.startX;
    const dy = point.clientY - dragCtx.startY;
    if (Math.abs(dx)>2 || Math.abs(dy)>2) dragCtx.moved = true;
    dragCtx.elem.x = Math.max(0, dragCtx.origX + dx);
    dragCtx.elem.y = Math.max(0, dragCtx.origY + dy);
    const pane = $("#pane-" + dragCtx.side);
    const node = pane.querySelector('.el[data-id="'+dragCtx.elem.id+'"]');
    if (node){ node.style.left = dragCtx.elem.x + "px"; node.style.top = dragCtx.elem.y + "px"; }
  }
  function onDragEnd(){
    if (dragCtx && dragCtx.moved) pushHistory();
    dragCtx = null;
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
    window.removeEventListener("touchmove", onDragMove);
    window.removeEventListener("touchend", onDragEnd);
  }

  /* resizing (images only) */
  let resizeCtx = null;
  function startResize(e, elem, side, corner){
    e.preventDefault(); e.stopPropagation();
    const point = e.touches ? e.touches[0] : e;
    resizeCtx = { elem, side, corner, startX: point.clientX, startY: point.clientY, origW: elem.w, origH: elem.h, origX: elem.x, origY: elem.y };
    window.addEventListener("mousemove", onResizeMove);
    window.addEventListener("mouseup", onResizeEnd);
    window.addEventListener("touchmove", onResizeMove, {passive:false});
    window.addEventListener("touchend", onResizeEnd);
  }
  function onResizeMove(e){
    if (!resizeCtx) return;
    e.preventDefault();
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - resizeCtx.startX;
    const dy = point.clientY - resizeCtx.startY;
    const { elem, corner } = resizeCtx;
    let w = resizeCtx.origW, h = resizeCtx.origH, x = resizeCtx.origX, y = resizeCtx.origY;
    if (corner.includes("e")) w = Math.max(40, resizeCtx.origW + dx);
    if (corner.includes("s")) h = Math.max(40, resizeCtx.origH + dy);
    if (corner.includes("w")){ w = Math.max(40, resizeCtx.origW - dx); x = resizeCtx.origX + dx; }
    if (corner.includes("n")){ h = Math.max(40, resizeCtx.origH - dy); y = resizeCtx.origY + dy; }
    elem.w = w; elem.h = h; elem.x = x; elem.y = y;
    const pane = $("#pane-" + resizeCtx.side);
    const node = pane.querySelector('.el[data-id="'+elem.id+'"]');
    if (node){
      node.style.width = w+"px"; node.style.height = h+"px";
      node.style.left = x+"px"; node.style.top = y+"px";
    }
  }
  function onResizeEnd(){
    if (resizeCtx) pushHistory();
    resizeCtx = null;
    window.removeEventListener("mousemove", onResizeMove);
    window.removeEventListener("mouseup", onResizeEnd);
    window.removeEventListener("touchmove", onResizeMove);
    window.removeEventListener("touchend", onResizeEnd);
  }

  /* clicking empty pane area with text/image tool */
  ["question","answer"].forEach(side=>{
    $("#pane-" + side).addEventListener("click", (e)=>{
      if (suppressNextPaneClick){ suppressNextPaneClick = false; return; }
      if (e.target.closest(".el")) return;
      if (laneLocked(side)) return;
      const pane = $("#pane-" + side);
      if ((ed.tool === "text" || ed.tool === "image") && ed.selectedId){
        // first tap on empty space just clears the current selection
        // (hides its floating toolbar) instead of also creating a new element
        ed.selectedId = null;
        renderEditorPanes();
        return;
      }
      const rect = pane.getBoundingClientRect();
      const x = e.clientX - rect.left + pane.scrollLeft;
      const y = e.clientY - rect.top + pane.scrollTop;
      if (ed.tool === "text"){
        const elem = { id: nextId(), type:"text", x: Math.max(0,x-10), y: Math.max(0,y-12), rotation:0, content:"" };
        currentCard()[side].elements.push(elem);
        ed.selectedId = elem.id;
        pushHistory();
        renderEditorPanes();
        requestAnimationFrame(()=>{
          const wrap = pane.querySelector('.el[data-id="'+elem.id+'"]');
          const textNode = wrap ? wrap.querySelector(".el-text") : null;
          if (textNode){
            textNode.contentEditable = "true";
            textNode.classList.add("editing");
            textNode.focus();
            placeCaretAtEnd(textNode);
          }
        });
      } else if (ed.tool === "image"){
        pendingImageTarget = { side, x: Math.max(0,x-60), y: Math.max(0,y-45) };
        $("#file-input").click();
      } else {
        ed.selectedId = null;
        renderEditorPanes();
      }
    });
  });

  let pendingImageTarget = null;
  $("#file-input").addEventListener("change", (e)=>{
    const file = e.target.files[0];
    e.target.value = "";
    if (!file || !pendingImageTarget) return;
    const reader = new FileReader();
    reader.onload = function(evt){
      const elem = { id: nextId(), type:"image", x: pendingImageTarget.x, y: pendingImageTarget.y, w:180, h:135, rotation:0, content: evt.target.result };
      currentCard()[pendingImageTarget.side].elements.push(elem);
      ed.selectedId = elem.id;
      pushHistory();
      renderEditorPanes();
      pendingImageTarget = null;
    };
    reader.readAsDataURL(file);
  });

  /* prev / next / delete-question */
  $("#editor-prev").addEventListener("click", ()=>{
    if (ed.cardIndex > 0){
      ed.cardIndex--;
      ed.selectedId = null;
      renderEditor();
    }
  });
  $("#editor-next").addEventListener("click", ()=>{
    if (ed.cardIndex < ed.cards.length - 1){
      ed.cardIndex++;
    } else {
      ed.cards.push(newCard());
      ed.cardIndex = ed.cards.length - 1;
      pushHistory();
    }
    ed.selectedId = null;
    renderEditor();
  });
  $("#editor-delete-q").addEventListener("click", ()=>{
    if (ed.cards.length <= 1){
      showToast("A flashcard needs at least one question");
      return;
    }
    ed.cards.splice(ed.cardIndex, 1);
    if (ed.cardIndex >= ed.cards.length) ed.cardIndex = ed.cards.length - 1;
    ed.selectedId = null;
    pushHistory();
    renderEditor();
  });

  /* cancel / save */
  $("#editor-cancel").addEventListener("click", ()=>{
    const back = ed.mode === "edit" ? "study" : "home";
    ed = null;
    if (back === "study") renderStudy();
    else renderHome();
    showView(back);
  });
  $("#editor-save").addEventListener("click", ()=>{
    if (ed.mode === "new"){
      const deck = newDeck(ed.deckMeta.name);
      deck.color = ed.deckMeta.color;
      deck.folderId = ed.deckMeta.folderId || null;
      deck.cards = ed.cards;
      decks.push(deck);
      ed = null;
      renderAll();
      showView("home");
      showToast("Flashcard saved");
    } else {
      ed.deckRef.cards = ed.cards;
      study.deck = ed.deckRef;
      if (study.cardIndex >= study.deck.cards.length) study.cardIndex = 0;
      ed = null;
      renderAll();
      renderStudy({instant:true});
      showView("study");
      showToast("Changes saved");
    }
  });

  /* keyboard delete for selected element */
  document.addEventListener("keydown", (e)=>{
    if (!ed || !ed.selectedId) return;
    if (document.activeElement && document.activeElement.isContentEditable) return;
    if (e.key === "Delete" || e.key === "Backspace"){
      const side = ed.lockedSide === "question" ? "answer" : "question";
      ["question","answer"].forEach(s=>{
        const arr = currentCard()[s].elements;
        const i = arr.findIndex(x=>x.id===ed.selectedId);
        if (i>-1){ arr.splice(i,1); ed.selectedId=null; pushHistory(); renderEditorPanes(); }
      });
    }
  });

  /* ---------------- init ---------------- */
  loadDecks();
  renderAll();
  showView("home");

})();
