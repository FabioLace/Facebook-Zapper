// ==UserScript==
// @name         Facebook Zap Block
// @namespace    fabio.facebook-zap-block
// @version      1.6.0
// @description  Aggiunge un pulsante ⚡ accanto all'autore di ogni commento: un clic e il profilo viene bloccato in una scheda in background.
// @match        https://www.facebook.com/*
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // --- Configurazione -------------------------------------------------------

  /** Chiede conferma prima di bloccare, per evitare zap accidentali. */
  const REQUIRE_CONFIRMATION_BEFORE_BLOCK = true;

  /** Nasconde subito dalla pagina tutti i commenti dell'autore appena bloccato. */
  const HIDE_COMMENTS_AFTER_BLOCK = true;

  /** Etichette (aria-label) del pulsante "…" nell'intestazione del profilo. */
  const PROFILE_OPTIONS_BUTTON_LABELS = [
    'Opzioni del pulsante per vedere altre impostazioni del profilo',
    'Vedi opzioni', 'Altre opzioni', 'Altro', 'See options', 'More options', 'More',
  ];

  /** Frammenti (minuscoli) cercati nell'aria-label se nessuna etichetta esatta corrisponde. */
  const PROFILE_OPTIONS_PARTIAL_LABELS = ['opzioni', 'options', 'altro', 'more'];

  /** Testo della voce di menu che avvia il blocco. */
  const BLOCK_MENU_ITEM_TEXTS = ['Blocca', 'Block'];

  /** Testo del pulsante di conferma nel dialog di blocco. */
  const CONFIRM_BLOCK_BUTTON_TEXTS = ['Conferma', 'Confirm', 'Blocca', 'Block'];

  /** Prefissi dell'aria-label dei commenti, usati per riconoscerli nel DOM. */
  const COMMENT_ARIA_LABEL_PREFIXES = ['Commento di', 'Risposta di', 'Comment by', 'Reply by'];

  /** Primi segmenti di URL che non sono profili. */
  const NON_PROFILE_PATH_SEGMENTS = new Set([
    'groups', 'pages', 'events', 'watch', 'photo', 'photo.php', 'photos', 'videos', 'reel', 'reels',
    'hashtag', 'stories', 'story.php', 'permalink.php', 'marketplace', 'gaming', 'notifications',
    'messages', 'settings', 'help', 'login', 'friends', 'bookmarks', 'saved', 'search', 'share',
  ]);

  const ELEMENT_WAIT_TIMEOUT_MS = 15000;
  const EXACT_LABEL_WAIT_TIMEOUT_MS = 10000;
  const ELEMENT_POLL_INTERVAL_MS = 300;
  const PAUSE_AFTER_CONFIRM_MS = 2000;

  const AUTO_BLOCK_HASH_PREFIX = '#zap-block=';
  const RESULT_STORAGE_KEY_PREFIX = 'zapBlockResult:';
  const ZAP_BUTTON_MARKER_ATTRIBUTE = 'data-zap-block-button';
  const PROCESSED_COMMENT_MARKER_ATTRIBUTE = 'data-zap-block-processed';
  const COMMENT_AUTHOR_KEY_ATTRIBUTE = 'data-zap-block-author';

  /** Profili bloccati da questa pagina: i loro commenti caricati in seguito vengono nascosti subito. */
  const profileKeysBlockedFromThisPage = new Set();

  // L'URL va letto subito, prima che Facebook lo riscriva lato client.
  const initialPageUrl = location.href;

  // --- Utility --------------------------------------------------------------

  const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

  const normalizeVisibleText = (element) => (element.textContent || '').replace(/\s+/g, ' ').trim();

  const textMatchesAny = (text, candidateTexts) =>
    candidateTexts.some((candidateText) => text === candidateText || text.startsWith(`${candidateText} `));

  async function waitForElement(findElement, timeoutMs = ELEMENT_WAIT_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const foundElement = findElement();
      if (foundElement) return foundElement;
      await sleep(ELEMENT_POLL_INTERVAL_MS);
    }
    throw new Error('Elemento non trovato entro il timeout');
  }

  /**
   * Converte un link di profilo in una chiave stabile:
   * "id:123456" per gli ID numerici, "user:nomeutente" per gli URL personalizzati.
   */
  function buildProfileKey(rawProfileUrl) {
    let parsedUrl;
    try {
      parsedUrl = new URL(rawProfileUrl, location.origin);
    } catch {
      return null;
    }
    if (!parsedUrl.hostname.endsWith('facebook.com')) return null;

    const groupMemberMatch = parsedUrl.pathname.match(/^\/groups\/[^/]+\/user\/(\d+)/);
    if (groupMemberMatch) return `id:${groupMemberMatch[1]}`;

    if (parsedUrl.pathname.startsWith('/profile.php')) {
      const numericProfileId = parsedUrl.searchParams.get('id');
      return numericProfileId ? `id:${numericProfileId}` : null;
    }

    const firstPathSegment = parsedUrl.pathname.split('/').filter(Boolean)[0];
    if (!firstPathSegment || NON_PROFILE_PATH_SEGMENTS.has(firstPathSegment.toLowerCase())) return null;

    return /^\d+$/.test(firstPathSegment) ? `id:${firstPathSegment}` : `user:${firstPathSegment.toLowerCase()}`;
  }

  function buildProfileUrl(profileKey) {
    const [profileKeyType, profileKeyValue] = profileKey.split(':');
    return profileKeyType === 'id'
      ? `https://www.facebook.com/profile.php?id=${profileKeyValue}`
      : `https://www.facebook.com/${profileKeyValue}`;
  }

  // --- Scheda del profilo: esegue il blocco ---------------------------------

  /** Esclude i pulsanti che appartengono ai post della bacheca (i loro "…" non portano al blocco). */
  function isInsidePost(candidateElement) {
    return candidateElement.closest('[role="article"], [role="feed"]') !== null;
  }

  function isIconOnlyMenuButton(candidateElement) {
    return (candidateElement.getAttribute('aria-haspopup') === 'menu' || candidateElement.getAttribute('role') === 'button')
      && normalizeVisibleText(candidateElement) === ''
      && !isInsidePost(candidateElement);
  }

  /**
   * Il "…" giusto sta sulla stessa riga delle schede del profilo (Tutto, Informazioni, Amici…):
   * si risale dalla tablist fino al primo contenitore che include un pulsante solo icona fuori dalla tablist.
   * Risalendo dal basso si incontra lui prima del "…" di qualsiasi post.
   */
  function findOptionsButtonNextToProfileTabs() {
    const profileTabList = document.querySelector('[role="main"] [role="tablist"]') || document.querySelector('[role="tablist"]');
    if (!profileTabList) return null;

    let ancestorContainer = profileTabList.parentElement;
    for (let climbedLevels = 0; ancestorContainer && climbedLevels < 8; climbedLevels += 1) {
      const iconOnlyButtonOutsideTabs = [...ancestorContainer.querySelectorAll('[aria-haspopup="menu"], [role="button"]')]
        .find((candidateButton) => !profileTabList.contains(candidateButton) && isIconOnlyMenuButton(candidateButton));
      if (iconOnlyButtonOutsideTabs) return iconOnlyButtonOutsideTabs;
      ancestorContainer = ancestorContainer.parentElement;
    }
    return null;
  }

  /** Confronta le etichette ignorando maiuscole e spazi (inclusi quelli non separabili che Facebook a volte usa). */
  const normalizeLabel = (rawLabel) => (rawLabel || '').replace(/\s+/g, ' ').trim().toLowerCase();

  const normalizedProfileOptionsLabels = PROFILE_OPTIONS_BUTTON_LABELS.map(normalizeLabel);

  /** Solo il pulsante con etichetta esatta, nell'ordine di priorità di PROFILE_OPTIONS_BUTTON_LABELS. */
  function findExactLabelOptionsButton() {
    const labelledButtons = [...document.querySelectorAll('[aria-label]')]
      .filter((labelledElement) => !isInsidePost(labelledElement));
    for (const normalizedExpectedLabel of normalizedProfileOptionsLabels) {
      const matchingButton = labelledButtons.find((labelledElement) =>
        normalizeLabel(labelledElement.getAttribute('aria-label')) === normalizedExpectedLabel);
      if (matchingButton) return matchingButton;
    }
    return null;
  }

  function findProfileOptionsButton() {
    const exactLabelMatch = findExactLabelOptionsButton();
    if (exactLabelMatch) return exactLabelMatch;

    const optionsButtonNextToTabs = findOptionsButtonNextToProfileTabs();
    if (optionsButtonNextToTabs) return optionsButtonNextToTabs;

    // Ripiego 1: pulsante di menu nell'area principale con un'etichetta "simile".
    const profileMainArea = document.querySelector('[role="main"]') || document.body;
    const profileMenuButtons = [...profileMainArea.querySelectorAll('[aria-haspopup="menu"]')]
      .filter((menuButton) => !isInsidePost(menuButton));
    const partialLabelMatch = profileMenuButtons.find((menuButton) => {
      const lowercaseLabel = (menuButton.getAttribute('aria-label') || '').toLowerCase();
      return PROFILE_OPTIONS_PARTIAL_LABELS.some((partialLabel) => lowercaseLabel.includes(partialLabel));
    });
    if (partialLabelMatch) return partialLabelMatch;

    // Ripiego 2: primo pulsante di menu solo icona (il "…" dell'intestazione).
    return profileMenuButtons.find((menuButton) => normalizeVisibleText(menuButton) === '') || null;
  }

  function logProfileDiagnostics() {
    const profileMainArea = document.querySelector('[role="main"]') || document.body;
    const visibleMenuButtons = [...profileMainArea.querySelectorAll('[aria-haspopup="menu"], [role="button"][aria-label]')]
      .slice(0, 40)
      .map((candidateButton) => ({
        ariaLabel: candidateButton.getAttribute('aria-label'),
        hasMenuPopup: candidateButton.getAttribute('aria-haspopup') === 'menu',
        visibleText: normalizeVisibleText(candidateButton).slice(0, 40),
      }));
    const visibleMenuItems = [...document.querySelectorAll('[role="menuitem"]')]
      .map((menuItem) => normalizeVisibleText(menuItem).slice(0, 60));
    const openDialogButtons = [...document.querySelectorAll('[role="dialog"] [role="button"]')]
      .map((dialogButton) => normalizeVisibleText(dialogButton) || dialogButton.getAttribute('aria-label'));

    console.info('[Zap Block] Pulsanti nella pagina:');
    console.table(visibleMenuButtons);
    console.info('[Zap Block] Voci di menu aperte:', visibleMenuItems);
    console.info('[Zap Block] Pulsanti nei dialog aperti:', openDialogButtons);
  }

  function findBlockMenuItem() {
    return [...document.querySelectorAll('[role="menuitem"]')].find((menuItem) =>
      textMatchesAny(normalizeVisibleText(menuItem), BLOCK_MENU_ITEM_TEXTS));
  }

  function findConfirmBlockButton() {
    const openDialogs = document.querySelectorAll('[role="dialog"]');
    for (const openDialog of openDialogs) {
      const confirmButton = [...openDialog.querySelectorAll('[role="button"]')].find((dialogButton) => {
        const buttonText = normalizeVisibleText(dialogButton) || dialogButton.getAttribute('aria-label') || '';
        return CONFIRM_BLOCK_BUTTON_TEXTS.includes(buttonText);
      });
      if (confirmButton) return confirmButton;
    }
    return null;
  }

  async function runAutoBlockFlow(profileKey) {
    const resultStorageKey = `${RESULT_STORAGE_KEY_PREFIX}${profileKey}`;
    let currentBlockStep = 'avvio';
    try {
      console.info('[Zap Block] Avvio blocco per', profileKey);

      currentBlockStep = 'pulsante "…" del profilo';
      // Prima si aspetta solo l'etichetta esatta: i ripieghi, se partono mentre l'intestazione
      // del profilo non è ancora renderizzata, rischiano di prendere il "…" di un post.
      let profileOptionsButton;
      try {
        profileOptionsButton = await waitForElement(findExactLabelOptionsButton, EXACT_LABEL_WAIT_TIMEOUT_MS);
      } catch {
        console.warn('[Zap Block] Etichetta esatta non trovata, uso i ripieghi');
        profileOptionsButton = await waitForElement(findProfileOptionsButton);
      }
      console.info('[Zap Block] Trovato pulsante opzioni:', profileOptionsButton.getAttribute('aria-label'), profileOptionsButton);
      profileOptionsButton.click();

      currentBlockStep = 'voce di menu "Blocca"';
      const blockMenuItem = await waitForElement(findBlockMenuItem);
      console.info('[Zap Block] Trovata voce di menu:', normalizeVisibleText(blockMenuItem));
      blockMenuItem.click();

      currentBlockStep = 'pulsante di conferma nel dialog';
      const confirmBlockButton = await waitForElement(findConfirmBlockButton);
      console.info('[Zap Block] Trovato pulsante di conferma:', normalizeVisibleText(confirmBlockButton));
      confirmBlockButton.click();

      // Il risultato va salvato subito: dopo il blocco Facebook può ricaricare o
      // reindirizzare la scheda, e un'attesa qui farebbe perdere l'esito.
      // È la scheda di origine ad aspettare prima di chiudere questa.
      GM_setValue(resultStorageKey, { status: 'blocked', finishedAt: Date.now() });
      console.info('[Zap Block] Blocco completato per', profileKey);
    } catch (blockError) {
      console.warn(`[Zap Block] Blocco non riuscito per ${profileKey} al passaggio: ${currentBlockStep}`, blockError);
      logProfileDiagnostics();
      GM_setValue(resultStorageKey, { status: 'failed', finishedAt: Date.now() });
    }
  }

  // --- Pagine con commenti: aggiunge il pulsante ⚡ --------------------------

  function isCommentArticle(articleElement) {
    const articleLabel = articleElement.getAttribute('aria-label') || '';
    return COMMENT_ARIA_LABEL_PREFIXES.some((labelPrefix) => articleLabel.startsWith(labelPrefix));
  }

  function findCommentAuthorLink(commentArticle) {
    return [...commentArticle.querySelectorAll('a[href]')].find((candidateLink) =>
      candidateLink.closest('[role="article"]') === commentArticle
      && normalizeVisibleText(candidateLink) !== ''
      && buildProfileKey(candidateLink.href) !== null);
  }

  function updateZapButtonState(zapButton, buttonSymbol, buttonTitle) {
    zapButton.textContent = buttonSymbol;
    zapButton.title = buttonTitle;
  }

  function hideCommentArticle(commentArticle) {
    commentArticle.style.setProperty('display', 'none', 'important');
  }

  function hideAllCommentsByAuthor(profileKey) {
    let hiddenCommentCount = 0;
    document.querySelectorAll(`[role="article"][${COMMENT_AUTHOR_KEY_ATTRIBUTE}]`).forEach((commentArticle) => {
      if (commentArticle.getAttribute(COMMENT_AUTHOR_KEY_ATTRIBUTE) === profileKey) {
        hideCommentArticle(commentArticle);
        hiddenCommentCount += 1;
      }
    });
    return hiddenCommentCount;
  }

  function handleZapButtonClick(clickEvent, zapButton, profileKey, authorName) {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();

    if (zapButton.dataset.zapBlockState === 'pending' || zapButton.dataset.zapBlockState === 'blocked') return;
    if (REQUIRE_CONFIRMATION_BEFORE_BLOCK && !window.confirm(`Bloccare ${authorName}?`)) return;

    const resultStorageKey = `${RESULT_STORAGE_KEY_PREFIX}${profileKey}`;
    GM_deleteValue(resultStorageKey);

    zapButton.dataset.zapBlockState = 'pending';
    updateZapButtonState(zapButton, '⏳', `Blocco di ${authorName} in corso…`);

    const profileUrlWithAutoBlock = `${buildProfileUrl(profileKey)}${AUTO_BLOCK_HASH_PREFIX}${encodeURIComponent(profileKey)}`;
    const backgroundProfileTab = GM_openInTab(profileUrlWithAutoBlock, { active: false, insert: true });

    GM_addValueChangeListener(resultStorageKey, (_changedKey, _previousResult, newResult) => {
      if (!newResult || zapButton.dataset.zapBlockState !== 'pending') return;

      const wasBlocked = newResult.status === 'blocked';
      zapButton.dataset.zapBlockState = wasBlocked ? 'blocked' : 'failed';
      updateZapButtonState(
        zapButton,
        wasBlocked ? '✅' : '⚠️',
        wasBlocked ? `${authorName} bloccato` : `Blocco di ${authorName} non riuscito: la scheda resta aperta per controllare`,
      );

      if (wasBlocked && HIDE_COMMENTS_AFTER_BLOCK) {
        profileKeysBlockedFromThisPage.add(profileKey);
        const hiddenCommentCount = hideAllCommentsByAuthor(profileKey);

        // Ripiego: il commento su cui si è cliccato, anche se l'attributo dell'autore si è perso in un re-render.
        const clickedCommentArticle = zapButton.closest('[role="article"]');
        if (clickedCommentArticle) hideCommentArticle(clickedCommentArticle);

        console.info(`[Zap Block] Nascosti ${hiddenCommentCount} commenti di ${profileKey}`, clickedCommentArticle ? '' : '(commento cliccato non più nel DOM)');
      }

      // Lascia alla scheda del profilo il tempo di completare la richiesta di blocco prima di chiuderla.
      if (wasBlocked) setTimeout(() => backgroundProfileTab.close(), PAUSE_AFTER_CONFIRM_MS);
      GM_deleteValue(resultStorageKey);
    });
  }

  function addZapButtonToComment(commentArticle) {
    commentArticle.setAttribute(PROCESSED_COMMENT_MARKER_ATTRIBUTE, 'true');

    const commentAuthorLink = findCommentAuthorLink(commentArticle);
    if (!commentAuthorLink) return;

    const profileKey = buildProfileKey(commentAuthorLink.href);
    const authorName = normalizeVisibleText(commentAuthorLink);

    commentArticle.setAttribute(COMMENT_AUTHOR_KEY_ATTRIBUTE, profileKey);
    if (profileKeysBlockedFromThisPage.has(profileKey)) {
      hideCommentArticle(commentArticle);
      return;
    }

    const zapButton = document.createElement('button');
    zapButton.type = 'button';
    zapButton.setAttribute(ZAP_BUTTON_MARKER_ATTRIBUTE, 'true');
    zapButton.style.cssText = 'margin-left:6px;padding:0 4px;border:none;background:none;cursor:pointer;font-size:12px;line-height:1;opacity:.7;';
    updateZapButtonState(zapButton, '⚡', `Blocca ${authorName}`);
    zapButton.addEventListener('click', (clickEvent) => handleZapButtonClick(clickEvent, zapButton, profileKey, authorName));

    commentAuthorLink.insertAdjacentElement('afterend', zapButton);
  }

  function scanForUnprocessedComments() {
    const unprocessedArticles = document.querySelectorAll(`[role="article"][aria-label]:not([${PROCESSED_COMMENT_MARKER_ATTRIBUTE}])`);
    unprocessedArticles.forEach((articleElement) => {
      if (isCommentArticle(articleElement)) addZapButtonToComment(articleElement);
    });
  }

  function startWatchingForComments() {
    let isScanScheduled = false;
    const scheduleCommentScan = () => {
      if (isScanScheduled) return;
      isScanScheduled = true;
      requestAnimationFrame(() => {
        isScanScheduled = false;
        scanForUnprocessedComments();
      });
    };

    new MutationObserver(scheduleCommentScan).observe(document.body, { childList: true, subtree: true });
    scanForUnprocessedComments();
  }

  // --- Avvio ----------------------------------------------------------------

  function onDocumentReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  const initialHash = new URL(initialPageUrl).hash;
  if (initialHash.startsWith(AUTO_BLOCK_HASH_PREFIX)) {
    const profileKeyToBlock = decodeURIComponent(initialHash.slice(AUTO_BLOCK_HASH_PREFIX.length));
    onDocumentReady(() => runAutoBlockFlow(profileKeyToBlock));
  } else {
    onDocumentReady(startWatchingForComments);
  }
})();
