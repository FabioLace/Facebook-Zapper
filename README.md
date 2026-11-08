<div align="center">
  <h1>Facebook Zapper</h1>
  <p>
    <img src="https://img.shields.io/badge/Facebook-Web-1877F2?style=flat&logo=facebook&logoColor=white" alt="Facebook" />
    <img src="https://img.shields.io/badge/Tampermonkey-Userscript_1.8.0-00485B?style=flat&logo=tampermonkey&logoColor=white" alt="Tampermonkey" />
    <img src="https://img.shields.io/badge/JavaScript-ES2019+-F7DF1E?style=flat&logo=javascript&logoColor=white" alt="JavaScript" />
  </p>
</div>

Uno userscript che aggiunge un pulsante ⚡ accanto all'autore di ogni commento su Facebook: un clic e il profilo viene bloccato in una scheda in background, senza lasciare la pagina che stai leggendo. Pensato per chi vuole tenere pulito il proprio feed senza ripetere ogni volta la trafila di cinque clic.
🇮🇹 Pensato per l’interfaccia italiana, compatibile anche con quella inglese 🇬🇧

## Funzionalità

- **Blocco con un clic** – un pulsante ⚡ viene inserito subito dopo il nome dell'autore in ogni commento e risposta.
- **Automazione in background** – il profilo dell'autore si apre in una scheda non attiva, dove lo script clicca da solo "…" → "Blocca" → "Conferma" e poi chiude la scheda.
- **Stato in tempo reale sul pulsante** – ⚡ pronto, ⏳ in corso, ✅ bloccato, ⚠️ non riuscito (in caso di errore la scheda resta aperta per controllare cosa è successo).
- **Conferma opzionale** – un dialog `confirm()` prima di ogni blocco, per evitare zap accidentali.
- **Nasconde i commenti dell'autore bloccato** – tutti i suoi commenti nella pagina spariscono subito, compresi quelli caricati in seguito scorrendo.
- **Effetto fulmine + cenere** – il commento cliccato viene colpito da un fulmine, si carbonizza, si dissolve in cenere e si richiude. Rispetta l'impostazione di sistema "riduci movimento" e parte solo per i commenti visibili a schermo.
- **Bilingue** – riconosce l'interfaccia di Facebook in italiano e in inglese.
- **Riconoscimento robusto dei profili** – gestisce gli URL personalizzati, `profile.php?id=…` e i link ai membri dei gruppi (`/groups/…/user/…`), ed esclude i percorsi che non sono profili (pagine, gruppi, eventi, foto, reel…).
- **Diagnostica integrata** – quando un blocco fallisce, la scheda in background scrive in console i pulsanti, le voci di menu e i pulsanti dei dialog trovati, così è facile aggiornare i selettori.

## Stack tecnologico

- JavaScript puro (ES2019+), nessuna dipendenza e nessuna fase di build
- API del gestore di userscript: `GM_openInTab`, `GM_setValue`, `GM_deleteValue`, `GM_addValueChangeListener`
- Web Animations API per l'effetto di incenerimento, SVG inline per il fulmine
- `MutationObserver` + `requestAnimationFrame` per elaborare i commenti caricati dinamicamente

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
| `HIDE_COMMENTS_AFTER_BLOCK` | `true` | Nasconde dalla pagina tutti i commenti dell'autore bloccato. |
| `ENABLE_INCINERATION_EFFECT` | `true` | Riproduce l'animazione fulmine + cenere quando i commenti vengono nascosti. |
| `LIGHTNING_FLASH_DURATION_MS` | `380` | Durata del lampo del fulmine. |
| `CHARRING_DURATION_MS` | `200` | Durata della fase di carbonizzazione. |
| `DISSOLVE_DURATION_MS` | `380` | Durata della dissolvenza in cenere. |
| `COLLAPSE_DURATION_MS` | `160` | Durata della chiusura finale dello spazio del commento. |
| `ASH_PARTICLE_MAX_COUNT` | `140` | Numero massimo di particelle di cenere per commento. |
| `ASH_PARTICLE_MIN_LIFETIME_MS` / `ASH_PARTICLE_MAX_LIFETIME_MS` | `500` / `900` | Intervallo di durata di ogni particella. |
| `ELEMENT_WAIT_TIMEOUT_MS` | `15000` | Attesa massima per ogni elemento del flusso di blocco. |
| `EXACT_LABEL_WAIT_TIMEOUT_MS` | `10000` | Attesa massima del pulsante "…" con etichetta esatta prima di passare ai ripieghi. |
| `ELEMENT_POLL_INTERVAL_MS` | `300` | Intervallo di polling durante l'attesa degli elementi. |
| `PAUSE_AFTER_CONFIRM_MS` | `2000` | Pausa prima di chiudere la scheda in background dopo un blocco riuscito. |

