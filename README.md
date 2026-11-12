<div align="center">
  <h1>Facebook Zapper</h1>
  <p>
    <img src="https://img.shields.io/badge/Facebook-Web-1877F2?style=flat&logo=facebook&logoColor=white" alt="Facebook" />
    <img src="https://img.shields.io/badge/Tampermonkey-Userscript_1.11.0-00485B?style=flat&logo=tampermonkey&logoColor=white" alt="Tampermonkey" />
    <img src="https://img.shields.io/badge/JavaScript-ES2020+-F7DF1E?style=flat&logo=javascript&logoColor=white" alt="JavaScript" />
  </p>
</div>

Uno userscript che aggiunge un pulsante ⚡ accanto all'autore di ogni commento e di ogni post su Facebook, nel feed e nei risultati di ricerca: un clic e il profilo viene bloccato in una scheda in background, senza lasciare la pagina che stai leggendo. Pensato per chi vuole tenere pulito il proprio feed senza ripetere ogni volta la trafila di cinque clic.

🇮🇹 Pensato per l’interfaccia italiana, compatibile anche con quella inglese 🇬🇧

## Funzionalità

- **Blocco con un clic** – un pulsante ⚡ viene inserito subito dopo il nome dell'autore in ogni commento e risposta.
- **Blocco anche dai post** – lo stesso pulsante compare accanto all'autore dei post, sia nel feed sia nei risultati di ricerca. Funziona anche con le Pagine e con gli autori dei post di gruppo.
- **Automazione in background** – il profilo dell'autore si apre in una scheda non attiva, dove lo script clicca da solo "…" → "Blocca" → "Conferma" e poi chiude la scheda.
- **Stato in tempo reale sul pulsante** – ⚡ pronto, ⏳ in corso, ✅ bloccato, ⚠️ non riuscito (in caso di errore la scheda resta aperta per controllare cosa è successo).
- **Conferma opzionale** – un dialog `confirm()` prima di ogni blocco, per evitare zap accidentali.
- **Nasconde commenti e post dell'autore bloccato** – tutti i suoi commenti e post nella pagina spariscono subito, compresi quelli caricati in seguito scorrendo.
- **Effetto fulmine + cenere** – il commento o post cliccato viene colpito da un fulmine, si carbonizza, si dissolve in cenere e si richiude. Rispetta l'impostazione di sistema "riduci movimento" e parte solo per gli elementi visibili a schermo.
- **Bilingue** – riconosce l'interfaccia di Facebook in italiano e in inglese.
- **Riconoscimento robusto dei profili** – gestisce gli URL personalizzati, `profile.php?id=…` e i link ai membri dei gruppi (`/groups/…/user/…`), ed esclude i percorsi che non sono profili (pagine, gruppi, eventi, foto, reel, link esterni `l.php`…).
- **Diagnostica integrata** – quando un blocco fallisce, la scheda in background scrive in console i pulsanti, le voci di menu e i pulsanti dei dialog trovati, così è facile aggiornare i selettori.

## Stack tecnologico

- JavaScript puro (ES2020+), nessuna dipendenza e nessuna fase di build
- API del gestore di userscript: `GM_openInTab`, `GM_setValue`, `GM_deleteValue`, `GM_addValueChangeListener`
- Web Animations API per l'effetto di incenerimento, SVG inline per il fulmine
- `MutationObserver` + `requestAnimationFrame` per elaborare commenti e post caricati dinamicamente

## Requisiti

- Un browser desktop (Chrome, Edge, Firefox, Brave…)
- Un gestore di userscript che supporti le API `GM_*` indicate sopra, ad esempio **Tampermonkey** o **Violentmonkey**
  (Greasemonkey 4 non è supportato: espone solo le API asincrone `GM.*` e non ha `GM_addValueChangeListener`)
- Essere loggati su `https://www.facebook.com`

## Installazione

1. Installa Tampermonkey o Violentmonkey nel browser.
2. Crea un nuovo userscript dalla dashboard del gestore.
3. Incolla l'intero contenuto dello script (salvandolo ad esempio come `facebook-zap-block.user.js`) e salva.
4. Verifica che lo script sia attivo, poi ricarica una qualsiasi pagina di Facebook.
5. Nei browser basati su Chromium con Tampermonkey potrebbe essere necessario attivare "Consenti script utente" / la modalità sviluppatore per l'estensione.

