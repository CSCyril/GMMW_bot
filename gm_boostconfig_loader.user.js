// ==UserScript==
// @name         GoMining BoostConfig Loader
// @version      1.4
// @description  Charge la configuration des boosts depuis un document externe (incluant les timeRanges)
// @author       CyrilG.
// @match        https://app.gomining.com/*
// @grant        GM_xmlhttpRequest
// @connect      githubusercontent.com
// @updateURL    https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_boostconfig_loader.user.js
// @downloadURL  https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_boostconfig_loader.user.js
// ==/UserScript==

(function () {
    const CONFIG_URL = "https://raw.githubusercontent.com/CSCyril/GMMW_bot/refs/heads/main/config";

    function resolveConfig(raw) {
        const { boostIds, config } = raw;
        const clickDelays = {};
        const sequenceDelays = {};
        const timeRanges = {}; // Ajout d'un objet pour stocker les timeRanges

        for (const [groupName, group] of Object.entries(config)) {
            for (const [levelName, level] of Object.entries(group)) {
                // Stocker les timeRanges pour chaque niveau
                timeRanges[`${groupName}_${levelName}`] = level.timeRanges;

                for (const multKey of Object.keys(level.config)) {
                    level.config[multKey] = level.config[multKey].map(entry => {
                        if (entry.boostId) { // Vérifiez si l'entrée a un boostId
                            const originalId = entry.boostId;
                            const uuid = boostIds[originalId] || originalId;
                            if (entry.timing) {
                                clickDelays[uuid] = entry.timing.clickDelay;
                                sequenceDelays[uuid] = entry.timing.sequenceDelay;
                                delete entry.timing;
                            }
                            return {
                                boostId: uuid,
                                count: entry.count,
                                priority: entry.priority
                            };
                        } else {
                            // Gérer les entrées sans boostId (par exemple, des objets vides)
                            return {};
                        }
                    }).filter(entry => entry.boostId); // Filtrer les entrées sans boostId
                }
            }
        }

        return { boostConfig: config, clickDelays, sequenceDelays, timeRanges };
    }

    GM_xmlhttpRequest({
        method: "GET",
        url: CONFIG_URL,
        headers: { "Accept": "application/json" },
        onload: (res) => {
            try {
                const raw = JSON.parse(res.responseText);
                const parsed = resolveConfig(raw);
                localStorage.setItem("gomining_boost_config", JSON.stringify(parsed.boostConfig));
                localStorage.setItem("gomining_click_delays", JSON.stringify(parsed.clickDelays));
                localStorage.setItem("gomining_sequence_delays", JSON.stringify(parsed.sequenceDelays));
                localStorage.setItem("gomining_time_ranges", JSON.stringify(parsed.timeRanges)); // Stocker les timeRanges
                console.log("[TM:Config] 📦 Boost config (with timeRanges) enregistrée avec succès");
            } catch (e) {
                console.warn("[TM:Config] ❌ Erreur parsing config :", e);
            }
        },
        onerror: (err) => {
            console.warn("[TM:Config] ❌ Erreur HTTP config :", err);
        }
    });
})();
