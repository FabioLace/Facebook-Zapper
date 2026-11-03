// ==UserScript==
// @name         Facebook Zap Block
// @namespace    fabio.facebook-zap-block
// @version      1.8.0
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

  /** Effetto fulmine + cenere quando i commenti vengono nascosti (rispetta "riduci movimento" del sistema). */
  const ENABLE_INCINERATION_EFFECT = true;

  const LIGHTNING_FLASH_DURATION_MS = 380;
  const CHARRING_DURATION_MS = 200;
  const DISSOLVE_DURATION_MS = 380;
  const COLLAPSE_DURATION_MS = 160;
  const ASH_PARTICLE_MAX_COUNT = 140;
  const ASH_PARTICLE_MIN_LIFETIME_MS = 500;
  const ASH_PARTICLE_MAX_LIFETIME_MS = 900;

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
  const INCINERATED_COMMENT_MARKER_ATTRIBUTE = 'data-zap-block-incinerated';

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

  // --- Effetto fulmine + cenere ---------------------------------------------

  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
  const ASH_PARTICLE_COLORS = ['#2b2b2b', '#3d3d3d', '#555555', '#6e6e6e', '#8a8a8a', '#a3a3a3'];
  const EMBER_PARTICLE_COLORS = ['#ff7a1a', '#ffb347', '#ff4d00'];

  const randomBetween = (minimumValue, maximumValue) => minimumValue + Math.random() * (maximumValue - minimumValue);

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function isElementInViewport(element) {
    const elementRect = element.getBoundingClientRect();
    return elementRect.width > 0 && elementRect.height > 0
      && elementRect.bottom > 0 && elementRect.top < window.innerHeight;
  }

  /** Livello fisso sopra la pagina: vive fuori dal DOM di Facebook, così i suoi re-render non interrompono l'effetto. */
  function createIncinerationOverlay() {
    const overlayLayer = document.createElement('div');
    overlayLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden;';
    document.body.appendChild(overlayLayer);
    return overlayLayer;
  }

  function buildJaggedBoltPoints(startX, startY, endX, endY, segmentCount) {
    const boltLength = Math.hypot(endX - startX, endY - startY);
    const maximumJitter = Math.min(45, (boltLength / segmentCount) * 0.8);
    const boltPoints = [[startX, startY]];
    for (let segmentIndex = 1; segmentIndex < segmentCount; segmentIndex += 1) {
      const segmentProgress = segmentIndex / segmentCount;
      boltPoints.push([
        startX + (endX - startX) * segmentProgress + randomBetween(-maximumJitter, maximumJitter),
        startY + (endY - startY) * segmentProgress + randomBetween(-maximumJitter, maximumJitter) * 0.3,
      ]);
    }
    boltPoints.push([endX, endY]);
    return boltPoints;
  }

  function appendBoltPolyline(lightningSvg, boltPoints, strokeWidth, strokeColor, strokeOpacity) {
    const boltPolyline = document.createElementNS(SVG_NAMESPACE, 'polyline');
    boltPolyline.setAttribute('points', boltPoints.map(([pointX, pointY]) => `${pointX.toFixed(1)},${pointY.toFixed(1)}`).join(' '));
    boltPolyline.setAttribute('fill', 'none');
    boltPolyline.setAttribute('stroke', strokeColor);
    boltPolyline.setAttribute('stroke-width', String(strokeWidth));
    boltPolyline.setAttribute('stroke-opacity', String(strokeOpacity));
    boltPolyline.setAttribute('stroke-linejoin', 'round');
    boltPolyline.setAttribute('stroke-linecap', 'round');
    lightningSvg.appendChild(boltPolyline);
  }

  /** Fulmine dal bordo alto dello schermo fino al commento, con un ramo secondario, bagliore d'impatto e lampo. */
  function strikeLightning(overlayLayer, targetRect) {
    const strikePointX = targetRect.left + targetRect.width * randomBetween(0.25, 0.75);
    const strikePointY = targetRect.top + Math.min(targetRect.height / 2, 40);
    const boltOriginX = strikePointX + randomBetween(-80, 80);

    const mainBoltPoints = buildJaggedBoltPoints(boltOriginX, -20, strikePointX, strikePointY, 14);
    const branchStartPoint = mainBoltPoints[Math.floor(mainBoltPoints.length * randomBetween(0.4, 0.7))];
    const branchDirection = Math.random() < 0.5 ? -1 : 1;
    const branchPoints = buildJaggedBoltPoints(
      branchStartPoint[0], branchStartPoint[1],
      branchStartPoint[0] + branchDirection * randomBetween(60, 140), branchStartPoint[1] + randomBetween(60, 140),
      6,
    );

    const lightningSvg = document.createElementNS(SVG_NAMESPACE, 'svg');
    lightningSvg.setAttribute('width', String(window.innerWidth));
    lightningSvg.setAttribute('height', String(window.innerHeight));
    lightningSvg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;'
      + 'filter:drop-shadow(0 0 4px #c8e8ff) drop-shadow(0 0 14px #4aa3ff);';
    appendBoltPolyline(lightningSvg, mainBoltPoints, 7, '#7cc4ff', 0.55);
    appendBoltPolyline(lightningSvg, mainBoltPoints, 2.5, '#ffffff', 1);
    appendBoltPolyline(lightningSvg, branchPoints, 3, '#7cc4ff', 0.45);
    appendBoltPolyline(lightningSvg, branchPoints, 1.2, '#ffffff', 0.9);

    const impactGlow = document.createElement('div');
    impactGlow.style.cssText = `position:absolute;left:${strikePointX - 70}px;top:${strikePointY - 70}px;width:140px;height:140px;`
      + 'border-radius:50%;background:radial-gradient(circle, rgba(255,255,255,.95) 0%, rgba(140,200,255,.6) 30%, rgba(74,163,255,0) 70%);';

    const screenFlash = document.createElement('div');
    screenFlash.style.cssText = 'position:absolute;inset:0;background:#dff1ff;';

    overlayLayer.append(screenFlash, lightningSvg, impactGlow);

    const flickerKeyframes = [
      { opacity: 0 }, { opacity: 1, offset: 0.05 }, { opacity: 0.2, offset: 0.3 },
      { opacity: 1, offset: 0.45 }, { opacity: 0 },
    ];
    const lightningTiming = { duration: LIGHTNING_FLASH_DURATION_MS, fill: 'forwards' };
    lightningSvg.animate(flickerKeyframes, lightningTiming);
    impactGlow.animate([
      { opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)', offset: 0.1 },
      { opacity: 0, transform: 'scale(1.4)' },
    ], lightningTiming);
    screenFlash.animate([
      { opacity: 0 }, { opacity: 0.22, offset: 0.06 }, { opacity: 0, offset: 0.3 },
      { opacity: 0.12, offset: 0.45 }, { opacity: 0 },
    ], lightningTiming);
  }

  /** Particelle di cenere (e qualche brace) che si staccano da sinistra a destra, in sincronia con la dissolvenza. */
  function scatterAsh(overlayLayer, commentRect) {
    const ashParticleCount = Math.min(ASH_PARTICLE_MAX_COUNT, Math.max(30, Math.round((commentRect.width * commentRect.height) / 180)));

    for (let particleIndex = 0; particleIndex < ashParticleCount; particleIndex += 1) {
      const isEmber = Math.random() < 0.15;
      const particleSize = isEmber ? randomBetween(2, 3.5) : randomBetween(2, 5);
      const particleOriginX = commentRect.left + Math.random() * commentRect.width;
      const particleOriginY = commentRect.top + Math.random() * commentRect.height;
      const particleColor = isEmber
        ? EMBER_PARTICLE_COLORS[Math.floor(Math.random() * EMBER_PARTICLE_COLORS.length)]
        : ASH_PARTICLE_COLORS[Math.floor(Math.random() * ASH_PARTICLE_COLORS.length)];

      const ashParticle = document.createElement('div');
      ashParticle.style.cssText = `position:absolute;left:${particleOriginX}px;top:${particleOriginY}px;`
        + `width:${particleSize}px;height:${particleSize}px;background:${particleColor};`
        + `border-radius:${Math.random() < 0.5 ? '50%' : '1px'};opacity:0;`
        + (isEmber ? `box-shadow:0 0 6px 1px ${particleColor};` : '');
      overlayLayer.appendChild(ashParticle);

      const horizontalDrift = randomBetween(-25, 70);
      const riseHeight = randomBetween(15, 60);
      const fallDepth = isEmber ? randomBetween(-40, 0) : randomBetween(20, 90);
      const spinDegrees = randomBetween(-360, 360);
      const detachDelayMs = ((particleOriginX - commentRect.left) / commentRect.width) * DISSOLVE_DURATION_MS;

      ashParticle.animate([
        { opacity: 0, transform: 'translate(0, 0) rotate(0deg) scale(1)' },
        { opacity: 1, transform: 'translate(0, 0) rotate(0deg) scale(1)', offset: 0.04 },
        { opacity: 0.9, transform: `translate(${horizontalDrift * 0.4}px, ${-riseHeight}px) rotate(${spinDegrees * 0.4}deg) scale(.9)`, offset: 0.35 },
        { opacity: 0, transform: `translate(${horizontalDrift}px, ${fallDepth - riseHeight * 0.3}px) rotate(${spinDegrees}deg) scale(.2)` },
      ], {
        duration: randomBetween(ASH_PARTICLE_MIN_LIFETIME_MS, ASH_PARTICLE_MAX_LIFETIME_MS),
        delay: detachDelayMs,
        easing: 'cubic-bezier(.2,.6,.4,1)',
        fill: 'both',
      });
    }
  }

  async function collapseElement(element) {
    const computedStyle = getComputedStyle(element);
    const currentHeight = element.getBoundingClientRect().height;
    element.style.setProperty('overflow', 'hidden', 'important');
    await element.animate([
      { height: `${currentHeight}px`, marginTop: computedStyle.marginTop, marginBottom: computedStyle.marginBottom },
      { height: '0px', marginTop: '0px', marginBottom: '0px' },
    ], { duration: COLLAPSE_DURATION_MS, easing: 'ease-in-out', fill: 'forwards' }).finished;
  }

  function hideCommentImmediately(commentArticle) {
    commentArticle.style.setProperty('display', 'none', 'important');
  }

  /** Fulmine (opzionale) → lampo e tremolio → carbonizzazione → dissolvenza in cenere → chiusura dello spazio. */
  async function incinerateComment(commentArticle, withLightning) {
    const overlayLayer = createIncinerationOverlay();
    try {
      if (withLightning) {
        strikeLightning(overlayLayer, commentArticle.getBoundingClientRect());
        commentArticle.animate([
          { filter: 'brightness(1)', transform: 'translate(0, 0)' },
          { filter: 'brightness(2.6) saturate(0)', transform: 'translate(-3px, 1px)', offset: 0.15 },
          { filter: 'brightness(1.2)', transform: 'translate(3px, -1px)', offset: 0.35 },
          { filter: 'brightness(2.2) saturate(0)', transform: 'translate(-2px, 0)', offset: 0.55 },
          { filter: 'brightness(1)', transform: 'translate(0, 0)' },
        ], { duration: LIGHTNING_FLASH_DURATION_MS });
        await sleep(LIGHTNING_FLASH_DURATION_MS * 0.7);
      }

      await commentArticle.animate([
        { filter: 'none' },
        { filter: 'sepia(1) saturate(4) hue-rotate(-25deg) brightness(.9)', offset: 0.45 },
        { filter: 'grayscale(1) brightness(.18) contrast(1.3)' },
      ], { duration: CHARRING_DURATION_MS, fill: 'forwards' }).finished;

      scatterAsh(overlayLayer, commentArticle.getBoundingClientRect());
      await commentArticle.animate([
        { clipPath: 'inset(0 0 0 0)' },
        { clipPath: 'inset(0 0 0 100%)' },
      ], { duration: DISSOLVE_DURATION_MS, easing: 'linear', fill: 'forwards' }).finished;

      await collapseElement(commentArticle);
    } finally {
      hideCommentImmediately(commentArticle);
      setTimeout(() => overlayLayer.remove(), ASH_PARTICLE_MAX_LIFETIME_MS);
    }
  }

  /**
   * Nasconde un commento una sola volta. Con animate: true e il commento visibile a schermo
   * parte l'effetto cenere (withLightning aggiunge il fulmine); altrimenti sparisce subito.
   */
  function hideCommentArticle(commentArticle, { animate = false, withLightning = false } = {}) {
    if (commentArticle.hasAttribute(INCINERATED_COMMENT_MARKER_ATTRIBUTE)) return;
    commentArticle.setAttribute(INCINERATED_COMMENT_MARKER_ATTRIBUTE, 'true');

    const shouldPlayEffect = ENABLE_INCINERATION_EFFECT && animate
      && !prefersReducedMotion() && isElementInViewport(commentArticle);
    if (!shouldPlayEffect) {
      hideCommentImmediately(commentArticle);
      return;
    }

    incinerateComment(commentArticle, withLightning).catch((effectError) => {
      console.warn('[Zap Block] Effetto non riuscito, commento nascosto direttamente', effectError);
    });
  }

  function hideAllCommentsByAuthor(profileKey) {
    let hiddenCommentCount = 0;
    document.querySelectorAll(`[role="article"][${COMMENT_AUTHOR_KEY_ATTRIBUTE}]`).forEach((commentArticle) => {
      if (commentArticle.getAttribute(COMMENT_AUTHOR_KEY_ATTRIBUTE) === profileKey) {
        hideCommentArticle(commentArticle, { animate: true });
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

        // Il commento su cui si è cliccato va per primo, così è lui a prendersi il fulmine.
        // Fa anche da ripiego se l'attributo dell'autore si è perso in un re-render.
        const clickedCommentArticle = zapButton.closest('[role="article"]');
        if (clickedCommentArticle) hideCommentArticle(clickedCommentArticle, { animate: true, withLightning: true });

        const hiddenCommentCount = hideAllCommentsByAuthor(profileKey);

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
