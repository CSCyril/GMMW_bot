// ==UserScript==
// @name         GoMining Participants Abilities Tracker + Price (filtered + league + name)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Cumule usedAbilities par nftGameAbilityId et calcule le total priceInGMT pour des participants spécifiques sur tous les rounds d'un cycle et d'une league donnée, avec le nom de l'ability
// @match        https://app.gomining.com/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @updateURL    https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_abilities_tracker.user.js
// @downloadURL  https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_abilities_tracker.user.js
// ==/UserScript==

(function() {
    'use strict';

    function getAccessToken() {
        const match = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
        return match ? match[1] : null;
    }

    function postRequest(url, data, token) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                data: JSON.stringify(data),
                headers: {
                    "accept": "application/json, text/plain, */*",
                    "content-type": "application/json",
                    "authorization": "Bearer " + token,
                    "origin": "https://app.gomining.com",
                    "referer": "https://app.gomining.com/",
                    "x-device-type": "desktop",
                    "cookie": "access_token=" + token
                },
                onload: function(response) {
                    try {
                        const json = JSON.parse(response.responseText);
                        resolve(json);
                    } catch (e) {
                        console.error("❌ Impossible de parser JSON:", e);
                        resolve(null);
                    }
                },
                onerror: function(err) {
                    console.error("❌ Erreur réseau:", err);
                    resolve(null);
                }
            });
        });
    }

    async function fetchAllRoundIds(cycleId, leagueId = 4) {
        const token = getAccessToken();
        if (!token) { console.error("❌ Impossible de trouver access_token"); return []; }

        const limit = 50;
        let skip = 0;
        let allIds = [];

        const firstPage = await postRequest("https://api.gomining.com/api/nft-game/round/find-by-cycleId", {
            cycleId,
            multipliers: [1,2,4,8,16,32,64],
            pagination: {limit, skip, count:0},
            leagueId
        }, token);

        const total = firstPage?.data?.count || 0;
        allIds.push(...firstPage.data.array.map(it => it.id));

        for(skip = limit; skip < total; skip += limit) {
            const page = await postRequest("https://api.gomining.com/api/nft-game/round/find-by-cycleId", {
                cycleId,
                multipliers: [1,2,4,8,16,32,64],
                pagination: {limit, skip, count:0},
                leagueId
            }, token);

            if(Array.isArray(page.data.array)) {
                allIds.push(...page.data.array.map(it => it.id));
            }
        }

        return allIds;
    }

    async function fetchAbilitiesPriceMap() {
        const token = getAccessToken();
        if (!token) { console.error("❌ Impossible de trouver access_token"); return {}; }

        const response = await postRequest("https://api.gomining.com/api/nft-game/nft-game-ability/find-all", {}, token);
        const array = response?.data?.array || [];
        const priceMap = {};
        array.forEach(a => priceMap[a.id] = { priceInGMT: a.priceInGMT || 0, name: a.name || "Unknown" });
        return priceMap;
    }

    async function getParticipantsAbilities(cycleId, filterNames = [], leagueId = 4) {
        const token = getAccessToken();
        if (!token) { console.error("❌ Impossible de trouver access_token"); return []; }

        const roundIds = await fetchAllRoundIds(cycleId, leagueId);
        console.log(`📦 Total rounds: ${roundIds.length} (league ${leagueId})`);

        const priceMap = await fetchAbilitiesPriceMap();
        const participantsMap = {}; // { name -> { nftGameAbilityId -> totalCount } }

        for(const roundId of roundIds) {
            const leaderboard = await postRequest("https://api.gomining.com/api/nft-game/round/user-leaderboard", {
                roundId,
                pagination: { limit: 20, skip: 0, count: 0 }
            }, token);

            if(leaderboard?.data?.participants) {
                for(const p of leaderboard.data.participants) {
                    const name = p.user.alias;
                    if(filterNames.length && !filterNames.includes(name)) continue;

                    if(!participantsMap[name]) participantsMap[name] = {};

                    for(const ability of p.usedAbilities) {
                        const id = ability.nftGameAbilityId;
                        const count = ability.count || 0;
                        if(participantsMap[name][id]) {
                            participantsMap[name][id] += count;
                        } else {
                            participantsMap[name][id] = count;
                        }
                    }
                }
            }
            console.log(`✅ Round ${roundId} traité`);
        }

        // Transformer en tableau avec name de l'ability et price
        const result = Object.entries(participantsMap).map(([name, abilities]) => {
            const detailedAbilities = Object.entries(abilities).map(([id, count]) => {
                const priceInGMT = priceMap[id]?.priceInGMT || 0;
                const abilityName = priceMap[id]?.name || id;
                return { name: abilityName, count, priceInGMT, totalPrice: priceInGMT * count };
            });

            const totalGMT = detailedAbilities.reduce((sum, a) => sum + a.totalPrice, 0);

            return { name, abilities: detailedAbilities, totalGMT };
        });

        console.log("🎯 Résultat final filtré + nom + prix:", result);
        return result;
    }

    // Expose
    unsafeWindow.getParticipantsAbilities = getParticipantsAbilities;
    console.log("🔧 Utilise getParticipantsAbilities(cycleId, [names], leagueId) pour lancer le calcul filtré par league avec nom et priceInGMT");
})();