I testi usati per trovare gli elementi di Facebook si possono estendere ad altre lingue:

- `PROFILE_OPTIONS_BUTTON_LABELS` / `PROFILE_OPTIONS_PARTIAL_LABELS` – aria-label del pulsante "…" nell'intestazione del profilo
- `BLOCK_MENU_ITEM_TEXTS` – testo della voce di menu "Blocca"
- `CONFIRM_BLOCK_BUTTON_TEXTS` – testo del pulsante di conferma nel dialog di blocco
- `COMMENT_ARIA_LABEL_PREFIXES` – prefissi dell'aria-label che identificano commenti e risposte
- `NON_PROFILE_PATH_SEGMENTS` – primi segmenti di URL che non sono mai profili

## Script disponibili

Nessuno. Il progetto è un unico userscript autosufficiente: non ci sono package manager, comandi di build o di test.

## Test

Non ci sono test automatici. Per verificare lo script a mano:

1. Apri un post con dei commenti e controlla che accanto a ogni autore compaia un ⚡.
2. Esegui lo zap su un profilo di prova e osserva il pulsante passare da ⏳ a ✅ (o ⚠️).
3. Apri la console dei DevTools e filtra per `[Zap Block]`:
   - nella scheda di origine vedrai quanti commenti sono stati nascosti;
   - nella scheda del profilo in background (che resta aperta in caso di errore) vedrai il passaggio fallito e una tabella con i pulsanti, le voci di menu e i pulsanti dei dialog trovati, utile per aggiornare le costanti delle etichette quando Facebook cambia il markup.

## Struttura del progetto

```text
.
└── facebook-zap-block.user.js   # L'intero userscript
```

Internamente lo script è diviso in sezioni:

| Sezione | Responsabilità |
| --- | --- |
| `Configurazione` | Flag delle funzionalità, tempi, etichette dell'interfaccia, chiavi di storage e attributi marcatori. |
| `Utility` | Funzioni di attesa, normalizzazione del testo, conversione profilo ↔ chiave/URL (`id:…` / `user:…`). |
| `Scheda del profilo` | Gira nella scheda in background: trova "…" → "Blocca" → "Conferma" e scrive l'esito nello storage GM. |
| `Pagine con commenti` | Riconosce i commenti, inserisce il pulsante ⚡, apre la scheda in background e attende l'esito. |
| `Effetto fulmine + cenere` | Overlay, fulmine, carbonizzazione, particelle di cenere e animazione di chiusura. |
| `Avvio` | Sceglie la modalità dall'URL iniziale: blocco automatico se contiene `#zap-block=…`, altrimenti osserva i commenti. |

### Come funziona

1. Il clic su ⚡ apre `https://www.facebook.com/<profilo>#zap-block=<chiaveProfilo>` in una scheda non attiva.
2. Lo script, eseguito a `document-start` in quella scheda, legge l'hash prima che Facebook riscriva l'URL e avvia il flusso di blocco.
3. L'esito (`blocked` / `failed`) viene salvato con `GM_setValue` nella chiave `zapBlockResult:<chiaveProfilo>`.
4. La scheda di origine, in ascolto con `GM_addValueChangeListener`, aggiorna il pulsante, nasconde i commenti dell'autore e chiude la scheda in background dopo `PAUSE_AFTER_CONFIRM_MS`.

## Distribuzione

Per rilasciare una nuova versione, incrementa `@version` nel blocco di metadati dello userscript e aggiorna lo script nel gestore. Se pubblichi il file da qualche parte (ad esempio un repository GitHub o Greasy Fork), puoi aggiungere `@updateURL` / `@downloadURL` ai metadati, così il gestore rileva gli aggiornamenti in automatico.

> **Nota:** lo script dipende dal markup e dalle aria-label di Facebook, che cambiano spesso. Quando il blocco inizia a fallire, controlla la diagnostica nella console della scheda in background e aggiorna di conseguenza le costanti delle etichette.
