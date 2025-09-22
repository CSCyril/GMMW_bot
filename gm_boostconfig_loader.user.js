// ==UserScript==
// @name         GoMining BoostConfig Loader (Flat Fixed)
// @version      1.6
// @description  Charge la configuration des boosts depuis un document externe (aplanie et avec timings)
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
        const flatConfig = {};
        const timeRanges = {};

        for (const [groupName, group] of Object.entries(config)) {
            for (const [levelName, level] of Object.entries(group)) {
                for (const [multKey, multConfig] of Object.entries(level.config)) {
                    const key = `${groupName}_${levelName}_${multKey}`;

                    // Remplacer les boostIds par leurs UUIDs et garder timing
                    const boosts = (multConfig.boosts || [])
                        .map(entry => {
                            if (!entry.boostId) return null;
                            const originalId = entry.boostId;
                            const uuid = boostIds[originalId] || originalId;
                            return {
                                boostId: uuid,
                                count: entry.count,
                                priority: entry.priority,
                                timing: entry.timing // ✅ garder timing
                            };
                        })
                        .filter(Boolean);

                    flatConfig[key] = {
                        timeRanges: multConfig.timeRanges || level.timeRanges || [],
                        boosts
                    };

                    timeRanges[key] = flatConfig[key].timeRanges;
                }
            }
        }

        return { boostConfig: flatConfig, timeRanges };
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
                localStorage.setItem("gomining_time_ranges", JSON.stringify(parsed.timeRanges));

                console.log("[TM:Config] 📦 Boost config corrigée enregistrée avec succès");
            } catch (e) {
                console.warn("[TM:Config] ❌ Erreur parsing config :", e);
            }
        },
        onerror: (err) => {
            console.warn("[TM:Config] ❌ Erreur HTTP config :", err);
        }
    });
})();
