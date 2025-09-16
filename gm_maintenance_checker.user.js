// ==UserScript==
// @name         GoMining Maintenance Checker
// @version      1.3
// @description  Maintenance automatique optimisée
// @author       CyrilG.
// @match        https://app.gomining.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_maintenance_checker.user.js
// @downloadURL  https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_maintenance_checker.user.js
// ==/UserScript==

(function () {
    const MAINTENANCE_URL = "https://api.gomining.com/api/action/get-maintenance-state";
    const MAINTENANCE_ID = "2ec728e7-f31f-4df3-b486-5e82a4976563";

    function uuidv4() {
        return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    }

    function nowIso() {
        return new Date().toISOString().replace("T", " ").replace("Z", "");
    }

    function parseDateSafe(dateString) {
        if (!dateString) return null;
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date;
    }

    function getBearer() {
        let token = localStorage.getItem('access_token');
        if (token) return token;
        const match = document.cookie.match(/access_token=([^;]+)/);
        return match ? match[1] : null;
    }

    async function checkMaintenanceStatus() {
        const bearer = getBearer();
        if (!bearer) {
            console.warn("[TM] ❌ Aucun token d'accès détecté.");
            scheduleNextCheck(5 * 60 * 1000); // recheck dans 5 min
            return;
        }

        try {
            const res = await fetch(MAINTENANCE_URL, {
                method: "POST",
                headers: {
                    "accept": "application/json, text/plain, */*",
                    "authorization": `Bearer ${bearer}`,
                    "x-device-type": "desktop"
                },
                credentials: "include"
            });

            const json = await res.json();
            const updateFrom = parseDateSafe(json?.data?.updateAvailableFrom);

            if (updateFrom) {
                console.log(`[TM][${nowIso()}] ⏱️ updateAvailableFrom = ${updateFrom.toISOString()}`);

                if (Date.now() > updateFrom.getTime()) {
                    console.log("[TM] ✅ Maintenance terminée → envoi WS");
                    if (window.__myws_jeu && window.__myws_jeu.readyState === 1) {
                        const payload = {
                            abilityId: MAINTENANCE_ID,
                            idempotencyKey: uuidv4(),
                            roundId: window._lastRoundId
                        };
                        const msg = "42" + JSON.stringify(["ability", payload]);
                        window.__myws_jeu.send(msg);
                        console.log(`[TM][${nowIso()}] ✅ Ability envoyé via ws.send`, msg);
                    } else {
                        console.warn("[TM] ❌ Aucun canal disponible pour envoyer l'ability");
                    }

                    // Après envoi, on recheck dans 1h pour être sûr
                    scheduleNextCheck(60 * 60 * 1000);

                } else {
                    const delay = updateFrom.getTime() - Date.now() + 5000; // marge de 5s
                    const secondsLeft = Math.floor((delay) / 1000);
                    console.log(`[TM] ⏳ Maintenance active, prochain check dans ${secondsLeft}s`);
                    scheduleNextCheck(delay);
                }
            } else {
                console.warn("[TM] ⚠️ updateAvailableFrom invalide ou absent :", json?.data);
                scheduleNextCheck(5 * 60 * 1000);
            }
        } catch (e) {
            console.warn("[TM] ❌ Erreur requête maintenance :", e);
            scheduleNextCheck(5 * 60 * 1000);
        }
    }

    let nextTimeout = null;
    function scheduleNextCheck(delay) {
        if (nextTimeout) clearTimeout(nextTimeout);
        nextTimeout = setTimeout(checkMaintenanceStatus, delay);
    }

    // === Initialisation ===
    scheduleNextCheck(30 * 1000); // premier check après 30s
})();