## Configurazione

Non c'è un file `.env`: le opzioni sono costanti in cima allo script, nella sezione `Configurazione`.

| Costante | Default | Descrizione |
| --- | --- | --- |
| `REQUIRE_CONFIRMATION_BEFORE_BLOCK` | `true` | Chiede conferma prima di bloccare. |
| `HIDE_COMMENTS_AFTER_BLOCK` | `true` | Nasconde dalla pagina tutti i commenti e i post dell'autore bloccato. |
| `ENABLE_INCINERATION_EFFECT` | `true` | Riproduce l'animazione fulmine + cenere quando commenti e post vengono nascosti. |
| `LIGHTNING_FLASH_DURATION_MS` | `380` | Durata del lampo del fulmine. |
| `CHARRING_DURATION_MS` | `200` | Durata della fase di carbonizzazione. |
| `DISSOLVE_DURATION_MS` | `380` | Durata della dissolvenza in cenere. |
| `COLLAPSE_DURATION_MS` | `160` | Durata della chiusura finale dello spazio dell'elemento. |
| `ASH_PARTICLE_MAX_COUNT` | `140` | Numero massimo di particelle di cenere per elemento. |
| `ASH_PARTICLE_MIN_LIFETIME_MS` / `ASH_PARTICLE_MAX_LIFETIME_MS` | `500` / `900` | Intervallo di durata di ogni particella. |
| `COMMENT_ZAP_BUTTON_FONT_SIZE_PX` / `POST_ZAP_BUTTON_FONT_SIZE_PX` | `12` / `14` | Dimensione del pulsante ⚡ nei commenti e nei post. |
| `ELEMENT_WAIT_TIMEOUT_MS` | `15000` | Attesa massima per ogni elemento del flusso di blocco. |
| `EXACT_LABEL_WAIT_TIMEOUT_MS` | `10000` | Attesa massima del pulsante "…" con etichetta esatta prima di passare ai ripieghi. |
| `ELEMENT_POLL_INTERVAL_MS` | `300` | Intervallo di polling durante l'attesa degli elementi. |
| `PAUSE_AFTER_CONFIRM_MS` | `2000` | Pausa prima di chiudere la scheda in background dopo un blocco riuscito. |

I testi e i selettori usati per trovare gli elementi di Facebook si possono estendere ad altre lingue o a nuovi markup:

- `PROFILE_OPTIONS_BUTTON_LABELS` / `PROFILE_OPTIONS_PARTIAL_LABELS` – aria-label del pulsante "…" nell'intestazione del profilo
- `BLOCK_MENU_ITEM_TEXTS` – testo della voce di menu "Blocca"
- `CONFIRM_BLOCK_BUTTON_TEXTS` – testo del pulsante di conferma nel dialog di blocco
- `COMMENT_ARIA_LABEL_PREFIXES` – prefissi dell'aria-label che identificano commenti e risposte
- `POST_ACTIONS_ARIA_LABEL_PREFIXES` – prefissi dell'aria-label del pulsante "…" dei post ("Azioni per questo post di …"), da cui si legge il nome dell'autore
- `POST_CONTAINER_SELECTOR`, `POST_PROFILE_NAME_LINK_SELECTOR`, `POST_HEADER_FALLBACK_LINK_SELECTOR` – ripiego per i post il cui "…" non viene riconosciuto
- `POST_MESSAGE_BODY_SELECTOR` – corpo del post, i cui link (menzioni, link nel testo) non vengono mai presi per l'autore
- `NON_PROFILE_PATH_SEGMENTS` – primi segmenti di URL che non sono mai profili

## Script disponibili

Nessuno. Il progetto è un unico userscript autosufficiente: non ci sono package manager, comandi di build o di test.

## Test

Non ci sono test automatici. Per verificare lo script a mano:

1. Apri un post con dei commenti e controlla che accanto a ogni autore compaia un ⚡.
2. Apri il feed e una ricerca di post (`/search/posts/?q=…`) e controlla che il ⚡ compaia anche accanto al nome dell'autore di ogni post.
3. Esegui lo zap su un profilo di prova e osserva il pulsante passare da ⏳ a ✅ (o ⚠️).
4. Apri la console dei DevTools e filtra per `[Zap Block]`:
   - nella scheda di origine vedrai quanti post e commenti sono stati nascosti;
   - nella scheda del profilo in background (che resta aperta in caso di errore) vedrai il passaggio fallito e una tabella con i pulsanti, le voci di menu e i pulsanti dei dialog trovati, utile per aggiornare le costanti delle etichette quando Facebook cambia il markup.

## Struttura del progetto

```text
.
└── facebook-zap-block.user.js   # L'intero userscript
```

Internamente lo script è diviso in sezioni:

| Sezione | Responsabilità |
| --- | --- |
| `Configurazione` | Flag delle funzionalità, tempi, etichette dell'interfaccia, selettori, chiavi di storage e attributi marcatori. |
| `Utility` | Funzioni di attesa, normalizzazione del testo, conversione profilo ↔ chiave/URL (`id:…` / `user:…`). |
| `Scheda del profilo` | Gira nella scheda in background: trova "…" → "Blocca" → "Conferma" e scrive l'esito nello storage GM. |
| `Pagine con commenti` | Riconosce i commenti, inserisce il pulsante ⚡, apre la scheda in background e attende l'esito. |
| `Post (feed e ricerche)` | Riconosce i post dall'etichetta del loro "…", trova il link dell'autore e il contenitore da nascondere. |
| `Effetto fulmine + cenere` | Overlay, fulmine, carbonizzazione, particelle di cenere e animazione di chiusura. |
| `Avvio` | Sceglie la modalità dall'URL iniziale: blocco automatico se contiene `#zap-block=…`, altrimenti osserva commenti e post. |

### Come funziona

1. Il clic su ⚡ apre `https://www.facebook.com/<profilo>#zap-block=<chiaveProfilo>` in una scheda non attiva.
2. Lo script, eseguito a `document-start` in quella scheda, legge l'hash prima che Facebook riscriva l'URL e avvia il flusso di blocco.
3. L'esito (`blocked` / `failed`) viene salvato con `GM_setValue` nella chiave `zapBlockResult:<chiaveProfilo>`.
4. La scheda di origine, in ascolto con `GM_addValueChangeListener`, aggiorna il pulsante, nasconde post e commenti dell'autore e chiude la scheda in background dopo `PAUSE_AFTER_CONFIRM_MS`.

### Come vengono riconosciuti i post

I post vengono riconosciuti come i commenti, partendo da un'aria-label che contiene il nome dell'autore:

1. Si cercano i pulsanti "…" con aria-label che inizia con uno dei `POST_ACTIONS_ARIA_LABEL_PREFIXES` (ad esempio "Azioni per questo post di Mario Rossi") e si legge il nome dopo il prefisso.
2. Risalendo dal "…" si cerca il primo link il cui testo è esattamente quel nome e che punta a un profilo valido: è il nome nell'intestazione, non un "è con …" o una menzione.
3. Il ⚡ viene inserito subito dopo quel link. Il "…" viene marcato come processato solo quando il link è stato trovato, perché l'intestazione può arrivare dopo.
4. Il contenitore da nascondere è l'unità del feed (`[aria-posinset]`) se c'è, altrimenti il figlio diretto di `[role="feed"]`, che nei risultati di ricerca è il risultato intero.

Per i post il cui "…" non viene riconosciuto resta un ripiego basato sui contenitori (`[aria-posinset]`, `[role="article"]`) e sui link dell'intestazione.

## Distribuzione

Per rilasciare una nuova versione, incrementa `@version` nel blocco di metadati dello userscript e aggiorna lo script nel gestore. Se pubblichi il file da qualche parte (ad esempio un repository GitHub o Greasy Fork), puoi aggiungere `@updateURL` / `@downloadURL` ai metadati, così il gestore rileva gli aggiornamenti in automatico.

> **Nota:** lo script dipende dal markup e dalle aria-label di Facebook, che cambiano spesso. Quando il blocco inizia a fallire, controlla la diagnostica nella console della scheda in background e aggiorna di conseguenza le costanti delle etichette.

> **Attenzione ai blocchi in serie:** Facebook limita le azioni ripetute in poco tempo. Molti zap di fila possono far scattare una sospensione temporanea di alcune funzioni dell'account: meglio distribuirli nel tempo.
